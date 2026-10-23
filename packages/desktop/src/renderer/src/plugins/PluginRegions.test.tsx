// @vitest-environment jsdom
import type { UiPluginContribution, UiPluginManifest } from "@drone/shared";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiPluginsStore } from "../stores/ui-plugins";
import { usePluginEntries } from "./PluginRegions";
import { useUiPluginRegistry } from "./registry";
import { UI_REGIONS } from "./slots";

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
			UI_REGIONS.HomeSection,
			UI_REGIONS.SkillsSection,
		])
			useUiPluginRegistry.getState().applyPlugin(manifest(region), { Panel }, []);

		useUiPluginsStore.setState({ config: { enabled: false, plugins: {}, assignments: {} } });
		const hooks = [
			renderHook(() => usePluginEntries(UI_REGIONS.KnowledgeTab)),
			renderHook(() => usePluginEntries(UI_REGIONS.KnowledgePage)),
			renderHook(() => usePluginEntries(UI_REGIONS.HomeSection)),
			renderHook(() => usePluginEntries(UI_REGIONS.SkillsSection)),
		];
		for (const hook of hooks) expect(hook.result.current).toEqual([]);
		for (const hook of hooks) hook.unmount();
	});
});
