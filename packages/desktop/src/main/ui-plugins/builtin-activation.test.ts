// @vitest-environment node
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageRegistry } from "@drone/backend";
import { expect, it, vi } from "vitest";
import type { DesktopRuntimeBridgeOptions } from "./runtime-bridge";

const desktop = vi.hoisted(() => ({
	showMessageBox: vi.fn(),
	bridgeOptions: undefined as DesktopRuntimeBridgeOptions | undefined,
}));
vi.mock("electron", () => ({
	app: { getPath: () => tmpdir() },
	BrowserWindow: { fromWebContents: () => ({}) },
	dialog: { showMessageBox: desktop.showMessageBox },
	webContents: { fromId: () => ({ isDestroyed: () => false }) },
}));
vi.mock("./runtime-bridge", () => ({
	DesktopRuntimeBridge: class {
		constructor(options: unknown) {
			desktop.bridgeOptions = options as DesktopRuntimeBridgeOptions;
		}
	},
}));

import type { UiPluginManager } from "./manager";
import { createDesktopRuntime } from "./runtime-host";

type Sessions = Parameters<typeof createDesktopRuntime>[2];

const storage = new StorageRegistry();

it("starts a built-in package's runtime without asking, and still asks for everything else", async () => {
	const builtin = {
		pluginId: "@drone/core",
		packageRoot: join(tmpdir(), "builtin"),
		entrypoint: join(tmpdir(), "a.mjs"),
	};
	const other = {
		pluginId: "@example/other",
		packageRoot: join(tmpdir(), "other"),
		entrypoint: join(tmpdir(), "b.mjs"),
	};
	createDesktopRuntime(
		{ builtinPackages: new Map([[builtin.packageRoot, builtin.pluginId]]) } as unknown as UiPluginManager,
		tmpdir(),
		{
			getTaskGrants: () => ({}),
			// The P5 composition registers the fact journal in the host's
			// storage ledger when the runtime is built, so the stub returns
			// one stable registry rather than a fresh one per call.
			getStorageRegistry: () => storage,
			getPluginCallerContext: () => undefined,
		} as unknown as Sessions,
		(owner) => ({ ownerId: owner.id, send: () => false, resolved: () => undefined }),
	);
	const owner = { id: 1, isDestroyed: () => false };
	const approve = (...args: [typeof builtin, string?]) => desktop.bridgeOptions?.approve(owner, ...args);
	desktop.showMessageBox.mockResolvedValue({ response: 0 });
	expect(await approve(builtin)).toBe(true);
	expect(desktop.showMessageBox).not.toHaveBeenCalled();
	expect(await approve(builtin, "capability:task.grant.request")).toBe(false);
	expect(await approve(other)).toBe(false);
	expect(desktop.showMessageBox).toHaveBeenCalledTimes(2);
});
