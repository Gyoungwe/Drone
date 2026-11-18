import { mkdir, mkdtemp, readdir, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import type { Scope } from "@gyoungwe/plugin-api/p5-receipts";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { type PluginFileCall, PluginFileCapabilities, type PluginRootGrant } from "./file-capabilities";
import * as rootChecks from "./plugin-root-checks";
import { createPluginWriterAuthority, type P5AdoptedWriter } from "./plugin-writer-authority";

afterEach(() => vi.restoreAllMocks());

async function filePorts() {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "drone-writer-authority-")));
	const state = join(directory, "state");
	const cache = join(directory, "cache");
	const leases = join(directory, "leases");
	await mkdir(join(state, "ledger", "nested"), { recursive: true });
	await mkdir(cache);
	const registry = new StorageRegistry();
	const entry = registry.registerDiscoveredRoot("writer", state, "plugin:test", "private");
	const grant: PluginRootGrant = {
		handle: "selected-state",
		path: state,
		kind: "state",
		stateWrite: { registry, storageId: entry.id },
		scope: { kind: "workspace", workspaceId: "workspace-a" },
	};
	const ports = await PluginFileCapabilities.create([grant], cache, leases);
	onTestFinished(async () => {
		ports.releaseReservations();
		await rm(directory, { recursive: true, force: true });
	});
	return { directory, state, cache, leases, registry, entry, grant, ports };
}

async function fixture() {
	const files = await filePorts();
	const controller = new AbortController();
	const scope: Scope = {
		workspaceId: "workspace-a",
		sessionId: "session-a",
		callerSourceHash: "caller-a",
		providerSourceHash: "provider-a",
	};
	const writer: P5AdoptedWriter = {
		attachment: {},
		scope,
		rootHandle: "selected-state",
		relativeDirectory: "ledger",
		signal: controller.signal,
	};
	const selection: { current: P5AdoptedWriter | undefined } = { current: writer };
	const view = files.ports.writerAuthority();
	const authority = createPluginWriterAuthority(view, () => selection.current);
	const call: PluginFileCall = {
		scope: { kind: "session", workspaceDirectory: files.directory, ...scope },
		signal: controller.signal,
		bootstrap: false,
	};
	await files.ports.reserveState({ root: writer.rootHandle, path: writer.relativeDirectory }, call);
	return {
		...files,
		controller,
		writer,
		selection,
		view,
		authority,
	};
}

it("authorizes the selected adopted writer through a frozen query-only view", async () => {
	const { view, authority, writer } = await fixture();
	expect(Object.keys(view)).toEqual(["isReserved"]);
	expect(Object.isFrozen(view)).toBe(true);
	expect(await authority.authorizeDelivery(writer)).toBe(true);
});

it("denies an aborted writer", async () => {
	const { controller, authority, writer } = await fixture();
	controller.abort();
	expect(await authority.authorizeDelivery(writer)).toBe(false);
});

it("denies a revoked selected grant", async () => {
	const { selection, authority, writer } = await fixture();
	selection.current = undefined;
	expect(await authority.authorizeDelivery(writer)).toBe(false);
});

it("denies root inode replacement", async () => {
	const { directory, state, authority, writer } = await fixture();
	await rename(state, join(directory, "previous-state"));
	await mkdir(join(state, "ledger"), { recursive: true });
	expect(await authority.authorizeDelivery(writer)).toBe(false);
});

it("denies a released reservation", async () => {
	const { ports, authority, writer } = await fixture();
	ports.releaseReservations();
	expect(await authority.authorizeDelivery(writer)).toBe(false);
});

it("denies root replacement during the filesystem query", async () => {
	const { directory, state, authority, writer } = await fixture();
	const resolvePath = rootChecks.resolveRootPath;
	vi.spyOn(rootChecks, "resolveRootPath").mockImplementation(async (...args) => {
		const path = await resolvePath(...args);
		await rename(state, join(directory, "previous-state"));
		await mkdir(join(state, "ledger"), { recursive: true });
		return path;
	});
	expect(await authority.authorizeDelivery(writer)).toBe(false);
});

it("denies a different adopted owner object even with identical fields", async () => {
	const { authority, writer } = await fixture();
	expect(await authority.authorizeDelivery({ ...writer, attachment: {} })).toBe(false);
});

it("denies a reservation held by another file-capabilities owner", async () => {
	const { grant, cache, leases, writer } = await fixture();
	const other = await PluginFileCapabilities.create([grant], cache, leases);
	onTestFinished(() => other.releaseReservations());
	const authority = createPluginWriterAuthority(other.writerAuthority(), () => writer);
	expect(await authority.authorizeDelivery(writer)).toBe(false);
});

it("does not treat an overlapping parent reservation as a child reservation", async () => {
	const { selection, authority, writer } = await fixture();
	selection.current = { ...writer, relativeDirectory: "ledger/nested" };
	expect(await authority.authorizeDelivery(selection.current)).toBe(false);
});

it.each(["workspaceId", "sessionId", "callerSourceHash", "providerSourceHash"] as const)(
	"denies a mismatched %s",
	async (field) => {
		const { authority, writer } = await fixture();
		expect(
			await authority.authorizeDelivery({ ...writer, scope: { ...writer.scope, [field]: "other" } }),
		).toBe(false);
	},
);

it("denies an adoption whose scope does not match the granted root", async () => {
	const { selection, authority, writer } = await fixture();
	selection.current = { ...writer, scope: { ...writer.scope, workspaceId: "other" } };
	expect(await authority.authorizeDelivery(selection.current)).toBe(false);
});

it("denies a StorageRegistry root mismatch", async () => {
	const { registry, entry, cache, authority, writer } = await fixture();
	vi.spyOn(registry, "assertRegistered").mockReturnValue({ ...entry, path: cache });
	expect(await authority.authorizeDelivery(writer)).toBe(false);
});

it("never creates a reservation on a true or false query", async () => {
	const { leases, selection, authority, writer } = await fixture();
	const reserve = vi.spyOn(PluginResourceReservations.prototype, "reserve");
	const before = await readdir(join(leases, "state-writers"));
	expect(await authority.authorizeDelivery(writer)).toBe(true);
	selection.current = { ...writer, relativeDirectory: "ledger/nested" };
	expect(await authority.authorizeDelivery(selection.current)).toBe(false);
	expect(await readdir(join(leases, "state-writers"))).toEqual(before);
	expect(reserve).not.toHaveBeenCalled();
});

it("denies revocation during the filesystem query", async () => {
	const { registry, entry, selection, authority, writer } = await fixture();
	vi.spyOn(registry, "assertRegistered").mockImplementation(() => {
		selection.current = undefined;
		return entry;
	});
	expect(await authority.authorizeDelivery(writer)).toBe(false);
});

it("returns false without exposing a thrown selected-grant diagnostic", async () => {
	const { view, state, writer } = await fixture();
	const authority = createPluginWriterAuthority(view, () => {
		throw new Error(state);
	});
	expect(await authority.authorizeDelivery(writer)).toBe(false);
});
