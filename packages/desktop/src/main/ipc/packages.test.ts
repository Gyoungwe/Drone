import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		removeHandler: vi.fn(),
	},
}));

import { IpcChannels } from "@drone/shared";
import { registerPackagesIpc } from "./packages";

const receipt = (operation: "install" | "update" | "rollback" | "remove") => ({
	operation,
	packageName: "@gyoungwe/desktop-ui-pack",
	source: "npm:@gyoungwe/desktop-ui-pack",
	scope: "user" as const,
	status: "succeeded" as const,
	effect: "current-session" as const,
	events: [],
});

describe("registerPackagesIpc", () => {
	beforeEach(() => mocks.handlers.clear());

	it("routes package operations through the explicit host service", async () => {
		const service = {
			searchPackages: vi.fn(async () => ({ packages: [], total: 0, page: 1, pageSize: 50 })),
			installPackage: vi.fn(async () => receipt("install")),
			updatePackage: vi.fn(async () => receipt("update")),
			rollbackPackage: vi.fn(async () => receipt("rollback")),
			removePackage: vi.fn(async () => receipt("remove")),
			listConfiguredPackages: vi.fn(async () => []),
		};
		registerPackagesIpc({ sessions: {}, packages: service } as unknown as Parameters<
			typeof registerPackagesIpc
		>[0]);

		const list = mocks.handlers.get(IpcChannels.PackagesListConfigured)!;
		expect(await list({})).toEqual([]);
		expect(service.listConfiguredPackages).toHaveBeenCalledOnce();
	});

	it("refreshes the UI plugin manager after package changes", async () => {
		const service = {
			searchPackages: vi.fn(async () => ({ packages: [], total: 0, page: 1, pageSize: 50 })),
			installPackage: vi.fn(async () => receipt("install")),
			updatePackage: vi.fn(async () => receipt("update")),
			rollbackPackage: vi.fn(async () => receipt("rollback")),
			removePackage: vi.fn(async () => receipt("remove")),
			listConfiguredPackages: vi.fn(async () => []),
		};
		const changed = vi.fn();
		registerPackagesIpc(
			{ sessions: {}, packages: service } as unknown as Parameters<typeof registerPackagesIpc>[0],
			undefined,
			changed,
		);
		await mocks.handlers.get(IpcChannels.PackagesInstall)!({}, "@gyoungwe/desktop-ui-pack");
		await mocks.handlers.get(IpcChannels.PackagesUpdate)!({}, "@gyoungwe/desktop-ui-pack");
		await mocks.handlers.get(IpcChannels.PackagesRollback)!({}, "@gyoungwe/desktop-ui-pack", "0.1.0");
		await mocks.handlers.get(IpcChannels.PackagesRemove)!({}, "npm:@gyoungwe/desktop-ui-pack", "user");
		expect(changed).toHaveBeenCalledTimes(4);
	});
});
