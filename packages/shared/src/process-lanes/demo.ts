import type { TaskView } from "../task-workbench";
import type { TurnRoute } from "../turn-route";
import { initialProcessLaneState, reduceProcessEvent } from "./reducer";
import type { ProcessEvent, ProcessLaneState } from "./types";

const route = (
	utterance: string,
	primary: string | null,
	stage: string | null,
	intake: TurnRoute["intake"],
	landing: TurnRoute["landing"],
	keptCheckpoint = false,
	host: TurnRoute["host"] = null,
): TurnRoute => ({
	utterance,
	intake,
	capabilities: primary === "pydeseq2" ? ["research"] : ["knowledge", "research"],
	topics: [],
	direction: stage === "de" ? "analysis" : "evidence",
	stage,
	contract: null,
	primary,
	reason: null,
	unavailableStage: null,
	comparison: false,
	academic: false,
	keptCheckpoint,
	deferPhrase: intake === "continuation",
	visiblePrimary: Boolean(primary),
	landing,
	host,
});
const task = (
	state: TaskView["tasks"][number]["state"],
	reason: string | null,
	planApproved = false,
): TaskView => ({
	version: 2,
	revision: 1,
	activeTaskId: "demo-task",
	selectionRequired: false,
	limits: { stageCalls: 48, totalCalls: 192 },
	tasks: [
		{
			id: "demo-task",
			goal: "demo",
			state,
			updatedAt: "2026-10-04T00:00:00Z",
			reason,
			stage: 1,
			planApproved,
			authorizationRequired: !planApproved,
			budget: { calls: 2, stageCalls: 1 },
			waitMs: 0,
			capabilities: ["research"],
			milestones: [],
			actions: [],
			operations: [],
		},
	],
});
export const PROCESS_DEMO_STEPS: ProcessEvent[][] = [
	[
		{ type: "user-input", id: "u1", seq: 0, text: "检索论文：小菜蛾 DHX16 在性别决定中的证据" },
		{
			type: "turn-route",
			id: "r1",
			seq: 1,
			route: route(
				"检索论文：小菜蛾 DHX16 在性别决定中的证据",
				"nature-academic-search",
				"search",
				"new-topic",
				"workflow",
			),
		},
	],
	[
		{ type: "user-input", id: "u2", seq: 2, text: "继续。阅读归档后来源，绑定主张并写入知识库" },
		{
			type: "turn-route",
			id: "r2",
			seq: 3,
			route: route(
				"继续。阅读归档后来源，绑定主张并写入知识库",
				"research-vault",
				"vault",
				"new-topic",
				"workflow",
			),
		},
	],
	[
		{ type: "user-input", id: "u3", seq: 4, text: "对已有计数做 DHX16 的差异表达" },
		{
			type: "turn-route",
			id: "r3",
			seq: 5,
			route: route("对已有计数做 DHX16 的差异表达", "pydeseq2", "de", "new-topic", "workflow"),
		},
	],
	[{ type: "tool-receipt", id: "t4", seq: 6, name: "read", state: "done" }],
	[
		{
			type: "tool-receipt",
			id: "t5",
			seq: 7,
			name: "write",
			state: "error",
			blockedReason: "task-authorization-required",
		},
	],
	[{ type: "task-view", id: "v6", seq: 8, view: task("running", null, true), demo: true }],
	[{ type: "task-view", id: "v7", seq: 9, view: task("blocked", "reconcile-before-retry", true) }],
	[
		{ type: "user-input", id: "u8", seq: 10, text: "进度如何" },
		{
			type: "turn-route",
			id: "r8",
			seq: 11,
			route: route("进度如何", "pydeseq2", "de", "status", "host-gate", true, {
				reason: "reconcile-before-retry",
				state: "blocked",
				stageCalls: 1,
				calls: 2,
				progressCount: 1,
				stageStartProgress: 0,
				stageLimited: false,
				hasProgress: true,
				pendingReview: false,
				reviewLinked: false,
				deferredReviews: 0,
				releasedStage: false,
			}),
		},
	],
];
export function processDemoState(step: number): ProcessLaneState {
	let state = initialProcessLaneState();
	for (let i = 0; i <= step; i++)
		for (const event of PROCESS_DEMO_STEPS[i] ?? []) state = reduceProcessEvent(state, event);
	return state;
}
