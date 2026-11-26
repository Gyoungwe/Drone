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

import { channelOf, PackagesContract } from "@drone/shared";
import { registerPackagesIpc } from "./packages";

function packageHandler(method: keyof typeof PackagesContract.methods) {
	const channel = channelOf(PackagesContract, method);
	const handler = mocks.handlers.get(channel);
	if (!handler) throw new Error(`No handler registered for ${channel}`);
	return handler;
}

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

		expect([...mocks.handlers.keys()]).toEqual(
			Object.keys(PackagesContract.methods).map((method) => channelOf(PackagesContract, method)),
		);
		expect(await packageHandler("listConfiguredPackages")({})).toEqual([]);
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
		await packageHandler("installPackage")({}, "@gyoungwe/desktop-ui-pack");
		await packageHandler("updatePackage")({}, "@gyoungwe/desktop-ui-pack");
		await packageHandler("rollbackPackage")({}, "@gyoungwe/desktop-ui-pack", "0.1.0");
		await packageHandler("removePackage")({}, "npm:@gyoungwe/desktop-ui-pack", "user");
		expect(changed).toHaveBeenCalledTimes(4);
	});
});
