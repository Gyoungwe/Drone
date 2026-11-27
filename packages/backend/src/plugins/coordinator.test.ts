import { setImmediate } from "node:timers/promises";
import type { Fact, HostFactDelivery } from "@gyoungwe/plugin-api/p5-inquiry";
import type { PluginRuntimeContext } from "@gyoungwe/plugin-api/runtime";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { PluginRuntimeBridge, type PluginRuntimeBridgeOptions } from "./coordinator";
import type { HostNativeSession } from "./p5-owner-facade";
import type { PluginCapabilityHandler } from "./runtime-capabilities";
import type { PluginSessionCallerContext } from "./session-caller";

const source = { pluginId: "example", packageRoot: "/example", entrypoint: "/example/runtime.mjs" };
const owner = { id: 1, isDestroyed: () => false };
const operations = {
	read: {
		inputSchema: { type: "null" },
		resultSchema: { type: "null" },
		effect: "read" as const,
		execute: async () => null,
	},
};

function deferred<Value>() {
	let resolve: (value: Value) => void = vi.fn();
	let reject: (reason: unknown) => void = vi.fn();
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, resolve, reject };
}

it.each([
	["no owner", false, true, false],
	["no port", true, false, false],
	["bound before adoption", true, true, true],
	["bound after adoption", true, true, false],
])("binds once and drains before disposal (%s)", async (_name, hasOwner, hasPort, boundFirst) => {
	const scope = { workspaceId: "workspace-1", sessionId: "session-1" };
	const session: PluginSessionCallerContext = {
		identity: {},
		scope: { ...scope, kind: "session", workspaceDirectory: "/example" },
		signal: new AbortController().signal,
		readOnly: false,
		projectTrusted: true,
	};
	const unsubscribe = vi.fn();
	const subscribe = vi.fn(() => unsubscribe);
	const scopeOf = () => ({ ...scope, callerSourceHash: "a".repeat(64), providerSourceHash: "b".repeat(64) });
	const facts = { subscribe, read: async () => ({ facts: [], cursor: null }) };
	const factOwners = { scopeOf, facts, authorize: async () => true };
	let finishCursor: () => void = vi.fn();
	const cursor = new Promise<null>((resolve) => {
		finishCursor = () => resolve(null);
	});
	const dispose = vi.fn(async () => undefined);
	const factOwner = { cursor: () => cursor, deliver: async () => ({ cursor: "fact-1" }) };
	const extension = () => undefined;
	const native = { extension, dispose, factOwner: hasOwner ? factOwner : undefined };
	const instance = { operations, createNativeSession: () => native, dispose: async () => undefined };
	const bridge = new PluginRuntimeBridge({
		source: () => source,
		enabled: () => true,
		factory: () => async () => instance,
		approve: async () => true,
		getSessionContext: () => session,
		factOwners: hasPort ? factOwners : undefined,
	});
	const bootstrap = bridge.beginNative(owner, () => "example");
	const bind = () => bootstrap.bindSession(session.scope.sessionId);
	if (boundFirst) bind();
	await bootstrap.factoryForPath("/example/extension.mjs");
	expect(subscribe).toHaveBeenCalledTimes(boundFirst ? 1 : 0);
	if (!boundFirst) bind();
	bind();
	const count = hasPort && hasOwner ? 1 : 0;
	expect(subscribe).toHaveBeenCalledTimes(count);
	await setImmediate();
	const closing = bootstrap.dispose();
	await setImmediate();
	expect(unsubscribe).toHaveBeenCalledTimes(count);
	expect(dispose).toHaveBeenCalledTimes(count === 1 ? 0 : 1);
	finishCursor();
	await closing;
	expect(dispose).toHaveBeenCalledOnce();
});

it("closes a native fact owner whose initial cursor reads the granted roots", async () => {
	const scope = { workspaceId: "workspace-1", sessionId: "session-1" };
	const session: PluginSessionCallerContext = {
		identity: {},
		scope: { ...scope, kind: "session", workspaceDirectory: "/example" },
		signal: new AbortController().signal,
		readOnly: false,
		projectTrusted: true,
	};
	const cursorFinished = deferred<void>();
	const describeRoots = vi.fn(async () => []);
	const dispose = vi.fn(async () => undefined);
	const native = {
		extension: () => undefined,
		dispose,
		factOwner: {
			async cursor(context?: PluginRuntimeContext) {
				try {
					if (!context) throw new Error("Expected fact owner context");
					await context.capabilities.call("roots.describe", null);
					return null;
				} finally {
					cursorFinished.resolve();
				}
			},
			deliver: async () => ({ cursor: "fact-1" }),
		},
	};
	const bridge = new PluginRuntimeBridge({
		source: () => source,
		enabled: () => true,
		factory: () => async () => ({ operations, createNativeSession: () => native, dispose }),
		approve: async () => true,
		getSessionContext: () => session,
		factOwners: {
			scopeOf: () => ({ ...scope, callerSourceHash: "a".repeat(64), providerSourceHash: "b".repeat(64) }),
			facts: { subscribe: () => vi.fn(), read: async () => ({ facts: [], cursor: null }) },
			authorize: async () => true,
		},
		capabilities: () => ({
			resources: [],
			handlers: {
				"roots.describe": {
					inputSchema: { type: "null" },
					resultSchema: {},
					effect: "read",
					execute: describeRoots,
				},
			},
		}),
	});
	const bootstrap = bridge.beginNative(owner, () => "example");
	await bootstrap.factoryForPath("/example/extension.mjs");
	bootstrap.bindSession(session.scope.sessionId);
	await cursorFinished.promise;
	await expect(bridge.close()).resolves.toBeUndefined();
	expect(describeRoots).toHaveBeenCalledOnce();
	expect(dispose).toHaveBeenCalledTimes(2);
});

const fact: Fact = {
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
};

it("delivers own state writes through the coordinator without a task grant or approval dialog", async () => {
	const names = ["state.reserve", "state.writeJson", "state.writeBinary"];
	const execute = vi.fn(async () => null);
	const handler: PluginCapabilityHandler = {
		inputSchema: {},
		resultSchema: {},
		effect: "write",
		approval: "own",
		execute,
	};
	const scope = { workspaceId: "workspace-1", sessionId: "session-1" };
	const session: PluginSessionCallerContext = {
		identity: {},
		scope: { ...scope, kind: "session", workspaceDirectory: "/example" },
		signal: new AbortController().signal,
		readOnly: false,
		projectTrusted: true,
	};
	const approval = vi.fn<PluginRuntimeBridgeOptions["approve"]>(
		async (_owner, _source, operation) => !operation,
	);
	const delivered = deferred<string>();
	const deliver = (delivery: HostFactDelivery, context?: PluginRuntimeContext) => {
		const pending = (async () => {
			if (!context || !delivery.cursor) throw new Error("Expected a delivery and an active caller");
			for (const name of names) await context.capabilities.call(name, null);
			return delivery.cursor;
		})();
		void pending.then(delivered.resolve, delivered.reject);
		return pending.then((cursor) => ({ cursor }));
	};
	const bridge = new PluginRuntimeBridge({
		source: () => source,
		enabled: () => true,
		approve: approval,
		getSessionContext: () => session,
		capabilities: () => ({
			resources: [],
			handlers: Object.fromEntries(names.map((name) => [name, handler])),
		}),
		factOwners: {
			scopeOf: () => ({ ...scope, callerSourceHash: "a".repeat(64), providerSourceHash: "b".repeat(64) }),
			facts: { subscribe: () => vi.fn(), read: async () => ({ facts: [fact], cursor: fact.id }) },
			authorize: async () => true,
		},
		factory: () => async () => ({
			operations,
			createNativeSession: () => ({
				extension: () => undefined,
				factOwner: { cursor: async () => null, deliver },
				dispose: async () => undefined,
			}),
			dispose: async () => undefined,
		}),
	});
	onTestFinished(() => bridge.close());
	const bootstrap = bridge.beginNative(owner, () => "example");
	await bootstrap.factoryForPath("/example/extension.mjs");
	bootstrap.bindSession(session.scope.sessionId);
	await expect(delivered.promise).resolves.toBe(fact.id);
	await setImmediate();
	expect(execute).toHaveBeenCalledTimes(3);
	expect(approval.mock.calls.map(([, , operation]) => operation)).toEqual([undefined]);
});

describe("native bootstrap ownership", () => {
	it("cancels outstanding approval without waiting for a dialog response", async () => {
		let approve!: (value: boolean) => void;
		const factory = vi.fn(async () => ({ operations, dispose: async () => {} }));
		const bridge = new PluginRuntimeBridge({
			source: () => source,
			enabled: () => true,
			factory: () => factory,
			approve: () =>
				new Promise((resolve) => {
					approve = resolve;
				}),
			getSessionContext: () => undefined,
		});
		const bootstrap = bridge.beginNative(owner, () => "example");
		const pending = bootstrap.factoryForPath("/example/extension.mjs");
		const failed = expect(pending).rejects.toThrow();
		await vi.waitFor(() => expect(approve).toBeDefined());
		await bootstrap.dispose();
		approve(true);
		await failed;
		expect(factory).not.toHaveBeenCalled();
		await bridge.close();
	});
	it("waits for pending native creation and disposes its session before the owner", async () => {
		const order: string[] = [];
		let finish!: (value: HostNativeSession) => void;
		const createNativeSession = vi.fn(
			() =>
				new Promise<HostNativeSession>((resolve) => {
					finish = resolve;
				}),
		);
		const bridge = new PluginRuntimeBridge({
			source: () => source,
			enabled: () => true,
			factory: () => async () => ({
				operations,
				createNativeSession,
				dispose: async () => {
					order.push("owner");
				},
			}),
			approve: async () => true,
			getSessionContext: () => undefined,
		});
		const bootstrap = bridge.beginNative(owner, () => "example");
		const pending = bootstrap.factoryForPath("/example/extension.mjs");
		const failed = expect(pending).rejects.toThrow();
		await vi.waitFor(() => expect(finish).toBeDefined());
		let closed = false;
		const stopping = bootstrap.dispose().then(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);
		finish({
			extension: () => {},
			dispose: async () => {
				order.push("session");
			},
		});
		await stopping;
		await failed;
		expect(order).toEqual(["session", "owner"]);
		await bridge.close();
	});
});

it("cancels only a same-window, binding and selection invocation and waits for its cleanup", async () => {
	let release!: () => void;
	const cleanup = new Promise<void>((resolve) => {
		release = resolve;
	});
	let started = false;
	const execute = async (
		_input: unknown,
		context: import("@gyoungwe/plugin-api/runtime").PluginRuntimeContext,
	) => {
		started = true;
		await new Promise<void>((_resolve, reject) => {
			context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
		}).finally(() => cleanup);
		return null;
	};
	const bridge = new PluginRuntimeBridge({
		source: () => source,
		enabled: () => true,
		approve: async () => true,
		getSessionContext: () => undefined,
		factory: () => async () => ({
			operations: { long: { ...operations.read, execute }, read: operations.read },
			dispose: async () => {},
		}),
	});
	const token = (await bridge.bind("ui", owner))!;
	const selected = bridge.selectSession(owner, null);
	const pending = bridge.invoke(owner, token, "long", null, selected, "long-request");
	const rejected = expect(pending).rejects.toThrow("canceled");
	await vi.waitFor(() => expect(started).toBe(true));
	await expect(
		bridge.cancel({ id: 2, isDestroyed: () => false }, token, selected, "long-request"),
	).rejects.toThrow("window");
	await expect(bridge.cancel(owner, token, "other-selection", "long-request")).rejects.toThrow("lease");
	await expect(bridge.invoke(owner, token, "read", null, selected, "long-request")).rejects.toThrow(
		"already active",
	);
	let canceled = false;
	const stopping = bridge.cancel(owner, token, selected, "long-request").then((value) => {
		canceled = value;
	});
	await Promise.resolve();
	expect(canceled).toBe(false);
	expect(await bridge.invoke(owner, token, "read", null, selected, "sibling-request")).toBeNull();
	release();
	await stopping;
	await rejected;
	expect(canceled).toBe(true);
	expect(await bridge.cancel(owner, token, selected, "long-request")).toBe(false);
	await bridge.close();
});

it("cancels an outstanding approval and ignores its late allow without running the operation", async () => {
	let answer!: (value: boolean) => void;
	let approvalSignal!: AbortSignal;
	const execute = vi.fn(async () => null);
	const bridge = new PluginRuntimeBridge({
		source: () => source,
		enabled: () => true,
		getSessionContext: () => undefined,
		approve: async (_owner, _source, operation, _detail, signal) => {
			if (!operation) return true;
			approvalSignal = signal!;
			return new Promise<boolean>((resolve) => {
				answer = resolve;
			});
		},
		factory: () => async () => ({
			operations: { write: { ...operations.read, effect: "write", execute } },
			dispose: async () => {},
		}),
	});
	const token = (await bridge.bind("ui", owner))!;
	const selected = bridge.selectSession(owner, null);
	const pending = bridge.invoke(owner, token, "write", null, selected, "pending-approval");
	const rejected = expect(pending).rejects.toThrow("canceled");
	await vi.waitFor(() => expect(answer).toBeDefined());
	expect(await bridge.cancel(owner, token, selected, "pending-approval")).toBe(true);
	expect(approvalSignal.aborted).toBe(true);
	answer(true);
	await rejected;
	expect(execute).not.toHaveBeenCalled();
	await bridge.close();
});
