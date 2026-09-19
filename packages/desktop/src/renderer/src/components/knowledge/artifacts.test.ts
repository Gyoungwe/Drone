import type { WorkbenchTask } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { mergeKnowledgeArtifacts } from "./artifacts";

function task(path: string, state = "completed"): WorkbenchTask {
	return {
		id: "t",
		goal: "g",
		state: "partial",
		updatedAt: "now",
		reason: null,
		stage: 0,
		budget: { calls: 0, stageCalls: 0 },
		waitMs: 0,
		capabilities: [],
		actions: [],
		operations: [],
		milestones: [
			{
				id: "m",
				title: "output",
				dependsOn: [],
				acceptance: { kind: "file", path },
				state,
				evidence: state === "completed" ? { kind: "file-observed", path } : null,
			},
		],
	};
}
describe("session output list", () => {
	it("includes a file observed by the workbench even if knowledge artifacts are empty", () => {
		expect(mergeKnowledgeArtifacts([], [task("C:/repo/results/plan.md")])).toHaveLength(1);
	});
	it("does not count merely planned paths", () => {
		expect(mergeKnowledgeArtifacts([], [task("C:/repo/results/plan.md", "pending")])).toEqual([]);
	});
	it("deduplicates Windows paths and relative flow paths against the session cwd", () => {
		const flow = [
			{
				key: "a",
				kind: "artifact",
				title: "plan",
				path: "results/plan.md",
				status: "saved",
				detail: "",
				at: 1,
			},
		];
		expect(
			mergeKnowledgeArtifacts(
				flow,
				[task("C:/REPO/results/plan.md"), task("C:/repo/results/plan.md")],
				"C:/repo",
			),
		).toHaveLength(1);
	});
});
