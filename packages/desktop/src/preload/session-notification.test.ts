import type { PiApi, SessionEventEnvelope } from "@drone/shared";
import { IpcChannels } from "@drone/shared";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	exposed: new Map<string, PiApi>(),
	listeners: new Map<string, (event: unknown, payload: SessionEventEnvelope) => void>(),
	removeListener: vi.fn(),
}));
vi.mock("electron", () => ({
	contextBridge: { exposeInMainWorld: (name: string, value: PiApi) => mocks.exposed.set(name, value) },
	ipcRenderer: {
		invoke: vi.fn(async () => undefined),
		on: (channel: string, listener: (event: unknown, payload: SessionEventEnvelope) => void) =>
			mocks.listeners.set(channel, listener),
		removeListener: mocks.removeListener,
		send: vi.fn(),
		sendSync: vi.fn(),
	},
	webUtils: { getPathForFile: () => "" },
}));
it("the real preload forwards the generic session notification envelope and unregisters its listener", async () => {
	await import("./index");
	const received: SessionEventEnvelope[] = [];
	const off = mocks.exposed.get("pi")!.onEvent((event) => received.push(event));
	const listener = mocks.listeners.get(IpcChannels.Event)!;
	const envelope: SessionEventEnvelope = {
		sessionId: "session-a",
		event: { type: "extension_notification", severity: "warning", message: "Official extension warning" },
	};
	listener({}, envelope);
	expect(received).toEqual([envelope]);
	off();
	expect(mocks.removeListener).toHaveBeenCalledWith(IpcChannels.Event, listener);
});
