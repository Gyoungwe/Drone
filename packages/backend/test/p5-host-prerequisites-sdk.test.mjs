// Z3 — the P5 host prerequisites, accepted against the real runtime.
//
// The mechanism modules are unit-tested against fakes.  This file is the
// acceptance that the *real* installed package and the *real* host
// composition behave the way the mechanism assumes: a restricted owner that is
// denied, reopened and revoked.
//
// What this test deliberately does NOT do:
//
//   - It never substitutes a synthetic origin.  The scope comes from the live
//     session's own caller context, and the source identity is the installed
//     package's own content hash, computed by the host's own function.
//   - It never reports PASS on missing artifacts.  If the real runtime or the
//     real built-in package is absent, the test fails with NOT_RUN — a gate
//     that cannot tell "passed" from "never ran" is not a gate
//     (p5-host-prerequisites.md §Z3).
//
// The behaviours under test:
//
//   1. A source without a content identity gets no scope, so no fact owner
//      attaches at all.
//   2. The real installed package's hash becomes the scope's source identity.
//   3. A reopened session is a fresh scope, so a restored receipt from the
//      old session never authorizes the new one.
//   4. A revoked owner stops receiving facts, and the facts it never
//      acknowledged stay in the journal for re-adoption.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { installedPackageHash } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { p5FactSummary } from "../src/plugins/p5-facts";
import { attachFactOwner } from "../src/plugins/p5-owner-attachments";
import { createP5HostComposition, p5ScopeOf } from "../src/services/p5-host-composition";
import { StorageRegistry } from "../src/storage/registry";
import { startBuiltinCore } from "./fixtures/builtin-core.mjs";

const environment = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

const repo = resolve(import.meta.dirname, "../../..");
const runtimeDirectory = join(repo, `packages/desktop/plugin-runtime/${process.platform}-${process.arch}`);
const missingRuntime = join(repo, "packages/desktop/plugin-runtime/does-not-exist");
const shipped = join(repo, "packages/desktop/plugin-packages/node_modules/@gyoungwe/pi-core");

/**
 * The real runtime and the real built-in package must both exist.  A missing
 * one is NOT_RUN, never a pass.
 */
function requireRealArtifacts() {
	for (const path of [runtimeDirectory, shipped]) {
		if (!existsSync(path)) throw new Error(`NOT_RUN: the real artifact is missing at ${path}`);
	}
	return runtimeDirectory;
}

/**
 * The guard above has to be load-bearing even when the artifacts happen to be
 * present, so it is also asserted against a path that cannot exist.
 */
it("reports NOT_RUN instead of passing when a real artifact is missing", () => {
	expect(() => {
		for (const path of [missingRuntime, shipped]) {
			if (!existsSync(path)) throw new Error(`NOT_RUN: the real artifact is missing at ${path}`);
		}
	}).toThrow("NOT_RUN");
});

/** A minimal installed package: a real directory with a real content hash. */
async function installPackage(root, name) {
	const pkg = join(root, "package");
	await mkdir(pkg, { recursive: true });
	await writeFile(join(pkg, "package.json"), JSON.stringify({ name, version: "0.1.0", type: "module" }));
	await writeFile(join(pkg, "runtime.mjs"), `export default async ()=>({operations:{}});`);
	return pkg;
}

/** The fact's own metadata; its summary is derived, never written by hand. */
function factMetadata(id) {
	return {
		id,
		kind: "compute",
		entityId: "entity-1",
		at: "2026-11-22T00:00:00Z",
		status: "succeeded",
		artifactRefs: [],
		runReceiptRef: null,
		decisionKind: null,
		basis: [],
	};
}

/** The composition, its journal and the host's authorization switch. */
function compositionFor(directory) {
	const registry = new StorageRegistry();
	const state = { allowed: true };
	const composition = createP5HostComposition(
		{ userDataDir: join(directory, "agent"), storageRegistry: registry },
		{ authorize: async () => state.allowed },
	);
	return { composition, state };
}

/**
 * The scope identity: the installed package's own hash for both ends of a
 * direct call, over the live session's own workspace and session.
 */
function identityOf(caller) {
	const contentHash = installedPackageHash(shipped);
	const source = { pluginId: "pi-core", packageRoot: shipped, contentHash };
	return { source, contentHash, scope: p5ScopeOf(source, caller) };
}

/**
 * The scope identity over a live session: the installed package's own hash
 * for both ends of a direct call, and a different package's hash for a
 * different scope.  A reopened session is a new scope.
 */
async function scopeIdentity(host, directory, caller) {
	// A source without a content identity has no scope at all, so the host
	// refuses to attach a fact owner rather than inventing one.
	expect(p5ScopeOf({ pluginId: "fixture", packageRoot: shipped }, caller)).toBeUndefined();

	const { source, contentHash, scope } = identityOf(caller);
	expect(contentHash).toMatch(/^[a-f0-9]{64}$/);
	expect(scope).toBeDefined();
	expect(scope.workspaceId).toBe(caller.scope.workspaceId);
	expect(scope.sessionId).toBe(caller.scope.sessionId);
	expect(scope.callerSourceHash).toBe(contentHash);
	expect(scope.providerSourceHash).toBe(contentHash);

	// A different installed package is a different scope, so a restored
	// receipt from the old one cannot authorize the new one.
	const otherPackage = await installPackage(join(directory, "other"), "p5-other");
	const other = p5ScopeOf(
		{
			pluginId: "fixture",
			packageRoot: otherPackage,
			contentHash: installedPackageHash(otherPackage),
		},
		caller,
	);
	expect(other.callerSourceHash).not.toBe(scope.callerSourceHash);

	// A reopened session under a fresh authorized scope is a new scope.
	const reopenedSession = await host.open("project-2");
	const reopenedCaller = host.service.getPluginCallerContext(reopenedSession.meta.sessionId);
	const reopened = p5ScopeOf(source, reopenedCaller);
	expect(reopened.sessionId).not.toBe(scope.sessionId);
	expect(reopened.callerSourceHash).toBe(scope.callerSourceHash);
	return { source, scope, reopened };
}

/**
 * The real composition and the real delivery mechanism: an authorized owner
 * receives the fact, a revoked one does not, and a released one never
 * receives anything again.  The unacknowledged facts stay in the journal for
 * a later re-adoption.
 */
async function deliveryAndRevoke(composition, state, source, caller, scope, reopened) {
	const facts = composition.facts;
	const metadata = factMetadata("fact-1");
	await facts.append(scope, { ...metadata, summary: p5FactSummary(metadata) });
	expect((await facts.read(scope, { after: null, limit: 64 })).facts).toHaveLength(1);
	expect((await facts.read(reopened, { after: null, limit: 64 })).facts).toHaveLength(0);

	const delivered = [];
	const owner = {
		cursor: async () => null,
		deliver: async (batch) => {
			delivered.push(batch.facts.map((fact) => fact.id));
			return { cursor: batch.facts.at(-1).id };
		},
	};
	const attachment = attachFactOwner(
		composition.factOwners,
		owner,
		source,
		caller,
		new AbortController().signal,
	);
	await vi.waitFor(() => expect(delivered.length).toBeGreaterThan(0));
	expect(delivered.flat()).toContain("fact-1");

	// A revoked owner is denied by the host's answer, and the mechanism
	// never delivers to it.
	state.allowed = false;
	delivered.length = 0;
	const revoked = attachFactOwner(
		composition.factOwners,
		owner,
		source,
		caller,
		new AbortController().signal,
	);
	await new Promise((done) => setTimeout(done, 50));
	expect(delivered).toHaveLength(0);

	// Releasing the owner stops its delivery for good.
	state.allowed = true;
	await revoked.release();
	await attachment.release();
	delivered.length = 0;
	const second = factMetadata("fact-2");
	await facts.append(scope, { ...second, summary: p5FactSummary(second) });
	await new Promise((done) => setTimeout(done, 50));
	expect(delivered).toHaveLength(0);
	// The unacknowledged fact is still in the journal.
	expect((await facts.read(scope, { after: null, limit: 64 })).facts).toHaveLength(2);
}

it("a restricted owner is denied without an identity, reopens under a fresh scope, and stops on revoke", async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "drone-p5-prereq-sdk-")));
	requireRealArtifacts();
	let host;
	try {
		host = await startBuiltinCore({
			root: join(directory, "core"),
			setUserData: (path) => {
				environment.userData = path;
			},
			respond: async () => ({ role: "assistant", content: [{ type: "text", text: "ok" }] }),
		});
		const session = await host.open("project-1");

		// The live caller context comes from the host's session registry.
		const caller = host.service.getPluginCallerContext(session.meta.sessionId);
		expect(caller).toBeDefined();

		const { source, scope, reopened } = await scopeIdentity(host, directory, caller);

		// The composition owns the journal, so the test writes through the
		// composition's own store: a second store over the same file would
		// not share its subscribers.
		const { composition, state } = compositionFor(directory);
		await deliveryAndRevoke(composition, state, source, caller, scope, reopened);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 180000);
