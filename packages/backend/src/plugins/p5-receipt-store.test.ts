import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Receipt } from "@gyoungwe/plugin-api/p5-receipts";
import { afterEach, beforeEach, expect, it } from "vitest";
import { JsonStore, JsonStoreCorruptedError } from "../json-store";
import { createDefaultStorageRegistry, StorageRegistry } from "../storage/registry";
import { createP5ReceiptStore, P5_RECEIPT_STORAGE, P5ReceiptStoreError } from "./p5-receipt-store";

const request = { requestId: "host-request-1" };
const accepted: Omit<Receipt, "requestId"> = {
	receiptRef: "host-receipt-1",
	operation: "files.writeBundle",
	inputSha256: "a".repeat(64),
	scope: {
		workspaceId: "workspace-1",
		sessionId: "session-1",
		callerSourceHash: "b".repeat(64),
		providerSourceHash: "c".repeat(64),
	},
	category: "compute-preflight",
	decision: "approved",
	status: "accepted",
	at: "2026-11-18T00:00:00Z",
	resultSha256: null,
	readback: [],
	parentReceiptRef: null,
};
const succeeded = {
	status: "succeeded",
	at: "2026-11-18T00:01:00Z",
	resultSha256: "d".repeat(64),
	readback: [{ path: "runs/export.json", sha256: "e".repeat(64), bytes: 12 }],
} as const;

interface Fixture {
	directory: string;
	path: string;
	registry: StorageRegistry;
}
const fixture: Fixture = { directory: "", path: "", registry: new StorageRegistry() };
const open = () => createP5ReceiptStore({ path: fixture.path, registry: fixture.registry });

beforeEach(async () => {
	fixture.directory = await mkdtemp(join(tmpdir(), "drone-p5-receipts-"));
	fixture.path = join(fixture.directory, "receipts.json");
	fixture.registry = new StorageRegistry();
});
afterEach(async () => {
	await rm(fixture.directory, { recursive: true, force: true });
});

it("registers private host metadata and reads a missing request without creating a file", async () => {
	const store = open();
	expect(fixture.registry.get(P5_RECEIPT_STORAGE.id)).toEqual({
		...P5_RECEIPT_STORAGE,
		path: fixture.path,
	});
	expect(await store.get(request)).toBeUndefined();
	await expect(readFile(fixture.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("uses the default registry's private receipt path and rejects a different path", () => {
	const agentDir = fixture.directory;
	const path = join(agentDir, "p5-receipts.json");
	const registry = createDefaultStorageRegistry({ agentDir });
	expect(registry.get("agent-p5-receipts")).toEqual({
		id: "agent-p5-receipts",
		path,
		owner: "plugins/p5-receipt-store",
		schema: 1,
		sensitivity: "private",
	});
	expect(() => createP5ReceiptStore({ path, registry })).not.toThrow();
	expect(() => createP5ReceiptStore({ path: fixture.path, registry })).toThrow(
		"P5 receipt storage registration does not match the ledger",
	);
});

it("persists exact accepted and terminal receipts across fresh JsonStore instances", async () => {
	const store = open();
	const first = await store.accept(request, accepted);
	expect(first).toEqual({ ...accepted, ...request });
	expect(await open().get(request)).toEqual(first);
	const terminal = await store.finish(request, succeeded);
	expect(terminal).toEqual({ ...first, ...succeeded });
	expect(await open().get(request)).toEqual(terminal);
	expect(JSON.parse(await readFile(fixture.path, "utf8"))).toEqual([terminal]);
});

it.each([
	{
		state: "known",
		metered: false,
		inputTokens: 12,
		outputTokens: 3,
		cost: { amountMicros: 250, currency: "USD" },
	},
	{ state: "unknown", metered: true, inputTokens: null, outputTokens: null, cost: null },
] as const)("persists $state per-item usage unchanged across reopen", async (usage) => {
	const store = open();
	await store.accept(request, accepted);
	const terminal = await store.finish(request, { ...succeeded, usage });
	expect(terminal).toEqual({ ...accepted, ...request, ...succeeded, usage });
	expect(await open().get(request)).toEqual(terminal);
	expect(await open().getByRef({ receiptRef: accepted.receiptRef })).toEqual(terminal);
	const bytes = await readFile(fixture.path);
	await expect(
		open().finish(request, { ...succeeded, usage: { ...usage, metered: !usage.metered } }),
	).rejects.toMatchObject({ code: "STATE_CONFLICT" });
	expect(await readFile(fixture.path)).toEqual(bytes);
});

it("rejects concurrent acceptance with different usage", async () => {
	const usage = {
		state: "unknown",
		metered: true,
		inputTokens: null,
		outputTokens: null,
		cost: null,
	} as const;
	const results = await Promise.allSettled([
		open().accept(request, { ...accepted, usage }),
		open().accept(request, { ...accepted, usage: { ...usage, metered: false } }),
	]);
	expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
	expect(results.filter((result) => result.status === "rejected")).toEqual([
		expect.objectContaining({ reason: expect.objectContaining({ code: "DUPLICATE_CONFLICT" }) }),
	]);
});

it("looks up accepted and terminal receipts by reference after reopening", async () => {
	const store = open();
	const first = await store.accept(request, accepted);
	const second = await store.accept(
		{ requestId: "host-request-2" },
		{ ...accepted, receiptRef: "host-receipt-2" },
	);
	expect(await open().getByRef({ receiptRef: first.receiptRef })).toEqual(first);
	expect(await open().getByRef({ receiptRef: second.receiptRef })).toEqual(second);
	const terminal = await store.finish(request, succeeded);
	const reopened = open();
	expect(await reopened.getByRef({ receiptRef: first.receiptRef })).toEqual(terminal);
	expect(await reopened.getByRef({ receiptRef: second.receiptRef })).toEqual(second);
});

it("returns undefined for unknown references without creating or changing the ledger", async () => {
	const store = open();
	const missing = { receiptRef: "host-receipt-missing" };
	expect(await store.getByRef(missing)).toBeUndefined();
	await expect(readFile(fixture.path)).rejects.toMatchObject({ code: "ENOENT" });
	await store.accept(request, accepted);
	const bytes = await readFile(fixture.path);
	expect(await open().getByRef(missing)).toBeUndefined();
	expect(await open().getByRef({ receiptRef: request.requestId })).toBeUndefined();
	expect(await readFile(fixture.path)).toEqual(bytes);
});

it("rejects a reference reused by another request with a typed conflict and preserves file bytes", async () => {
	await open().accept(request, accepted);
	const bytes = await readFile(fixture.path);
	const conflicting = open().accept({ requestId: "host-request-2" }, accepted);
	await expect(conflicting).rejects.toBeInstanceOf(P5ReceiptStoreError);
	await expect(conflicting).rejects.toMatchObject({ code: "DUPLICATE_CONFLICT" });
	expect(await readFile(fixture.path)).toEqual(bytes);
});

it("returns the stored receipt for the same request hash without writing, including after completion", async () => {
	const store = open();
	const first = await store.accept(request, accepted);
	const bytes = await readFile(fixture.path);
	expect(await open().accept(request, { ...accepted, at: "2026-11-18T01:00:00Z" })).toEqual(first);
	expect(await readFile(fixture.path)).toEqual(bytes);
	const terminal = await store.finish(request, succeeded);
	const terminalBytes = await readFile(fixture.path);
	expect(await open().accept(request, accepted)).toEqual(terminal);
	expect(await readFile(fixture.path)).toEqual(terminalBytes);
});

it("rejects a changed request hash with a typed conflict and preserves file bytes", async () => {
	const store = open();
	await store.accept(request, accepted);
	const bytes = await readFile(fixture.path);
	const conflicting = store.accept(request, { ...accepted, inputSha256: "f".repeat(64) });
	await expect(conflicting).rejects.toBeInstanceOf(P5ReceiptStoreError);
	await expect(conflicting).rejects.toMatchObject({ code: "DUPLICATE_CONFLICT" });
	expect(await readFile(fixture.path)).toEqual(bytes);
});

it("makes concurrent acceptance of the same request hash idempotent across store instances", async () => {
	const results = await Promise.all([
		open().accept(request, accepted),
		open().accept(request, { ...accepted, at: "2026-11-18T01:00:00Z" }),
	]);
	expect(results[1]).toEqual(results[0]);
	expect(await open().get(request)).toEqual(results[0]);
});

it("reports a typed duplicate conflict for concurrent acceptance with different hashes", async () => {
	const results = await Promise.allSettled([
		open().accept(request, accepted),
		open().accept(request, { ...accepted, inputSha256: "f".repeat(64) }),
	]);
	expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
	expect(results.filter((result) => result.status === "rejected")).toEqual([
		expect.objectContaining({ reason: expect.objectContaining({ code: "DUPLICATE_CONFLICT" }) }),
	]);
});

it.each(["succeeded", "failed", "cancelled", "outcome-unknown", "cleanup-failed"] as const)(
	"keeps %s final against duplicate and changed completions",
	async (status) => {
		const store = open();
		await store.accept(request, accepted);
		const completion = {
			...succeeded,
			status,
			resultSha256: status === "succeeded" ? succeeded.resultSha256 : null,
		};
		await store.finish(request, completion);
		const bytes = await readFile(fixture.path);
		for (const next of [completion, { ...succeeded, resultSha256: "f".repeat(64) }]) {
			await expect(open().finish(request, next)).rejects.toMatchObject({ code: "STATE_CONFLICT" });
			expect(await readFile(fixture.path)).toEqual(bytes);
		}
	},
);

it("records approval denial without an accepted invocation and rejects further transitions", async () => {
	const store = open();
	const denied = await store.accept(request, { ...accepted, decision: "denied", status: "failed" });
	expect(denied).toMatchObject({ decision: "denied", status: "failed", resultSha256: null, readback: [] });
	await expect(store.finish(request, succeeded)).rejects.toMatchObject({ code: "STATE_CONFLICT" });
});

it("rejects invalid acceptance metadata before writing", async () => {
	const store = open();
	for (const invalid of [
		{ ...accepted, status: "succeeded" as const },
		{ ...accepted, decision: "denied" as const, status: "failed" as const, readback: succeeded.readback },
		{ ...accepted, payload: "synthetic unexpected field" },
	]) {
		await expect(store.accept(request, invalid)).rejects.toMatchObject({ code: "INVALID_INPUT" });
		await expect(readFile(fixture.path)).rejects.toMatchObject({ code: "ENOENT" });
	}
});

it("validates terminal cross-field rules before writing", async () => {
	const store = open();
	await store.accept(request, accepted);
	const bytes = await readFile(fixture.path);
	for (const invalid of [
		{ ...succeeded, resultSha256: null },
		{ ...succeeded, status: "failed" as const },
		{ ...succeeded, readback: [{ ...succeeded.readback[0], path: "../escaped" }] },
	]) {
		await expect(store.finish(request, invalid)).rejects.toMatchObject({ code: "INVALID_INPUT" });
		expect(await readFile(fixture.path)).toEqual(bytes);
	}
});

it.each(["{broken", "{}", '[{"requestId":"invalid-record"}]'])(
	"preserves corrupt disk contents on lookup, acceptance and terminal update: %s",
	async (garbage) => {
		const store = open();
		await store.accept(request, accepted);
		await writeFile(fixture.path, garbage);
		for (const action of [
			() => open().get(request),
			() => store.accept(request, accepted),
			() => store.finish(request, succeeded),
		]) {
			await expect(action()).rejects.toBeInstanceOf(JsonStoreCorruptedError);
			expect(await readFile(fixture.path, "utf8")).toBe(garbage);
		}
	},
);

it.each(["{broken", "{}", '[{"requestId":"invalid-record"}]'])(
	"rejects corrupt disk contents on reference lookup without changing them: %s",
	async (garbage) => {
		const store = open();
		await store.accept(request, accepted);
		await writeFile(fixture.path, garbage);
		for (const reader of [store, open()]) {
			await expect(reader.getByRef({ receiptRef: accepted.receiptRef })).rejects.toBeInstanceOf(
				JsonStoreCorruptedError,
			);
			expect(await readFile(fixture.path, "utf8")).toBe(garbage);
		}
	},
);

it.each(["accept", "finish"] as const)("rejects mutated JsonStore readback after %s", async (action) => {
	if (action === "finish") await open().accept(request, accepted);
	const json = new JsonStore<Receipt[]>({
		path: fixture.path,
		storageId: P5_RECEIPT_STORAGE.id,
		defaultValue: () => [],
	});
	const read = json.read.bind(json);
	const wrapper = {
		storageId: json.storageId,
		writeChecked: json.writeChecked.bind(json),
		read: async () => (await read()).map((receipt) => ({ ...receipt, operation: "mutated" })),
	};
	const store = createP5ReceiptStore({ path: fixture.path, registry: fixture.registry, store: wrapper });
	const result = action === "accept" ? store.accept(request, accepted) : store.finish(request, succeeded);
	await expect(result).rejects.toMatchObject({ code: "READBACK_FAILED" });
	expect(await open().get(request)).toEqual({
		...accepted,
		...request,
		...(action === "finish" ? succeeded : {}),
	});
});

it("rejects a raw-byte CAS change between the first check and atomic rename", async () => {
	await open().accept(request, accepted);
	const changedBytes = `${await readFile(fixture.path, "utf8")}\n`;
	const json = new JsonStore<Receipt[]>({
		path: fixture.path,
		storageId: P5_RECEIPT_STORAGE.id,
		defaultValue: () => [],
	});
	let checked = false;
	const wrapper = {
		storageId: json.storageId,
		read: json.read.bind(json),
		writeChecked: <R>(records: Receipt[], boundary: { check(): Promise<void>; readBack(): Promise<R> }) =>
			json.writeChecked(records, {
				readBack: boundary.readBack,
				check: async () => {
					await boundary.check();
					if (checked) return;
					checked = true;
					await writeFile(fixture.path, changedBytes);
				},
			}),
	};
	const store = createP5ReceiptStore({ path: fixture.path, registry: fixture.registry, store: wrapper });
	await expect(store.finish(request, succeeded)).rejects.toMatchObject({ code: "STATE_CONFLICT" });
	expect(await readFile(fixture.path, "utf8")).toBe(changedBytes);
	expect(await open().get(request)).toEqual({ ...accepted, ...request });
});

it("allows only one terminal writer when two store instances complete concurrently", async () => {
	await open().accept(request, accepted);
	const results = await Promise.allSettled([
		open().finish(request, succeeded),
		open().finish(request, { ...succeeded, status: "cancelled", resultSha256: null }),
	]);
	expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
	expect(results.filter((result) => result.status === "rejected")).toEqual([
		expect.objectContaining({ reason: expect.objectContaining({ code: "STATE_CONFLICT" }) }),
	]);
	const winner = results.find((result) => result.status === "fulfilled");
	if (winner?.status !== "fulfilled") throw new Error("Expected one committed terminal receipt");
	expect(await open().get(request)).toEqual(winner.value);
});
