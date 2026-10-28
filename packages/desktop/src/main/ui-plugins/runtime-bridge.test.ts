import { PluginRuntimeRegistry, type PluginSessionCallerContext } from "@drone/backend";
import type { PluginRuntimeFactory } from "@gyoungwe/plugin-api/runtime";
import { describe, expect, it, vi } from "vitest";
import { DesktopRuntimeBridge, type DesktopRuntimeSource } from "./runtime-bridge";

const source: DesktopRuntimeSource = {
	pluginId: "example",
	packageRoot: "/packages/example",
	entrypoint: "/packages/example/runtime.mjs",
};
const owner = { id: 1, isDestroyed: () => false };
const operation = {
	inputSchema: { type: "string" },
	resultSchema: { type: "string" },
	effect: "read" as const,
	execute: vi.fn(async (input: unknown) => input),
};
const selections = new WeakMap<DesktopRuntimeBridge, Map<object, string>>();
function selection(bridge: DesktopRuntimeBridge, owner: { id: number; isDestroyed(): boolean }): string {
	const token = selections.get(bridge)?.get(owner);
	return token ?? bridge.selectSession(owner, null);
}
function setup() {
	const dispose = vi.fn(async () => {});
	const factory = vi.fn<PluginRuntimeFactory>(async () => ({
		operations: { read: operation, write: { ...operation, effect: "write" } },
		dispose,
	}));
	const options = {
		source: vi.fn((): DesktopRuntimeSource | undefined => source),
		enabled: vi.fn(() => true),
		factory: () => factory,
		approve: vi.fn(async () => true),
		getSessionContext: vi.fn<(sessionId: string) => PluginSessionCallerContext | undefined>(() => undefined),
	};
	const bridge = new DesktopRuntimeBridge(options);
	const tokens = new Map<object, string>();
	selections.set(bridge, tokens);
	const select = bridge.selectSession.bind(bridge);
	vi.spyOn(bridge, "selectSession").mockImplementation((owner, id) => {
		const token = select(owner, id);
		tokens.set(owner, token);
		return token;
	});
	return { bridge, options, factory, dispose };
}

describe("DesktopRuntimeBridge", () => {
	it("presents only host capability details and preserves write rejection", async () => {
		const execute = vi.fn(async () => "saved");
		const approve = vi.fn<import("./runtime-bridge").DesktopRuntimeBridgeOptions["approve"]>(
			async (_owner, _source, operation) => operation !== "capability:save",
		);
		const bridge = new DesktopRuntimeBridge({
			source: () => source,
			enabled: () => true,
			getSessionContext: () => undefined,
			approve,
			capabilities: () => ({
				resources: [],
				handlers: {
					save: {
						inputSchema: { type: "object" },
						resultSchema: { type: "string" },
						effect: "write",
						approvalDetail: () => "Host-approved root / policy.json",
						execute,
					},
				},
			}),
			factory: () => async () => ({
				operations: {
					save: {
						inputSchema: { type: "object" },
						resultSchema: { type: "string" },
						effect: "write",
						execute: (input, context) => context.capabilities.call("save", input),
					},
				},
				dispose: async () => {},
			}),
		});
		const token = (await bridge.bind("ui", owner))!;
		const input = { approvalDetail: "Forged approval text" };
		await expect(bridge.invoke(owner, token, "save", input, selection(bridge, owner))).rejects.toThrow(
			"Plugin capability denied: save",
		);
		expect(approve).toHaveBeenNthCalledWith(2, owner, source, "save", undefined);
		expect(approve).toHaveBeenNthCalledWith(
			3,
			owner,
			source,
			"capability:save",
			"Host-approved root / policy.json",
		);
		expect(execute).not.toHaveBeenCalled();
		approve.mockResolvedValue(true);
		expect(await bridge.invoke(owner, token, "save", input, selection(bridge, owner))).toBe("saved");
		expect(execute).toHaveBeenCalledOnce();
		await bridge.close();
	});

	it("sends invalidations only to live bindings with their current selection lease", async () => {
		const { bridge, factory } = setup();
		const listener = vi.fn();
		bridge.onEvent(listener);
		const first = (await bridge.bind("ui", owner))!;
		const token = bridge.selectSession(owner, null);
		const emit = factory.mock.calls[0]![0].events.changed;
		emit();
		expect(listener).toHaveBeenCalledWith(owner, {
			binding: first,
			selectionToken: token,
			type: "changed",
			revision: 1,
		});
		await bridge.revoke(undefined, owner.id);
		expect(() => emit()).toThrow("deactivated");
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("does not revive a revoked sibling bind after awaiting the former owner's disposal", async () => {
		const { bridge, factory, dispose } = setup();
		let finish!: () => void;
		dispose.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		await bridge.bind("ui", owner);
		const stopping = bridge.revoke(undefined, owner.id);
		await vi.waitFor(() => expect(finish).toBeDefined());
		const sibling = { ...owner, id: 2 };
		const loading = bridge.bind("ui", sibling);
		const rejected = expect(loading).rejects.toThrow("superseded");
		// Allow this bind to reach the shared owner's outstanding disposal barrier.
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await bridge.revoke(undefined, sibling.id);
		const latest = bridge.bind("ui", sibling);
		finish();
		await stopping;
		await rejected;
		const token = (await latest)!;
		expect(factory).toHaveBeenCalledTimes(2);
		expect(await bridge.invoke(sibling, token, "read", "latest", selection(bridge, sibling))).toBe("latest");
		await bridge.close();
	});

	it("cancels an unfinished activation when its approving window leaves, then lets a sibling reapprove", async () => {
		const { bridge, options, factory } = setup();
		let approve!: (allowed: boolean) => void;
		options.approve.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					approve = resolve;
				}),
		);
		const activating = vi.spyOn(PluginRuntimeRegistry.prototype, "activate");
		const first = bridge.bind("ui", owner);
		const firstRejected = expect(first).rejects.toThrow();
		await vi.waitFor(() => expect(approve).toBeDefined());
		const sibling = { ...owner, id: 2 };
		const second = bridge.bind("ui", sibling);
		const secondRejected = expect(second).rejects.toThrow();
		await vi.waitFor(() => expect(activating).toHaveBeenCalledTimes(2));
		activating.mockRestore();
		await bridge.revoke(undefined, owner.id);
		await Promise.all([firstRejected, secondRejected]);
		expect(factory).not.toHaveBeenCalled();
		approve(true);
		const token = (await bridge.bind("ui", sibling))!;
		expect(await bridge.invoke(sibling, token, "read", "after new consent", selection(bridge, sibling))).toBe(
			"after new consent",
		);
		expect(factory).toHaveBeenCalledOnce();
		await bridge.close();
	});
	it("rejects stale selection leases even after A to B to A and a switch before dispatch microtask", async () => {
		const { bridge, options } = setup();
		const a = sessionContext("a"),
			b = sessionContext("b");
		options.getSessionContext.mockImplementation((id) => (id === "a" ? a : b));
		const token = (await bridge.bind("ui", owner))!;
		const first = bridge.selectSession(owner, "a");
		bridge.selectSession(owner, "b");
		const again = bridge.selectSession(owner, "a");
		expect(again).not.toBe(first);
		await expect(bridge.invoke(owner, token, "read", "old", first)).rejects.toThrow("selection lease");
		const before = operation.execute.mock.calls.length;
		const dispatch = bridge.invoke(owner, token, "read", "racing", again);
		bridge.selectSession(owner, "b");
		await expect(dispatch).rejects.toThrow("no longer available");
		expect(operation.execute.mock.calls.length).toBe(before);
		await bridge.close();
	});

	function sessionContext(sessionId: string, workspaceId = "/workspace"): PluginSessionCallerContext {
		return {
			identity: {},
			scope: { kind: "session", sessionId, workspaceId, workspaceDirectory: "/Work/Bridge" },
			signal: new AbortController().signal,
			projectTrusted: true,
			readOnly: false,
		};
	}
	it("shares an application owner but resolves explicit application and real session scopes per call", async () => {
		const { bridge, options, factory, dispose } = setup();
		const contexts = new Map([
			["a", sessionContext("a", "/first")],
			["b", sessionContext("b", "/second")],
		]);
		options.getSessionContext.mockImplementation((id) => contexts.get(id));
		const calls: unknown[] = [];
		factory.mockImplementation(async () => ({
			operations: {
				read: {
					...operation,
					execute: async (_input, ctx) => {
						calls.push(ctx.scope);
						return "ok";
					},
				},
			},
			dispose,
		}));
		const second = { ...owner, id: 2 };
		const a = (await bridge.bind("ui", owner))!;
		const b = (await bridge.bind("ui", second))!;
		await bridge.invoke(owner, a, "read", "", selection(bridge, owner));
		bridge.selectSession(owner, "a");
		bridge.selectSession(second, "b");
		await bridge.invoke(owner, a, "read", "", selection(bridge, owner));
		await bridge.invoke(second, b, "read", "", selection(bridge, second));
		expect(calls).toEqual([{ kind: "application" }, contexts.get("a")!.scope, contexts.get("b")!.scope]);
		expect(factory).toHaveBeenCalledOnce();
		expect(factory.mock.calls[0]![0]).not.toHaveProperty("scope");
		await bridge.revoke(undefined, owner.id);
		expect(dispose).not.toHaveBeenCalled();
		await bridge.invoke(second, b, "read", "", selection(bridge, second));
		await bridge.close();
		expect(dispose).toHaveBeenCalledOnce();
	});
	it("rejects closed or reused session identities until the renderer explicitly selects the new entry", async () => {
		const { bridge, options } = setup();
		let current: PluginSessionCallerContext | undefined = sessionContext("same-id");
		options.getSessionContext.mockImplementation(() => current);
		const token = (await bridge.bind("ui", owner))!;
		bridge.selectSession(owner, "same-id");
		current = sessionContext("same-id");
		await expect(bridge.invoke(owner, token, "read", "", selection(bridge, owner))).rejects.toThrow(
			"no longer available",
		);
		bridge.selectSession(owner, "same-id");
		expect(await bridge.invoke(owner, token, "read", "new entry", selection(bridge, owner))).toBe(
			"new entry",
		);
		current = undefined;
		expect(() => bridge.selectSession(owner, "missing")).toThrow("not open");
		await expect(bridge.invoke(owner, token, "read", "", selection(bridge, owner))).rejects.toThrow(
			"no longer available",
		);
		await bridge.close();
	});
	it("cancels a pending write approval on session switch without stopping the application owner", async () => {
		const { bridge, options, factory, dispose } = setup();
		const a = sessionContext("a"),
			b = sessionContext("b");
		options.getSessionContext.mockImplementation((id) => (id === "a" ? a : b));
		const token = (await bridge.bind("ui", owner))!;
		bridge.selectSession(owner, "a");
		let resolve!: (allowed: boolean) => void;
		options.approve.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const write = bridge.invoke(owner, token, "write", "late", selection(bridge, owner));
		const rejected = expect(write).rejects.toThrow("selection changed");
		await vi.waitFor(() => expect(resolve).toBeDefined());
		const before = operation.execute.mock.calls.length;
		bridge.selectSession(owner, "b");
		await rejected;
		resolve(true);
		await Promise.resolve();
		expect(operation.execute.mock.calls.length).toBe(before);
		expect(await bridge.invoke(owner, token, "read", "current", selection(bridge, owner))).toBe("current");
		expect(factory).toHaveBeenCalledOnce();
		expect(dispose).not.toHaveBeenCalled();
		await bridge.close();
	});
	it("rechecks trust and read-only status after approval and never dispatches denied writes", async () => {
		const { bridge, options } = setup();
		let current = sessionContext("a");
		options.getSessionContext.mockImplementation(() => current);
		const token = (await bridge.bind("ui", owner))!;
		bridge.selectSession(owner, "a");
		options.approve.mockImplementationOnce(async () => {
			current = { ...current, readOnly: true };
			return true;
		});
		await expect(bridge.invoke(owner, token, "write", "denied", selection(bridge, owner))).rejects.toThrow(
			"operation denied",
		);
		expect(await bridge.invoke(owner, token, "read", "allowed", selection(bridge, owner))).toBe("allowed");
		current = { ...current, projectTrusted: false };
		await expect(bridge.invoke(owner, token, "read", "denied", selection(bridge, owner))).rejects.toThrow(
			"operation denied",
		);
		await bridge.close();
	});

	it("binds to the issuing window and revokes old generations on reload", async () => {
		const { bridge, dispose } = setup();
		const token = (await bridge.bind("ui", owner))!;
		expect(await bridge.invoke(owner, token, "read", "data", selection(bridge, owner))).toBe("data");
		await expect(
			bridge.invoke({ ...owner, id: 2 }, token, "read", "data", selection(bridge, { ...owner, id: 2 })),
		).rejects.toThrow("invalid for this window");
		const replacement = (await bridge.bind("ui", owner))!;
		expect(replacement).not.toBe(token);
		expect(dispose).toHaveBeenCalledTimes(1);
		await expect(bridge.invoke(owner, token, "read", "data", selection(bridge, owner))).rejects.toThrow(
			"invalid",
		);
		await bridge.revoke();
	});

	it("denies activation before executing the factory and requires write approval", async () => {
		const { bridge, options, factory } = setup();
		options.approve.mockResolvedValueOnce(false);
		await expect(bridge.bind("ui", owner)).rejects.toThrow("activation denied");
		expect(factory).not.toHaveBeenCalled();
		const token = (await bridge.bind("ui", owner))!;
		options.approve.mockResolvedValueOnce(false);
		await expect(bridge.invoke(owner, token, "write", "data", selection(bridge, owner))).rejects.toThrow(
			"operation denied",
		);
		await bridge.revoke();
	});

	it("does not revive a pending approval after disable", async () => {
		const { bridge, options, factory } = setup();
		let approve!: (allowed: boolean) => void;
		const requested = new Promise<void>((resolve) => {
			options.approve.mockImplementation(
				() =>
					new Promise<boolean>((done) => {
						approve = done;
						resolve();
					}),
			);
		});
		const loading = bridge.bind("ui", owner);
		await requested;
		const stopped = bridge.revoke("ui");
		approve(true);
		await expect(loading).rejects.toThrow();
		await stopped;
		expect(factory).not.toHaveBeenCalled();
	});

	it("rejects source changes and never gives a local UI an installed binding", async () => {
		const { bridge, options, dispose } = setup();
		const token = (await bridge.bind("ui", owner))!;
		options.source.mockReturnValue(undefined);
		await expect(bridge.invoke(owner, token, "read", "data", selection(bridge, owner))).rejects.toThrow(
			"no longer enabled",
		);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(await bridge.bind("local", owner)).toBeUndefined();
	});

	it.each(["requestsStateWrite", "requestsFileWrite", "requestsModel"] as const)(
		"revokes old bindings when the manifest changes %s authority",
		async (permission) => {
			const { bridge, options, dispose, factory } = setup();
			const token = (await bridge.bind("ui", owner))!;
			options.source.mockReturnValue({ ...source, [permission]: true });
			await expect(bridge.invoke(owner, token, "read", "data", selection(bridge, owner))).rejects.toThrow(
				"no longer enabled",
			);
			expect(dispose).toHaveBeenCalledOnce();
			await bridge.bind("ui", owner);
			expect(factory).toHaveBeenCalledTimes(2);
			await bridge.close();
		},
	);

	it("keeps windows independent and cancels superseded parallel loads", async () => {
		const { bridge, factory } = setup();
		const first = bridge.bind("ui", owner);
		const second = bridge.bind("ui", owner);
		await expect(first).rejects.toThrow("superseded");
		const token = (await second)!;
		const other = { ...owner, id: 2 };
		const otherToken = (await bridge.bind("ui", other))!;
		expect(factory).toHaveBeenCalledTimes(1);
		await bridge.revoke(undefined, owner.id);
		await expect(bridge.invoke(owner, token, "read", "x", selection(bridge, owner))).rejects.toThrow(
			"invalid",
		);
		expect(await bridge.invoke(other, otherToken, "read", "x", selection(bridge, other))).toBe("x");
		await bridge.revoke();
	});
	it("holds parallel replacement binds behind the original teardown", async () => {
		const { bridge, factory, dispose } = setup();
		let finish!: () => void;
		dispose.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		await bridge.bind("ui", owner);
		const first = bridge.bind("ui", owner);
		const firstRejected = expect(first).rejects.toThrow("superseded");
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
		const second = bridge.bind("ui", owner);
		await Promise.resolve();
		await Promise.resolve();
		expect(factory).toHaveBeenCalledOnce();
		finish();
		await firstRejected;
		const token = (await second)!;
		expect(factory).toHaveBeenCalledTimes(2);
		expect(await bridge.invoke(owner, token, "read", "after teardown", selection(bridge, owner))).toBe(
			"after teardown",
		);
		await bridge.revoke();
	});

	it("does not replace a package or bind a client until pending disposal finishes", async () => {
		const { bridge, factory, dispose } = setup();
		let finish!: () => void;
		dispose.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const token = (await bridge.bind("ui", owner))!;
		const stopping = bridge.revoke("ui");
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
		const replace = vi.fn(async () => "updated");
		const mutation = bridge.withTransition(replace);
		await expect(bridge.bind("ui", owner)).rejects.toThrow("unavailable");
		await expect(bridge.invoke(owner, token, "read", "x", selection(bridge, owner))).rejects.toThrow(
			"invalid",
		);
		expect(replace).not.toHaveBeenCalled();
		expect(factory).toHaveBeenCalledOnce();
		finish();
		await stopping;
		await expect(mutation).resolves.toBe("updated");
		expect(replace).toHaveBeenCalledOnce();
	});

	it("retains failed teardown as a barrier for reactivation and package replacement", async () => {
		const { bridge, factory, dispose } = setup();
		dispose.mockRejectedValueOnce(new Error("worker still alive"));
		await bridge.bind("ui", owner);
		await expect(bridge.revoke("ui")).rejects.toThrow("disposal failed");
		await expect(bridge.bind("ui", owner)).rejects.toThrow("disposal failed");
		const replace = vi.fn(async () => undefined);
		await expect(bridge.withTransition(replace)).rejects.toThrow("disposal failed");
		expect(replace).not.toHaveBeenCalled();
		expect(factory).toHaveBeenCalledOnce();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("rejects another owner object even when its numeric window id matches", async () => {
		const { bridge } = setup();
		const token = (await bridge.bind("ui", owner))!;
		await expect(
			bridge.invoke({ ...owner }, token, "read", "x", selection(bridge, { ...owner })),
		).rejects.toThrow("invalid for this window");
		expect(await bridge.invoke(owner, token, "read", "x", selection(bridge, owner))).toBe("x");
		await bridge.revoke();
	});
	it("blocks binding during configuration persistence and permanently after close", async () => {
		const { bridge } = setup();
		let finish!: () => void;
		const action = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const changing = bridge.withTransition(action);
		await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
		await expect(bridge.bind("ui", owner)).rejects.toThrow("unavailable");
		finish();
		await changing;
		await bridge.bind("ui", owner);
		await bridge.close();
		await expect(bridge.bind("ui", owner)).rejects.toThrow("unavailable");
		await expect(bridge.withTransition(async () => {})).rejects.toThrow("closing");
	});

	it("close waits for an in-progress package mutation to finish", async () => {
		const { bridge } = setup();
		let finish!: () => void;
		const action = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const changing = bridge.withTransition(action);
		await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
		let closed = false;
		const closing = bridge.close().then(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);
		await expect(bridge.bind("ui", owner)).rejects.toThrow("unavailable");
		finish();
		await changing;
		await closing;
		expect(closed).toBe(true);
	});

	it("close reports teardown failure and still permanently rejects new clients", async () => {
		const { bridge, dispose } = setup();
		await bridge.bind("ui", owner);
		dispose.mockRejectedValueOnce(new Error("cannot confirm cleanup"));
		await expect(bridge.close()).rejects.toThrow("shutdown failed");
		await expect(bridge.bind("ui", owner)).rejects.toThrow("unavailable");
	});
});
