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

describe("registerPackagesIpc", () => {
	beforeEach(() => mocks.handlers.clear());

	it("routes package operations through the explicit host service", async () => {
		const service = {
			searchPackages: vi.fn(async () => ({ packages: [], total: 0, page: 1, pageSize: 50 })),
			installPackage: vi.fn(async () => {}),
			removePackage: vi.fn(async () => {}),
			listConfiguredPackages: vi.fn(async () => []),
		};
		registerPackagesIpc({ sessions: {}, packages: service } as unknown as Parameters<
			typeof registerPackagesIpc
		>[0]);

		const list = mocks.handlers.get(IpcChannels.PackagesListConfigured)!;
		expect(await list({})).toEqual([]);
		expect(service.listConfiguredPackages).toHaveBeenCalledOnce();
	});
});
