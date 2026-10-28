import type { PluginNativeSession } from "@gyoungwe/plugin-api/native";
import { describe, expect, it, vi } from "vitest";
import { PluginRuntimeBridge } from "./coordinator";

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
		let finish!: (value: PluginNativeSession) => void;
		const createNativeSession = vi.fn(
			() =>
				new Promise<PluginNativeSession>((resolve) => {
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
