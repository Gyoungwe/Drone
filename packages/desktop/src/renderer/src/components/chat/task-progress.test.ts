import type { TaskView, TurnRoute, WorkbenchTask } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import { TaskDecisionCard } from "./TaskDecisionCard";
import { TaskRow } from "./TaskRow";
import { TurnRouteCard } from "./TurnRouteCard";

vi.mock("../../i18n", async () => {
	const { zh } = await import("../../i18n/zh");
	const lookup = (key: string, params?: Record<string, string | number>) => {
		let node: unknown = zh;
		for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
		const template = typeof node === "string" ? node : key;
		return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`));
	};
	return {
		useT: () => lookup,
		useI18nStore: (selector: (s: { language: string }) => unknown) => selector({ language: "zh" }),
		translateOptional: () => null,
	};
});
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
const task = {
	id: "task",
	goal: "Report",
	state: "partial",
	stage: 2,
	budget: { calls: 191, stageCalls: 1 },
	milestones: [
		{ id: "a", title: "A", state: "completed", dependsOn: [], acceptance: { kind: "file" } },
		{ id: "b", title: "B", state: "pending", dependsOn: [], acceptance: { kind: "file" } },
	],
	actions: [],
	operations: [],
	remainingSummary: "剩余：B；原因：尚未验收；下一步：核对已有文件。",
} as unknown as WorkbenchTask;
const view = {
	version: 2,
	revision: 1,
	activeTaskId: "task",
	tasks: [task],
	limits: { totalCalls: 192, stageCalls: 48 },
} as TaskView;
function render(value = task, active = false) {
	return renderToStaticMarkup(
		createElement(TaskRow, { task: value, view, sessionId: "session", agentActive: active }),
	);
}
it("progress means accepted deliverables, not 191/192 spent calls", () => {
	const html = render();
	expect(html).toContain('aria-valuenow="50"');
	expect(html).toContain("已执行");
	expect(html).toContain("原因：尚未验收");
	expect(html).toContain("继续做剩下的");
});
it("no milestones does not invent a percentage", () =>
	expect(render({ ...task, milestones: [], remainingSummary: undefined })).not.toContain(
		'role="progressbar"',
	));
it("completed deliverables show full progress and no reopening button", () => {
	const html = render({
		...task,
		state: "completed",
		milestones: task.milestones.map((m) => ({ ...m, state: "completed" })),
	});
	expect(html).toContain('aria-valuenow="100"');
	expect(html).not.toContain("继续做剩下的");
});
it("running agent withholds the quick-action entry instead of offering a retry", () => {
	const html = render(task, true);
	// Withholding the entry is stronger than rendering it disabled.
	expect(html).not.toContain("继续做剩下的");
	expect(html).toContain("任务仍在执行");
});
it("extension acceptance kinds render the verifier's evidence summary through the milestone slot", () => {
	const html = render({
		...task,
		milestones: [
			{
				id: "z",
				title: "Z",
				state: "pending",
				dependsOn: [],
				acceptance: { kind: "zotero_item", doi: "10.1000/xyz" },
				evidence: { state: "missing", summary: "Zotero 中未找到", note: "先运行 /zotero-setup" },
			},
		],
	} as unknown as WorkbenchTask);
	expect(html).toContain("Zotero 中未找到");
	expect(html).toContain("先运行 /zotero-setup");
	expect(html).toContain("10.1000/xyz");
	// 核心种类没有扩展证据行
	expect(render()).not.toContain("Zotero 中未找到");
});
it("hides the side-pane continue button while a review is still pending", () => {
	const html = render({
		...task,
		actions: [
			{
				id: "review-1",
				kind: "review",
				title: "请看一下结果",
				reason: "等你",
				expected: {},
				state: "pending",
			},
		],
	} as unknown as WorkbenchTask);
	expect(html).not.toContain("继续做剩下的");
	expect(html).not.toContain("我已看过，验收");
});
it("renders the decision card from the task, and a quiet line when nothing is pending", () => {
	const pending = renderToStaticMarkup(
		createElement(TaskDecisionCard, {
			task: {
				...task,
				goal: "配置并验证 Zotero 文献读取能力",
				state: "waiting_user",
				reason: "stage-budget",
				actions: [
					{
						id: "review-1",
						kind: "review",
						title: "请看一下 Zotero 读取结果",
						reason: "等你",
						expected: {},
						milestoneId: null,
						state: "pending",
					},
				],
			} as unknown as WorkbenchTask,
			view,
			sessionId: "session",
			agentActive: false,
		}),
	);
	expect(pending).toContain("请看一下 Zotero 读取结果");
	expect(pending).toContain("停在这一段的步数上限");
	expect(pending).toContain("先不验收，继续后面的");
	expect(pending).toContain("结束这项任务");
	expect(pending).toContain("不能替你勾完成");
	expect(pending).not.toContain("我看过了，这项算完成");
	const quiet = renderToStaticMarkup(
		createElement(TaskDecisionCard, {
			task: { ...task, goal: "配置并验证 Zotero 文献读取能力", actions: [] } as unknown as WorkbenchTask,
			view,
			sessionId: "session",
			agentActive: false,
		}),
	);
	expect(quiet).toContain("配置并验证 Zotero 文献读取能力 · 还在做");
	expect(quiet).not.toContain("先不验收，继续后面的");
});

it("embeds the task decision in the route card instead of rendering a second card", () => {
	const route = {
		utterance: "继续处理当前任务",
		intake: "continuation",
		capabilities: ["coding"],
		topics: ["task"],
		direction: "coding",
		stage: "execution",
		contract: "继续当前任务",
		primary: "coding",
		reason: "沿用当前任务检查点",
		unavailableStage: null,
		comparison: false,
		academic: false,
		keptCheckpoint: true,
		deferPhrase: true,
		visiblePrimary: true,
		landing: "workflow",
		host: null,
	} as TurnRoute;
	const html = renderToStaticMarkup(
		createElement(TurnRouteCard, {
			route,
			tasks: [
				{
					...task,
					state: "waiting_user",
					actions: [
						{
							id: "review-1",
							kind: "review",
							title: "请看一下结果",
							reason: "等你",
							expected: {},
							milestoneId: null,
							state: "pending",
						},
					],
				} as unknown as WorkbenchTask,
			],
			view,
			sessionId: "session",
			agentActive: false,
		}),
	);
	expect(html).toContain('data-testid="turn-route-decisions"');
	expect(html.match(/data-testid="task-decision"/g)).toHaveLength(1);
	expect(html).toContain("请看一下结果");
});
