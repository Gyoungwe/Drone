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
	remainingSummary?: string;
	id: string;
	goal: string;
	state: TaskState;
	updatedAt: string;
	reason: string | null;
	stage: number;
	planApproved?: boolean;
	authorizationRequired?: boolean;
	authorizationSummary?: string;
	writeRoots?: string[];
	executionConsent?: {
		version: 1;
		contractHash: string;
		approvedAt: string;
		maxCalls: number;
		maxAutoResumes: number;
	};
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
				(t.remainingSummary === undefined ||
					(typeof t.remainingSummary === "string" && t.remainingSummary.length <= 10000)) &&
				(t.authorizationSummary === undefined ||
					(typeof t.authorizationSummary === "string" && t.authorizationSummary.length <= 1200)) &&
				(t.writeRoots === undefined ||
					(Array.isArray(t.writeRoots) &&
						t.writeRoots.length <= 8 &&
						t.writeRoots.every((p) => typeof p === "string" && p.length <= 512))) &&
				(t.executionConsent === undefined ||
					(t.executionConsent?.version === 1 &&
						t.executionConsent.maxCalls === 192 &&
						t.executionConsent.maxAutoResumes === 3 &&
						typeof t.executionConsent.approvedAt === "string" &&
						/^[a-f0-9]{64}$/.test(t.executionConsent.contractHash))) &&
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
	"task-authorization-required": "方案已准备好，请一次确认本任务的范围、可写目录和完成标准。",
	"automatic-recovery": "正在按已确认的任务授权自动续作，无需重复确认阶段。",
	"automatic-stage-checkpoint": "已保存执行进展，正在原授权和总预算内继续下一阶段。",
	"total-budget": "本任务已到达总调用上限，已保留结果，不会自动扩大预算。",
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
/**
 * 一张工作台卡是否值得占用聊天流的位置。
 *
 * 流里只保留一类：等待用户决定的（授权/待选/阻塞——不点就推进不下去）。
 * 其余全部交给侧栏，包括终态——任务完成与否属于"状态"，
 * 状态该有一个常驻的地方可查，而不是在对话里再复述一遍。
 *
 * 授权卡必须留在流里：用户批准的是「当时那一份契约」，契约变化即失效，
 * 它是时间线上的审计记录，不能收进一个始终悬浮、脱离上下文的侧栏。
 */
export function taskNeedsUser(task: WorkbenchTask): boolean {
	if (task.authorizationRequired && !task.executionConsent) return true;
	if (task.state === "waiting_user" || task.state === "blocked") return true;
	return task.actions.some((a) => a.kind === "authorization" && a.state === "pending");
}

/** 终态：任务已收尾，流里留一张交代结果（partial 也算收尾，它不会再自行推进）。 */
export function taskIsTerminal(task: WorkbenchTask): boolean {
	return TERMINAL_TASK_STATES.has(task.state) || task.state === "partial";
}

/**
 * 流内应渲染的任务子集。空数组表示这条 taskView 消息整条不必上屏
 * （数据仍在 store 里，侧栏照常读取最新一份）。
 */
export function tasksForTranscript(view: TaskView): WorkbenchTask[] {
	return view.tasks.filter(taskNeedsUser);
}
