import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileReadback, Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { afterEach, beforeEach, expect, it } from "vitest";
import { JsonStoreCorruptedError } from "../json-store";
import { StorageRegistry } from "../storage/registry";
import { createP5ComputePlanStore, type P5ComputePlan } from "./p5-compute-plans";

const scope: Scope = {
	workspaceId: "workspace-1",
	sessionId: "session-1",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "b".repeat(64),
};
const input = {
	preflightRef: "host-plan-1",
	profile: "local",
	image: "image@sha256:fixture",
	spec: { jobId: "job-1", hostAlias: "local", workflow: { name: "fixture", version: "1" } },
	collectionRoot: "runs/collected",
	expected: [
		{ path: "a.txt", bytes: 1, sha256: "c".repeat(64) },
		{ path: "b.txt", bytes: 2, sha256: "d".repeat(64) },
	] as const,
	budget: { maxTokens: 100, maxCost: 1, timeoutMs: 1000, maxOutputBytes: 10 },
};
const fixture = { directory: "", path: "" };
const open = () => createP5ComputePlanStore({ path: fixture.path, registry: new StorageRegistry() });
beforeEach(async () => {
	fixture.directory = await mkdtemp(join(tmpdir(), "drone-p5-plans-"));
	fixture.path = join(fixture.directory, "p5-compute-plans.json");
});
afterEach(async () => {
	await rm(fixture.directory, { recursive: true, force: true });
});
function expectFrozen(value: unknown): void {
	if (value !== null && typeof value === "object") {
		expect(Object.isFrozen(value)).toBe(true);
		for (const child of Object.values(value)) expectFrozen(child);
	}
}
it("freezes detached durable plans and preserves missing lookups", async () => {
	const store = open();
	expect(await store.resolve(input.preflightRef, scope)).toBeUndefined();
	await expect(readFile(fixture.path)).rejects.toMatchObject({ code: "ENOENT" });
	const mutable = structuredClone(input);
	const issued = await store.issue(mutable, scope);
	mutable.spec.workflow.name = "changed";
	expect(issued.spec).toEqual(input.spec);
	expectFrozen(issued);
	const resolved = await open().resolve(input.preflightRef, scope);
	expect(resolved).toEqual(issued);
	expectFrozen(resolved);
});
const changes = [
	{ spec: { ...input.spec, workflow: { ...input.spec.workflow, version: "2" } } },
	{ profile: "other" },
	{ image: "other" },
	{ collectionRoot: "other" },
	...input.expected.flatMap((_, index) =>
		["path", "bytes", "sha256"].map((field) => ({
			expected: input.expected.map((entry, i) =>
				i === index
					? { ...entry, [field]: field === "path" ? "other.txt" : field === "bytes" ? 3 : "e".repeat(64) }
					: entry,
			),
		})),
	),
	{ expected: [...input.expected].reverse() },
	...Object.keys(input.budget).map((field) => ({ budget: { ...input.budget, [field]: 5 } })),
];
it.each(changes)("hashes every covered content field: %j", async (change) => {
	const first = await open().issue(input, scope);
	const changed = await open().issue({ ...input, ...change, preflightRef: "host-plan-2" }, scope);
	expect(changed.sha256).not.toBe(first.sha256);
});
it.each(Object.keys(scope) as (keyof Scope)[])("binds scope field %s", async (field) => {
	const first = await open().issue(input, scope);
	const foreign = { ...scope, [field]: field.endsWith("Hash") ? "f".repeat(64) : "foreign" };
	expect(await open().resolve(input.preflightRef, foreign)).toBeUndefined();
	const changed = await open().issue({ ...input, preflightRef: "host-plan-2" }, foreign);
	expect(changed.sha256).not.toBe(first.sha256);
	expect(await open().resolve("unknown", scope)).toBeUndefined();
});
it("issues idempotently with one writer for conflicting content", async () => {
	const [first, second] = await Promise.all([open().issue(input, scope), open().issue(input, scope)]);
	expect(second).toEqual(first);
	const bytes = await readFile(fixture.path);
	expect(await open().issue(input, scope)).toEqual(first);
	await expect(open().issue({ ...input, image: "changed" }, scope)).rejects.toThrow(/conflict/i);
	expect(await readFile(fixture.path)).toEqual(bytes);
	const other = await open().issue({ ...input, preflightRef: "same-content" }, scope);
	expect(other.sha256).toBe(first.sha256);
	const results = await Promise.allSettled(
		["one", "two"].map((image) => open().issue({ ...input, preflightRef: "race", image }, scope)),
	);
	expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
	expect(JSON.parse(await readFile(fixture.path, "utf8"))).toHaveLength(3);
});
const invalidExpectations = [
	[],
	[{ path: "a", bytes: 1 }],
	[{ path: "a", sha256: "c".repeat(64) }],
	...["bad", "c".repeat(63), "z".repeat(64)].map((sha256) => [{ path: "a", bytes: 1, sha256 }]),
	...["/absolute", "../escape", "a/../escape", "C:/absolute", "a\\b"].map((path) => [
		{ ...input.expected[0], path },
	]),
	[input.expected[0], input.expected[0]],
].map((expected) => ({ expected }));
it.each(invalidExpectations)("rejects invalid expectations: %j", async ({ expected }) => {
	// Deliberately cross the input boundary with incomplete file tuples.
	await expect(
		open().issue({ ...input, expected: expected as readonly FileReadback[] }, scope),
	).rejects.toThrow();
	await expect(readFile(fixture.path)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each([
	() => "{broken",
	() => "{}",
	(plan: P5ComputePlan) => JSON.stringify([plan, {}]),
	(plan: P5ComputePlan) => JSON.stringify([{ ...plan, image: "tampered" }]),
	(plan: P5ComputePlan) => JSON.stringify([plan, plan]),
])("fails closed on corrupt ledgers: %s", async (corrupt) => {
	const plan = await open().issue(input, scope);
	const bytes = corrupt(plan);
	await writeFile(fixture.path, bytes);
	await expect(open().resolve(input.preflightRef, scope)).rejects.toBeInstanceOf(JsonStoreCorruptedError);
	await expect(open().issue(input, scope)).rejects.toBeInstanceOf(JsonStoreCorruptedError);
	expect(await readFile(fixture.path, "utf8")).toBe(bytes);
});
