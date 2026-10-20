import { describe, expect, it } from "vitest";
import {
	DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES,
	DRONE_PLUGIN_METADATA,
	DRONE_PLUGIN_PACKAGE_NAMES,
	dronePluginSource,
	MARKET_RESOURCE_LINKS,
	mergePiPluginSources,
	piMarketPluginSource,
} from "./plugin-sources";

describe("plugin source adapters", () => {
	it("keeps the official market extension-only", () => {
		expect(
			piMarketPluginSource({
				name: "skill-package",
				description: "skill",
				author: "author",
				types: ["skill"],
				downloads: 1,
				updatedAt: 1,
				installSource: "npm:skill-package",
			}),
		).toBeNull();
		expect(
			piMarketPluginSource({
				name: "extension-package",
				description: "extension",
				author: "author",
				types: ["extension"],
				downloads: 1,
				updatedAt: 1,
				installSource: "npm:extension-package",
			}),
		).toMatchObject({ packageName: "extension-package", sources: ["pi-market"], packageKind: "pi" });
	});

	it("keeps skill-only packages out of the plugin source", () => {
		expect(dronePluginSource({ name: "@gyoungwe/skill-only", pi: { skills: ["./skills/*"] } })).toBeNull();
		expect(
			dronePluginSource({
				name: "@gyoungwe/pi-knowledge",
				pi: { extensions: ["./dist/index.mjs"], skills: ["./skills/*"] },
			}),
		).toMatchObject({ piExtensions: ["./dist/index.mjs"], piSkills: ["./skills/*"] });
		expect(dronePluginSource({ name: "@other/plugin", pi: { extensions: ["./dist/index.mjs"] } })).toBeNull();
		expect(
			dronePluginSource(
				{ name: "@gyoungwe/desktop-ui-pack", version: "0.1.0" },
				{ entrypoints: { ui: "./ui/plugin.json" } },
			),
		).toMatchObject({ packageKind: "desktop-ui", uiContribution: true, piExtensions: [] });
	});

	it("merges a package listed by both origins without duplicating the install row", () => {
		const official = piMarketPluginSource({
			name: "@gyoungwe/pi-connectors",
			description: "official",
			author: "author",
			types: ["extension"],
			downloads: 1,
			updatedAt: 1,
			installSource: "npm:@gyoungwe/pi-connectors",
		});
		const drone = dronePluginSource(
			{ name: "@gyoungwe/pi-connectors", version: "0.1.0", pi: { extensions: ["./dist/index.mjs"] } },
			{ capabilities: ["connectors"], hosts: ["native-pi"] },
		);
		if (!official || !drone) throw new Error("source fixtures should be accepted");
		const [merged] = mergePiPluginSources([official, drone]);
		expect(merged).toMatchObject({
			packageName: "@gyoungwe/pi-connectors",
			sources: ["pi-market", "drone"],
			piExtensions: ["<pi.dev extension>", "./dist/index.mjs"],
			capabilities: ["connectors"],
		});
	});

	it("keeps the market metadata complete before Drone packages are installed", () => {
		for (const name of DRONE_PLUGIN_PACKAGE_NAMES) {
			expect(DRONE_PLUGIN_METADATA[name].version).toMatch(/^\d+\.\d+\.\d+$/u);
			expect(DRONE_PLUGIN_METADATA[name].description.length).toBeGreaterThan(0);
		}
		expect(MARKET_RESOURCE_LINKS.some((entry) => entry.kind === "mcp-official")).toBe(true);
		expect(MARKET_RESOURCE_LINKS.some((entry) => entry.kind === "mcp-community")).toBe(true);
		expect(DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES).toEqual([
			"@gyoungwe/pi-core",
			"@gyoungwe/pi-knowledge",
			"@gyoungwe/pi-research",
		]);
		for (const name of DRONE_BUILTIN_PLUGIN_PACKAGE_NAMES)
			expect(DRONE_PLUGIN_METADATA[name].builtIn).toBe(true);
	});
});
