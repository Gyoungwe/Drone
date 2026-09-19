import { describe, expect, it } from "vitest";
import {
	activeExampleTaskMilestones,
	composeExampleTaskPrompt,
	EXAMPLE_TASK_ACCEPTANCE_KINDS,
	EXAMPLE_TASK_INPUT_KINDS,
	EXAMPLE_TASKS,
	exampleTaskCommand,
	exampleTaskDefaults,
	exampleTaskForDirection,
	missingExampleTaskInputs,
} from "./example-tasks";
import { WORKFLOW_DIRECTIONS, workflowStage } from "./workflow-catalog";

describe("built-in example tasks", () => {
	it("covers every direction exactly once with unique ids", () => {
		expect(EXAMPLE_TASKS).toHaveLength(WORKFLOW_DIRECTIONS.length);
		expect(new Set(EXAMPLE_TASKS.map((task) => task.id)).size).toBe(EXAMPLE_TASKS.length);
		for (const direction of WORKFLOW_DIRECTIONS)
			expect(EXAMPLE_TASKS.filter((task) => task.direction === direction.id)).toHaveLength(1);
	});
	it("references only catalog stages of its own direction and opens with one of the first stage's commands", () => {
		for (const task of EXAMPLE_TASKS) {
			expect(task.stages.length).toBeGreaterThan(0);
			for (const id of task.stages) {
				const stage = workflowStage(id);
				expect(stage, `${task.id}: stage ${id}`).toBeDefined();
				expect(stage?.direction).toBe(task.direction);
			}
			const first = workflowStage(task.stages[0] ?? "");
			const command = exampleTaskCommand(task);
			expect(command.startsWith("skill:")).toBe(true);
			expect(first?.commands).toContain(command);
		}
	});
	it("uses known acceptance and input kinds, three milestones each, and leaves required inputs empty", () => {
		for (const task of EXAMPLE_TASKS) {
			expect(task.milestones).toHaveLength(3);
			for (const milestone of task.milestones)
				expect(EXAMPLE_TASK_ACCEPTANCE_KINDS).toContain(milestone.acceptance.kind);
			for (const input of task.inputs) {
				expect(EXAMPLE_TASK_INPUT_KINDS).toContain(input.kind);
				if (input.required) expect(input.defaultValue).toBeUndefined();
				if (input.kind === "select") {
					expect(input.options?.length).toBeGreaterThan(1);
					if (input.defaultValue)
						expect(input.options?.some((option) => option.value === input.defaultValue)).toBe(true);
				}
			}
			expect(task.inputs.some((input) => input.required)).toBe(true);
			expect(task.authorizations).toContain("task");
			expect(task.contractNotes?.zh).toBeTruthy();
			expect(task.contractNotes?.en).toBeTruthy();
			const defaults = exampleTaskDefaults(task);
			for (const input of task.inputs) if (input.required) expect(defaults[input.key]).toBe("");
			expect(missingExampleTaskInputs(task, defaults)).toEqual(
				task.inputs.filter((input) => input.required).map((input) => input.key),
			);
		}
	});
	it("conditional milestones follow their input while every milestone refers to an existing input", () => {
		const evidence = exampleTaskForDirection("evidence");
		expect(evidence).toBeDefined();
		if (!evidence) return;
		const defaults = exampleTaskDefaults(evidence);
		expect(activeExampleTaskMilestones(evidence, defaults)).toHaveLength(2);
		expect(activeExampleTaskMilestones(evidence, { ...defaults, zotero: "yes" })).toHaveLength(3);
		for (const task of EXAMPLE_TASKS)
			for (const milestone of task.milestones)
				if (milestone.when)
					expect(task.inputs.some((input) => input.key === milestone.when?.input)).toBe(true);
	});
});

describe("composeExampleTaskPrompt", () => {
	const planning = exampleTaskForDirection("planning");
	it("opens with `/skill:name <header>` on one line so the SDK reads the real skill name", () => {
		if (!planning) throw new Error("planning example missing");
		const prompt = composeExampleTaskPrompt(planning, { question: "睡眠剥夺是否影响工作记忆？" }, "zh");
		const [first = ""] = prompt.split("\n");
		expect(first.startsWith("/skill:hypothesis-generation 【示例任务 · 研究规划与设计 · ")).toBe(true);
		const spaceIndex = first.indexOf(" ");
		expect(first.slice(7, spaceIndex)).toBe("hypothesis-generation");
	});
	it("lists goal, inputs (missing ones marked), the task_plan request, numbered milestones and the boundary", () => {
		if (!planning) throw new Error("planning example missing");
		const prompt = composeExampleTaskPrompt(planning, { question: "Q1" }, "zh");
		expect(prompt).toContain("目标：");
		expect(prompt).toContain("输入：研究问题=Q1；背景材料路径=（未提供）");
		expect(prompt).toContain("请先用 task_plan 建立任务并等待我的授权，再开始执行：");
		expect(prompt).toContain("  1. 问题澄清与边界（验收：human_review）");
		expect(prompt).toContain("  2. 竞争假设与判别证据清单 → hypotheses.md（验收：file）");
		expect(prompt).toContain("  3. 实验设计草案 → design.md（验收：file）");
		expect(prompt).toContain("边界：不声称已完成任何实验；阶段契约：Question, rival hypotheses");
	});
	it("is deterministic, bilingual and renders select values by label", () => {
		const presentation = exampleTaskForDirection("presentation");
		if (!presentation) throw new Error("presentation example missing");
		const values = { results: "C:/data/results.csv", format: "pdf" };
		const en = composeExampleTaskPrompt(presentation, values, "en");
		expect(en).toBe(composeExampleTaskPrompt(presentation, values, "en"));
		expect(
			en.startsWith("/skill:scientific-visualization [Example task · Visualization and delivery · "),
		).toBe(true);
		expect(en).toContain("Inputs: Results / data file=C:/data/results.csv; Target format=pdf");
		expect(en).toContain("Please create the task with task_plan first");
		expect(en).toContain("  3. Delivery check (acceptance: human_review)");
		expect(en).toContain("Boundary: AI diagrams are not data plots; stage contract: ");
	});
	it("drops the optional Zotero milestone unless the user asked for it", () => {
		const evidence = exampleTaskForDirection("evidence");
		if (!evidence) throw new Error("evidence example missing");
		const base = { topic: "gut microbiome", years: "", zotero: "no" };
		expect(composeExampleTaskPrompt(evidence, base, "zh")).not.toContain("zotero_item");
		expect(composeExampleTaskPrompt(evidence, { ...base, zotero: "yes" }, "zh")).toContain(
			"（验收：zotero_item）",
		);
	});
	it("never mentions a path the user did not type", () => {
		for (const task of EXAMPLE_TASKS) {
			const prompt = composeExampleTaskPrompt(task, exampleTaskDefaults(task), "zh");
			expect(prompt).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//);
		}
	});
});
