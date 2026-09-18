import { describe, expect, it } from "vitest";
import {
	type TaskView,
	taskDeliveryPresentation,
	taskIsTerminal,
	taskNeedsUser,
	tasksForTranscript,
	type WorkbenchTask,
} from "./task-workbench";

function task(over: Partial<WorkbenchTask> = {}): WorkbenchTask {
	return {
		id: "t1",
		goal: "g",
		state: "running",
		updatedAt: "2026-01-01",
		reason: null,
		stage: 1,
		budget: { calls: 1, stageCalls: 1 },
		waitMs: 0,
		capabilities: [],
		milestones: [],
		actions: [],
		operations: [],
		...over,
	};
}

function view(tasks: WorkbenchTask[]): TaskView {
	return {
		version: 2,
		revision: 1,
		activeTaskId: tasks[0]?.id ?? null,
		selectionRequired: false,
		tasks,
		limits: { stageCalls: 40, totalCalls: 192 },
	};
}

describe("delivery presentation", () => {
	const accepted = [
		{ id: "m", title: "output", dependsOn: [], acceptance: { kind: "file" as const }, state: "completed" },
	];
	it("shows completed delivery with a historical warning, without resume", () => {
		const value = taskDeliveryPresentation(
			task({ state: "partial", reason: "tool-failure", milestones: accepted }),
			false,
		);
		expect(value).toMatchObject({ label: "交付已完成 · 有提醒", canContinue: false });
	});
	it("does not offer continuation while the agent is running", () => {
		expect(taskDeliveryPresentation(task({ state: "partial" }), true)).toMatchObject({
			label: "执行中",
			canContinue: false,
		});
	});
	it("does not infer completion from zero milestones", () => {
		expect(taskDeliveryPresentation(task({ state: "partial" }), false).canContinue).toBe(true);
	});
	it("keeps unknown operations visible even when every milestone passed", () => {
		const value = taskDeliveryPresentation(
			task({
				state: "partial",
				milestones: accepted,
				operations: [{ id: "o", tool: "write", state: "unknown", at: "now" }],
			}),
			false,
		);
		expect(value.deliveryComplete).toBe(false);
		expect(value.label).toContain("待核对");
	});
	it("preserves cancelled and archived states", () => {
		for (const state of ["cancelled", "archived"] as const)
			expect(taskDeliveryPresentation(task({ state, milestones: accepted }), false).canContinue).toBe(false);
	});
});

describe("流内工作台卡的取舍", () => {
	it("纯进度任务不进流：一个任务跑一趟会刷出十几份 revision，全渲染就是刷屏", () => {
		expect(tasksForTranscript(view([task({ state: "running", stage: 3 })]))).toEqual([]);
		expect(tasksForTranscript(view([task({ state: "pending" })]))).toEqual([]);
	});

	it("等用户拍板的必须进流", () => {
		expect(taskNeedsUser(task({ authorizationRequired: true }))).toBe(true);
		expect(taskNeedsUser(task({ state: "waiting_user" }))).toBe(true);
		expect(taskNeedsUser(task({ state: "blocked" }))).toBe(true);
	});

	it("已授权后不再因 authorizationRequired 反复上屏", () => {
		const approved = task({
			authorizationRequired: true,
			executionConsent: {
				version: 1,
				contractHash: "h",
				approvedAt: "2026-01-01",
				maxCalls: 192,
				maxAutoResumes: 3,
			},
		});
		expect(taskNeedsUser(approved)).toBe(false);
		expect(tasksForTranscript(view([approved]))).toEqual([]);
	});

	it("待处理的授权动作会把卡留在流里", () => {
		const withAction = task({
			actions: [
				{
					id: "a1",
					kind: "authorization",
					title: "t",
					reason: "r",
					expected: {},
					state: "pending",
				},
			],
		});
		expect(taskNeedsUser(withAction)).toBe(true);
		// 已处理完的动作不应再占位
		const done = task({
			actions: [{ id: "a1", kind: "authorization", title: "t", reason: "r", expected: {}, state: "done" }],
		});
		expect(taskNeedsUser(done)).toBe(false);
	});

	it("终态不再占用流：完成与否属于状态，侧栏常驻可查", () => {
		for (const state of ["completed", "cancelled", "archived", "partial"] as const) {
			expect(taskIsTerminal(task({ state }))).toBe(true);
			expect(tasksForTranscript(view([task({ state })]))).toEqual([]);
		}
	});

	it("等用户拍板的也不进流：决策走 ask_user 弹窗，不靠一张要自己去找的卡", () => {
		expect(tasksForTranscript(view([task({ state: "blocked" })]))).toEqual([]);
		expect(tasksForTranscript(view([task({ state: "waiting_user" })]))).toEqual([]);
		expect(
			tasksForTranscript(view([task({ authorizationRequired: true, executionConsent: undefined })])),
		).toEqual([]);
	});

	it("任何组合下聊天流都不出任务卡", () => {
		const shown = tasksForTranscript(
			view([
				task({ id: "running", state: "running" }),
				task({ id: "needs", state: "waiting_user" }),
				task({ id: "done", state: "completed" }),
			]),
		);
		expect(shown).toEqual([]);
	});
});
