// @vitest-environment node
import { IpcChannels } from "@drone/shared";
import { expect, it, vi } from "vitest";
import type { DesktopRuntimeBridge } from "../ui-plugins/runtime-bridge";

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<unknown>>());
vi.mock("electron", () => ({
	ipcMain: {
		handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler),
	},
}));

import { registerPluginRuntimeIpc } from "./plugin-runtime";

it("preserves legacy invokes, validates optional request IDs and binds cancellation to the actual IPC sender", async () => {
	const runtime = {
		invoke: vi.fn(async () => "receipt"),
		cancel: vi.fn(async () => true),
		selectSession: vi.fn(() => "selection"),
	};
	registerPluginRuntimeIpc(runtime as unknown as DesktopRuntimeBridge);
	const sender = { id: 37 },
		event = { sender };
	const invoke = handlers.get(IpcChannels.PluginRuntimeInvoke)!;
	const cancel = handlers.get(IpcChannels.PluginRuntimeCancel)!;
	expect(await invoke(event, "binding", "write", null, "selection")).toBe("receipt");
	expect(runtime.invoke).toHaveBeenLastCalledWith(sender, "binding", "write", null, "selection", undefined);
	expect(await invoke(event, "binding", "write", null, "selection", "request-1")).toBe("receipt");
	expect(runtime.invoke).toHaveBeenLastCalledWith(sender, "binding", "write", null, "selection", "request-1");
	expect(await cancel(event, "binding", "selection", "request-1")).toBe(true);
	expect(runtime.cancel).toHaveBeenCalledExactlyOnceWith(sender, "binding", "selection", "request-1");
	await invoke(event, "binding", "write", null, "selection", { forgedSignal: true });
	await cancel(event, "binding", "selection", 99);
	expect(runtime.invoke).toHaveBeenCalledTimes(2);
	expect(runtime.cancel).toHaveBeenCalledTimes(1);
});
