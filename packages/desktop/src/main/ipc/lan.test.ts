import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	removeHandler: vi.fn((channel: string) => mocks.handlers.delete(channel)),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		removeHandler: mocks.removeHandler,
	},
}));

import { IpcChannels } from "@drone/shared";
import { registerLanIpc } from "./lan";

const status = {
	enabled: true,
	port: 4318,
	urls: [],
	qrDataUrl: null,
	clients: 0,
	remoteControl: false,
};

describe("registerLanIpc", () => {
	beforeEach(() => {
		mocks.handlers.clear();
		mocks.removeHandler.mockClear();
	});

	it("routes status and toggles through LanContract channels", async () => {
		const lan = {
			getStatus: vi.fn(async () => status),
			setEnabled: vi.fn(async (enabled: boolean) => ({ ...status, enabled })),
			setRemoteControl: vi.fn(async (remoteControl: boolean) => ({ ...status, remoteControl })),
		} as unknown as Parameters<typeof registerLanIpc>[0];

		registerLanIpc(lan);
		expect(await mocks.handlers.get(IpcChannels.LanGetStatus)!({})).toEqual(status);
		expect(await mocks.handlers.get(IpcChannels.LanSetEnabled)!({}, false)).toMatchObject({ enabled: false });
		expect(await mocks.handlers.get(IpcChannels.LanSetRemoteControl)!({}, true)).toMatchObject({
			remoteControl: true,
		});
		expect(lan.getStatus).toHaveBeenCalledOnce();
		expect(lan.setEnabled).toHaveBeenCalledWith(false);
		expect(lan.setRemoteControl).toHaveBeenCalledWith(true);
	});

	it("rejects invalid toggle arguments before invoking LAN", async () => {
		const lan = {
			getStatus: vi.fn(async () => status),
			setEnabled: vi.fn(),
			setRemoteControl: vi.fn(),
		} as unknown as Parameters<typeof registerLanIpc>[0];
		registerLanIpc(lan);

		const invalid = await mocks.handlers.get(IpcChannels.LanSetEnabled)!({}, "false");
		expect(invalid).toMatchObject({ code: "invalid_arguments", severity: "error" });
		expect(lan.setEnabled).not.toHaveBeenCalled();
	});
});
