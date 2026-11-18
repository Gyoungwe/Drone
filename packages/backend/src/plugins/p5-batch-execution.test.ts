import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BatchInput } from "@gyoungwe/plugin-api/p5-discovery";
import type { FileReadback, Receipt } from "@gyoungwe/plugin-api/p5-receipts";
import { afterEach, expect, it, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { createP5BatchExecutor, type P5BatchExecutionPort } from "./p5-batch-execution";
import { createP5BatchReviewer, freezeP5Batch } from "./p5-batch-review";
import { createP5ReceiptStore } from "./p5-receipt-store";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const now = () => "2026-11-18T00:00:00Z";
const scope = {
	workspaceId: "workspace",
	sessionId: "session",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const file: FileReadback = { path: "output.txt", sha256: "c".repeat(64), bytes: 1 };
const unknownUsage = {
	state: "unknown",
	metered: false,
	inputTokens: null,
	outputTokens: null,
	cost: null,
} as const;
const zeroUsage = { state: "known", metered: false, inputTokens: 0, outputTokens: 0, cost: null } as const;

function batchInput(model = false): BatchInput {
	const cases = ["one", "two", "three"].map((id) => ({
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
			budget: { maxTokens: 0, maxCost: null, timeoutMs: 1000, maxOutputBytes: 1024 },
			execution:
				model && id === "two"
					? { kind: "model", profile: "critic", prompt: "Synthetic", resultKind: "path-result" }
					: { kind: "compute", preflightRef: "preflight" },
		})),
	};
}
function freeze(input = batchInput()) {
	return freezeP5Batch(
		input,
		input.items.map(({ id }) => ({
			itemId: id,
			profile: "local",
			image: "sha256:cached",
			preflightRef: "preflight",
			preflightSha256: "d".repeat(64),
		})),
		scope,
	);
}
async function fixture(model = false) {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-execution-"));
	directories.push(directory);
	const path = join(directory, "receipts.json");
	const open = () => createP5ReceiptStore({ path, registry: new StorageRegistry() });
	const store = open();
	const batch = freeze(batchInput(model));
	for (const category of ["compute-preflight", "background-model-spend"] as const) {
		await store.accept(
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
	const reviewer = createP5BatchReviewer(store, async () => ({
		compute: { requestId: "compute-preflight" },
		model: { requestId: "background-model-spend" },
	}));
	const reviewed = await reviewer.review(batch);
	const port = {
		expectedReadback: () => [file],
		execute: vi.fn<P5BatchExecutionPort["execute"]>(async () => ({ verified: true, usage: zeroUsage })),
		readback: vi.fn<P5BatchExecutionPort["readback"]>(async () => [file]),
	};
	const executor = (metered = false, ledger = store) =>
		createP5BatchExecutor({ store: ledger, reviewer, port, now, context: { metered } });
	return { path, open, store, batch, reviewer, reviewed, port, executor };
}

it("persists one outcome and reported usage per item, then suppresses duplicate dispatch after reopen", async () => {
	const f = await fixture();
	f.port.execute.mockImplementation(async (item) => {
		const ledger: Receipt[] = JSON.parse(await readFile(f.path, "utf8"));
		expect(ledger.filter((entry) => entry.parentReceiptRef !== null).at(-1)?.status).toBe("accepted");
		return item.id === "two" ? { verified: true } : { verified: true, usage: zeroUsage };
	});
	const result = await f.executor(true).run(f.reviewed, f.batch);
	expect(result.status).toBe("ok");
	if (result.status !== "ok") throw new Error("Expected batch outcome");
	expect(result.value.status).toBe("complete");
	const fresh = f.open();
	const receipts = await Promise.all(result.value.items.map((entry) => fresh.getByRef(entry)));
	expect(receipts.map((entry) => entry?.usage)).toEqual([
		{ ...zeroUsage, metered: false },
		unknownUsage,
		{ ...zeroUsage, metered: false },
	]);
	expect(receipts).toEqual(result.value.items);
	expect(await f.executor(false, fresh).run(f.reviewed, f.batch)).toEqual(result);
	expect(f.port.execute).toHaveBeenCalledTimes(3);
	expect((JSON.parse(await readFile(f.path, "utf8")) as Receipt[]).length).toBe(5);
});

it.each(["unreviewed", "hash", "plan", "item", "foreign-item", "decision"])(
	"rejects %s without writes or dispatch",
	async (kind) => {
		const f = await fixture();
		const input = batchInput();
		const candidate = kind === "item" ? freeze({ ...input, items: [...input.items].reverse() }) : f.batch;
		const changed = kind === "hash" ? { ...candidate, sha256: "e".repeat(64) } : candidate;
		const reviewed = kind === "unreviewed" ? structuredClone(f.reviewed) : f.reviewed;
		const before = await readFile(f.path);
		if (kind === "foreign-item") {
			const items = input.items.map((item, index) => (index === 0 ? { ...item, id: "unplanned" } : item));
			await expect(
				f.executor().run(reviewed, { ...f.batch, request: { ...input, items } }),
			).rejects.toThrow();
		} else if (kind === "plan") {
			const altered = { ...f.batch, plans: f.batch.plans.map((plan) => ({ ...plan, profile: "other" })) };
			expect((await f.executor().run(reviewed, altered)).status).toBe("failed");
		} else if (kind === "decision") {
			const altered = freeze({ ...input, requestId: "other" });
			await expect(f.reviewer.review(altered)).rejects.toThrow("decision");
		} else expect((await f.executor().run(reviewed, changed)).status).toBe("failed");
		expect(f.port.execute).not.toHaveBeenCalled();
		expect(await readFile(f.path)).toEqual(before);
	},
);

it("does not redispatch interrupted acceptances from a fresh store", async () => {
	const f = await fixture();
	const result = await f.executor().run(f.reviewed, f.batch);
	if (result.status !== "ok") throw new Error("Expected batch outcome");
	const path = `${f.path}.interrupted`;
	const ledger = createP5ReceiptStore({ path, registry: new StorageRegistry() });
	for (const receipt of result.value.items) {
		await ledger.accept(receipt, {
			...receipt,
			status: "accepted",
			resultSha256: null,
			readback: [],
			usage: unknownUsage,
		});
	}
	const fresh = createP5ReceiptStore({ path, registry: new StorageRegistry() });
	expect(await f.executor(false, fresh).run(f.reviewed, f.batch)).toMatchObject({
		status: "ok",
		value: { status: "blocked" },
	});
	expect(f.port.execute).toHaveBeenCalledTimes(3);
});

it("does not dispatch any item twice when runs overlap", async () => {
	const f = await fixture();
	const outcomes = await Promise.allSettled([
		f.executor().run(f.reviewed, f.batch),
		f.executor().run(f.reviewed, f.batch),
	]);
	for (const outcome of outcomes) {
		if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ code: "PERSISTENCE_PENDING" });
	}
	const ids = f.port.execute.mock.calls.map(([item]) => item.id);
	expect(new Set(ids).size).toBe(ids.length);
	expect(ids).toHaveLength(3);
});

it("rejects a mixed model batch up front with a typed unavailable failure", async () => {
	const f = await fixture(true);
	const before = await readFile(f.path);
	expect(await f.executor(true).run(f.reviewed, f.batch)).toEqual({
		status: "failed",
		code: "MODEL_UNAVAILABLE",
		receiptRef: null,
	});
	expect(f.port.execute).not.toHaveBeenCalled();
	expect(await readFile(f.path)).toEqual(before);
});

it.each(["throw", "unverified", "readback"])(
	"retains %s uncertainty without reporting batch success",
	async (kind) => {
		const f = await fixture();
		f.port.execute.mockImplementation(async (item) => {
			if (item.id === "two" && kind === "throw") throw new Error("Synthetic private diagnostic");
			return { verified: item.id !== "two" || kind !== "unverified", usage: zeroUsage };
		});
		if (kind === "readback")
			f.port.readback.mockImplementation(async (item) => (item.id === "two" ? [] : [file]));
		const result = await f.executor().run(f.reviewed, f.batch);
		if (result.status !== "ok") throw new Error("Expected batch outcome");
		expect(result.value.status).toBe("blocked");
		const persisted = await Promise.all(result.value.items.map((entry) => f.open().getByRef(entry)));
		expect(persisted.map((entry) => entry?.status)).toEqual([
			"succeeded",
			kind === "readback" ? "failed" : "outcome-unknown",
			"succeeded",
		]);
		expect(persisted[1]?.usage?.state).toBe("unknown");
		expect(await readFile(f.path, "utf8")).not.toContain("Synthetic private diagnostic");
		await f.executor().run(f.reviewed, f.batch);
		expect(f.port.execute).toHaveBeenCalledTimes(3);
	},
);

it("resolves ordered durable receipts without executing, reading back or writing", async () => {
	const f = await fixture();
	const before = await readFile(f.path);
	expect(await f.executor().receipts(f.reviewed)).toEqual({ status: "ok", value: [null, null, null] });
	expect(f.port.execute).not.toHaveBeenCalled();
	expect(f.port.readback).not.toHaveBeenCalled();
	expect(await readFile(f.path)).toEqual(before);
	const result = await f.executor().run(f.reviewed, f.batch);
	if (result.status !== "ok") throw new Error("Expected batch outcome");
	f.port.execute.mockClear();
	f.port.readback.mockClear();
	const fresh = f.open();
	const accept = vi.spyOn(fresh, "accept");
	const finish = vi.spyOn(fresh, "finish");
	const persisted = await readFile(f.path);
	expect(await f.executor(false, fresh).receipts(f.reviewed)).toEqual({
		status: "ok",
		value: result.value.items,
	});
	expect(f.port.execute).not.toHaveBeenCalled();
	expect(f.port.readback).not.toHaveBeenCalled();
	expect(accept).not.toHaveBeenCalled();
	expect(finish).not.toHaveBeenCalled();
	expect(await readFile(f.path)).toEqual(persisted);
});

it.each(["operation", "inputSha256", "scope"] as const)(
	"reports a public conflict for a stored receipt with mismatched %s",
	async (field) => {
		const f = await fixture();
		const result = await f.executor().run(f.reviewed, f.batch);
		if (result.status !== "ok") throw new Error("Expected batch outcome");
		const [receipt] = result.value.items;
		if (!receipt) throw new Error("Expected item receipt");
		const ledger = createP5ReceiptStore({ path: `${f.path}.conflict`, registry: new StorageRegistry() });
		await ledger.accept(receipt, {
			...receipt,
			[field]: field === "scope" ? { ...scope, sessionId: "other" } : "e".repeat(64),
			status: "accepted",
			resultSha256: null,
			readback: [],
		});
		f.port.execute.mockClear();
		f.port.readback.mockClear();
		expect(await f.executor(false, ledger).receipts(f.reviewed)).toEqual({
			status: "failed",
			code: "DUPLICATE_CONFLICT",
			receiptRef: null,
		});
		expect(f.port.execute).not.toHaveBeenCalled();
		expect(f.port.readback).not.toHaveBeenCalled();
	},
);

it("does not start any item when the host signal is already aborted", async () => {
	const f = await fixture();
	const controller = new AbortController();
	controller.abort();
	const before = await readFile(f.path);
	expect(await f.executor().run(f.reviewed, f.batch, { signal: controller.signal })).toEqual({
		status: "ok",
		value: { status: "cancelled", items: [] },
	});
	expect(f.port.execute).not.toHaveBeenCalled();
	expect(await readFile(f.path)).toEqual(before);
});

it("stops before item two without creating its receipt when aborted after item one", async () => {
	const f = await fixture();
	const controller = new AbortController();
	f.port.readback.mockImplementationOnce(async () => {
		controller.abort();
		return [file];
	});
	const result = await f.executor().run(f.reviewed, f.batch, { signal: controller.signal });
	if (result.status !== "ok") throw new Error("Expected batch outcome");
	expect(result.value.status).toBe("cancelled");
	expect(result.value.items).toHaveLength(1);
	expect(result.value.items[0]?.status).toBe("succeeded");
	expect(f.port.execute.mock.calls.map(([item]) => item.id)).toEqual(["one"]);
	expect(await f.executor(false, f.open()).receipts(f.reviewed)).toEqual({
		status: "ok",
		value: [...result.value.items, null, null],
	});
});

it("passes the host signal and waits for active cleanup and its durable observation", async () => {
	const f = await fixture();
	const controller = new AbortController();
	const release = vi.fn<() => void>();
	const cleanup = new Promise<void>((resolve) => release.mockImplementation(resolve));
	const sawAbort = vi.fn();
	const active = new Promise<void>((resolve) => {
		f.port.execute.mockImplementation(async (_item, _batch, context) => {
			resolve();
			await cleanup;
			sawAbort(context.signal?.aborted);
			throw new Error("Synthetic private abort reason");
		});
	});
	const executor = f.executor();
	const settled = vi.fn();
	const running = executor.run(f.reviewed, f.batch, { signal: controller.signal }).then((result) => {
		settled();
		return result;
	});
	await active;
	controller.abort("Synthetic private abort reason");
	try {
		expect(await executor.receipts(f.reviewed)).toMatchObject({
			status: "ok",
			value: [{ status: "accepted" }, null, null],
		});
		expect(settled).not.toHaveBeenCalled();
	} finally {
		release();
	}
	const result = await running;
	if (result.status !== "ok") throw new Error("Expected batch outcome");
	expect(result.value.status).toBe("cancelled");
	expect(result.value.items).toHaveLength(1);
	expect(result.value.items[0]?.status).toBe("outcome-unknown");
	expect(f.port.execute).toHaveBeenCalledTimes(1);
	expect(f.port.execute.mock.calls[0]?.[2].signal).toBe(controller.signal);
	expect(sawAbort).toHaveBeenCalledWith(true);
	expect(await Promise.all(result.value.items.map((receipt) => f.open().getByRef(receipt)))).toEqual(
		result.value.items,
	);
	expect(await readFile(f.path, "utf8")).not.toContain("Synthetic private abort reason");
});
