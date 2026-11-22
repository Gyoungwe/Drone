import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BatchInput } from "@gyoungwe/plugin-api/p5-discovery";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { afterEach, expect, it, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { createP5BatchExecutor, type P5BatchExecutionPort } from "./p5-batch-execution";
import { createP5BatchLifecycle } from "./p5-batch-lifecycle";
import { createP5BatchReviewer, freezeP5Batch } from "./p5-batch-review";
import { createP5ReceiptStore, type P5ReceiptStore } from "./p5-receipt-store";
import { PluginCapabilityBroker, type PluginCapabilityContext } from "./runtime-capabilities";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

const scope: Scope = {
	workspaceId: "workspace",
	sessionId: "session",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const now = () => "2026-11-18T00:00:00Z";
const output = { path: "output.txt", bytes: 1, sha256: "c".repeat(64) };
const request = { requestId: "batch" };
const caller = (): Omit<PluginCapabilityContext, "capabilities"> => ({
	pluginId: "fixture",
	applicationId: "fixture",
	callerIdentity: {},
	bootstrap: false,
	signal: new AbortController().signal,
	scope: { kind: "session", workspaceId: "workspace", sessionId: "session", workspaceDirectory: "/fixture" },
});

function deferred<Value>() {
	let resolve: (value: Value) => void = vi.fn();
	const promise = new Promise<Value>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function frozenBatch(requestId = "batch", ids = ["one", "two"]) {
	const cases = ids.map((id) => ({
		id,
		metric: "rediscovery-rate" as const,
		datasetId: "fixture",
		datasetRevision: "1",
		datasetStatus: "fixture" as const,
		description: "Synthetic case",
	}));
	const input: BatchInput = {
		requestId,
		plan: { kind: "evaluation", runId: "run", cases },
		items: cases.map(({ id }) => ({
			id,
			budget: { maxTokens: 0, maxCost: null, timeoutMs: 1000, maxOutputBytes: 1024 },
			execution: { kind: "compute", preflightRef: "preflight" },
		})),
	};
	return freezeP5Batch(
		input,
		cases.map(({ id }) => ({
			itemId: id,
			profile: "local",
			image: "sha256:cached",
			preflightRef: "preflight",
			preflightSha256: "d".repeat(64),
		})),
		scope,
	);
}

/** One approval per batch, keyed by the batch's own sha256. */
async function approve(
	store: P5ReceiptStore,
	approvals: { requestId: string; sha256: string }[],
): Promise<void> {
	for (const entry of approvals)
		await store.accept(
			{ requestId: entry.requestId },
			{
				receiptRef: entry.requestId,
				operation: "execution.batch.run",
				inputSha256: entry.sha256,
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
}

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-drain-"));
	directories.push(directory);
	const store = createP5ReceiptStore({
		path: join(directory, "receipts.json"),
		registry: new StorageRegistry(),
	});
	const batch = frozenBatch();
	// A second batch with its own sha256, so the same lifecycle owns two runs at once.
	const other = frozenBatch("other", ["three"]);
	const approvals: { requestId: string; sha256: string }[] = [
		{ requestId: "approval", sha256: batch.sha256 },
		{ requestId: "other-approval", sha256: other.sha256 },
	];
	await approve(store, approvals);
	// One reviewer decides by the batch's own sha256, so the same executor serves both batches.
	const reviewer = createP5BatchReviewer(store, async (candidate) => {
		const found = approvals.find((entry) => entry.sha256 === candidate.sha256);
		return { compute: { requestId: found?.requestId ?? "" }, model: null };
	});
	const reviewed = await reviewer.review(batch);
	const otherReviewed = await reviewer.review(other);
	const port = {
		expectedReadback: () => [output],
		execute: vi.fn<P5BatchExecutionPort["execute"]>(),
		readback: vi.fn<P5BatchExecutionPort["readback"]>(async () => [output]),
	};
	const executor = createP5BatchExecutor({ store, reviewer, port, now, context: { metered: false } });
	const lifecycle = createP5BatchLifecycle({
		executor,
		scope: () => scope,
		findBatch: async (input) => {
			if (input.requestId === request.requestId) return reviewed;
			if (input.requestId === other.request.requestId) return otherReviewed;
			return undefined;
		},
	});
	const broker = new PluginCapabilityBroker({ handlers: lifecycle.handlers, resources: [] });
	const call = (action: "status" | "cancel") =>
		broker.run(
			caller(),
			action === "status" ? "read" : "write",
			vi.fn(),
			async () => true,
			() => broker.port.call(`execution.batch.${action}`, request),
		);
	return {
		port,
		call,
		run: () => lifecycle.run(reviewed, batch),
		runOther: () => lifecycle.run(otherReviewed, other),
		reviewedSha: reviewed.batch.sha256,
		otherSha: otherReviewed.batch.sha256,
		receipts: () => executor.receipts(reviewed),
		otherReceipts: () => executor.receipts(otherReviewed),
		drain: () => lifecycle.drain(),
	};
}

it.each([
	{
		outcome: "throws",
		finish: () => {
			throw new Error("Synthetic abort");
		},
	},
	{ outcome: "returns an unverified result", finish: () => ({ verified: false }) },
])("blocks the batch when an active item $outcome after abort", async ({ finish }) => {
	const batch = await fixture();
	const active = deferred<AbortSignal | undefined>();
	const aborted = deferred<void>();
	batch.port.execute.mockImplementationOnce(async (_item, _batch, { signal }) => {
		signal?.addEventListener("abort", () => aborted.resolve(), { once: true });
		active.resolve(signal);
		await aborted.promise;
		return finish();
	});
	const running = batch.run();
	expect(await active.promise).toBeInstanceOf(AbortSignal);
	const [result, cancelled] = await Promise.all([running, batch.call("cancel")]);
	expect(result).toMatchObject({
		status: "ok",
		value: { status: "blocked", items: [{ status: "outcome-unknown" }] },
	});
	const blocked = {
		status: "ok",
		value: {
			status: "blocked",
			items: [
				{ itemId: "one", status: "blocked" },
				{ itemId: "two", status: "pending" },
			],
		},
	};
	expect(cancelled).toMatchObject(blocked);
	expect(await batch.call("status")).toMatchObject(blocked);
});

it("cancels cleanly when the first item succeeds and the second never starts", async () => {
	const batch = await fixture();
	const reading = deferred<void>();
	const aborted = deferred<void>();
	batch.port.execute.mockImplementationOnce(async (_item, _batch, { signal }) => {
		signal?.addEventListener("abort", () => aborted.resolve(), { once: true });
		return { verified: true };
	});
	batch.port.readback.mockImplementationOnce(async () => {
		reading.resolve();
		await aborted.promise;
		return [output];
	});
	const running = batch.run();
	await reading.promise;
	const [result, cancelled] = await Promise.all([running, batch.call("cancel")]);
	expect(result).toMatchObject({
		status: "ok",
		value: { status: "cancelled", items: [{ status: "succeeded" }] },
	});
	const cleanCancellation = {
		status: "ok",
		value: {
			status: "cancelled",
			items: [
				{ itemId: "one", status: "succeeded" },
				{ itemId: "two", status: "pending", hostReceiptRef: null },
			],
		},
	};
	expect(cancelled).toMatchObject(cleanCancellation);
	expect(await batch.call("status")).toMatchObject(cleanCancellation);
	expect(await batch.receipts()).toMatchObject({ status: "ok", value: [{ status: "succeeded" }, null] });
});

/**
 * A port whose execute blocks until the run is aborted, then settles with `finish`.
 * `execute` is a plain function, not a mock: the caller installs it on the port.
 */
function abortablePort(finish: () => { verified: boolean }) {
	const inFlight = deferred<void>();
	const aborted = deferred<void>();
	const execute: P5BatchExecutionPort["execute"] = async (_item, _batch, { signal }) => {
		signal?.addEventListener("abort", () => aborted.resolve(), { once: true });
		inFlight.resolve();
		await aborted.promise;
		return finish();
	};
	return { execute, inFlight };
}

it("drains two concurrent runs: aborts both and resolves only after both settle", async () => {
	const batch = await fixture();
	const first = abortablePort(() => ({ verified: true }), "first");
	const second = abortablePort(() => ({ verified: true }), "second");
	// Dispatch by the batch's own request id, so each run gets its own blocking port.
	batch.port.execute.mockImplementation(async (item, candidate, context) => {
		const port = candidate.request.requestId === "other" ? second : first;
		return port.execute(item, candidate, context);
	});
	const running = batch.run();
	const other = batch.runOther();
	await first.inFlight.promise;
	await second.inFlight.promise;
	await batch.drain();
	expect(await running).toMatchObject({ status: "ok", value: { status: "cancelled" } });
	expect(await other).toMatchObject({ status: "ok", value: { status: "cancelled" } });
});

it("drain resolves only after the in-flight item's durable receipt is written", async () => {
	const batch = await fixture();
	const item = abortablePort(() => ({ verified: true }));
	batch.port.execute.mockImplementation(async (_item, _batch, { signal }) =>
		item.execute(_item, _batch, { signal }),
	);
	const running = batch.run();
	await item.inFlight.promise;
	await batch.drain();
	await running;
	// The receipt for the in-flight item is on disk by the time drain resolved.
	expect(await batch.receipts()).toMatchObject({ status: "ok", value: [{ status: "succeeded" }, null] });
});

it("refuses a new run after drain without calling the executor", async () => {
	const batch = await fixture();
	await batch.drain();
	const result = await batch.run();
	expect(result).toMatchObject({ status: "failed", code: "STATE_CONFLICT" });
	expect(batch.port.execute).not.toHaveBeenCalled();
});

it("drain still resolves when a run's execute throws during the drain", async () => {
	const batch = await fixture();
	const item = abortablePort(() => {
		throw new Error("Synthetic abort");
	});
	batch.port.execute.mockImplementation(async (_item, _batch, { signal }) =>
		item.execute(_item, _batch, { signal }),
	);
	const running = batch.run();
	await item.inFlight.promise;
	await expect(batch.drain()).resolves.toBeUndefined();
	expect(await running).toMatchObject({ status: "ok", value: { status: "blocked" } });
	expect(await batch.call("status")).toMatchObject({
		status: "ok",
		value: {
			status: "blocked",
			items: [
				{ itemId: "one", status: "blocked" },
				{ itemId: "two", status: "pending" },
			],
		},
	});
});
