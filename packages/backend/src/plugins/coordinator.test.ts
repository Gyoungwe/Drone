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
