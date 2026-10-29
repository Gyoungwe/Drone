import { Check } from "typebox/value";
import { type ComputeAuthorization, ComputeAuthorizationSchema } from "./compute";

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
		/** file / human_review 由宿主核对；其它种类（zotero_item / wiki_review / …）由扩展登记的验收器定义（挂钩 2） */
		kind: string;
		path?: string | null;
		sha256?: string | null;
		/** 扩展验收器声明的字段（如 doi / libraryId / collection） */
		[field: string]: string | null | undefined;
	};
	state: string;
	evidence?: {
		kind?: string;
		path?: string;
		at?: string;
		/** 扩展验收器读回的观察：state 记号 + 可选的一句话摘要 / 附注 / 动作链接（通用渲染用） */
		state?: string;
		reason?: string;
		summary?: string | null;
		note?: string | null;
		links?: {
			label: string;
			i18n?: string;
			kind: "external" | "resource" | "note" | "path";
			target: string;
		}[];
		itemId?: string;
		libraryType?: string;
		libraryId?: string;
		doi?: string;
		verifier?: string;
		attachments?: { key: string; contentType?: string; metadataOnly?: boolean }[];
		candidateId?: string;
	} | null;
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
	/** 待外部审阅的对象（由登记了 observe 的验收器识别） */
	review?: { kind: string; id: string; path?: string | null };
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
	/** Optional remote compute scope; never grants permission by itself. */
	compute?: ComputeAuthorization | null;
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
	/** Host observations copied onto the view. Absent on older snapshots. */
	progressCount?: number;
	stageStartProgress?: number;
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
				(t.compute === undefined || t.compute === null || Check(ComputeAuthorizationSchema, t.compute)) &&
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
export type TaskDecisionLang = "zh" | "en";

/** Chat card for one task. Presentation only: it never mutates the ledger. */
export interface TaskDecision {
	mode: "decision" | "line";
	title: string;
	stop: string;
	done: string;
	remaining: string;
	details: string[];
	line: string;
	canComplete: boolean;
	canDefer: boolean;
	canEnd: boolean;
	completeActionId: string | null;
	cannotComplete: string | null;
	completeLabel: string;
	deferLabel: string;
	endLabel: string;
	detailsLabel: string;
}
