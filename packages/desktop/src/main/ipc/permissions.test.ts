import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	showItemInFolder: vi.fn(),
	openPath: vi.fn(async () => ""),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		removeHandler: vi.fn(),
	},
	shell: { showItemInFolder: mocks.showItemInFolder, openPath: mocks.openPath },
}));

import { IpcChannels } from "@drone/shared";
import { registerPermissionSettingsIpc } from "./permissions";

describe("registerPermissionSettingsIpc", () => {
	beforeEach(() => mocks.handlers.clear());

	it("routes durable settings through BackendServices.permissions", async () => {
		const permissions = {
			getConfig: vi.fn(() => ({ enabled: true })),
			getSettings: vi.fn(() => ({ path: "/tmp/permissions.json" })),
			saveSettings: vi.fn(),
			resetSettings: vi.fn(),
			probe: vi.fn(),
			getAuditTail: vi.fn(() => []),
		};
		const sessions = {
			getPermissionConfig: vi.fn(() => ({ enabled: false })),
			getPermissionSettings: vi.fn(() => ({ path: "/tmp/legacy.json" })),
		} as any;
		registerPermissionSettingsIpc({ sessions, permissions } as any);

		const handler = mocks.handlers.get(IpcChannels.PermissionGetConfig)!;
		expect(await handler({})).toEqual({ enabled: true });
		expect(permissions.getConfig).toHaveBeenCalledOnce();
		expect(sessions.getPermissionConfig).not.toHaveBeenCalled();
	});
});

it("authenticates AskRespond with the invoking webContents rather than renderer arguments", async () => {
	const respondAsk = vi.fn(() => false);
	const permissions = {
		getConfig: vi.fn(),
		getSettings: vi.fn(),
		saveSettings: vi.fn(),
		resetSettings: vi.fn(),
		probe: vi.fn(),
		getAuditTail: vi.fn(),
	};
	registerPermissionSettingsIpc({ sessions: { respondAsk }, permissions } as any);
	const handler = mocks.handlers.get(IpcChannels.AskRespond)!;
	expect(await handler({ sender: { id: 42 } }, "question-id", { kind: "cancel" })).toBe(false);
	expect(respondAsk).toHaveBeenCalledWith("question-id", { kind: "cancel" }, 42);
});
