import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fact } from "@gyoungwe/plugin-api/p5-inquiry";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JsonStoreCorruptedError } from "../json-store";
import { StorageRegistry } from "../storage/registry";
import { createP5FactStore, p5FactCapabilityHandlers, p5FactSummary } from "./p5-facts";
import { PluginCapabilityBroker } from "./runtime-capabilities";

const scope = { workspaceId: "workspace-1", sessionId: "session-1" };
const fixture = { directory: "", path: "", registry: new StorageRegistry() };
const open = () => createP5FactStore({ path: fixture.path, registry: fixture.registry });
function fact(id: string): Omit<Fact, "sequence"> {
	const metadata = {
		id,
		kind: "compute",
		entityId: "host-run-1",
		at: "2026-11-18T00:00:00Z",
		status: "succeeded",
		artifactRefs: [
			{
				id: "artifact-1",
				path: "runs/output.json",
				bytes: 12,
				sha256: "a".repeat(64),
				parentIds: [],
				purpose: "evidence",
			},
		],
		runReceiptRef: "host-receipt-1",
		decisionKind: null,
		basis: ["host-request-1"],
	} as const;
	return { ...metadata, summary: p5FactSummary(metadata) };
}
beforeEach(async () => {
	fixture.directory = await mkdtemp(join(tmpdir(), "drone-p5-facts-"));
	fixture.path = join(fixture.directory, "facts.json");
	fixture.registry = new StorageRegistry();
});
afterEach(async () => {
	await rm(fixture.directory, { recursive: true, force: true });
});

it("persists gapless workspace sequences and reads only the host-bound session after reopen", async () => {
	const store = open();
	const first = await store.append(scope, fact("fact-1"));
	await store.append({ ...scope, sessionId: "session-2" }, fact("fact-2"));
	const third = await store.append(scope, fact("fact-3"));
	const other = await store.append({ ...scope, workspaceId: "workspace-2" }, fact("fact-4"));
	expect([first.sequence, third.sequence, other.sequence]).toEqual([1, 3, 1]);
	const bytes = await readFile(fixture.path);
	expect(await open().read(scope, { after: null, limit: 64 })).toEqual({
		cursor: "fact-3",
		facts: [first, third],
	});
	expect(await readFile(fixture.path)).toEqual(bytes);
});

it("exposes read/no-approval facts with current host scope and closed request schemas", async () => {
	const store = open();
	expect(await store.read(scope, { after: null, limit: 64 })).toEqual({ cursor: null, facts: [] });
	await expect(readFile(fixture.path)).rejects.toMatchObject({ code: "ENOENT" });
	const saved = await store.append(scope, fact("seed"));
	const bytes = await readFile(fixture.path);
	const caller = {
		pluginId: "fixture",
		applicationId: "fixture",
		callerIdentity: {},
		scope: { kind: "session", ...scope, workspaceDirectory: "/fixture" } as const,
		signal: new AbortController().signal,
		bootstrap: false,
	};
	const authorize = vi.fn<Parameters<PluginCapabilityBroker["run"]>[3]>(async () => true);
	const broker = new PluginCapabilityBroker({
		resources: [],
		handlers: p5FactCapabilityHandlers(store, (context) =>
			context.scope.kind === "session" ? context.scope : undefined,
		),
	});
	const collect = (input: unknown) =>
		broker.run(caller, "read", vi.fn(), authorize, () => broker.port.call("facts.read", input));
	expect(await collect({ after: null, limit: 1 })).toEqual({
		status: "ok",
		value: { cursor: "seed", facts: [saved] },
	});
	const invalidCursor = { status: "failed", code: "INVALID_INPUT", receiptRef: null };
	expect(await collect({ after: "unknown", limit: 1 })).toEqual(invalidCursor);
	expect(await readFile(fixture.path)).toEqual(bytes);
	await expect(collect({ after: null, limit: 1, workspaceId: "other" })).rejects.toThrow(
		"Invalid plugin capability input: facts.read",
	);
	expect(await readFile(fixture.path)).toEqual(bytes);
	expect(authorize.mock.calls.map(([, , effect, , , approval]) => [effect, approval])).toEqual([
		["read", undefined],
		["read", undefined],
	]);
});

it("deduplicates ID/hash without writing and rejects changed hashes and copied IDs", async () => {
	const store = open();
	const input = fact("fact-1");
	const first = await store.append(scope, input);
	const bytes = await readFile(fixture.path);
	expect(await open().append(scope, input)).toEqual(first);
	expect(await readFile(fixture.path)).toEqual(bytes);
	const changed = { ...input, status: "failed" as const };
	changed.summary = p5FactSummary(changed);
	for (const [target, candidate] of [
		[scope, changed],
		[{ ...scope, sessionId: "other" }, input],
	] as const) {
		await expect(store.append(target, candidate)).rejects.toMatchObject({ code: "DUPLICATE_CONFLICT" });
		expect(await readFile(fixture.path)).toEqual(bytes);
	}
});

it.each([
	{ summary: "synthetic plugin prose" },
	{ body: "synthetic body" },
	{ content: "synthetic content" },
])("rejects non-template summaries and payload fields without writing: %j", async (override) => {
	await open().append(scope, fact("seed"));
	const bytes = await readFile(fixture.path);
	await expect(open().append(scope, { ...fact("invalid"), ...override })).rejects.toMatchObject({
		code: "INVALID_INPUT",
	});
	expect(await readFile(fixture.path)).toEqual(bytes);
});

it("paginates strictly after scoped cursors and rejects unknown or foreign cursors without writing", async () => {
	const store = open();
	const first = await store.append(scope, fact("first"));
	const second = await store.append(scope, fact("second"));
	await store.append({ ...scope, sessionId: "other" }, fact("foreign-session"));
	await store.append({ ...scope, workspaceId: "other" }, fact("foreign-workspace"));
	const bytes = await readFile(fixture.path);
	expect(await store.read(scope, { after: null, limit: 1 })).toEqual({ cursor: "first", facts: [first] });
	expect(await store.read(scope, { after: "first", limit: 1 })).toEqual({
		cursor: "second",
		facts: [second],
	});
	expect(await store.read(scope, { after: "second", limit: 64 })).toEqual({ cursor: "second", facts: [] });
	for (const after of ["unknown", "foreign-session", "foreign-workspace"]) {
		await expect(store.read(scope, { after, limit: 1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
		expect(await readFile(fixture.path)).toEqual(bytes);
	}
});

it.each([
	() => "{broken",
	() => "{}",
	(text: string) => text.replace('"sequence": 1', '"sequence": 9'),
	(text: string) => text.replace('"summary": "compute', '"summary": "forged'),
	(text: string) => text.replace(/"sha256": "[a-f0-9]{64}"/, `"sha256": "${"b".repeat(64)}"`),
])("rejects corrupt journals on read and append without resetting them: %#", async (corrupt) => {
	await open().append(scope, fact("seed"));
	const garbage = corrupt(await readFile(fixture.path, "utf8"));
	await writeFile(fixture.path, garbage);
	for (const action of [
		() => open().read(scope, { after: null, limit: 1 }),
		() => open().append(scope, fact("next")),
	]) {
		await expect(action()).rejects.toBeInstanceOf(JsonStoreCorruptedError);
		expect(await readFile(fixture.path, "utf8")).toBe(garbage);
	}
});
