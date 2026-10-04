import { createTaskWorkbench, LIMITS } from "@drone/tasks/workbench";
import { expect, it } from "vitest";

function setup() {
	const j = createTaskWorkbench({ requireAuthorization: true, persist: () => undefined });
	j.attach("session-a");
	j.begin("配置并验证 Zotero 文献读取能力");
	j.plan({
		summary: "核对已有读取结果，不安装软件。",
		milestones: [{ id: "report", title: "读取结果", acceptance: { kind: "file", path: "report.csv" } }],
	});
	j.command({ taskId: j.snapshot().id, revision: j.view().revision, action: "authorize-task" });
	return j;
}
async function read(j, id) {
	const event = { toolName: "read", toolCallId: id, input: { path: `${id}.txt` } };
	expect(j.guard(event)).toBeNull();
	await j.observe({ ...event, content: [{ type: "text", text: "fixture" }] });
}
function review(j, milestoneId) {
	return j.wait({
		kind: "review",
		title: "请看一下 Zotero 读取结果",
		reason: "阶段步数用完",
		...(milestoneId ? { milestoneId } : {}),
	});
}
async function fillStage(j) {
	for (let i = 0; i < LIMITS.stageCalls; i++) await read(j, `read-${i}`);
}

it("继续做完 drops an unlinked review and releases the stage when there was progress", async () => {
	const j = setup();
	await fillStage(j);
	review(j);
	expect(j.snapshot().budget.stageCalls).toBe(48);
	expect(j.snapshot().actions.some((action) => action.state === "pending")).toBe(true);
	j.begin("继续做完");
	const task = j.snapshot();
	expect(task.actions.some((action) => action.kind === "review" && action.state === "pending")).toBe(false);
	expect(task.actions.find((action) => action.kind === "review").state).toBe("cancelled");
	expect(task.milestones.every((milestone) => milestone.state !== "completed")).toBe(true);
	expect(task.budget.stageCalls).toBe(0);
	expect(task.reason).toBe("automatic-stage-checkpoint");
	expect(task.lastDefer).toMatchObject({ reviews: 1, releasedStage: true });
});

it("a status question leaves the review and the stage limit in place", async () => {
	const j = setup();
	await fillStage(j);
	review(j);
	j.begin("进度如何");
	const task = j.snapshot();
	expect(task.actions.some((action) => action.kind === "review" && action.state === "pending")).toBe(true);
	expect(task.budget.stageCalls).toBe(48);
	expect(task.lastDefer).toBeNull();
});

it("a new topic does not dismiss the review", async () => {
	const j = setup();
	await fillStage(j);
	review(j);
	j.begin("检索灰飞虱性别决定论文");
	expect(j.snapshot().actions.some((action) => action.state === "pending")).toBe(true);
	expect(j.snapshot().budget.stageCalls).toBe(48);
});

it("does not release the stage when the stage made no new progress", async () => {
	const j = setup();
	for (let i = 0; i < LIMITS.stageCalls; i++)
		expect(j.guard({ toolName: "set_status", toolCallId: `status-${i}`, input: {} })).toBeNull();
	review(j);
	j.begin("继续");
	const task = j.snapshot();
	expect(task.actions.some((action) => action.state === "pending")).toBe(false);
	expect(task.milestones.every((milestone) => milestone.state !== "completed")).toBe(true);
	expect(task.budget.stageCalls).toBe(48);
	expect(task.lastDefer.releasedStage).toBe(false);
});

it("acknowledging a linked human review still completes that deliverable", () => {
	const j = createTaskWorkbench({ requireAuthorization: true, persist: () => undefined });
	j.attach("session-a");
	j.begin("核对读取");
	j.plan({
		summary: "等你看一眼读取结果。",
		milestones: [{ id: "read-check", title: "核对读取", acceptance: { kind: "human_review" } }],
	});
	j.command({ taskId: j.snapshot().id, revision: j.view().revision, action: "authorize-task" });
	const action = review(j, "read-check");
	j.command({
		taskId: j.snapshot().id,
		revision: j.view().revision,
		action: "acknowledge",
		actionId: action.id,
	});
	expect(j.snapshot().milestones.find((milestone) => milestone.id === "read-check").state).toBe("completed");
});
