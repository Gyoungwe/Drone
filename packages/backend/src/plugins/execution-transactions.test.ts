import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ControlledSandboxRunner,
	type ExecutionIdentity,
	type ExecutionPrivateReceipt,
	ExecutionTransactions,
	executionOwnerKey,
	NodeExecutionReceiptStorage,
	type SignedExecutionReceipt,
} from "@gyoungwe/plugin-api/node/execution";
import type { PluginExecutionInput } from "@gyoungwe/plugin-api/runtime";
import { afterEach, beforeEach, expect, it } from "vitest";
import { JsonStore } from "../json-store";

let directory: string;
const key = randomBytes(32);
const owner: ExecutionIdentity = {
	pluginId: "@example/runner",
	sourceIdentity: "installed-content-hash",
	applicationId: "actual-app",
	sessionId: "creator-session",
	workspaceId: "canonical-workspace",
};
const input: PluginExecutionInput = {
	requestId: "request-1",
	language: "python",
	code: "print('synthetic-only')",
	runDirectory: "runs/synthetic",
	image: `sha256:${"a".repeat(64)}`,
	timeoutMs: 1000,
	maxOutputBytes: 128,
	dataClassification: "public",
};
const result = {
	exitCode: 0,
	outputs: [
		{ text: "[summary] synthetic", contentKind: "summary" as const, classification: "public" as const },
	],
	durationMs: 1,
	producedBytes: 19,
};
const runner = (run: ControlledSandboxRunner["run"]): ControlledSandboxRunner => ({
	capabilities: {
		kind: "fixture",
		languages: ["python"],
		networkDisabled: true,
		writesOnlyToRunDirectory: true,
	},
	run,
});
beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "execution-transactions-test-")));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
async function storage(host: boolean) {
	return NodeExecutionReceiptStorage.create(
		directory,
		key,
		host
			? async (path, value, boundary) => {
					await new JsonStore<SignedExecutionReceipt>({
						path,
						storageId: "execution-receipt-test",
						defaultValue: () => {
							throw new Error("missing");
						},
						mode: 0o600,
					}).writeChecked(value, boundary);
				}
			: undefined,
	);
}
for (const host of [true, false]) {
	it(`persists accepted-before-run and terminal readback through ${host ? "actual host JsonStore" : "native atomic Node"} storage`, async () => {
		const persistence = await storage(host),
			transactions = new ExecutionTransactions(persistence);
		let runs = 0;
		const fixture = runner(async () => {
			runs++;
			expect((await persistence.read(executionOwnerKey(owner, input.requestId)))?.receipt.status).toBe(
				"accepted",
			);
			return result;
		});
		expect((await transactions.run(input, owner, fixture, new AbortController().signal)).receipt.status).toBe(
			"succeeded",
		);
		expect(await transactions.receipt(owner, input.requestId)).toMatchObject({
			kind: "value",
			receipt: { status: "succeeded", exitCode: 0 },
		});
		await expect(transactions.run(input, owner, fixture, new AbortController().signal)).rejects.toThrow(
			"durable receipt",
		);
		expect(runs).toBe(1);
		const bytes = await readFile(
			join(directory, `${executionOwnerKey(owner, input.requestId)}.json`),
			"utf8",
		);
		expect(bytes).not.toContain(input.code);
		expect(bytes).not.toContain(result.outputs[0]!.text);
		await transactions.drain();
	});
}
it("finalizes only the accepted transaction after its caller is canceled", async () => {
	const persistence = await storage(true),
		transactions = new ExecutionTransactions(persistence),
		controller = new AbortController();
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const pending = transactions.run(
		input,
		owner,
		runner(async (request) => {
			entered();
			await new Promise<void>((_resolve, reject) =>
				request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true }),
			);
			return result;
		}),
		controller.signal,
	);
	const rejected = expect(pending).rejects.toThrow("caller revoked");
	await started;
	controller.abort(new Error("caller revoked"));
	await rejected;
	expect(await transactions.receipt(owner, input.requestId)).toMatchObject({
		kind: "value",
		receipt: { status: "cancelled" },
	});
	await transactions.drain();
});
it("records cleanup failure and refuses successful owner drain", async () => {
	const transactions = new ExecutionTransactions(await storage(false));
	await expect(
		transactions.run(
			input,
			owner,
			runner(async () => {
				throw Object.assign(new Error("owned container not verified absent"), {
					code: "DISCOVERY_CLEANUP_FAILED",
				});
			}),
			new AbortController().signal,
		),
	).rejects.toThrow("not verified");
	expect(await transactions.receipt(owner, input.requestId)).toMatchObject({
		kind: "value",
		receipt: { status: "cleanup-failed" },
	});
	await expect(transactions.drain()).rejects.toThrow("leases must be retained");
});
it("refuses forged receipts and blocks replay after application-key replacement", async () => {
	const transactions = new ExecutionTransactions(await storage(true));
	await transactions.run(
		input,
		owner,
		runner(async () => result),
		new AbortController().signal,
	);
	const replacement = new ExecutionTransactions(
		await NodeExecutionReceiptStorage.create(directory, randomBytes(32)),
	);
	await expect(replacement.receipt({ ...owner, applicationId: "new-app" }, input.requestId)).rejects.toThrow(
		"needs recovery",
	);
	await expect(
		replacement.run(
			input,
			{ ...owner, applicationId: "new-app" },
			runner(async () => {
				throw new Error("must never execute");
			}),
			new AbortController().signal,
		),
	).rejects.toThrow("needs recovery");
	const path = join(directory, `${executionOwnerKey(owner, input.requestId)}.json`);
	const forged = JSON.parse(await readFile(path, "utf8")) as { record: ExecutionPrivateReceipt };
	await writeFile(
		path,
		JSON.stringify({
			...forged,
			record: { ...forged.record, receipt: { ...forged.record.receipt, status: "accepted" } },
		}),
	);
	await expect(transactions.receipt(owner, input.requestId)).rejects.toThrow("needs recovery");
	expect(await readdir(directory)).toHaveLength(1);
});
it("keeps receipts scoped to source, session and canonical workspace", async () => {
	const transactions = new ExecutionTransactions(await storage(false));
	await transactions.run(
		input,
		owner,
		runner(async () => result),
		new AbortController().signal,
	);
	await expect(
		transactions.receipt({ ...owner, sourceIdentity: "other-package-content" }, input.requestId),
	).rejects.toThrow("needs recovery");
	expect(await transactions.receipt({ ...owner, sessionId: "other-session" }, input.requestId)).toEqual({
		kind: "missing",
	});
	expect(await transactions.receipt({ ...owner, workspaceId: "other-workspace" }, input.requestId)).toEqual({
		kind: "missing",
	});
});
