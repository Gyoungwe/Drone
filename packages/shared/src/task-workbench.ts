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
/** Presentation only: never changes the ledger or certifies scientific claims. */
export function taskDeliveryPresentation(task: WorkbenchTask, agentActive: boolean) {
	const terminal = TERMINAL_TASK_STATES.has(task.state);
	const allAccepted = task.milestones.length > 0 && task.milestones.every((m) => m.state === "completed");
	const unsettled =
		task.operations.some((o) => o.state === "started" || o.state === "unknown") ||
		task.actions.some((a) => a.state === "pending");
	const deliveryComplete = allAccepted && !unsettled;
	const warnings = !!task.reason || task.operations.some((o) => o.state === "failed");
	const closed = task.state === "cancelled" || task.state === "archived";
	const label = closed
		? TASK_STATE_LABELS[task.state]
		: agentActive && !terminal && task.state !== "waiting_user"
			? "执行中"
			: deliveryComplete
				? warnings
					? "交付已完成 · 有提醒"
					: "交付已完成"
				: allAccepted && unsettled
					? "交付已验收 · 尚有事项待核对"
					: TASK_STATE_LABELS[task.state];
	return { label, deliveryComplete, canContinue: !terminal && !agentActive && !deliveryComplete };
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
	"task-authorization-required": "计划已经准备好，等你点头。确认一次，后面就自动做完，不再反复打扰。",
	"automatic-recovery": "刚才中断了一下，已经从上次保存的地方接着做，不用你操作。",
	"automatic-stage-checkpoint": "进展已保存，正在接着做下一部分。",
	"total-budget": "这个任务的步数已经用完，做出来的结果都保留着。想继续做，请重新描述需求开一个新任务。",
	"stage-budget": "最近一段没有做出新进展，先停下来保留结果，避免空转。",
	"budget-review-required": "这一段的步数用完了。先看看目前的结果，确认后可以继续。",
	"reconcile-before-retry":
		"上次有操作没等到结果就中断了（比如写文件、安装、上传），现在不确定它做没做成。请先点“核对已有结果”看一下实际情况，别让它盲目重做一遍。",
	"binding-changed": "知识库换了，旧任务里查到的内容不能继续用。请重新描述需求，开一个新任务。",
	"tool-failure": "中间有一步出错了。具体是哪一步、影不影响结果，看下面的记录。",
	"user-cancelled-choice-not-consent": "你取消了刚才的选择。任务停在原地等你决定，不会自作主张继续。",
	"user-action-cancelled": "你跳过了一个需要你处理的事项，任务先停着。想继续时再说一声就行。",
	"wiki-rejected-or-stale": "Wiki 修改没有通过审阅（或者来源内容变了），这一项还不算完成。",
	"verified-stage-checkpoint": "有一项交付已经确认完成，接着做下一项。",
	"session-restored": "会话已恢复，从上次保存的进度接着来。",
	"legacy-checkpoint-unreviewed": "这是从旧版本带过来的任务记录，之前做了什么还没核对过。",
	"user-cancelled": "你已取消这个任务。",
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
 * 保留任务是否需要用户处理的判定，供侧栏和会话标签等调用方复用。
 *
 * 任务状态不渲染为聊天流卡片；授权契约由宿主的 ask_user 弹窗当场征询，
 * 任务状态则由侧栏常驻展示。
 */
export function taskNeedsUser(task: WorkbenchTask): boolean {
	if (task.authorizationRequired && !task.executionConsent) return true;
	if (task.state === "waiting_user" || task.state === "blocked") return true;
	return task.actions.some((a) => a.kind === "authorization" && a.state === "pending");
}

/** 展示时视作已停下的状态；partial 的已有结果仍可在侧栏查看和恢复。 */
export function taskIsTerminal(task: WorkbenchTask): boolean {
	return TERMINAL_TASK_STATES.has(task.state) || task.state === "partial";
}

/**
 * 流内应渲染的任务子集 —— 恒为空。
 *
 * 任务的「状态」归右侧上下文面板「任务」页签，任务的「决策」归 ask_user 弹窗，
 * 聊天流只承载对话本身。保留此函数是为了让调用方继续有一个明确的语义入口，
 * 也便于日后若要放开某一类卡片时只改这一处。
 */
export function tasksForTranscript(_view: TaskView): WorkbenchTask[] {
	return [];
}
