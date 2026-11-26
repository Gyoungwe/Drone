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

import { channelOf, type PackageLifecycleReceipt, PackagesContract } from "@drone/shared";
import { requiresPluginHostRestart } from "../optional-plugin-hosts";
import { registerPackagesIpc } from "./packages";

function packageHandler(method: keyof typeof PackagesContract.methods) {
	const channel = channelOf(PackagesContract, method);
	const handler = mocks.handlers.get(channel);
	if (!handler) throw new Error(`No handler registered for ${channel}`);
	return handler;
}

const receipt = (operation: PackageLifecycleReceipt["operation"]): PackageLifecycleReceipt => ({
	operation,
	packageName: "@gyoungwe/desktop-ui-pack",
	source: "npm:@gyoungwe/desktop-ui-pack",
	scope: "user",
	status: "succeeded",
	effect: "current-session",
	events: [],
});

function packageServiceMock() {
	return {
		searchPackages: vi.fn(async () => ({ packages: [], total: 0, page: 1, pageSize: 50 })),
		installPackage: vi.fn(async () => receipt("install")),
		updatePackage: vi.fn(async () => receipt("update")),
		rollbackPackage: vi.fn(async () => receipt("rollback")),
		removePackage: vi.fn(async () => receipt("remove")),
		listConfiguredPackages: vi.fn(async () => []),
	};
}

it("attributes restart to the boot-selected host root and eligible user loader candidates", () => {
	const root = "/fixture/agent/npm/node_modules/host-package";
	const loaded = [
		{
			capability: "research",
			exportName: "researchConnectorHostLoader",
			packageName: "host-package",
			packageRoot: root,
			entrypoint: `${root}/host.mjs`,
		},
	];
	const candidate = {
		hosts: ["drone-desktop"],
		capabilities: ["research"],
		entrypoints: { host: "host.mjs" },
	};
	expect(requiresPluginHostRestart(root, "user", loaded)).toBe(true);
	expect(requiresPluginHostRestart("/fixture/project", "project", loaded, candidate)).toBe(false);
	expect(requiresPluginHostRestart("/fixture/staged", "user", loaded, candidate)).toBe(true);
	expect(
		requiresPluginHostRestart("/fixture/staged", "user", loaded, {
			...candidate,
			capabilities: ["not-a-boot-host"],
		}),
	).toBe(false);
});

describe("registerPackagesIpc", () => {
	beforeEach(() => mocks.handlers.clear());

	it("routes package operations through the explicit host service", async () => {
		const service = packageServiceMock();
		registerPackagesIpc({ packages: service });

		expect([...mocks.handlers.keys()]).toEqual(
			Object.keys(PackagesContract.methods).map((method) => channelOf(PackagesContract, method)),
		);
		expect(await packageHandler("listConfiguredPackages")({})).toEqual([]);
		expect(service.listConfiguredPackages).toHaveBeenCalledOnce();
	});

	it("refreshes the UI plugin manager after package changes", async () => {
		const changed = vi.fn();
		registerPackagesIpc({ packages: packageServiceMock() }, undefined, changed);
		await packageHandler("installPackage")({}, "@gyoungwe/desktop-ui-pack");
		await packageHandler("updatePackage")({}, "@gyoungwe/desktop-ui-pack");
		await packageHandler("rollbackPackage")({}, "@gyoungwe/desktop-ui-pack", "0.1.0");
		await packageHandler("removePackage")({}, "npm:@gyoungwe/desktop-ui-pack", "user");
		expect(changed).toHaveBeenCalledTimes(4);
	});

	it("notifies the renderer when an update fails before any worker drain", async () => {
		const failed: PackageLifecycleReceipt = {
			...receipt("update"),
			status: "failed",
			events: [{ type: "failed", at: 1 }],
		};
		const service = packageServiceMock();
		service.updatePackage.mockResolvedValue(failed);
		const changed = vi.fn();
		registerPackagesIpc({ packages: service }, undefined, changed);
		await expect(packageHandler("updatePackage")({}, failed.packageName)).resolves.toEqual(failed);
		expect(changed).toHaveBeenCalledExactlyOnceWith(failed);
	});

	it("binds a mutation host to each validated IPC caller", async () => {
		const service = packageServiceMock();
		const createHost = vi.fn(() => ({
			inspect: vi.fn(),
			transition: vi.fn(),
			probe: vi.fn(),
			rescan: vi.fn(),
		}));
		registerPackagesIpc({ packages: service }, undefined, undefined, createHost);
		const first = { sender: { id: 1 } };
		const second = { sender: { id: 2 } };
		const { packageName } = receipt("update");
		const update = packageHandler("updatePackage");
		await expect(update(first, "")).resolves.toMatchObject({ code: "invalid_arguments" });
		expect(createHost).not.toHaveBeenCalled();
		expect(service.updatePackage).not.toHaveBeenCalled();
		await Promise.all([update(first, packageName), update(second, packageName)]);
		expect(createHost.mock.calls).toEqual([[first], [second]]);
		expect(service.updatePackage.mock.calls).toEqual(
			createHost.mock.results.map(({ value }) => [packageName, value]),
		);
	});
});
