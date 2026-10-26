// @vitest-environment jsdom

import type { UiPluginInfo, UiPluginManifest, UiPluginsEventPayload } from "@drone/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ onUiPluginsEvent: vi.fn(), uiPluginsReadCode: vi.fn() }));
vi.mock("../api", () => ({ getPi: () => api }));

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { useUiPluginsStore } from "../stores/ui-plugins";
import { initUiPlugins } from "./loader";
import { useUiPluginRegistry } from "./registry";

beforeEach(() => {
	api.uiPluginsReadCode.mockReset();
	vi.stubGlobal(
		"URL",
		class extends URL {
			static createObjectURL() {
				return "data:text/javascript,export function Panel(){return 'Loaded contribution'}";
			}
			static revokeObjectURL() {}
		},
	);
	useUiPluginRegistry.setState({
		overrides: {},
		contributions: {},
		crashCounts: {},
		loadNonces: {},
		cleanups: {},
	});
	useUiPluginsStore.setState({
		config: { enabled: true, plugins: {}, assignments: {} },
		plugins: [],
		loadErrors: {},
		loadAll: vi.fn(async () => {}),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function fixture(name: string): { info: UiPluginInfo; manifest: UiPluginManifest; code: string } {
	const manifest = {
		name,
		droneUi: 1,
		main: "index.js",
		contributions: [{ id: "panel", region: "panel.tab", export: "Panel" }],
	} satisfies UiPluginManifest;
	return {
		manifest,
		code: "export function Panel(){return null}",
		info: {
			name,
			droneUi: 1,
			slots: {},
			contributions: manifest.contributions,
			enabled: true,
			trusted: true,
			built: true,
		},
	};
}

function event(payload: UiPluginsEventPayload): void {
	const onEvent = api.onUiPluginsEvent.mock.calls[0]![0] as (event: UiPluginsEventPayload) => void;
	onEvent(payload);
}

describe("UI runtime loader lifecycle", () => {
	it("cleans headless plugins and does not reload them after the global switch is disabled", async () => {
		await initUiPlugins();
		const cleanup = vi.fn();
		useUiPluginRegistry
			.getState()
			.applyPlugin(
				{ name: "headless-runtime", droneUi: 1, main: "index.ts", headless: true },
				{ activate: () => cleanup },
				[],
			);
		useUiPluginsStore.setState({
			config: { enabled: false, plugins: {}, assignments: {} },
			plugins: [
				{
					name: "headless-runtime",
					droneUi: 1,
					headless: true,
					slots: {},
					contributions: [],
					enabled: true,
					trusted: true,
					built: true,
				},
			],
		});
		const onEvent = api.onUiPluginsEvent.mock.calls[0]![0] as (event: UiPluginsEventPayload) => void;
		onEvent({ kind: "config" });
		await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
		expect(api.uiPluginsReadCode).not.toHaveBeenCalled();
	});
	it("records a rejected first plugin, mounts the next plugin and recovers on reload", async () => {
		const denied = fixture("denied-runtime");
		const allowed = fixture("allowed-runtime");
		useUiPluginsStore.setState({ plugins: [denied.info, allowed.info] });
		api.uiPluginsReadCode.mockImplementation(async (name: string) => {
			if (name === denied.manifest.name) throw new Error("Activation denied");
			return { manifest: allowed.manifest, code: allowed.code };
		});
		await initUiPlugins();
		expect(useUiPluginsStore.getState().loadErrors[denied.manifest.name]).toContain("Activation denied");
		const entries = useUiPluginRegistry.getState().contributions["panel.tab"]!;
		expect(entries.map((entry) => entry.pluginName)).toEqual([allowed.manifest.name]);
		render(createElement(entries[0]!.component));
		expect(screen.getByText("Loaded contribution")).toBeDefined();
		api.uiPluginsReadCode.mockResolvedValue({ manifest: denied.manifest, code: denied.code });
		event({ kind: "changed", name: denied.manifest.name });
		await vi.waitFor(() => expect(useUiPluginRegistry.getState().contributions["panel.tab"]).toHaveLength(2));
		expect(useUiPluginsStore.getState().loadErrors[denied.manifest.name]).toBeUndefined();
	});

	it("records changed-plugin IPC failures and can recover on the next change event", async () => {
		await initUiPlugins();
		const plugin = fixture("changed-runtime");
		useUiPluginsStore.setState({ plugins: [plugin.info] });
		api.uiPluginsReadCode.mockRejectedValueOnce(new Error("Worker startup failed"));
		event({ kind: "changed", name: plugin.manifest.name });
		await vi.waitFor(() =>
			expect(useUiPluginsStore.getState().loadErrors[plugin.manifest.name]).toContain(
				"Worker startup failed",
			),
		);
		api.uiPluginsReadCode.mockResolvedValue({ manifest: plugin.manifest, code: plugin.code });
		event({ kind: "changed", name: plugin.manifest.name });
		await vi.waitFor(() => expect(useUiPluginRegistry.getState().contributions["panel.tab"]).toHaveLength(1));
		expect(useUiPluginsStore.getState().loadErrors[plugin.manifest.name]).toBeUndefined();
	});

	it("propagates store loading failures instead of treating them as a plugin denial", async () => {
		useUiPluginsStore.setState({
			loadAll: vi.fn(async () => {
				throw new Error("Store unavailable");
			}),
		});
		await expect(initUiPlugins()).rejects.toThrow("Store unavailable");
	});
});
