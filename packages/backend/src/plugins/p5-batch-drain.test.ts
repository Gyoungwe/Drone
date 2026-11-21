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
import { createP5ReceiptStore } from "./p5-receipt-store";
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
const approval = { requestId: "approval" };
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

function frozenBatch() {
	const cases = ["one", "two"].map((id) => ({
		id,
		metric: "rediscovery-rate" as const,
		datasetId: "fixture",
		datasetRevision: "1",
		datasetStatus: "fixture" as const,
		description: "Synthetic case",
	}));
	const input: BatchInput = {
		...request,
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

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-drain-"));
	directories.push(directory);
	const store = createP5ReceiptStore({
		path: join(directory, "receipts.json"),
		registry: new StorageRegistry(),
	});
	const batch = frozenBatch();
	await store.accept(approval, {
		receiptRef: "approval",
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
	});
	const reviewer = createP5BatchReviewer(store, async () => ({ compute: approval, model: null }));
	const reviewed = await reviewer.review(batch);
	const port = {
		expectedReadback: () => [output],
		execute: vi.fn<P5BatchExecutionPort["execute"]>(),
		readback: vi.fn<P5BatchExecutionPort["readback"]>(async () => [output]),
	};
	const executor = createP5BatchExecutor({ store, reviewer, port, now, context: { metered: false } });
	const lifecycle = createP5BatchLifecycle({
		executor,
		scope: () => scope,
		findBatch: async (input) => (input.requestId === request.requestId ? reviewed : undefined),
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
		receipts: () => executor.receipts(reviewed),
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
