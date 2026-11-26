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

import { channelOf, PermissionsContract } from "@drone/shared";
import { registerPermissionSettingsIpc } from "./permissions";

function permissionHandler(method: keyof typeof PermissionsContract.methods) {
	const channel = channelOf(PermissionsContract, method);
	const handler = mocks.handlers.get(channel);
	if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
	return handler;
}

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
		};
		registerPermissionSettingsIpc({ sessions, permissions } as any);

		expect([...mocks.handlers.keys()].sort()).toEqual(
			Object.keys(PermissionsContract.methods)
				.map((method) => channelOf(PermissionsContract, method))
				.sort(),
		);
		const handler = permissionHandler("getConfig");
		expect(await handler({})).toEqual({ enabled: true });
		expect(permissions.getConfig).toHaveBeenCalledOnce();
		expect(sessions.getPermissionConfig).not.toHaveBeenCalled();
	});
});

it("authenticates respondAsk with the invoking webContents", async () => {
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
	const handler = permissionHandler("respondAsk");
	expect(await handler({ sender: { id: 42 } }, "question-id", { kind: "cancel" })).toBe(false);
	expect(await handler({ sender: { id: 42 } }, "question-id", { kind: "cancel" }, 7)).toMatchObject({
		code: "invalid_arguments",
	});
	expect(respondAsk).toHaveBeenCalledExactlyOnceWith("question-id", { kind: "cancel" }, 42);
});
