import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { p5FactSummary } from "../plugins/p5-facts";
import type { P5ActiveFactOwner } from "../plugins/p5-host-delivery";
import { attachFactOwner } from "../plugins/p5-owner-attachments";
import type { P5CommittedProjection } from "../plugins/p5-owner-facade";
import type { PluginRuntimeSource } from "../plugins/plugin-source";
import type { PluginSessionCallerContext } from "../plugins/session-caller";
import { createDefaultStorageRegistry, StorageRegistry } from "../storage/registry";
import { createP5HostComposition, p5ScopeOf } from "./p5-host-composition";

const HASH = "a".repeat(64);

const fixture = { directory: "", registry: new StorageRegistry() };

/** Waits for a condition the delivery reaches through real filesystem reads. */
async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("Timed out waiting for the delivery");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function source(overrides: Partial<PluginRuntimeSource> = {}): PluginRuntimeSource {
	return {
		pluginId: "plugin-1",
		packageRoot: "/packages/plugin-1",
		entrypoint: "index.js",
		contentHash: HASH,
		...overrides,
	};
}

function session(overrides: Partial<PluginSessionCallerContext> = {}): PluginSessionCallerContext {
	return {
		identity: { kind: "application" },
		sessionIdentity: { kind: "application" },
		scope: { kind: "session", workspaceId: "workspace-1", workspaceDirectory: "/w", sessionId: "session-1" },
		readOnly: false,
		projectTrusted: true,
		...overrides,
	} as unknown as PluginSessionCallerContext;
}

beforeEach(async () => {
	fixture.directory = await mkdtemp(join(tmpdir(), "drone-p5-composition-"));
	fixture.registry = createDefaultStorageRegistry({ agentDir: fixture.directory });
});
afterEach(async () => {
	await rm(fixture.directory, { recursive: true, force: true });
});

it("takes the scope from the live session and the current installed hash", () => {
	expect(p5ScopeOf(source(), session())).toEqual({
		workspaceId: "workspace-1",
		sessionId: "session-1",
		callerSourceHash: HASH,
		providerSourceHash: HASH,
	});
});

it("has no scope for a source that cannot prove its identity", () => {
	expect(p5ScopeOf(source({ contentHash: undefined }), session())).toBeUndefined();
});

it("keeps the source hashes at the installed identity even when the session claims another scope", () => {
	const claimed = session({
		scope: {
			kind: "session",
			workspaceId: "claimed-workspace",
			workspaceDirectory: "/w",
			sessionId: "claimed-session",
		},
	} as unknown as PluginSessionCallerContext);
	const scope = p5ScopeOf(source(), claimed);
	expect(scope?.workspaceId).toBe("claimed-workspace");
	expect(scope?.sessionId).toBe("claimed-session");
	expect(scope?.callerSourceHash).toBe(HASH);
	expect(scope?.providerSourceHash).toBe(HASH);
});

it("binds the fact journal to the host's registered private storage", () => {
	const composition = createP5HostComposition(
		{ userDataDir: fixture.directory, storageRegistry: fixture.registry },
		{ authorize: async () => true },
	);
	expect(fixture.registry.get("agent-p5-facts")?.path).toBe(join(fixture.directory, "p5-facts.json"));
	expect(composition.facts).toBe(composition.factOwners.facts);
});

it("keeps the journal at the ledger's path when the host registered a different one", () => {
	// The ledger owns the path.  A host that keeps its agent directory
	// elsewhere must not get a second journal under the profile directory.
	const agentDir = join(fixture.directory, "agent");
	const registry = createDefaultStorageRegistry({ agentDir });
	const composition = createP5HostComposition(
		{ userDataDir: join(fixture.directory, "user-data"), storageRegistry: registry },
		{ authorize: async () => true },
	);
	expect(registry.get("agent-p5-facts")?.path).toBe(join(agentDir, "p5-facts.json"));
	expect(composition.facts).toBe(composition.factOwners.facts);
});

it("refuses a scope for a source without a current installed identity", () => {
	const composition = createP5HostComposition(
		{ userDataDir: fixture.directory, storageRegistry: fixture.registry },
		{ authorize: async () => true },
	);
	expect(() => composition.factOwners.scopeOf(source({ contentHash: undefined }), session())).toThrow(
		"P5 fact ownership requires a current installed package identity",
	);
});

it("asks the host for authority instead of deciding it", async () => {
	const authorize = vi.fn(async () => false);
	const composition = createP5HostComposition(
		{ userDataDir: fixture.directory, storageRegistry: fixture.registry },
		{ authorize },
	);
	const attachment = {
		workspaceId: "workspace-1",
		sessionId: "session-1",
		callerSourceHash: HASH,
		providerSourceHash: HASH,
		owner: { deliver: async () => ({ cursor: "c" }) },
		signal: new AbortController().signal,
	} as unknown as P5ActiveFactOwner;
	await expect(composition.factOwners.authorize(attachment)).resolves.toBe(false);
	expect(authorize).toHaveBeenCalledTimes(1);
	expect(authorize).toHaveBeenCalledWith(attachment);
});

it("exposes the journal subscription the delivery mechanism needs", () => {
	const composition = createP5HostComposition(
		{ userDataDir: fixture.directory, storageRegistry: fixture.registry },
		{ authorize: async () => true },
	);
	expect(typeof composition.factOwners.facts.subscribe).toBe("function");
	expect(typeof composition.factOwners.facts.read).toBe("function");
});

it("delivers a committed fact to a bound owner through the real journal", async () => {
	const composition = createP5HostComposition(
		{ userDataDir: fixture.directory, storageRegistry: fixture.registry },
		{ authorize: async () => true },
	);
	const controller = new AbortController();
	const caller = session();
	const deliver = vi.fn<P5CommittedProjection["deliver"]>(async (batch) => {
		expect(batch.facts).toHaveLength(1);
		return { cursor: batch.facts[0]?.id ?? "" };
	});
	const owner: P5CommittedProjection = { cursor: async () => null, deliver };
	const attachment = attachFactOwner(composition.factOwners, owner, source(), caller, controller.signal);
	const metadata = {
		id: "fact-1",
		kind: "compute",
		entityId: "run-1",
		at: "2026-11-18T00:00:00Z",
		status: "succeeded",
		artifactRefs: [],
		runReceiptRef: null,
		decisionKind: null,
		basis: [],
	} as const;
	const fact = await composition.facts.append(
		{ workspaceId: "workspace-1", sessionId: "session-1" },
		{ ...metadata, summary: p5FactSummary(metadata) },
	);
	expect(fact.id).toBe("fact-1");
	// The delivery chain crosses the journal's filesystem reads, so the
	// wait is for the delivery itself rather than for a microtask turn.
	await waitFor(() => deliver.mock.calls.length > 0);
	expect(deliver).toHaveBeenCalledTimes(1);
	expect(deliver.mock.calls[0]?.[0].facts[0]?.id).toBe("fact-1");
	await attachment.release();
});
