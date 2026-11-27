import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostFactDelivery, HostFactDeliveryHandle } from "@gyoungwe/plugin-api/p5-inquiry";
import type {
	PluginBinaryStateReadResult,
	PluginRuntimeContext,
	PluginStateReadResult,
} from "@gyoungwe/plugin-api/runtime";
import { expect, it, onTestFinished, vi } from "vitest";
import { StorageRegistry } from "../storage/registry";
import { fileCapabilityHandlers, PluginFileCapabilities } from "./file-capabilities";
import type { HostNativeFactOwner } from "./p5-owner-facade";
import { type PluginRuntimeCaller, PluginRuntimeRegistry } from "./runtime";
import type { PluginRuntimeInvocation } from "./runtime-invocation";

const scope = {
	kind: "session",
	workspaceId: "work",
	workspaceDirectory: "/example",
	sessionId: "session",
} as const;
const binding = { root: "json", path: "binding.json" };
const ledger = { root: "binary", path: "ledger.sqlite" };
const jsonWrite = { ...binding, expectedVersion: null, value: { ledger: ledger.path } };
const reserve = { root: ledger.root, path: "" };
const delivery: HostFactDelivery = {
	cursor: "fact:1",
	facts: [
		{
			id: "fact:1",
			sequence: 1,
			kind: "compute",
			entityId: "run:1",
			at: "2026-11-20T00:00:00Z",
			status: "succeeded",
			artifactRefs: [],
			runReceiptRef: null,
			decisionKind: null,
			summary: "Compute succeeded",
			basis: [],
		},
	],
	handle: Object.freeze({}) as HostFactDeliveryHandle,
};

function port(context?: PluginRuntimeContext) {
	assert(context);
	return context.capabilities;
}

async function readCursor(context?: PluginRuntimeContext) {
	const capabilities = port(context);
	await capabilities.call("roots.describe", null);
	const config = (await capabilities.call("state.readJson", binding)) as PluginStateReadResult;
	if (config.kind === "missing") return null;
	expect(config.value).toEqual(jsonWrite.value);
	const saved = (await capabilities.call("state.readBinary", ledger)) as PluginBinaryStateReadResult;
	assert(saved.kind === "value");
	const committed = JSON.parse(Buffer.from(saved.base64, "base64").toString("utf8")) as Pick<
		HostFactDelivery,
		"cursor" | "facts"
	>;
	expect(committed.facts).toEqual(delivery.facts);
	return committed.cursor;
}

async function commit({ cursor, facts }: HostFactDelivery, context?: PluginRuntimeContext) {
	assert(cursor);
	const capabilities = port(context);
	await capabilities.call("roots.describe", null);
	await capabilities.call("state.reserve", reserve);
	await capabilities.call("state.writeJson", jsonWrite);
	await capabilities.call("state.writeBinary", {
		...ledger,
		base64: Buffer.from(JSON.stringify({ cursor, facts })).toString("base64"),
		expectedVersion: null,
		assertAbsent: [],
	});
	return { cursor };
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "drone-fact-owner-"));
	onTestFinished(() => rm(root, { recursive: true, force: true }));
	const state = join(root, "state");
	const cache = join(root, "cache");
	await mkdir(state);
	await mkdir(cache);
	const registry = new StorageRegistry().register({
		id: "fixture",
		path: state,
		owner: "example",
		schema: 1,
		sensitivity: "private",
	});
	const grant = { registry, storageId: "fixture" };
	const shared = { path: state, scope: { kind: "application" } } as const;
	const ports = await PluginFileCapabilities.create(
		[
			{ ...shared, handle: "json", kind: "state", stateWrite: grant },
			{ ...shared, handle: "binary", kind: "binary-state", binaryStateWrite: grant },
		],
		cache,
		join(root, "leases"),
	);
	return { state, ports, handlers: { ...fileCapabilityHandlers(ports) } };
}

async function attach(
	{ ports, handlers }: Awaited<ReturnType<typeof fixture>>,
	factOwner: HostNativeFactOwner,
) {
	const abort = new AbortController();
	let caller: PluginRuntimeCaller = { scope, identity: {}, sessionIdentity: {}, signal: abort.signal };
	const resolveCaller = () => caller;
	const approve = vi.fn(async () => false);
	const authorizeInvocation = vi.fn(
		async (request: PluginRuntimeInvocation) =>
			request.effect === "read" || request.approval === "own" || (await approve()),
	);
	const registry = new PluginRuntimeRegistry(
		{ authorizeActivation: async () => true, authorizeInvocation },
		"app",
		{
			handlers,
			resources: [],
			dispose: () => ports.drain(),
			finalRelease: async () => ports.releaseReservations(),
		},
	);
	onTestFinished(() => registry.deactivate("example"));
	registry.register("example", async () => ({
		operations: {},
		createNativeSession: () => ({ factOwner, extension: () => undefined, dispose: async () => undefined }),
		dispose: async () => undefined,
	}));
	await registry.activate("example", resolveCaller);
	const { hostFactOwner } = await registry.attachNative("example", resolveCaller, resolveCaller);
	assert(hostFactOwner);
	return {
		owner: hostFactOwner,
		authorizeInvocation,
		approve,
		replace: (key: "identity" | "sessionIdentity") => {
			caller = { ...caller, [key]: {} };
		},
		abort: () => abort.abort(new Error("Fact caller revoked")),
	};
}

it("reads an unbound cursor, commits own writes without approval, and reads the bound cursor back", async () => {
	const files = await fixture();
	const { owner, authorizeInvocation, approve } = await attach(files, {
		cursor: readCursor,
		deliver: commit,
	});
	await expect(owner.cursor()).resolves.toBeNull();
	const [cursorWrapper] = authorizeInvocation.mock.calls.map(([request]) => request);
	expect(cursorWrapper).toMatchObject({ operation: "capability:roots.describe", effect: "read" });
	expect(cursorWrapper).not.toHaveProperty("approval");
	authorizeInvocation.mockClear();
	await expect(owner.deliver(delivery)).resolves.toEqual({ cursor: "fact:1" });
	const requests = authorizeInvocation.mock.calls.map(([request]) => [
		request.operation,
		request.effect,
		request.approval,
	]);
	expect(requests).toEqual([
		["capability:roots.describe", "write", "own"],
		["capability:roots.describe", "read", undefined],
		["capability:state.reserve", "write", "own"],
		["capability:state.reserve", "write", "own"],
		["capability:state.writeJson", "write", "own"],
		["capability:state.writeJson", "write", "own"],
		["capability:state.writeBinary", "write", "own"],
		["capability:state.writeBinary", "write", "own"],
	]);
	expect(approve).not.toHaveBeenCalled();
	await expect(owner.cursor()).resolves.toBe("fact:1");
	expect((await readdir(files.state)).sort()).toEqual([binding.path, ledger.path]);
});

it.each([undefined, "always", "allowance"] as const)(
	"rejects a write registered with %s approval",
	async (approval) => {
		const files = await fixture();
		const actual = files.handlers["state.writeJson"];
		assert(actual);
		files.handlers["state.writeJson"] = { ...actual, approval };
		const { owner } = await attach(files, { cursor: readCursor, deliver: commit });
		await expect(owner.deliver(delivery)).rejects.toThrow(
			"Plugin capability is unavailable during fact delivery: state.writeJson",
		);
		expect(await readdir(files.state)).toEqual([]);
	},
);

it("rejects a cursor capability registered with a write effect", async () => {
	const files = await fixture();
	const actual = files.handlers["roots.describe"];
	assert(actual);
	files.handlers["roots.describe"] = { ...actual, effect: "write", approval: "own" };
	const { owner, authorizeInvocation } = await attach(files, { cursor: readCursor, deliver: commit });
	await expect(owner.cursor()).rejects.toThrow(
		"Plugin capability is unavailable during fact delivery: roots.describe",
	);
	expect(authorizeInvocation).not.toHaveBeenCalled();
});

it.each(["identity", "sessionIdentity", "abort"] as const)(
	"stops fact capabilities after caller %s changes",
	async (change) => {
		for (const phase of ["cursor", "deliver"] as const) {
			const files = await fixture();
			let invalidate: () => void = vi.fn();
			const useRevokedCapability = async (context?: PluginRuntimeContext) => {
				invalidate();
				await (phase === "cursor"
					? port(context).call("roots.describe", null)
					: port(context).call("state.writeJson", jsonWrite));
			};
			const runtime = await attach(files, {
				cursor: async (context?: PluginRuntimeContext) => {
					await useRevokedCapability(context);
					return null;
				},
				deliver: async (_delivery, context?: PluginRuntimeContext) => {
					await useRevokedCapability(context);
					return { cursor: "fact:1" };
				},
			});
			invalidate = change === "abort" ? runtime.abort : () => runtime.replace(change);
			const pending = phase === "cursor" ? runtime.owner.cursor() : runtime.owner.deliver(delivery);
			await expect(pending).rejects.toThrow(
				change === "abort" ? "Fact caller revoked" : "Plugin caller is no longer available",
			);
			expect(runtime.authorizeInvocation).not.toHaveBeenCalled();
			expect(await readdir(files.state)).toEqual([]);
		}
	},
);
