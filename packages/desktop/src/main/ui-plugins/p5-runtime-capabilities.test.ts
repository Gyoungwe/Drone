import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createP5FactStore,
	createP5ReceiptStore,
	P5_FACT_STORAGE,
	P5_RECEIPT_STORAGE,
	type PluginCapabilityContext,
	type PluginRuntimeCapabilitiesOptions,
	type PluginSessionCallerContext,
	StorageRegistry,
} from "@drone/backend";
import { contractContentHash } from "@drone/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createP5RuntimeCapabilities } from "./p5-runtime-capabilities";

const scope = {
	workspaceId: "workspace-a",
	sessionId: "session-a",
	callerSourceHash: "a".repeat(64),
	providerSourceHash: "a".repeat(64),
};
const source = {
	pluginId: "fixture",
	packageRoot: "/fixture",
	entrypoint: "/fixture/runtime.js",
	contentHash: scope.callerSourceHash,
};
const fixture = {
	directory: "",
	registry: new StorageRegistry(),
	sessions: new Map<string, PluginSessionCallerContext>(),
};
const ok = (value: unknown) => ({ status: "ok", value });
const denied = { status: "failed", code: "DENIED", receiptRef: null };
function session(sessionId = scope.sessionId, workspaceId = scope.workspaceId): PluginSessionCallerContext {
	const identity = {};
	const caller = {
		identity,
		sessionIdentity: identity,
		scope: { kind: "session" as const, sessionId, workspaceId, workspaceDirectory: "/fixture" },
		signal: new AbortController().signal,
		readOnly: false,
		projectTrusted: true,
	};
	fixture.sessions.set(sessionId, caller);
	return caller;
}
const context = (caller = session()): PluginCapabilityContext => ({
	pluginId: source.pluginId,
	applicationId: "app",
	callerIdentity: {},
	sessionIdentity: caller.identity,
	scope: caller.scope,
	signal: caller.signal,
	bootstrap: false,
	capabilities: {
		call: async () => {
			throw new Error("Unexpected capability call");
		},
	},
});
const activation = () => ({
	pluginId: source.pluginId,
	applicationId: "app",
	signal: new AbortController().signal,
	events: { changed: vi.fn() },
});
const open = () =>
	createP5RuntimeCapabilities({
		userDataDir: fixture.directory,
		storageRegistry: fixture.registry,
		getSessionContext: (id) => fixture.sessions.get(id),
	});
async function seed() {
	const receipts = createP5ReceiptStore({
		path: fixture.registry.assertRegistered(P5_RECEIPT_STORAGE.id).path,
		registry: fixture.registry,
	});
	const receipt = await receipts.accept(
		{ requestId: "request-a" },
		{
			receiptRef: "receipt-a",
			operation: "fixture.read",
			inputSha256: "b".repeat(64),
			scope,
			category: null,
			decision: "not-required",
			status: "accepted",
			at: "2026-11-18T00:00:00Z",
			resultSha256: null,
			readback: [],
			parentReceiptRef: null,
		},
	);
	const facts = createP5FactStore({
		path: fixture.registry.assertRegistered(P5_FACT_STORAGE.id).path,
		registry: fixture.registry,
	});
	const metadata = {
		id: "fact-a",
		kind: "compute",
		entityId: "run-a",
		at: receipt.at,
		status: "succeeded",
		artifactRefs: [],
		runReceiptRef: receipt.receiptRef,
		decisionKind: null,
		basis: [receipt.requestId],
	} as const;
	const hash = contractContentHash([
		[metadata.id, metadata.kind, metadata.entityId, metadata.runReceiptRef, metadata.basis],
		[metadata.at, metadata.status, metadata.artifactRefs, metadata.decisionKind],
	]);
	const fact = await facts.append(scope, { ...metadata, summary: `compute fact-a sha256:${hash}` });
	return { receipt, fact };
}
async function read(
	ports: PluginRuntimeCapabilitiesOptions,
	name: "receipts.read" | "facts.read",
	caller: PluginCapabilityContext,
) {
	const handler = ports.handlers[name];
	if (!handler) throw new Error(`Missing handler: ${name}`);
	return handler.execute(
		name === "receipts.read" ? { receiptRef: "receipt-a" } : { after: null, limit: 64 },
		caller,
	);
}
beforeEach(async () => {
	fixture.directory = await realpath(await mkdtemp(join(tmpdir(), "drone-p5-main-")));
	fixture.registry = new StorageRegistry();
	fixture.sessions.clear();
});
afterEach(async () => {
	await rm(fixture.directory, { recursive: true, force: true });
});

it("registers only the two read handlers over private profile stores", async () => {
	const ports = await open()(source)(activation());
	expect(Object.keys(ports.handlers).sort()).toEqual(["facts.read", "receipts.read"]);
	expect(ports.resources).toEqual([]);
	for (const handler of Object.values(ports.handlers)) {
		expect(handler.effect).toBe("read");
		expect(handler.approval).toBeUndefined();
		expect(handler.observe).toBeUndefined();
	}
	expect(fixture.registry.list()).toEqual([
		{ ...P5_FACT_STORAGE, path: join(fixture.directory, "p5-facts.json") },
		{ ...P5_RECEIPT_STORAGE, path: join(fixture.directory, "p5-receipts.json") },
	]);
});

it("isolates stored receipts and facts by the live workspace and session", async () => {
	const ports = await open()(source)(activation());
	const { receipt, fact } = await seed();
	const caller = context();
	expect(await read(ports, "receipts.read", caller)).toEqual(ok(receipt));
	expect(await read(ports, "facts.read", caller)).toEqual(ok({ cursor: fact.id, facts: [fact] }));
	for (const other of [context(session("session-b")), context(session("session-c", "workspace-b"))]) {
		expect(await read(ports, "receipts.read", other)).toEqual(denied);
		expect(await read(ports, "facts.read", other)).toEqual(ok({ cursor: null, facts: [] }));
	}
});

it("isolates receipts between source activations and preserves them after disposal", async () => {
	const provider = open();
	const first = await provider(source)(activation());
	const second = await provider({ ...source, contentHash: "c".repeat(64) })(activation());
	const { receipt, fact } = await seed();
	const caller = context();
	expect(await read(second, "receipts.read", caller)).toEqual(denied);
	await first.dispose?.();
	for (const name of ["receipts.read", "facts.read"] as const)
		await expect(read(first, name, caller)).rejects.toThrow();
	expect(await read(second, "facts.read", caller)).toEqual(ok({ cursor: fact.id, facts: [fact] }));
	const reopened = await open()(source)(activation());
	expect(await read(reopened, "receipts.read", caller)).toEqual(ok(receipt));
	expect(await read(reopened, "facts.read", caller)).toEqual(ok({ cursor: fact.id, facts: [fact] }));
});

it.each(["receipts.read", "facts.read"] as const)("rejects stale callers: %s", async (name) => {
	const ports = await open()(source)(activation());
	await seed();
	const caller = context();
	session();
	await expect(read(ports, name, caller)).rejects.toThrow("stale");
	const current = context(fixture.sessions.get(scope.sessionId));
	const selection = new AbortController();
	const switched = { ...current, signal: selection.signal };
	selection.abort(new Error("Plugin caller selection changed"));
	await expect(read(ports, name, switched)).rejects.toThrow("selection changed");
	const pending = read(ports, name, current);
	fixture.sessions.delete(scope.sessionId);
	await expect(pending).rejects.toThrow("stale");
	await expect(read(ports, name, current)).rejects.toThrow("stale");
});

it.each(["receipts.read", "facts.read"] as const)("rejects unproven scope: %s", async (name) => {
	const ports = await open()(source)(activation());
	await seed();
	const caller = context();
	for (const invalid of [
		{ ...caller, scope: { kind: "application" as const }, sessionIdentity: undefined },
		{ ...caller, bootstrap: true },
		{ ...caller, providerChain: [{ source, operation: "fixture" }] },
		{ ...caller, scope: { ...caller.scope, workspaceId: "foreign" } },
	])
		await expect(read(ports, name, invalid)).rejects.toThrow();
});
