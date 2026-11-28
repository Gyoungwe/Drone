// @vitest-environment node
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PluginRuntimeSource, StorageRegistry } from "@drone/backend";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopRuntimeBridgeOptions } from "./runtime-bridge";

const desktop = vi.hoisted(() => ({ bridgeOptions: undefined as DesktopRuntimeBridgeOptions | undefined }));
vi.mock("electron", () => ({
	app: { getPath: () => tmpdir() },
	BrowserWindow: { fromWebContents: () => ({}) },
	dialog: { showMessageBox: vi.fn() },
	webContents: { fromId: () => ({ isDestroyed: () => false }) },
}));
vi.mock("./runtime-bridge", () => ({
	DesktopRuntimeBridge: class {
		constructor(options: unknown) {
			desktop.bridgeOptions = options as DesktopRuntimeBridgeOptions;
		}
	},
}));

import { createDesktopRuntime } from "./runtime-host";

const owner = { id: 1, isDestroyed: () => false };
const source = (hostEvents?: readonly ["inquiry.compute"]): PluginRuntimeSource => ({
	pluginId: "@example/events",
	packageRoot: tmpdir(),
	entrypoint: join(tmpdir(), "runtime.mjs"),
	...(hostEvents ? { hostEvents } : {}),
});

function providerFor(approved: boolean) {
	const hostEvents = { subscribe: vi.fn() };
	const getPluginHostEvents = vi.fn(() => (approved ? hostEvents : undefined));
	const storage = new StorageRegistry();
	const sessions = {
		getPluginHostEvents,
		getPluginCallerContext: () => undefined,
		getStorageRegistry: () => storage,
		getPluginSessionCapabilities: () => ({}),
		getPluginSourceCapabilities: () => ({}),
		getTaskGrants: () => ({ bindSourceValidator: vi.fn() }),
		getPluginWorkspaceCapabilities: () => ({}),
	};
	createDesktopRuntime({ builtinPackages: new Map() } as never, tmpdir(), sessions as never, () => ({
		ownerId: owner.id,
		send: () => false,
		resolved: () => undefined,
	}));
	return { hostEvents, getPluginHostEvents };
}

async function optionsFor(selected: PluginRuntimeSource) {
	const options = desktop.bridgeOptions;
	if (!options?.capabilities) throw new Error("Desktop runtime capabilities were not composed");
	const provider = options.capabilities(selected, owner);
	if (typeof provider !== "function") throw new Error("Expected an activation-scoped capability provider");
	return provider({
		pluginId: selected.pluginId,
		applicationId: "app",
		signal: new AbortController().signal,
		events: { changed: () => undefined },
	});
}

describe("desktop host event source wiring", () => {
	afterEach(() => {
		desktop.bridgeOptions = undefined;
	});

	it("passes a declared and approved source to the runtime options", async () => {
		const state = providerFor(true);
		const selected = source(["inquiry.compute"]);
		const options = await optionsFor(selected);

		expect(state.getPluginHostEvents).toHaveBeenCalledWith(selected, expect.any(AbortSignal));
		expect(options.hostEvents).toBe(state.hostEvents);
	});

	it("omits hostEvents when the package has no declaration", async () => {
		const state = providerFor(true);
		const options = await optionsFor(source());

		expect(state.getPluginHostEvents).not.toHaveBeenCalled();
		expect("hostEvents" in options).toBe(false);
	});

	it("omits a declared source when its consent gate returns no source", async () => {
		const state = providerFor(false);
		const selected = source(["inquiry.compute"]);
		const options = await optionsFor(selected);

		expect(state.getPluginHostEvents).toHaveBeenCalledWith(selected, expect.any(AbortSignal));
		expect("hostEvents" in options).toBe(false);
	});
});
