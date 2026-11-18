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
