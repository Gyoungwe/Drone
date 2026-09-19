import {
	RESEARCH_SKILL_SOURCES,
	type SlashCommandInfo,
	WORKFLOW_PROFILES,
	WORKFLOW_STAGES,
} from "@drone/shared";
import { describe, expect, it } from "vitest";
import { groupCommands, menuCommands, workflowMenuItems } from "./slash-filter";

const blocked = new Set(
	RESEARCH_SKILL_SOURCES.flatMap((s) => s.skills.filter((k) => !k.bundled).map((k) => k.name)),
);
const commands: SlashCommandInfo[] = [
	{ name: "compact", source: "builtin", description: "", supported: true },
	...WORKFLOW_PROFILES.filter((p) => !blocked.has(p.name)).map((p) => ({
		name: `skill:${p.name}`,
		source: "skill" as const,
		description: p.name,
		supported: true,
	})),
	...["ars-full", "ars-reviewer"].map((name) => ({
		name,
		source: "template" as const,
		description: "",
		supported: true,
	})),
	{ name: "skill:user-local-tool", source: "skill", description: "", supported: true },
];
describe("six-direction command navigation", () => {
	it("replaces the flat managed inventory with six navigation rows while preserving unrelated user commands", () => {
		const list = menuCommands(commands, "");
		expect(list.filter((c) => c.workflowNavigation)).toHaveLength(6);
		expect(list.some((c) => c.name === "compact")).toBe(true);
		expect(list.some((c) => c.name === "skill:user-local-tool")).toBe(true);
		expect(list.some((c) => c.name === "skill:nature-writing")).toBe(false);
		expect(list.some((c) => c.name === "ars-full")).toBe(false);
	});
	it("advanced browsing and exact searches retain every original command", () => {
		expect(menuCommands(commands, "", true)).toHaveLength(commands.length);
		for (const command of commands)
			expect(menuCommands(commands, command.name).some((c) => c.name === command.name)).toBe(true);
		expect(menuCommands(commands, "nature-shared").some((c) => c.name === "skill:nature-shared")).toBe(true);
	});
	it("stage selection resolves a real native command and has no alternative for missing contracts", () => {
		const list = workflowMenuItems(commands, "writing");
		expect(list.find((c) => c.workflowStage === "writing")?.name).toBe("skill:nature-writing");
		expect(list.find((c) => c.workflowStage === "arsReview")?.name).toBe("ars-reviewer");
		const absent = workflowMenuItems([], "writing");
		expect(absent.every((c) => !c.supported)).toBe(true);
		expect(
			workflowMenuItems(
				commands.filter((c) => c.name !== "skill:nature-reviewer"),
				"writing",
			).find((c) => c.workflowStage === "blindReview")?.supported,
		).toBe(false);
	});
	it("rendered, Enter and Tab lists share the exact ordering for every view", () => {
		for (const direction of [
			null,
			"planning",
			"evidence",
			"analysis",
			"writing",
			"presentation",
			"engineering",
		] as const)
			for (const advanced of [false, true])
				for (const query of ["", "paper", "skill:anndata"])
					expect(menuCommands(commands, query, advanced, direction)).toEqual(
						groupCommands(commands, query, advanced, direction).flatMap((g) => g.items),
					);
	});
	it("does not invent directions or usable stages for an empty SDK catalog", () => {
		expect(workflowMenuItems([])).toEqual([]);
		expect(menuCommands([], "")).toEqual([]);
		expect(workflowMenuItems([], "analysis").filter((c) => c.supported)).toEqual([]);
	});
	it("all six stage views together preserve explicit contract choices, not 197 mega-prompts", () => {
		expect(WORKFLOW_STAGES.length).toBeLessThan(50);
		for (const direction of [
			"planning",
			"evidence",
			"analysis",
			"writing",
			"presentation",
			"engineering",
		] as const)
			for (const command of workflowMenuItems(commands, direction).filter((c) => c.supported))
				expect(commands.some((c) => c.name === command.name)).toBe(true);
	});
});
