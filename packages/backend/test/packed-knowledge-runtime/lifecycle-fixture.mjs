import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { expect } from "vitest";
import { cleanupRuntime } from "./evidence.mjs";
import { packageChildren } from "./helpers.mjs";
import { prepareReviewProposals } from "./review-preview.mjs";
import { createRuntime } from "./runtime.mjs";
import { configureOfflineModel, createWritableSession } from "./sdk-sessions.mjs";
import { createContext, prepareArtifact } from "./setup.mjs";

export async function withLifecycle(work) {
	const ctx = await createContext({
		tarball: process.env.DRONE_KNOWLEDGE_TARBALL,
		apiTarball: process.env.DRONE_PLUGIN_API_TARBALL,
		runtimeDirectory: resolve(
			process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
				join(import.meta.dirname, `../../../desktop/plugin-runtime/${process.platform}-${process.arch}`),
		),
	});
	ctx.lifecyclePending = [];
	try {
		await prepareLifecycle(ctx);
		await work(ctx);
	} catch (error) {
		ctx.failure = error;
	} finally {
		await cleanupLifecycle(ctx);
	}
	const failures = ctx.cleanup.filter((phase) => phase.status === "rejected").map((phase) => phase.reason);
	if (ctx.failure) failures.unshift(ctx.failure);
	if (failures.length === 1) throw failures[0];
	if (failures.length) throw new AggregateError(failures, "Lifecycle scenario and cleanup failed");
}

async function cleanupLifecycle(ctx) {
	// Release the deliberately uncooperative provider before draining its host capability.
	ctx.modelGate?.reply.resolve(ctx.modelReply);
	await Promise.allSettled(ctx.lifecyclePending);
	ctx.complete?.mockRestore();
	await cleanupRuntime(ctx);
}

async function prepareLifecycle(ctx) {
	await prepareArtifact(ctx);
	ctx.grantStateWrite = true;
	ctx.grantFileWrite = true;
	await createRuntime(ctx);
	ctx.overview = await ctx.bridge.invoke(ctx.window, ctx.binding, "overview", null, ctx.application);
	ctx.processes = await packageChildren(ctx.packageRoot);
	expect(ctx.processes).toHaveLength(2);
	await configureOfflineModel(ctx);
	ctx.settingsManager = SettingsManager.inMemory({});
	await prepareReviewProposals(ctx);
	await createWritableSession(ctx);
	await writeFile(join(ctx.vault, ctx.modelProposal.path), ctx.beforeWiki);
	await writeFile(
		join(ctx.pendingDirectory, `${ctx.modelProposal.id}.json`),
		JSON.stringify(ctx.modelProposal),
	);
	ctx.pendingBytes = await readFile(join(ctx.pendingDirectory, `${ctx.modelProposal.id}.json`));
	ctx.modelIdentity = {
		revision: ctx.overview.binding.revision,
		id: ctx.modelProposal.id,
		expectedProposalHash: ctx.modelProposal.proposalHash,
	};
	ctx.modelInput = { ...ctx.modelIdentity, acknowledged: true, autoApply: true };
	ctx.advice = {
		summary: "The recorded synthetic source supports the proposed change.",
		verdict: "approve",
		cautions: [],
		source_paths: [ctx.sharedNote],
		checks: {
			evidenceSupportsChanges: true,
			scopeAndUncertaintyPreserved: true,
			noUnresolvedContradictions: true,
			humanContentPreserved: true,
			noInstructionInjection: true,
		},
	};
}
