import { mkdtemp, readFile, rm } from "node:fs/promises";
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
const file = { path: "output.txt", bytes: 1, sha256: "c".repeat(64) };
const denied = { status: "failed", code: "DENIED", receiptRef: null };
const request = { requestId: "batch" };
const approval = { requestId: "approval" };
function expectState(result: unknown, status: string, states: readonly string[]) {
	expect(result).toMatchObject({
		status: "ok",
		value: { status, items: states.map((state) => ({ status: state })) },
	});
}
const caller = (): Omit<PluginCapabilityContext, "capabilities"> => ({
	pluginId: "fixture",
	applicationId: "fixture",
	callerIdentity: {},
	bootstrap: false,
	signal: new AbortController().signal,
	scope: { kind: "session", workspaceId: "workspace", sessionId: "session", workspaceDirectory: "/fixture" },
});
function frozenBatch() {
	const cases = ["one", "two", "three"].map((id) => ({
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
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-lifecycle-"));
	directories.push(directory);
	const path = join(directory, "receipts.json");
	const open = () => createP5ReceiptStore({ path, registry: new StorageRegistry() });
	const store = open();
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
	const historical = structuredClone(reviewed);
	const port = {
		expectedReadback: () => [file],
		execute: vi.fn<P5BatchExecutionPort["execute"]>(async () => ({ verified: true })),
		readback: vi.fn<P5BatchExecutionPort["readback"]>(async () => [file]),
	};
	const compose = (currentScope: Scope | undefined = scope) => {
		const context = { metered: false };
		const executor = createP5BatchExecutor({ store: open(), reviewer, port, now, context });
		const receipts = vi.spyOn(executor, "receipts");
		const lifecycle = createP5BatchLifecycle({
			executor,
			scope: () => currentScope,
			findBatch: async (input) => (input.requestId === request.requestId ? historical : undefined),
		});
		const broker = new PluginCapabilityBroker({ handlers: lifecycle.handlers, resources: [] });
		const call = (action: "status" | "cancel", input: unknown = request) =>
			broker.run(
				caller(),
				action === "status" ? "read" : "write",
				vi.fn(),
				async () => true,
				() => broker.port.call(`execution.batch.${action}`, input),
			);
		return { lifecycle, call, receipts };
	};
	return { path, batch, reviewed, reviewer, port, compose, ...compose() };
}

it("reports pending and complete receipts after reopen without executing or reading back", async () => {
	const f = await fixture();
	expectState(await f.call("status"), "accepted", ["pending", "pending", "pending"]);
	expect(f.port.execute).not.toHaveBeenCalled();
	expect(f.port.readback).not.toHaveBeenCalled();
	await f.lifecycle.run(f.reviewed, f.batch);
	f.port.execute.mockClear();
	f.port.readback.mockClear();
	const before = await readFile(f.path);
	expectState(await f.compose().call("status"), "complete", ["succeeded", "succeeded", "succeeded"]);
	expect(f.port.execute).not.toHaveBeenCalled();
	expect(f.port.readback).not.toHaveBeenCalled();
	expect(await readFile(f.path)).toEqual(before);
});

it("drains active cleanup and its durable receipt before both cancels resolve", async () => {
	const f = await fixture();
	const release = vi.fn<() => void>();
	const cleanup = new Promise<void>((resolve) => release.mockImplementation(resolve));
	const active = new Promise<void>((resolve) =>
		f.port.execute.mockImplementation(async (_item, _batch, context) => {
			resolve();
			await cleanup;
			expect(context.signal?.aborted).toBe(true);
			throw new Error("Synthetic private abort diagnostic");
		}),
	);
	const running = f.lifecycle.run(f.reviewed, f.batch);
	await active;
	const settled = vi.fn();
	const cancelled = async (result: unknown) => {
		expect(JSON.parse(await readFile(f.path, "utf8"))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "outcome-unknown", parentReceiptRef: "approval" }),
			]),
		);
		settled();
		return result;
	};
	const first = f.call("cancel").then(cancelled);
	const second = f.call("cancel").then(cancelled);
	try {
		expectState(await f.call("status"), "running", ["running", "pending", "pending"]);
		expect(settled).not.toHaveBeenCalled();
		expectState(await f.compose().call("status"), "blocked", ["blocked", "pending", "pending"]);
	} finally {
		release();
	}
	const result = await first;
	expect(await second).toEqual(result);
	expect(await f.call("cancel")).toEqual(result);
	expect(result).toMatchObject({ status: "ok", value: { status: "cancelled" } });
	expect((await running).status).toBe("ok");
	expect(f.port.execute.mock.calls.map(([item]) => item.id)).toEqual(["one"]);
	expect(await readFile(f.path, "utf8")).not.toContain("Synthetic private abort diagnostic");
	f.port.execute.mockClear();
	f.port.readback.mockClear();
	expectState(await f.compose().call("status"), "blocked", ["blocked", "pending", "pending"]);
	expect(f.port.execute).not.toHaveBeenCalled();
	expect(f.port.readback).not.toHaveBeenCalled();
	expect(await f.lifecycle.run(f.reviewed, f.batch)).toMatchObject({ code: "STATE_CONFLICT" });
	f.port.execute.mockResolvedValue({ verified: true });
	const freshReview = await f.reviewer.review(f.batch);
	expect((await f.lifecycle.run(freshReview, f.batch)).status).toBe("ok");
	expect(f.port.execute.mock.calls.map(([item]) => item.id)).toEqual(["two", "three"]);
});

it.each(["workspaceId", "sessionId", "callerSourceHash", "providerSourceHash"] as const)(
	"denies foreign %s before receipt lookup or cancellation",
	async (field) => {
		const f = await fixture();
		const foreign = f.compose({ ...scope, [field]: "e".repeat(64) });
		expect(await foreign.call("status")).toEqual(denied);
		expect(await foreign.call("cancel")).toEqual(denied);
		expect(foreign.receipts).not.toHaveBeenCalled();
		expect(f.port.execute).not.toHaveBeenCalled();
	},
);

it("rejects invalid lookups without exposing private errors", async () => {
	const f = await fixture();
	expect(await f.call("status", { requestId: "unknown" })).toEqual(denied);
	await expect(f.call("status", { ...request, scope })).rejects.toThrow("Invalid plugin capability input");
	expect(f.receipts).not.toHaveBeenCalled();
	f.receipts.mockRejectedValue(new Error("Synthetic private storage diagnostic"));
	expect(await f.call("status")).toEqual({ status: "failed", code: "OUTCOME_UNKNOWN", receiptRef: null });
});
