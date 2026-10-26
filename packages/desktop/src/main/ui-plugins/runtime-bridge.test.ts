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
	};
	return { bridge: new DesktopRuntimeBridge(options), options, factory, dispose };
}

describe("DesktopRuntimeBridge", () => {
	it("binds to the issuing window and revokes old generations on reload", async () => {
		const { bridge, dispose } = setup();
		const token = (await bridge.bind("ui", owner))!;
		expect(await bridge.invoke(owner, token, "read", "data")).toBe("data");
		await expect(bridge.invoke({ ...owner, id: 2 }, token, "read", "data")).rejects.toThrow(
			"invalid for this window",
		);
		const replacement = (await bridge.bind("ui", owner))!;
		expect(replacement).not.toBe(token);
		expect(dispose).toHaveBeenCalledTimes(1);
		await expect(bridge.invoke(owner, token, "read", "data")).rejects.toThrow("invalid");
		await bridge.revoke();
	});

	it("denies activation before executing the factory and requires write approval", async () => {
		const { bridge, options, factory } = setup();
		options.approve.mockResolvedValueOnce(false);
		await expect(bridge.bind("ui", owner)).rejects.toThrow("activation denied");
		expect(factory).not.toHaveBeenCalled();
		const token = (await bridge.bind("ui", owner))!;
		options.approve.mockResolvedValueOnce(false);
		await expect(bridge.invoke(owner, token, "write", "data")).rejects.toThrow("operation denied");
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
		await expect(bridge.invoke(owner, token, "read", "data")).rejects.toThrow("no longer enabled");
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(await bridge.bind("local", owner)).toBeUndefined();
	});

	it("keeps windows independent and cancels superseded parallel loads", async () => {
		const { bridge, factory } = setup();
		const first = bridge.bind("ui", owner);
		const second = bridge.bind("ui", owner);
		await expect(first).rejects.toThrow("superseded");
		const token = (await second)!;
		const other = { ...owner, id: 2 };
		const otherToken = (await bridge.bind("ui", other))!;
		expect(factory).toHaveBeenCalledTimes(2);
		await bridge.revoke(undefined, owner.id);
		await expect(bridge.invoke(owner, token, "read", "x")).rejects.toThrow("invalid");
		expect(await bridge.invoke(other, otherToken, "read", "x")).toBe("x");
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
		expect(await bridge.invoke(owner, token, "read", "after teardown")).toBe("after teardown");
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
		await expect(bridge.invoke(owner, token, "read", "x")).rejects.toThrow("invalid");
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
		await expect(bridge.invoke({ ...owner }, token, "read", "x")).rejects.toThrow("invalid for this window");
		expect(await bridge.invoke(owner, token, "read", "x")).toBe("x");
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
