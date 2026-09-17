import type { TaskView, WorkbenchTask } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import { TaskRow } from "./TaskSidebar";

vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
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
	expect(html).toContain("已用调用预算");
	expect(html).toContain("原因：尚未验收");
	expect(html).toContain("通过 ask_user 推进剩余事项");
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
	expect(html).not.toContain("通过 ask_user 推进剩余事项");
});
it("running agent disables the quick-action entry", () =>
	expect(render(task, true)).toContain('disabled=""'));
