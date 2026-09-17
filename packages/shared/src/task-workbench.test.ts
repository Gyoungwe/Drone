import { describe, expect, it } from "vitest";
import {
	type TaskView,
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

	it("终态但仍等用户拍板时照样上屏（blocked 未收尾，不能被终态规则吞掉）", () => {
		const blocked = task({ state: "blocked" });
		expect(tasksForTranscript(view([blocked]))).toHaveLength(1);
	});

	it("混合场景只挑出该上屏的那些", () => {
		const shown = tasksForTranscript(
			view([
				task({ id: "running", state: "running" }),
				task({ id: "needs", state: "waiting_user" }),
				task({ id: "done", state: "completed" }),
			]),
		);
		expect(shown.map((t) => t.id)).toEqual(["needs"]);
	});
});
