export type TaskState =
	| "pending"
	| "running"
	| "waiting_user"
	| "blocked"
	| "partial"
	| "completed"
	| "cancelled";
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
};
