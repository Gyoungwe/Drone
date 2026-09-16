export type TaskState =
	| "pending"
	| "running"
	| "waiting_user"
	| "blocked"
	| "partial"
	| "completed"
	| "cancelled"
	| "archived";
export interface TaskArtifact {
	path: string;
	bytes: number;
	sha256: string;
	identity?: string;
	observedAt?: string;
}
export interface TaskMilestone {
	id: string;
	title: string;
	dependsOn: string[];
	acceptance: {
		kind: "file" | "human_review" | "wiki_review" | "zotero_item";
		path?: string;
		doi?: string;
		libraryId?: string;
		collection?: string;
	};
	state: string;
	evidence?: { kind?: string; path?: string; at?: string } | null;
}
export interface TaskUserAction {
	id: string;
	kind: "file" | "download" | "authorization" | "review";
	title: string;
	reason: string;
	url?: string | null;
	expected: { doi?: string; title?: string };
	milestoneId?: string | null;
	state: string;
	file?: TaskArtifact | null;
}
export interface TaskOperation {
	id: string;
	tool: string;
	state: string;
	at: string;
	checkedAt?: string;
	candidateId?: string;
	verifier?: string;
	artifact?: TaskArtifact;
}
export interface WorkbenchTask {
	id: string;
	goal: string;
	state: TaskState;
	updatedAt: string;
	reason: string | null;
	stage: number;
	planApproved?: boolean;
	archivedFrom?: TaskState;
	archivedAt?: string;
	budget: { calls: number; stageCalls: number };
	waitMs: number;
	capabilities: string[];
	milestones: TaskMilestone[];
	actions: TaskUserAction[];
	operations: TaskOperation[];
}
export interface TaskView {
	version: 2;
	revision: number;
	activeTaskId: string | null;
	selectionRequired: boolean;
	tasks: WorkbenchTask[];
	limits: { stageCalls: number; totalCalls: number };
}
const states = new Set([
	"pending",
	"running",
	"waiting_user",
	"blocked",
	"partial",
	"completed",
	"cancelled",
	"archived",
]);
/** Presentation-only whitelist; it never authorizes a mutation or certifies a conclusion. */
export function decodeTaskView(value: unknown): TaskView | undefined {
	if (!value || typeof value !== "object") return;
	const v = value as TaskView;
	if (
		v.version !== 2 ||
		!Number.isSafeInteger(v.revision) ||
		v.revision < 0 ||
		!Array.isArray(v.tasks) ||
		v.tasks.length > 12 ||
		!v.limits ||
		JSON.stringify(v).length > 220000
	)
		return;
	if (
		!v.tasks.every(
			(t) =>
				t &&
				typeof t.id === "string" &&
				t.id.length <= 100 &&
				typeof t.goal === "string" &&
				t.goal.length <= 180 &&
				states.has(t.state) &&
				!!t.budget &&
				Number.isFinite(t.budget.calls) &&
				Array.isArray(t.milestones) &&
				t.milestones.length <= 24 &&
				t.milestones.every(
					(m) =>
						m &&
						typeof m.id === "string" &&
						typeof m.title === "string" &&
						Array.isArray(m.dependsOn) &&
						m.acceptance &&
						typeof m.acceptance.kind === "string",
				) &&
				Array.isArray(t.actions) &&
				t.actions.length <= 64 &&
				t.actions.every(
					(a) =>
						a &&
						typeof a.id === "string" &&
						typeof a.title === "string" &&
						!!a.expected &&
						(!a.url || /^https?:\/\//i.test(a.url)),
				) &&
				Array.isArray(t.operations) &&
				t.operations.length <= 64 &&
				t.operations.every((o) => o && typeof o.id === "string" && typeof o.tool === "string"),
		)
	)
		return;
	return v;
}
export function taskActionCommand(
	view: TaskView,
	taskId: string,
	action: string,
	extra: Record<string, string> = {},
): string {
	const text = JSON.stringify({ ...extra, taskId, revision: view.revision, action });
	if (text.length > 4000) throw new Error("Task action is too large");
	const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(text)))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
	return `/task-action ${encoded}`;
}
export const TASK_STATE_LABELS: Record<TaskState, string> = {
	pending: "待开始",
	running: "执行中",
	waiting_user: "等待你",
	blocked: "受阻",
	partial: "部分完成",
	completed: "记录的验收已满足",
	cancelled: "已取消",
	archived: "已归档",
};
/** Human-readable explanation with a next step for host reason codes; unknown codes fall back to the code. Mirrors `.pi/lib/tasks/workbench.mjs` REASON_TEXT. */
export const TASK_REASON_TEXT: Record<string, string> = {
	"stage-budget": "本阶段的工具调用次数已用完，已暂停并保留进度。点“确认下一阶段预算”可继续。",
	"budget-review-required": "工具调用预算已用完。请查看当前结果；确认后可开启下一阶段。",
	"reconcile-before-retry":
		"有操作在上次运行中没有得到结果（例如写入、安装、上传）。请先点“只读核对产物”确认实际情况，避免重复执行。",
	"binding-changed": "知识库绑定已更改，旧任务的证据和权限不能沿用。请重新描述需求以开始新任务。",
	"tool-failure": "上一步工具调用失败，任务保留为部分完成。可以直接继续，或查看下方记录了解原因。",
	"user-cancelled-choice-not-consent": "你取消了一个选择。任务在等待你的决定，不会按默认选项继续。",
	"user-action-cancelled": "你跳过了一个需要人工处理的事项，任务暂停。需要时可重新描述需求。",
	"wiki-rejected-or-stale": "Wiki 候选被拒绝或来源已变化，相关验收条件未满足。",
	"verified-stage-checkpoint": "已核实一个验收条件，进入下一阶段。",
	"session-restored": "会话已恢复，进度从上次保存点继续。",
	"legacy-checkpoint-unreviewed": "这是旧版本记录导入的任务，历史操作尚未复核。",
	"user-cancelled": "任务已由你取消。",
	"user-archived": "任务已归档。",
};
export function explainTaskReason(code: string | null | undefined): string | null {
	return code ? TASK_REASON_TEXT[code] || code : null;
}
/** Task states with no further agent continuation; the UI hides resume/stage/cancel for them. */
export const TERMINAL_TASK_STATES: ReadonlySet<TaskState> = new Set(["completed", "cancelled", "archived"]);
/** Archiving requires an explicitly closed or paused task with nothing pending; mirrors the host ledger rule. */
export function canArchiveTask(task: WorkbenchTask): boolean {
	return (
		["completed", "cancelled", "partial", "blocked"].includes(task.state) &&
		!task.operations.some((o) => o.state === "started" || o.state === "unknown") &&
		!task.actions.some((a) => a.state === "pending")
	);
}
