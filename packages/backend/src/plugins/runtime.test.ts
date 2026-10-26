import type {
	PluginRuntimeFactory,
	PluginRuntimeInstance,
	PluginRuntimeOperation,
	PluginRuntimeScope,
} from "@gyoungwe/plugin-api/runtime";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { type PluginRuntimePolicy, PluginRuntimeRegistry } from "./runtime";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function policy(): PluginRuntimePolicy {
	return {
		authorizeActivation: vi.fn(async () => true),
		authorizeInvocation: vi.fn(async () => true),
	};
}

function runtime(
	execute: PluginRuntimeOperation["execute"] = vi.fn(async (input: unknown) => input),
): PluginRuntimeInstance {
	return {
		operations: {
			read: {
				inputSchema: Type.String(),
				resultSchema: Type.String(),
				effect: "read",
				execute,
			},
			write: {
				inputSchema: Type.String(),
				resultSchema: Type.String(),
				effect: "write",
				execute,
			},
		},
		dispose: vi.fn(async () => {}),
	};
}

function caller(scope: PluginRuntimeScope) {
	const value = { identity: {}, scope, signal: new AbortController().signal };
	return () => value;
}

const scope = { kind: "session" as const, workspaceId: "workspace-a", sessionId: "session-a" };

describe("PluginRuntimeRegistry", () => {
	it("authorizes activation before executing plugin code", async () => {
		const access = policy();
		vi.mocked(access.authorizeActivation).mockResolvedValue(false);
		const registry = new PluginRuntimeRegistry(access);
		const factory = vi.fn(async () => runtime());
		registry.register("example", factory);
		await expect(registry.activate("example", caller(scope))).rejects.toThrow("activation denied");
		expect(factory).not.toHaveBeenCalled();
		vi.mocked(access.authorizeActivation).mockResolvedValue(true);
		const client = await registry.activate("example", caller(scope));
		expect(await client.invoke("read", "allowed")).toBe("allowed");
	});

	it("does not enter a factory when deactivated during activation authorization", async () => {
		const approval = deferred<boolean>();
		const asked = deferred<void>();
		const access = policy();
		vi.mocked(access.authorizeActivation).mockImplementation(() => {
			asked.resolve();
			return approval.promise;
		});
		const registry = new PluginRuntimeRegistry(access);
		const factory = vi.fn(async () => runtime());
		registry.register("example", factory);
		const activation = registry.activate("example", caller(scope));
		const rejected = expect(activation).rejects.toThrow("deactivated");
		await asked.promise;
		const stopping = registry.deactivate("example");
		await stopping;
		approval.resolve(true);
		await rejected;
		expect(factory).not.toHaveBeenCalled();
		vi.mocked(access.authorizeActivation).mockResolvedValue(true);
		await registry.activate("example", caller(scope));
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("coalesces activation and binds the host's scope, not payload fields", async () => {
		const ready = deferred<PluginRuntimeInstance>();
		const factory = vi.fn(() => ready.promise);
		const access = policy();
		const registry = new PluginRuntimeRegistry(access);
		registry.register("example", factory);
		const first = registry.activate("example", caller(scope));
		const second = registry.activate("example", caller(scope));
		ready.resolve(runtime());
		const [client] = await Promise.all([first, second]);
		expect(factory).toHaveBeenCalledTimes(1);
		expect(await client.invoke("read", "pretend-session-b")).toBe("pretend-session-b");
		expect(access.authorizeInvocation).toHaveBeenCalledWith(
			expect.objectContaining({
				pluginId: "example",
				scope,
				operation: "read",
				effect: "read",
				input: "pretend-session-b",
			}),
			expect.any(AbortSignal),
		);
	});

	it("validates inputs and outputs while preserving denied mutations", async () => {
		const access = policy();
		vi.mocked(access.authorizeInvocation).mockImplementation(async (request) => request.effect === "read");
		const execute = vi.fn(async () => "value");
		const registry = new PluginRuntimeRegistry(access);
		registry.register("example", async () => runtime(execute));
		const client = await registry.activate("example", caller(scope));
		await expect(client.invoke("read", 5)).rejects.toThrow("Invalid plugin operation input");
		await expect(client.invoke("write", "change")).rejects.toThrow("operation denied");
		await expect(client.invoke("toString", "anything")).rejects.toThrow("not registered");
		expect(execute).not.toHaveBeenCalled();
		expect(await client.invoke("read", "query")).toBe("value");
	});

	it("rejects a plugin result that violates its declared schema", async () => {
		const registry = new PluginRuntimeRegistry(policy());
		registry.register("example", async () => runtime(vi.fn(async () => 7)));
		const client = await registry.activate("example", caller(scope));
		await expect(client.invoke("read", "query")).rejects.toThrow("Invalid plugin operation result");
	});

	it("shares one application owner across caller scopes while independent applications stay isolated", async () => {
		const factory = vi.fn<PluginRuntimeFactory>(async () =>
			runtime(
				vi.fn(async (_input, { scope: own }) =>
					own.kind === "session" ? `${own.workspaceId}/${own.sessionId}` : "application",
				),
			),
		);
		const first = new PluginRuntimeRegistry(policy());
		const second = new PluginRuntimeRegistry(policy());
		first.register("example", factory);
		second.register("example", factory);
		const a = await first.activate("example", caller(scope));
		const b = await first.activate("example", caller({ ...scope, sessionId: "session-b" }));
		const c = await first.activate("example", caller({ ...scope, workspaceId: "workspace-b" }));
		const otherHost = await second.activate("example", caller(scope));
		expect(await a.invoke("read", "")).toBe("workspace-a/session-a");
		expect(await b.invoke("read", "")).toBe("workspace-a/session-b");
		expect(await c.invoke("read", "")).toBe("workspace-b/session-a");
		expect(factory).toHaveBeenCalledTimes(2);
		await first.deactivate("example");
		await expect(b.invoke("read", "")).rejects.toThrow("not active");
		expect(await otherHost.invoke("read", "")).toBe("workspace-a/session-a");
	});

	it("revokes the old client when re-enabled", async () => {
		const registry = new PluginRuntimeRegistry(policy());
		const factory = vi.fn(async () => runtime());
		registry.register("example", factory);
		const old = await registry.activate("example", caller(scope));
		const bound = registry.bind("example", caller(scope));
		await registry.deactivate("example");
		const fresh = await registry.activate("example", caller(scope));
		await expect(old.invoke("read", "old")).rejects.toThrow("not active");
		await expect(bound.invoke("read", "bound")).rejects.toThrow("not active");
		expect(await fresh.invoke("read", "fresh")).toBe("fresh");
		expect(factory).toHaveBeenCalledTimes(2);
	});

	it("revokes a pending approval without waiting for the dialog or executing after deactivation", async () => {
		const approval = deferred<boolean>();
		const asked = deferred<void>();
		const access = policy();
		vi.mocked(access.authorizeInvocation).mockImplementation(() => {
			asked.resolve();
			return approval.promise;
		});
		const execute = vi.fn(async () => "written");
		const instance = runtime(execute);
		const registry = new PluginRuntimeRegistry(access);
		registry.register("example", async () => instance);
		const client = await registry.activate("example", caller(scope));
		const invocation = client.invoke("write", "change");
		const rejected = expect(invocation).rejects.toThrow("deactivated");
		await asked.promise;
		const stopping = registry.deactivate("example");
		await expect(client.invoke("read", "new")).rejects.toThrow("not active");
		await stopping;
		approval.resolve(true);
		await rejected;
		expect(execute).not.toHaveBeenCalled();
		expect(instance.dispose).toHaveBeenCalledTimes(1);
	});

	it("waits for in-flight cancellation cleanup before disposing", async () => {
		const started = deferred<void>();
		const cleanup = deferred<void>();
		const aborted = deferred<void>();
		const order: string[] = [];
		const operation: PluginRuntimeOperation = {
			inputSchema: Type.String(),
			resultSchema: Type.String(),
			effect: "write",
			execute: async (_input, { signal }) => {
				started.resolve();
				await new Promise<void>((resolve) =>
					signal.addEventListener("abort", () => resolve(), { once: true }),
				);
				aborted.resolve();
				await cleanup.promise;
				order.push("cleanup");
				return "result after abort";
			},
		};
		const registry = new PluginRuntimeRegistry(policy());
		registry.register("example", async () => ({
			operations: { write: operation },
			dispose: async () => {
				order.push("dispose");
			},
		}));
		const client = await registry.activate("example", caller(scope));
		const invocation = client.invoke("write", "change");
		const rejected = expect(invocation).rejects.toThrow("deactivated");
		await started.promise;
		const stopping = registry.deactivate("example");
		expect(registry.deactivate("example")).toBe(stopping);
		await aborted.promise;
		expect(order).toEqual([]);
		cleanup.resolve();
		await stopping;
		await rejected;
		expect(order).toEqual(["cleanup", "dispose"]);
	});

	it("waits for an activating factory before disposing its returned resources", async () => {
		const entered = deferred<void>();
		const created = deferred<PluginRuntimeInstance>();
		const instance = runtime();
		const registry = new PluginRuntimeRegistry(policy());
		registry.register("example", async () => {
			entered.resolve();
			return created.promise;
		});
		const activating = registry.activate("example", caller(scope));
		const rejected = expect(activating).rejects.toThrow("deactivated");
		await entered.promise;
		const stopping = registry.deactivate("example");
		expect(instance.dispose).not.toHaveBeenCalled();
		created.resolve(instance);
		await rejected;
		await stopping;
		expect(instance.dispose).toHaveBeenCalledTimes(1);
	});

	it("reports factory failure during shutdown instead of claiming successful disposal", async () => {
		const entered = deferred<void>();
		const created = deferred<PluginRuntimeInstance>();
		const registry = new PluginRuntimeRegistry(policy());
		registry.register("example", async () => {
			entered.resolve();
			return created.promise;
		});
		const activating = registry.activate("example", caller(scope));
		const failedActivation = expect(activating).rejects.toThrow("failed startup cleanup");
		await entered.promise;
		const stopping = registry.deactivate("example");
		const failedStop = expect(stopping).rejects.toThrow("failed startup cleanup");
		created.reject(new Error("failed startup cleanup"));
		await Promise.all([failedActivation, failedStop]);
	});

	it("allows retry after factory failure without hiding the error", async () => {
		const registry = new PluginRuntimeRegistry(policy());
		const factory = vi
			.fn<PluginRuntimeFactory>()
			.mockRejectedValueOnce(new Error("resource unavailable"))
			.mockResolvedValue(runtime());
		registry.register("example", factory);
		await expect(registry.activate("example", caller(scope))).rejects.toThrow("resource unavailable");
		const client = await registry.activate("example", caller(scope));
		expect(await client.invoke("read", "recovered")).toBe("recovered");
	});

	it("cancels one caller without stopping other calls in the same runtime", async () => {
		const registry = new PluginRuntimeRegistry(policy());
		registry.register("example", async () => runtime());
		const client = await registry.activate("example", caller(scope));
		const canceled = new AbortController();
		canceled.abort(new Error("user canceled"));
		await expect(client.invoke("read", "canceled", canceled.signal)).rejects.toThrow("user canceled");
		expect(await client.invoke("read", "still available")).toBe("still available");
	});
});
