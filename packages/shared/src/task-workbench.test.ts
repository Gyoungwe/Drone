import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
	TASK_REASON_TEXT,
	type TaskView,
	taskDecision,
	taskDeliveryPresentation,
	taskIsTerminal,
	taskNeedsUser,
	tasksForDecision,
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

	it("只把待验收动作投影到聊天流", () => {
		const action = {
			id: "review-1",
			kind: "review" as const,
			title: "核对报告",
			reason: "请看最终结果",
			expected: {},
			state: "pending",
		};
		const review = task({
			state: "waiting_user",
			actions: [action],
		});
		expect(tasksForTranscript(view([review]))).toEqual([review]);
		expect(
			tasksForTranscript(view([{ ...review, actions: [{ ...action, state: "acknowledged" }] }])),
		).toEqual([]);
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

describe("task decision card", () => {
	const review = {
		id: "review-1",
		kind: "review" as const,
		title: "请看一下 Zotero 读取结果",
		reason: "阶段步数用完",
		expected: {},
		milestoneId: null,
		state: "pending",
	};
	it("uses the review title and refuses to complete an unlinked review", () => {
		const decision = taskDecision(
			task({
				goal: "配置并验证 Zotero 文献读取能力",
				state: "waiting_user",
				reason: "stage-budget",
				budget: { calls: 76, stageCalls: 48 },
				progressCount: 46,
				stageStartProgress: 16,
				milestones: [
					{
						id: "done",
						title: "已读到库",
						state: "completed",
						dependsOn: [],
						acceptance: { kind: "human_review" },
					},
					{
						id: "left",
						title: "剩下的下载",
						state: "pending",
						dependsOn: [],
						acceptance: { kind: "file" },
					},
				],
				actions: [review],
				operations: [{ id: "op", tool: "read", state: "returned", at: "t" }],
			}),
		);
		expect(decision.mode).toBe("decision");
		expect(decision.title).toBe("请看一下 Zotero 读取结果");
		expect(decision.stop).toBe("停在这一段的步数上限");
		expect(decision.done).toContain("已读到库");
		expect(decision.remaining).toContain("剩下的下载");
		expect(decision.canComplete).toBe(false);
		expect(decision.canDefer).toBe(true);
		expect(decision.canEnd).toBe(true);
		expect(decision.cannotComplete).toContain("不能替你勾完成");
		expect(decision.details.join("\n")).toContain("stage-budget");
		expect(decision.details.join("\n")).toContain("read · returned");
		expect(tasksForDecision(view([task({ state: "running" })]))[0]?.id).toBe("t1");
	});
	it("offers completion only for an open human-review deliverable, then collapses", () => {
		const open = taskDecision(
			task({
				state: "waiting_user",
				actions: [{ ...review, milestoneId: "check" }],
				milestones: [
					{
						id: "check",
						title: "核对读取",
						state: "pending",
						dependsOn: [],
						acceptance: { kind: "human_review" },
					},
				],
			}),
		);
		expect(open.canComplete).toBe(true);
		expect(open.completeActionId).toBe("review-1");
		const quiet = taskDecision(task({ goal: "配置并验证 Zotero 文献读取能力", state: "partial" }));
		expect(quiet.mode).toBe("line");
		expect(quiet.line).toBe("配置并验证 Zotero 文献读取能力 · 还在做");
		expect(quiet.canDefer).toBe(false);
		expect(taskDecision(task({ goal: "配置并验证 Zotero 文献读取能力", state: "cancelled" })).line).toContain(
			"已结束",
		);
	});
	it("english copy stays on the same facts", () => {
		const decision = taskDecision(
			task({ state: "blocked", reason: "stage-budget", actions: [review] }),
			"en",
		);
		expect(decision.stop).toBe("Stopped at this stage's step limit");
		expect(decision.deferLabel).toBe("Leave it unchecked and continue");
		expect(decision.cannotComplete).toContain("cannot be marked complete");
	});
});

describe("task reason contract", () => {
	it("keeps the shared reason text aligned with the CLI workbench", async () => {
		const cliPath = resolve(process.cwd(), "../../.pi/lib/tasks/workbench.mjs");
		const cli = await import(pathToFileURL(cliPath).href);
		expect(TASK_REASON_TEXT).toEqual(cli.REASON_TEXT);
	});
});
