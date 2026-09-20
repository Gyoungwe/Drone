import type { SubagentPanelAgent, SubagentPanelRun } from "@drone/shared";
import { describe, expect, it } from "vitest";
import {
	buildDispatchInput,
	citeRunText,
	type DispatchFormDraft,
	type DispatchTaskDraft,
	dispatchSlotPlan,
	emptyDispatchForm,
	formNeedsProjectTrust,
	newTaskDraft,
	promptDispatchText,
	taskWithStageContract,
	validateDispatchForm,
} from "./subagents-form";

const AGENTS: SubagentPanelAgent[] = [
	{
		name: "scout",
		description: "recon",
		source: "builtin",
		tools: ["read", "grep", "webfetch"],
		mcpAccess: "read-local",
		trusted: true,
	},
	{
		name: "data-checker",
		description: "csv checks",
		source: "project",
		tools: ["read", "bash"],
		mcpAccess: "none",
		trusted: true,
		path: "/proj/.pi/agents/data-checker.md",
	},
	{
		name: "shadow",
		description: "untrusted project agent",
		source: "project",
		tools: ["read"],
		mcpAccess: "none",
		trusted: false,
	},
];

function first(form: DispatchFormDraft): DispatchTaskDraft {
	const task = form.tasks[0];
	if (!task) throw new Error("empty form");
	return task;
}

describe("派发表单校验（与后端一致，前端先拦）", () => {
	it("空表单：agent 必选；选了 agent 后任务必填", () => {
		const form = emptyDispatchForm();
		expect(validateDispatchForm(form, AGENTS).map((e) => e.code)).toEqual(["agent"]);
		const withAgent = { ...form, tasks: [{ ...first(form), agent: "scout" }] };
		expect(validateDispatchForm(withAgent, AGENTS).map((e) => e.code)).toEqual(["task"]);
	});

	it("必需工具必须落在 agent 工具集内，错误带缺失工具名", () => {
		const form = emptyDispatchForm("data-checker");
		first(form).task = "check csv";
		first(form).requiredTools = ["read", "webfetch"];
		form.trustProjectAgents = true;
		const errors = validateDispatchForm(form, AGENTS);
		expect(errors).toEqual([
			{ key: first(form).key, code: "tools", agent: "data-checker", tools: ["webfetch"] },
		]);
	});

	it("项目级定义：需要勾选信任；未信任项目的项目级定义直接不可派发", () => {
		const form = emptyDispatchForm("data-checker");
		first(form).task = "check";
		expect(validateDispatchForm(form, AGENTS).map((e) => e.code)).toEqual(["trust"]);
		expect(formNeedsProjectTrust(form, AGENTS)).toBe(true);
		form.trustProjectAgents = true;
		expect(validateDispatchForm(form, AGENTS)).toEqual([]);
		const untrusted = emptyDispatchForm("shadow");
		first(untrusted).task = "x";
		untrusted.trustProjectAgents = true;
		expect(validateDispatchForm(untrusted, AGENTS).map((e) => e.code)).toEqual(["untrusted"]);
	});

	it("多任务逐行报错，派发按钮据此置灰", () => {
		const form = emptyDispatchForm("scout");
		first(form).task = "ok";
		form.tasks.push({ ...newTaskDraft("scout"), requiredTools: ["bash"], task: "needs bash" });
		form.tasks.push(newTaskDraft());
		const errors = validateDispatchForm(form, AGENTS);
		expect(errors.map((e) => e.code)).toEqual(["tools", "agent"]);
	});
});

describe("阶段契约 / 派发输入 / 槽位 / 引用文本", () => {
	it("阶段提示把 WORKFLOW_STAGES 的 contract 追加在任务末尾（不选则原样）", () => {
		expect(taskWithStageContract("  read docs  ", "", "zh")).toBe("read docs");
		const text = taskWithStageContract("read docs", "reading", "zh");
		expect(text.startsWith("read docs\n\n[Stage contract · ")).toBe(true);
		expect(text.length).toBeGreaterThan("read docs".length + 20);
		expect(taskWithStageContract("x", "no-such-stage", "en")).toBe("x");
	});

	it("buildDispatchInput：必需工具为空时不带字段；cwd / followUp / 信任透传", () => {
		const form = emptyDispatchForm("scout");
		first(form).task = "go";
		form.followUp = false;
		const input = buildDispatchInput(form, { cwd: "/proj", language: "en" });
		expect(input).toEqual({
			tasks: [{ agent: "scout", task: "go" }],
			cwd: "/proj",
			followUp: false,
			trustProjectAgents: false,
		});
		first(form).requiredTools = ["read"];
		expect(buildDispatchInput(form, { language: "en" }).tasks[0]).toEqual({
			agent: "scout",
			task: "go",
			requiredTools: ["read"],
		});
	});

	it("运行槽：本批立即运行 / 排队数", () => {
		expect(dispatchSlotPlan(3, 1, 3)).toEqual({ now: 2, queued: 1, free: 2 });
		expect(dispatchSlotPlan(1, 3, 3)).toEqual({ now: 0, queued: 1, free: 0 });
		expect(dispatchSlotPlan(2, 0, 1)).toEqual({ now: 1, queued: 1, free: 1 });
	});

	it("引用：≤ 20 行摘要 + 子会话文件，blockquote 形式", () => {
		const run: SubagentPanelRun = {
			runId: "r",
			dispatchId: "d",
			parentSessionId: "p",
			agent: "scout",
			source: "builtin",
			task: "t",
			cwd: "/proj",
			requiredTools: [],
			followUp: true,
			status: "done",
			contextState: "delivered",
			createdAt: 1,
			content: Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n"),
			sessionFile: "/tmp/sessions-subagents/scout.jsonl",
			pendingApprovalIds: [],
		};
		const text = citeRunText(run, "scout said:");
		const lines = text.split("\n");
		expect(lines[0]).toBe("> scout said:");
		expect(lines[1]).toBe("> line 1");
		expect(lines).toContain("> …");
		expect(lines.at(-1)).toBe("> /tmp/sessions-subagents/scout.jsonl");
		expect(lines.filter((line) => line.startsWith("> line "))).toHaveLength(20);
		expect(lines.every((line) => line.startsWith("> "))).toBe(true);
	});

	it("插入到输入框：每个任务一段结构化请求，带必需工具", () => {
		const form = emptyDispatchForm("scout");
		first(form).task = "go";
		first(form).requiredTools = ["read"];
		const text = promptDispatchText(
			form,
			{ header: (agent, task) => `dispatch ${agent}: ${task}`, required: (tools) => `tools: ${tools}` },
			"en",
		);
		expect(text).toBe("dispatch scout: go\ntools: read");
	});
});
