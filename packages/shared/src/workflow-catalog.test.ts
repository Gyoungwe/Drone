import { describe, expect, it } from "vitest";
import { RESEARCH_SKILL_SOURCES } from "./research-skills";
import {
	WORKFLOW_DIRECTIONS,
	WORKFLOW_PROFILES,
	WORKFLOW_STAGES,
	workflowProfile,
	resolveWorkflowStage,
} from "./workflow-catalog";
describe("reviewed six-direction catalog", () => {
	it("covers every locked skill plus exactly seven first-party skills, without deleting or renaming sources", () => {
		expect(WORKFLOW_DIRECTIONS).toHaveLength(6);
		expect(WORKFLOW_PROFILES).toHaveLength(197);
		expect(new Set(WORKFLOW_PROFILES.map((p) => p.name)).size).toBe(197);
		expect(WORKFLOW_PROFILES.filter((p) => p.source === "project")).toHaveLength(7);
		for (const source of RESEARCH_SKILL_SOURCES)
			for (const skill of source.skills) expect(workflowProfile(skill.name)?.source).toBe(source.id);
	});
	it("keeps foundations internal and classifies by actual task rather than similar names", () => {
		expect(workflowProfile("nature-shared")?.direction).toBe("internal");
		expect(workflowProfile("research-workflow")?.direction).toBe("internal");
		expect(workflowProfile("nature-data")?.direction).toBe("writing");
		expect(workflowProfile("nature-statistics")?.direction).toBe("writing");
		expect(workflowProfile("statistical-analysis")?.direction).toBe("analysis");
		expect(workflowProfile("drone-ui-plugin")?.direction).toBe("engineering");
		expect(workflowProfile("research-show-me")?.direction).toBe("presentation");
		expect(workflowProfile("user-custom-skill")).toBeUndefined();
	});
	it("never infers installed commands from the inventory or an unsupported candidate", () => {
		for (const stage of WORKFLOW_STAGES) {
			expect(resolveWorkflowStage(stage, [])).toBeUndefined();
			expect(
				resolveWorkflowStage(
					stage,
					stage.commands.map((name) => ({ name, supported: false })),
				),
			).toBeUndefined();
			expect(
				resolveWorkflowStage(
					stage,
					stage.commands.map((name) => ({ name, supported: true, source: "builtin" })),
				),
			).toBeUndefined();
			const actual = { name: stage.commands[0]!, supported: true };
			expect(resolveWorkflowStage(stage, [actual])).toBe(actual);
		}
	});
	it("preserves incompatible contracts and exact ARS commands as separate choices", () => {
		const stage = (id: string) => WORKFLOW_STAGES.find((s) => s.id === id)!;
		expect(stage("review").commands).toEqual(["skill:peer-review"]);
		expect(stage("blindReview").commands).toEqual(["skill:nature-reviewer"]);
		expect(stage("arsReview").commands).toEqual(["ars-reviewer"]);
		expect(stage("pipeline").commands).toEqual(["ars-full"]);
		expect(stage("statistics").commands).not.toContain("skill:nature-statistics");
		expect(stage("singlecell").commands).not.toContain("skill:scvi-tools");
		expect(new Set(WORKFLOW_STAGES.map((s) => s.id)).size).toBe(WORKFLOW_STAGES.length);
	});
});
