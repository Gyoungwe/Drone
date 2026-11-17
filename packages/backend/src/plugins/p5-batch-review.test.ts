import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BatchInput } from "@gyoungwe/plugin-api/p5-discovery";
import type { Receipt } from "@gyoungwe/plugin-api/p5-receipts";
import { expect, it } from "vitest";
import { JsonStore } from "../json-store";
import { StorageRegistry } from "../storage/registry";
import { createP5BatchReviewer, type FrozenP5Batch, freezeP5Batch } from "./p5-batch-review";
import { createP5ReceiptStore, type P5ReceiptStore } from "./p5-receipt-store";

const sourceHash = "a".repeat(64);
const scope = {
	workspaceId: "w",
	sessionId: "s",
	callerSourceHash: sourceHash,
	providerSourceHash: sourceHash,
};
function request(count = 2) {
	const ids = Array.from({ length: count }, (_, index) => `case-${index}`);
	const cases = ids.map((id) => ({
		id,
		metric: "rediscovery-rate" as const,
		datasetId: "fixture",
		datasetRevision: "1",
		datasetStatus: "fixture" as const,
		description: "Synthetic case",
	}));
	const items = ids.map((id) => ({
		id,
		budget: { maxTokens: 0, maxCost: null, timeoutMs: 1000, maxOutputBytes: 1024 },
		execution: { kind: "compute" as const, preflightRef: "pf" },
	}));
	const plan = { kind: "evaluation", runId: "run", cases } as const;
	return { requestId: "batch", plan, items } satisfies BatchInput;
}
function plans(input: BatchInput) {
	return input.items.map((item) => ({
		itemId: item.id,
		profile: item.execution.kind === "model" ? item.execution.profile : "local",
		image: "sha256:cached",
		preflightRef: "pf",
		preflightSha256: "c".repeat(64),
	}));
}
async function withStore(run: (store: P5ReceiptStore, path: string) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), "drone-p5-batch-"));
	try {
		const path = join(directory, "receipts.json");
		await new JsonStore({ path, storageId: "p5-receipts", defaultValue: () => [] }).write([]);
		await run(createP5ReceiptStore({ path, registry: new StorageRegistry() }), path);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
async function record(
	store: P5ReceiptStore,
	batch: FrozenP5Batch,
	category: NonNullable<Receipt["category"]>,
) {
	await store.accept(
		{ requestId: category },
		{
			receiptRef: category,
			operation: "execution.batch.run",
			inputSha256: batch.sha256,
			scope: batch.scope,
			category,
			decision: "approved",
			status: "accepted",
			at: "2026-11-18T00:00:00Z",
			resultSha256: null,
			readback: [],
			parentReceiptRef: null,
		},
	);
}
const decisions = async () => ({ compute: { requestId: "compute-preflight" }, model: null });

it.each(["case", "path", "item", "missing", "unidentified", "resolution", "image", "hash", "preflight"])(
	"rejects invalid %s without writes",
	(kind) =>
		withStore(async (_store, path) => {
			const input = request(kind === "path" ? 5 : 2);
			if (kind === "case") for (const entry of input.plan.cases) entry.id = "duplicate";
			if (kind === "item") for (const item of input.items) item.id = "duplicate";
			if (kind === "missing") input.items.pop();
			if (kind === "unidentified") for (const item of input.items) Reflect.deleteProperty(item, "id");
			const paths = Array.from({ length: 5 }, () => ({
				id: "duplicate",
				description: "Path",
				parameters: [],
			}));
			const multipath = {
				kind: "multipath",
				planId: "p",
				findingId: "f",
				intent: "exploratory",
				priorRecordRef: null,
				paths,
			} as const;
			const candidate: BatchInput = { ...input, plan: kind === "path" ? multipath : input.plan };
			const resolved = plans(candidate);
			if (kind === "resolution") for (const plan of resolved) plan.itemId = "duplicate";
			if (kind === "image") for (const plan of resolved) Reflect.set(plan, "image", null);
			if (kind === "hash") for (const plan of resolved) Reflect.set(plan, "preflightSha256", null);
			if (kind === "preflight") for (const plan of resolved) plan.preflightRef = "other";
			const before = await readFile(path);
			const reason = kind === "case" || kind === "path" ? "Duplicate path/case IDs" : undefined;
			expect(() => freezeP5Batch(candidate, resolved, scope)).toThrow(reason);
			expect(await readFile(path)).toEqual(before);
		}),
);

it("copies and freezes all nested inputs", () =>
	withStore(async (_store, path) => {
		const input = request();
		const resolved = plans(input);
		const boundScope = { ...scope };
		const frozen = freezeP5Batch(input, resolved, boundScope);
		for (const entry of input.plan.cases) entry.description = "Changed";
		for (const item of input.items) item.budget.timeoutMs = 2000;
		for (const plan of resolved) plan.profile = "changed";
		boundScope.sessionId = "changed";
		expect(frozen.request.plan).toMatchObject({
			cases: [{ description: "Synthetic case" }, expect.anything()],
		});
		expect(frozen.plans[0]).toMatchObject({ profile: "local", budget: { timeoutMs: 1000 } });
		expect(frozen.scope).toEqual(scope);
		const before = await readFile(path);
		for (const plan of frozen.plans) expect(Reflect.set(plan.budget, "timeoutMs", 3000)).toBe(false);
		expect(Reflect.set(frozen.request.items, "0", null)).toBe(false);
		expect(await readFile(path)).toEqual(before);
	}));

it.each(["add", "remove", "reorder", "budget", "profile", "image", "preflight"])(
	"invalidates %s changes",
	(kind) =>
		withStore(async (store, path) => {
			const input = request();
			const batch = freezeP5Batch(input, plans(input), scope);
			await record(store, batch, "compute-preflight");
			const reviewer = createP5BatchReviewer(store, decisions);
			const reviewed = await reviewer.review(batch);
			expect(reviewer.validates(reviewed, batch)).toBe(true);
			expect(reviewer.validates(structuredClone(reviewed), batch)).toBe(false);
			expect(createP5BatchReviewer(store, decisions).validates(reviewed, batch)).toBe(false);
			const changed = request(kind === "add" ? 3 : kind === "remove" ? 1 : 2);
			if (kind === "reorder") changed.items.reverse();
			if (kind === "budget") for (const item of changed.items) item.budget.timeoutMs = 2000;
			const resolved = plans(changed);
			if (kind === "profile") for (const plan of resolved) plan.profile = "changed";
			if (kind === "image") for (const plan of resolved) plan.image = "sha256:changed";
			if (kind === "preflight") for (const plan of resolved) plan.preflightSha256 = "d".repeat(64);
			const next = freezeP5Batch(changed, resolved, scope);
			const before = await readFile(path);
			expect(next.sha256).not.toBe(batch.sha256);
			expect(reviewer.validates(reviewed, next)).toBe(false);
			await expect(reviewer.review(next)).rejects.toThrow("decision");
			expect(await readFile(path)).toEqual(before);
		}),
);

it("requires one M decision for model items", () =>
	withStore(async (store, path) => {
		const execution = {
			kind: "model",
			profile: "critic",
			prompt: "Synthetic",
			resultKind: "evaluation-observation",
		} as const;
		const input: BatchInput = {
			...request(),
			items: request().items.map((item) => ({ ...item, execution })),
		};
		const batch = freezeP5Batch(input, plans(input), scope);
		await record(store, batch, "compute-preflight");
		const before = await readFile(path);
		await expect(createP5BatchReviewer(store, decisions).review(batch)).rejects.toThrow("decision");
		expect(await readFile(path)).toEqual(before);
		await record(store, batch, "background-model-spend");
		const both = async () => ({ ...(await decisions()), model: { requestId: "background-model-spend" } });
		expect((await createP5BatchReviewer(store, both).review(batch)).modelReceiptRef).toBe(
			"background-model-spend",
		);
	}));
