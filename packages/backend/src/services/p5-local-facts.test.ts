import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileReadback } from "@gyoungwe/plugin-api/p5-receipts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createP5FactStore, p5FactSummary } from "../plugins/p5-facts";
import { StorageRegistry } from "../storage/registry";
import { createP5LocalFacts } from "./p5-local-facts";

const scope = { workspaceId: "workspace-1", sessionId: "session-1" };
const at = "2026-11-18T00:00:00Z";
const fixture = { directory: "" };
const open = () =>
	createP5FactStore({
		path: join(fixture.directory, "facts.json"),
		registry: new StorageRegistry(),
	});
const execution = () => ({
	id: "execution-1",
	outcome: "succeeded" as const,
	code: "print('synthetic code body')",
	stdout: "synthetic standard output",
	stderr: "synthetic standard error",
	outputBody: "synthetic output body",
	summary: "synthetic supplied summary",
	artifacts: [],
});

beforeEach(async () => {
	fixture.directory = await mkdtemp(join(tmpdir(), "drone-p5-local-facts-"));
});
afterEach(async () => {
	await rm(fixture.directory, { recursive: true, force: true });
});

it("persists only host metadata through F1 and reads it back after reopen", async () => {
	const producer = createP5LocalFacts({ append: open().append, scope, readback: vi.fn() });
	const input = execution();
	const fact = await producer.record(input, at);
	expect(fact).toMatchObject({
		kind: "local-execution",
		entityId: "execution-1",
		at,
		status: "succeeded",
		sequence: 1,
		artifactRefs: [],
		runReceiptRef: null,
		decisionKind: null,
		basis: [],
	});
	expect(fact.summary).toBe(p5FactSummary(fact));
	for (const content of [input.code, input.stdout, input.stderr, input.outputBody, input.summary])
		expect(JSON.stringify(fact)).not.toContain(content);
	expect(await open().read(scope, { after: null, limit: 64 })).toEqual({
		cursor: fact.id,
		facts: [fact],
	});
	expect(await open().read({ ...scope, sessionId: "other" }, { after: null, limit: 64 })).toEqual({
		cursor: null,
		facts: [],
	});
});

it("claims only hash-matching readbacks and omits output paths without a verified hash", async () => {
	const output = "synthetic artifact body";
	const sha256 = createHash("sha256").update(output).digest("hex");
	await writeFile(join(fixture.directory, "output.txt"), output);
	const readback = vi.fn(async (path: string) => {
		const bytes = await readFile(join(fixture.directory, path));
		return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
	});
	const producer = createP5LocalFacts({ append: open().append, scope, readback });
	const input = {
		...execution(),
		artifacts: [
			{ path: "output.txt", bytes: output.length, sha256, content: output },
			{ path: "unverified.txt", bytes: 12 },
		],
	};
	const fact = await producer.record(input, at);
	expect(fact.artifactRefs).toEqual([
		{
			id: `${fact.id}:artifact:0`,
			path: "output.txt",
			bytes: output.length,
			sha256,
			parentIds: [],
			purpose: "deliverable",
		},
	]);
	expect(readback.mock.calls).toEqual([["output.txt"]]);
	expect(JSON.stringify(fact)).not.toContain(output);
	expect((await open().read(scope, { after: null, limit: 64 })).facts).toEqual([fact]);
});

it.each([
	["failed", "failed"],
	["interrupted", "unknown"],
	["blocked", "blocked"],
	["unknown", "unknown"],
] as const)("records %s executions as %s, never success", async (outcome, status) => {
	const producer = createP5LocalFacts({ append: open().append, scope, readback: vi.fn() });
	const fact = await producer.record({ ...execution(), outcome }, at);
	expect(fact.kind).toBe("local-execution");
	expect(fact.status).toBe(status);
	expect((await open().read(scope, { after: null, limit: 64 })).facts).toEqual([fact]);
});

it("rejects an unfinished execution before readback or append", async () => {
	const append = vi.fn(open().append);
	const readback = vi.fn();
	const producer = createP5LocalFacts({ append, scope, readback });
	await expect(producer.record({ ...execution(), outcome: "running" }, at)).rejects.toMatchObject({
		code: "INVALID_INPUT",
	});
	expect(readback).not.toHaveBeenCalled();
	expect(append).not.toHaveBeenCalled();
	expect((await open().read(scope, { after: null, limit: 64 })).facts).toEqual([]);
});

it.each([
	undefined,
	{ path: "other.txt", bytes: 12, sha256: "a".repeat(64) },
	{ path: "output.txt", bytes: 12, sha256: "b".repeat(64) },
	{ path: "output.txt", bytes: 13, sha256: "a".repeat(64) },
])("does not claim missing readback or append mismatched metadata: %j", async (observed) => {
	const append = vi.fn(open().append);
	const readback = vi.fn(async (): Promise<FileReadback | undefined> => observed);
	const producer = createP5LocalFacts({ append, scope, readback });
	const input = {
		...execution(),
		artifacts: [{ path: "output.txt", bytes: 12, sha256: "a".repeat(64) }],
	};
	if (observed === undefined) {
		expect((await producer.record(input, at)).artifactRefs).toEqual([]);
	} else {
		await expect(producer.record(input, at)).rejects.toMatchObject({ code: "READBACK_FAILED" });
		expect(append).not.toHaveBeenCalled();
		expect((await open().read(scope, { after: null, limit: 64 })).facts).toEqual([]);
	}
});

it("propagates readback failure without appending a success or copying output content", async () => {
	const append = vi.fn(open().append);
	const readback = vi.fn(async (): Promise<FileReadback> => {
		throw new Error("Readback unavailable");
	});
	const producer = createP5LocalFacts({ append, scope, readback });
	await expect(
		producer.record({ ...execution(), artifacts: [{ path: "output.txt", sha256: "a".repeat(64) }] }, at),
	).rejects.toThrow("Readback unavailable");
	expect(append).not.toHaveBeenCalled();
	expect((await open().read(scope, { after: null, limit: 64 })).facts).toEqual([]);
});

it("reuses an observation ID on replay and keeps identical execution IDs separate by host scope", async () => {
	const store = open();
	const producer = createP5LocalFacts({ append: store.append, scope, readback: vi.fn() });
	const first = await producer.record(execution(), at);
	expect(await producer.record(execution(), at)).toEqual(first);
	const otherScope = { ...scope, sessionId: "session-2" };
	const other = await createP5LocalFacts({
		append: store.append,
		scope: otherScope,
		readback: vi.fn(),
	}).record(execution(), at);
	expect(other.id).not.toBe(first.id);
	expect((await store.read(scope, { after: null, limit: 64 })).facts).toEqual([first]);
	expect((await store.read(otherScope, { after: null, limit: 64 })).facts).toEqual([other]);
});
