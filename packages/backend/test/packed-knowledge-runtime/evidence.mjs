import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inspect } from "node:util";
import { expect } from "vitest";
import { canonicalProjectId } from "../../src/project-id";
import { SessionEngine } from "../../src/session-engine/engine";
import { packageChildren, run, sha256 } from "./helpers.mjs";

export async function verifyRetainedUiOwner(ctx) {
	ctx.stage = "last-native-close-retains-ui-owner";
	for (const active of [ctx.session, ctx.writeSession]) {
		ctx.sessions.revoke(active.sessionId);
		await new SessionEngine().dispose(active);
		ctx.sessions.delete(active.sessionId);
	}
	ctx.session = undefined;
	ctx.writeSession = undefined;
	await ctx.bootstrap.dispose();
	await ctx.writeBootstrap.dispose();
	const uiOnly = ctx.bridge.selectSession(ctx.window, null);
	expect(await ctx.bridge.invoke(ctx.window, ctx.binding, "overview", null, uiOnly)).toMatchObject({
		state: "bound",
	});
	expect(await packageChildren(ctx.packageRoot)).toEqual(ctx.processes);
	expect(await readdir(join(ctx.leases, "knowledge-writers"))).toHaveLength(2);
	expect(ctx.errors).toEqual([]);
	ctx.reviewScopes.writes = {
		fileGrantRequired: true,
		approvalDeniedWithoutWrite: true,
		crossProjectRejected: true,
		staleProposalRejected: true,
		humanEditRetained: true,
		partial: ctx.partial,
		applied: ctx.applied,
		partialRetryVaultWrites: 1,
		historyAfterApply: ctx.history.items.length,
		undoRestoredProtectedText: true,
		historyAfterUndo: 0,
		nativeCloseRetainsUi: true,
	};
}

export async function collectReceipt(ctx) {
	ctx.stage = "sdk-version-evidence";
	// Resolve the installed ESM package in Node; Vitest's transformed import.meta omits resolve.
	const { stdout: sdkPackageUrl } = await run(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			'process.stdout.write(new URL("../package.json", import.meta.resolve("@earendil-works/pi-coding-agent")).href)',
		],
		{ cwd: ctx.testDirectory },
	);
	const sdk = JSON.parse(await readFile(new URL(sdkPackageUrl), "utf8"));
	expect(sdk.version).toBe("1.1.0");
	ctx.receipt = {
		status: "PASS",
		tarballSha256: sha256(await readFile(ctx.artifact)),
		package: ctx.pkg.name,
		version: ctx.pkg.version,
		manifestId: ctx.manifest.id,
		sdk: sdk.version,
		model: "faux-offline",
		actualReadOnlySession: true,
		actualWritableSdkSession: true,
		productionCapabilityRouting: true,
		tools: ctx.results.map((result) => ({ name: result.toolName, error: result.isError })),
		sameOwnerProcesses: ctx.processes,
		uiOverviewNotes: ctx.overview.index.noteCount,
		searchMatchesNative: true,
		refresh: true,
		readingOperations: ["readNote", "links", "graph", "jobs", "recentByCategory"],
		readingScopes: ctx.readingScopes,
		statePolicy: ctx.stateReceipt,
		reviews: ctx.reviewScopes,
		readingInputSchemas: true,
		pagedReadHashAndLines: true,
		changedHashRejected: true,
		unknownAndWriteExecuted: 0,
		readOnlyWriteHooksDenied: ctx.readOnlyErrors.map((error) => error.event),
		fullHooksAndPublication: "NOT_COVERED_BY_THIS_UI_AND_READ_ONLY_BOUNDARY_PROBE",
	};
}

export async function recordFailure(ctx, error) {
	ctx.failure = new Error(`Packed knowledge acceptance failed at ${ctx.stage}`, { cause: error });
	if (process.env.DRONE_KNOWLEDGE_EVIDENCE) {
		const path = `${resolve(process.env.DRONE_KNOWLEDGE_EVIDENCE)}.failure.json`;
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			`${JSON.stringify({ status: "FAIL", stage: ctx.stage, error: String(error), tarballSha256: sha256(await readFile(ctx.artifact)), workspaceId: canonicalProjectId(ctx.workspace), workspaceDirectory: ctx.workspace }, null, 2)}\n`,
		);
	}
}

export async function cleanupRuntime(ctx) {
	// Separate real shutdown and census phases so a failure identifies its owner.
	async function cleanupPhase(phase, operation) {
		const started = performance.now();
		const [result] = await Promise.allSettled([operation]);
		ctx.cleanup.push({ phase, durationMs: Math.round(performance.now() - started), ...result });
	}
	if (ctx.session) {
		ctx.sessions.revoke(ctx.session.sessionId);
		await cleanupPhase("sdk-dispose", new SessionEngine().dispose(ctx.session));
		ctx.sessions.delete(ctx.session.sessionId);
	}
	if (ctx.writeSession) {
		ctx.sessions.revoke(ctx.writeSession.sessionId);
		await cleanupPhase("writable-sdk-dispose", new SessionEngine().dispose(ctx.writeSession));
		ctx.sessions.delete(ctx.writeSession.sessionId);
	}
	await cleanupPhase("native-bootstrap-dispose", ctx.bootstrap?.dispose());
	await cleanupPhase("writable-native-bootstrap-dispose", ctx.writeBootstrap?.dispose());
	await cleanupPhase("coordinator-close", ctx.bridge?.close());
	await cleanupPhase(
		"knowledge-child-census",
		(async () => {
			if (ctx.packageRoot) expect(await packageChildren(ctx.packageRoot)).toEqual([]);
		})(),
	);
	await cleanupPhase(
		"control-child-census",
		(async () => {
			expect(await packageChildren(ctx.controlsRoot)).toEqual([]);
		})(),
	);
	await cleanupPhase(
		"sqlite-reopen-after-owner-close",
		(async () => {
			for (const directory of await readdir(ctx.cache)) {
				const database = new DatabaseSync(join(ctx.cache, directory, "index.sqlite"));
				try {
					database.exec("BEGIN EXCLUSIVE; ROLLBACK;");
					expect(database.prepare("PRAGMA quick_check").get()).toMatchObject({ quick_check: "ok" });
					ctx.sqliteReopened++;
				} finally {
					database.close();
				}
			}
		})(),
	);
	await cleanupPhase(
		"reservation-census",
		(async () => {
			for (const namespace of await readdir(ctx.leases))
				expect(await readdir(join(ctx.leases, namespace))).toEqual([]);
		})(),
	);
	await cleanupPhase("fixture-remove", rm(ctx.root, { recursive: true, force: true }));
}

export async function finishEvidence(ctx) {
	const failures = ctx.cleanup.filter((result) => result.status === "rejected");
	if (failures.length) {
		if (process.env.DRONE_KNOWLEDGE_EVIDENCE) {
			const path = `${resolve(process.env.DRONE_KNOWLEDGE_EVIDENCE)}.cleanup-failure.txt`;
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, inspect(ctx.cleanup, { depth: 8 }));
		}
		throw new AggregateError(
			[...(ctx.failure ? [ctx.failure] : []), ...failures.map((result) => result.reason)],
			"Packed knowledge cleanup failed",
		);
	}
	if (ctx.failure) throw ctx.failure;
	expect(ctx.sqliteReopened).toBe(1);
	const evidence = {
		...ctx.receipt,
		childrenExited: true,
		reservationsReleased: true,
		sqliteExclusiveReopenAfterExit: ctx.sqliteReopened,
		cleanup: ctx.cleanup.map(({ phase, status, durationMs }) => ({ phase, status, durationMs })),
	};
	if (process.env.DRONE_KNOWLEDGE_EVIDENCE) {
		const path = resolve(process.env.DRONE_KNOWLEDGE_EVIDENCE);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
	}
	console.log(JSON.stringify(evidence));
}
