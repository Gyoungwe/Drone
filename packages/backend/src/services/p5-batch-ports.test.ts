import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostProfile, JobSpec } from "@drone/compute";
import type { BatchInput } from "@gyoungwe/plugin-api/p5-discovery";
import { afterEach, expect, it, vi } from "vitest";
import { createP5BatchExecutor } from "../plugins/p5-batch-execution";
import { createP5BatchLifecycle } from "../plugins/p5-batch-lifecycle";
import { createP5BatchReviewer, freezeP5Batch } from "../plugins/p5-batch-review";
import { createP5ReceiptStore } from "../plugins/p5-receipt-store";
import type { PluginCapabilityContext } from "../plugins/runtime-capabilities";
import { StorageRegistry } from "../storage/registry";
import { type ComputeExecutor, ComputeService } from "./compute";
import { createP5BatchExecutionPort, createP5BatchIndex } from "./p5-batch-ports";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const now = () => "2026-11-22T00:00:00Z";
const scope = {
	workspaceId: "workspace",
	sessionId: "session",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const output = { path: "report.txt", sha256: "", bytes: 0 };
const payload = Buffer.from("reviewed output\n");
const other = Buffer.from("different bytes\n");
output.sha256 = "f90f97ffb0294cbf34d96c34385c210c1718b46f3fdf88f08ba4f60bc9c32b90";
output.bytes = payload.byteLength;
const otherSha256 = "78442dda3e5642ce405f6dc6a36797ab67d4c6bef4f46eb5e19d2c66d7f1595c";
function host(): HostProfile {
	return { alias: "local", host: "127.0.0.1", username: "runner" };
}

function batchInput(model = false): BatchInput {
	const cases = ["one", "two"].map((id) => ({
		id,
		metric: "rediscovery-rate" as const,
		datasetId: "fixture",
		datasetRevision: "1",
		datasetStatus: "fixture" as const,
		description: "Synthetic case",
	}));
	return {
		requestId: "batch",
		plan: { kind: "evaluation", runId: "run", cases },
		items: cases.map(({ id }) => ({
			id,
			budget: { maxTokens: 0, maxCost: null, timeoutMs: 5000, maxOutputBytes: 1024 },
			execution:
				model && id === "two"
					? { kind: "model", profile: "critic", prompt: "Synthetic", resultKind: "path-result" }
					: { kind: "compute", preflightRef: "preflight" },
		})),
	};
}

function resolutions(input: BatchInput) {
	return input.items.map(({ id }) => ({
		itemId: id,
		profile: "local",
		image: "sha256:cached",
		preflightRef: "preflight",
		preflightSha256: "d".repeat(64),
	}));
}

function jobSpec(): JobSpec {
	return {
		jobId: "unused",
		hostAlias: "local",
		workflow: { version: 1, modules: [], steps: [] },
		outputs: [{ path: output.path, bytes: output.bytes, sha256: output.sha256 }],
	};
}

interface Fixture {
	readonly service: ComputeService;
	readonly receipts: ReturnType<typeof createP5ReceiptStore>;
	readonly index: ReturnType<typeof createP5BatchIndex>;
	readonly batch: ReturnType<typeof freezeP5Batch>;
	readonly reviewed: Awaited<ReturnType<ReturnType<typeof createP5BatchReviewer>["review"]>>;
	readonly port: ReturnType<typeof createP5BatchExecutionPort>;
	readonly executor: ReturnType<typeof createP5BatchExecutor>;
	/** A live counter: a snapshot would make the "never dispatched" assertions vacuous. */
	readonly submits: { count: number };
}

async function fixture(options?: {
	model?: boolean;
	collectBody?: Buffer;
	manifestSha256?: string;
}): Promise<Fixture> {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-batch-ports-"));
	directories.push(directory);
	const agentDir = join(directory, "agent");
	const outputRoot = join(directory, "output");
	const registry = new StorageRegistry();
	const submits = { count: 0 };
	const executor: ComputeExecutor = {
		submit: async () => {
			submits.count += 1;
			return { status: "queued" };
		},
		status: async () => ({ status: "succeeded" }),
		collect: async (_job, _host, collectOptions) => {
			const body = options?.collectBody ?? payload;
			await writeFile(join(collectOptions?.targetDir ?? outputRoot, output.path), body);
			return {
				manifest: {
					version: 1,
					entries: [
						{ path: output.path, size: body.byteLength, sha256: options?.manifestSha256 ?? output.sha256 },
					],
				},
			};
		},
	};
	const service = new ComputeService({ storage: registry, agentDir, executor });
	await service.upsertHost(host());
	const receipts = createP5ReceiptStore({
		path: join(agentDir, "p5-receipts.json"),
		registry,
	});
	const index = createP5BatchIndex({ path: join(agentDir, "p5-batch-index.json"), registry });
	const input = batchInput(options?.model ?? false);
	const batch = freezeP5Batch(input, resolutions(input), scope);
	for (const category of ["compute-preflight", "background-model-spend"] as const) {
		await receipts.accept(
			{ requestId: category },
			{
				receiptRef: category,
				operation: "execution.batch.run",
				inputSha256: batch.sha256,
				scope,
				category,
				decision: "approved",
				status: "accepted",
				at: now(),
				resultSha256: null,
				readback: [],
				parentReceiptRef: null,
			},
		);
	}
	const reviewer = createP5BatchReviewer(receipts, async () => ({
		compute: { requestId: "compute-preflight" },
		model: { requestId: "background-model-spend" },
	}));
	const reviewed = await reviewer.review(batch);
	await index.record(reviewed);
	const port = createP5BatchExecutionPort({
		compute: service,
		planOf: () => ({ job: jobSpec(), expected: [output] }),
		outputRoot,
		pollIntervalMs: 10,
	});
	const batchExecutor = createP5BatchExecutor({
		store: receipts,
		reviewer,
		port,
		now,
		context: { metered: false },
	});
	return { service, receipts, index, batch, reviewed, port, executor: batchExecutor, submits };
}

function contextFor(sessionId = "session"): PluginCapabilityContext {
	return {
		scope: { kind: "session", workspaceId: "workspace", workspaceDirectory: "/tmp", sessionId },
		signal: new AbortController().signal,
	} as unknown as PluginCapabilityContext;
}

it("executes a reviewed batch and verifies the collected output checksums", async () => {
	const f = await fixture();
	const result = await f.executor.run(f.reviewed, f.batch);
	if (result.status !== "ok") throw new Error("Expected batch outcome");
	expect(result.value.status).toBe("complete");
	expect(result.value.items).toHaveLength(2);
	for (const receipt of result.value.items) expect(receipt.status).toBe("succeeded");
	expect(f.submits.count).toBe(2);
	const persisted = await Promise.all(result.value.items.map((entry) => f.receipts.getByRef(entry)));
	expect(persisted.map((entry) => entry?.readback)).toEqual([[output], [output]]);
	await f.service.dispose();
});

it("fails the item when the collected output does not match the reviewed checksum", async () => {
	// The manifest matches what the runner wrote, so collection succeeds; the
	// reviewed checksum is what the readback disagrees with.
	const f = await fixture({ collectBody: other, manifestSha256: otherSha256 });
	const result = await f.executor.run(f.reviewed, f.batch);
	if (result.status !== "ok") throw new Error("Expected batch outcome");
	expect(result.value.status).toBe("blocked");
	expect(result.value.items.every((entry) => entry.status === "failed")).toBe(true);
	await f.service.dispose();
});

it("never dispatches an unreviewed or hash-changed batch", async () => {
	const f = await fixture();
	const changed = { ...f.batch, sha256: "e".repeat(64) };
	expect((await f.executor.run(f.reviewed, changed)).status).toBe("failed");
	expect((await f.executor.run(structuredClone(f.reviewed), f.batch)).status).toBe("failed");
	expect(f.submits.count).toBe(0);
	await f.service.dispose();
});

it("rejects a model item without submitting anything", async () => {
	const f = await fixture({ model: true });
	expect(await f.executor.run(f.reviewed, f.batch)).toEqual({
		status: "failed",
		code: "MODEL_UNAVAILABLE",
		receiptRef: null,
	});
	expect(f.submits.count).toBe(0);
	await f.service.dispose();
});

it("finds a historical batch for reconciliation but never runs it", async () => {
	const f = await fixture();
	const found = await f.index.find({ requestId: "batch" }, contextFor());
	expect(found?.batch.sha256).toBe(f.batch.sha256);
	const lifecycle = createP5BatchLifecycle({
		executor: f.executor,
		scope: () => scope,
		findBatch: async (request, context) => f.index.find(request, context),
	});
	const status = await lifecycle.handlers["execution.batch.status"].execute(
		{ requestId: "batch" },
		contextFor(),
	);
	expect(status).toMatchObject({ status: "ok", value: { status: "accepted" } });
	expect(f.submits.count).toBe(0);
	await f.service.dispose();
});

it("does not expose a historical batch to another session scope", async () => {
	const f = await fixture();
	expect(await f.index.find({ requestId: "batch" }, contextFor("other"))).toBeUndefined();
	await f.service.dispose();
});

it("does not expose a historical batch to an application scope", async () => {
	const f = await fixture();
	const context = {
		scope: { kind: "application" },
		signal: new AbortController().signal,
	} as unknown as PluginCapabilityContext;
	expect(await f.index.find({ requestId: "batch" }, context)).toBeUndefined();
	await f.service.dispose();
});

it("aborts the live job and drains it before the run settles", async () => {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-batch-ports-abort-"));
	directories.push(directory);
	const agentDir = join(directory, "agent");
	const registry = new StorageRegistry();
	const controller = new AbortController();
	let cancelled = 0;
	let submitted = 0;
	let stopped = false;
	const executor: ComputeExecutor = {
		submit: async () => {
			submitted += 1;
			return { status: "queued" };
		},
		status: async () => ({ status: stopped ? "cancelled" : "running" }),
		cancel: async () => {
			cancelled += 1;
			stopped = true;
			return { status: "cancelled" };
		},
	};
	const service = new ComputeService({ storage: registry, agentDir, executor });
	await service.upsertHost(host());
	const receipts = createP5ReceiptStore({ path: join(agentDir, "p5-receipts.json"), registry });
	const input = batchInput();
	const batch = freezeP5Batch(input, resolutions(input), scope);
	await receipts.accept(
		{ requestId: "compute-preflight" },
		{
			receiptRef: "compute-preflight",
			operation: "execution.batch.run",
			inputSha256: batch.sha256,
			scope,
			category: "compute-preflight",
			decision: "approved",
			status: "accepted",
			at: now(),
			resultSha256: null,
			readback: [],
			parentReceiptRef: null,
		},
	);
	const reviewer = createP5BatchReviewer(receipts, async () => ({
		compute: { requestId: "compute-preflight" },
		model: { requestId: "background-model-spend" },
	}));
	const reviewed = await reviewer.review(batch);
	const port = createP5BatchExecutionPort({
		compute: service,
		planOf: () => ({ job: jobSpec(), expected: [output] }),
		outputRoot: join(directory, "output"),
		pollIntervalMs: 10,
	});
	const batchExecutor = createP5BatchExecutor({
		store: receipts,
		reviewer,
		port,
		now,
		context: { metered: false },
	});
	const running = batchExecutor.run(reviewed, batch, { signal: controller.signal });
	await vi.waitFor(() => expect(submitted).toBe(1));
	controller.abort();
	const result = await running;
	if (result.status !== "ok") throw new Error("Expected batch outcome");
	// The aborted item has an unknown outcome, so the batch is blocked rather
	// than reported as a clean cancellation.
	expect(result.value.status).toBe("blocked");
	expect(cancelled).toBe(1);
	expect(result.value.items).toHaveLength(1);
	expect(result.value.items[0]?.status).toBe("outcome-unknown");
	await service.dispose();
});

it("keeps the durable index readable after a reopen and drops a tampered entry", async () => {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-batch-ports-index-"));
	directories.push(directory);
	const registry = new StorageRegistry();
	const path = join(directory, "p5-batch-index.json");
	const index = createP5BatchIndex({ path, registry });
	const input = batchInput();
	const batch = freezeP5Batch(input, resolutions(input), scope);
	const reviewed = {
		batch,
		computeReceiptRef: "compute-preflight",
		modelReceiptRef: null,
	} as unknown as Awaited<ReturnType<ReturnType<typeof createP5BatchReviewer>["review"]>>;
	await index.record(reviewed);
	const reopened = createP5BatchIndex({ path, registry: new StorageRegistry() });
	const found = await reopened.find({ requestId: "batch" }, contextFor());
	expect(found?.batch.sha256).toBe(batch.sha256);
	const stored = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>[];
	stored[0] = { ...stored[0], sha256: "f".repeat(64) };
	await writeFile(path, JSON.stringify(stored));
	const tampered = createP5BatchIndex({ path, registry: new StorageRegistry() });
	expect(await tampered.find({ requestId: "batch" }, contextFor())).toBeUndefined();
});
