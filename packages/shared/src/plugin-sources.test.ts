import { describe, expect, it } from "vitest";
import { dronePluginSource, mergePiPluginSources, piMarketPluginSource } from "./plugin-sources";

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
});
