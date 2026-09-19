import type { TaskView, WorkbenchTask } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import { TaskRow } from "./TaskRow";

vi.mock("../../i18n", () => ({
	useT: () => (key: string) => key,
	useI18nStore: (selector: (s: { language: string }) => unknown) => selector({ language: "zh" }),
	translateOptional: () => null,
}));
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
