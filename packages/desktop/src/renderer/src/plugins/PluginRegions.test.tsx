// @vitest-environment jsdom
import type { UiPluginContribution, UiPluginManifest } from "@drone/shared";
import { act, render, renderHook, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiPluginsStore } from "../stores/ui-plugins";
import { PluginEntryHost, usePluginEntries } from "./PluginRegions";
import { useUiPluginRegistry } from "./registry";
import { UI_REGIONS } from "./slots";

vi.stubGlobal("React", React);

const Panel = () => null;

function manifest(region: string): UiPluginManifest {
	const contribution: UiPluginContribution = {
		id: region.replaceAll(".", "-"),
		region,
		export: "Panel",
		title: `Test ${region}`,
	};
	return { name: "v3-region-fixture", droneUi: 1, main: "src/index.tsx", contributions: [contribution] };
}

beforeEach(() => {
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
	});
});

describe("v3 plugin page regions", () => {
	for (const region of [
		UI_REGIONS.KnowledgeTab,
		UI_REGIONS.KnowledgePage,
		UI_REGIONS.KnowledgeSurface,
		UI_REGIONS.HomeSection,
		UI_REGIONS.SkillsSection,
	]) {
		it(`${region} mounts and unmounts a contribution`, () => {
			useUiPluginRegistry.getState().applyPlugin(manifest(region), { Panel }, []);
			const { result, unmount } = renderHook(() => usePluginEntries(region));

			expect(result.current).toHaveLength(1);
			expect(result.current[0]).toMatchObject({
				id: `plugin:v3-region-fixture:${region.replaceAll(".", "-")}`,
				title: `Test ${region}`,
			});

			act(() => useUiPluginRegistry.getState().removePlugin("v3-region-fixture"));
			expect(result.current).toEqual([]);
			unmount();
		});
	}

	it("disabled plugins leave every page region at its default empty state", () => {
		for (const region of [
			UI_REGIONS.KnowledgeTab,
			UI_REGIONS.KnowledgePage,
			UI_REGIONS.KnowledgeSurface,
			UI_REGIONS.HomeSection,
			UI_REGIONS.SkillsSection,
		])
			useUiPluginRegistry.getState().applyPlugin(manifest(region), { Panel }, []);

		useUiPluginsStore.setState({ config: { enabled: false, plugins: {}, assignments: {} } });
		const hooks = [
			renderHook(() => usePluginEntries(UI_REGIONS.KnowledgeTab)),
			renderHook(() => usePluginEntries(UI_REGIONS.KnowledgePage)),
			renderHook(() => usePluginEntries(UI_REGIONS.KnowledgeSurface)),
			renderHook(() => usePluginEntries(UI_REGIONS.HomeSection)),
			renderHook(() => usePluginEntries(UI_REGIONS.SkillsSection)),
		];
		for (const hook of hooks) expect(hook.result.current).toEqual([]);
		for (const hook of hooks) hook.unmount();
	});

	it("renders the host fallback when a full-page contribution crashes", () => {
		const Broken = () => {
			throw new Error("fixture plugin crash");
		};
		useUiPluginRegistry.getState().applyPlugin(manifest(UI_REGIONS.KnowledgePage), { Panel: Broken }, []);
		const entries = renderHook(() => usePluginEntries(UI_REGIONS.KnowledgePage));
		const entry = entries.result.current[0];
		if (!entry) throw new Error("knowledge page fixture did not register");
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		render(
			React.createElement(PluginEntryHost, {
				entry,
				fallback: React.createElement(
					"div",
					{ "data-testid": "knowledge-default-fallback" },
					"default knowledge page",
				),
			}),
		);
		expect(screen.getByTestId("knowledge-default-fallback").textContent).toBe("default knowledge page");
		error.mockRestore();
		entries.unmount();
	});
});
