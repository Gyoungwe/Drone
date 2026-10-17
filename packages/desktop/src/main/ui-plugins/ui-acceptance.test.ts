// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({
	app: {
		isPackaged: true,
		getVersion: () => "ui-acceptance",
		getPath: (name: string) => (name === "userData" ? electronState.userData : electronState.userData),
	},
	shell: { openPath: vi.fn() },
}));

import { useUiPluginRegistry } from "../../renderer/src/plugins/registry";
import { UI_REGIONS } from "../../renderer/src/plugins/slots";
import { UiPluginManager } from "./manager";

const STORE = Object.assign(() => undefined, {
	getState: () => ({ sessions: [], activeSessionId: undefined, bySession: {} }),
	subscribe: () => () => {},
});

function installHostShim(): void {
	(globalThis as Record<string, unknown>).window = {
		DroneUI: {
			React,
			jsxRuntime,
			ReactDOM,
			components: {},
			helpers: {},
			hooks: { useT: () => () => "", useLanguage: () => "en" },
			stores: { useSessionsStore: STORE, useTranscriptStore: STORE },
			i18n: { registerMessages: () => () => {} },
		},
	};
}

function resetRegistry(): void {
	useUiPluginRegistry.setState({
		overrides: {},
		contributions: {},
		crashCounts: {},
		cleanups: {},
		loadNonces: {},
	});
}

async function importBundle(path: string, generation: number): Promise<Record<string, unknown>> {
	return (await import(`${pathToFileURL(path).href}?acceptance=${generation}`)) as Record<string, unknown>;
}

describe("UI-01 real plugin lifecycle", () => {
	let root = "";
	const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");

	afterEach(async () => {
		resetRegistry();
		delete (globalThis as Record<string, unknown>).window;
		if (originalResourcesPath) Object.defineProperty(process, "resourcesPath", originalResourcesPath);
		else Reflect.deleteProperty(process, "resourcesPath");
		if (root) await rm(root, { recursive: true, force: true });
	});

	it("enables a shipped plugin, observes its real contribution, disables it, then reloads it", async () => {
		root = await mkdtemp(join(tmpdir(), "drone-ui-01-"));
		electronState.userData = root;
		// The manager intentionally exercises the packaged resource path. Resolve it
		// from this test file so the acceptance remains valid from the repository root
		// and from an individual workspace invocation.
		Object.defineProperty(process, "resourcesPath", {
			configurable: true,
			enumerable: originalResourcesPath?.enumerable ?? false,
			value: fileURLToPath(new URL("../../../resources", import.meta.url)),
			writable: true,
		});
		installHostShim();

		const manager = new UiPluginManager();
		await manager.init();
		const name = "ds-whale-maid";
		const initial = manager.info(name);
		expect(initial).toMatchObject({ name, builtin: true, enabled: false, trusted: false, built: false });

		await manager.updateConfig({ enabled: true, plugins: { [name]: { enabled: true, trusted: true } } });
		const built = await manager.ensureBuilt(name);
		expect(built).toBe(true);
		const first = await manager.readCode(name);
		expect("manifest" in first).toBe(true);
		if (!("manifest" in first)) throw new Error(first.error);
		expect(first.manifest.contributions?.[0]).toMatchObject({ region: UI_REGIONS.AppOverlay, id: "pet" });

		const firstModule = await importBundle(join(manager.pluginDirOf(name) as string, "dist/index.js"), 1);
		const firstApplied = useUiPluginRegistry.getState().applyPlugin(first.manifest, firstModule, []);
		expect(firstApplied).toEqual({ ok: true, missing: [] });
		expect(useUiPluginRegistry.getState().contributions[UI_REGIONS.AppOverlay]).toHaveLength(1);
		expect(useUiPluginRegistry.getState().loadNonces[name]).toBe(1);

		await manager.updateConfig({ plugins: { [name]: { enabled: false, trusted: true } } });
		useUiPluginRegistry.getState().removePlugin(name);
		expect(manager.info(name)).toMatchObject({ enabled: false, trusted: true, built: true });
		expect(useUiPluginRegistry.getState().contributions[UI_REGIONS.AppOverlay]).toBeUndefined();

		await manager.updateConfig({ enabled: true, plugins: { [name]: { enabled: true, trusted: true } } });
		const second = await manager.readCode(name);
		expect("manifest" in second).toBe(true);
		if (!("manifest" in second)) throw new Error(second.error);
		const secondModule = await importBundle(join(manager.pluginDirOf(name) as string, "dist/index.js"), 2);
		const secondApplied = useUiPluginRegistry.getState().applyPlugin(second.manifest, secondModule, []);
		expect(secondApplied).toEqual({ ok: true, missing: [] });
		expect(useUiPluginRegistry.getState().contributions[UI_REGIONS.AppOverlay]).toHaveLength(1);
		expect(useUiPluginRegistry.getState().loadNonces[name]).toBe(2);

		const restarted = new UiPluginManager();
		await restarted.init();
		expect(restarted.info(name)).toMatchObject({ enabled: true, trusted: true, built: true });
	});
});
