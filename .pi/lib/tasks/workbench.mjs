import { createHash, randomUUID } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { contractHash, hasTaskConsent, MAX_AUTO_RESUMES } from "./consent.mjs";
import { failureObservation, failureReceipt, toolResultFailed } from "./failure-feedback.mjs";
import { readPdfIdentity } from "./pdf-identity.mjs";

export const WORKBENCH_ENTRY = "drone-task-workbench-v2";
export const LIMITS = Object.freeze({
	tasks: 12,
	operations: 64,
	milestones: 24,
	actions: 16,
	stageCalls: 48,
	totalCalls: 192,
	retries: 2,
	fileBytes: 8 * 1024 * 1024,
});
export const clean = (value, max = 180) =>
	String(value ?? "")
		.replace(/(?:bearer\s+|(?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, "[redacted]")
		.split("")
		.map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || "<>".includes(c) ? " " : c))
		.join("")
		.slice(0, max);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => structuredClone(value);
const continuation = (text) =>
	/^(?:also\b|and\b|补充)/i.test(String(text).trim()) ||
	/^(?:继续(?:吧|执行|处理|完成|上一任务)?|接着(?:做|处理)?|下好了|下载好了|我下载了(?:，?手动的那几篇)?|continue|resume|done)[\s,.!？，。！?]*$/i.test(
		String(text).trim(),
	);
const controls = new Set([
	"set_status",
	"todo",
	"capability_load",
	"task_status",
	"task_plan",
	"task_wait",
	"task_reconcile",
	"task_evidence_restore",
]);
const readOnly = (name) =>
	/^(?:read|grep|find|ls|webfetch|websearch)$/.test(name) ||
	/^research_(?:read_|search_|check_answer$|wiki_navigate$|knowledge_status$|zotero_status$|restore_evidence$|wiki_review_status$|list_wiki)/.test(
		name,
	);
const terminal = (state) => ["completed", "cancelled", "archived"].includes(state);
const sameArtifactPath = (cwd, declared, observed) => {
 const normalize = path => {
  const absolute=resolve(cwd || process.cwd(),path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
 };
 return typeof declared === "string" && typeof observed === "string" && normalize(declared) === normalize(observed);
};
/** User-facing explanation and next step for each machine reason code. Codes stay stable for tests/UI. */
export const REASON_TEXT = Object.freeze({
	"task-authorization-required": "方案已准备好。请一次确认本任务的范围、可写目录和完成标准，之后自动推进。",
	"automatic-recovery": "已按本任务授权从检查点自动继续，无需再次确认阶段。",
	"automatic-stage-checkpoint": "已保存执行进展，正在原授权和总预算内继续下一阶段。",
	"total-budget": "已到达本任务总调用上限，现有结果已保留。不会自动扩大预算或反复要求确认。",
	"stage-budget": "阶段暂未取得足够新进展，已保留结果。已授权任务不会重复要求确认阶段预算。",
	"budget-review-required": "工具调用预算已用完。请查看当前结果；确认后可在任务面板开启下一阶段。",
	"reconcile-before-retry":
		"有操作在上次运行中没有得到结果（例如写入、安装、上传）。请先点“只读核对产物”确认实际情况，避免重复执行。",
	"binding-changed": "知识库绑定已更改，旧任务的证据和权限不能沿用。请重新描述需求以开始新任务。",
	"tool-failure": "任务中有失败记录；是否影响结果、是否需要重试，应结合具体错误和后续证据判断。",
	"user-cancelled-choice-not-consent": "你取消了一个选择。任务在等待你的决定，不会按默认选项继续。",
	"user-action-cancelled": "你跳过了一个需要人工处理的事项，任务暂停。需要时可重新描述需求。",
	"wiki-rejected-or-stale": "Wiki 候选被拒绝或来源已变化，相关验收条件未满足。",
	"verified-stage-checkpoint": "已核实一个验收条件，进入下一阶段。",
	"session-restored": "会话已恢复，进度从上次保存点继续。",
	"legacy-checkpoint-unreviewed": "这是旧版本记录导入的任务，历史操作尚未复核。",
	"user-cancelled": "任务已由你取消。",
	"user-archived": "任务已归档。",
});
export const explainReason = (code) => (code ? REASON_TEXT[code] || code : null);
const error = (code, message) => Object.assign(new Error(message), { code });
const stable = (value) =>
	JSON.stringify(value, (_key, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
			: v,
	);

/** Explicit workspace file only. No glob/recursive scan; no contents in the durable ledger. */
export async function inspectTaskFile(cwd, input, expected = {}) {
	const base = await realpath(cwd),
		path = await realpath(resolve(cwd, input));
	const rel = relative(base, path);
	if (
		!rel ||
		isAbsolute(rel) ||
		rel === ".." ||
		rel.startsWith(`..${sep}`) ||
		rel
			.split(sep)
			.some((p) => p.startsWith(".") || /^(?:auth|credentials|secrets?|tokens?|password)(?:\.|$)/i.test(p))
	)
		throw error("file-scope", "Choose an explicit non-private file within this task workspace.");
	const stat = await lstat(path);
	if (!stat.isFile() || stat.size > LIMITS.fileBytes)
		throw error(
			"file-limit",
			"Expected a regular file of at most 8 MiB; larger files need a dedicated read-only adapter.",
		);
	const file = await open(path, "r");
	try {
		const opened = await file.stat();
		if (
			(await realpath(path)) !== path ||
			opened.ino !== stat.ino ||
			opened.dev !== stat.dev ||
			opened.size > LIMITS.fileBytes
		)
			throw error("file-changed", "File scope/version changed before inspection.");
		const bytes = await file.readFile();
		if (bytes.length > LIMITS.fileBytes)
			throw error("file-limit", "File changed beyond the inspection limit.");
		const identity = {
			path: rel.split(sep).join("/"),
			bytes: bytes.length,
			sha256: hash(bytes),
			observedAt: new Date().toISOString(),
			kind: "file",
			identity: "not-requested",
		};
		if (expected.kind === "pdf") {
			if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
				throw error("not-pdf", "Not a PDF: HTML landing pages and renamed downloads are not accepted.");
			identity.kind = "pdf";
			if (expected.doi || expected.title) {
				const found = await readPdfIdentity(bytes);
				const normalize = (value) =>
					String(value || "")
						.toLowerCase()
						.replace(/[^a-z0-9\u3400-\u9fff]/g, "");
				const doi = String(expected.doi || "")
					.toLowerCase()
					.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
				const title = normalize(expected.title);
				const titleMatch = title.length >= 12 && normalize(found.text).includes(title);
				const doiMatch = !!doi && found.text.toLowerCase().includes(doi);
				if ((doi && !doiMatch) || (title.length >= 12 && !titleMatch))
					throw error(
						"identity-mismatch",
						"Selected PDF does not match the requested title/DOI in the inspected first pages. Choose the correct file or explicitly revise the request; original unchanged.",
					);
				identity.identity = doiMatch && titleMatch ? "metadata-matched" : "needs-review";
				identity.extraction = { pages: found.pages, partial: found.partial };
			}
			// Hash matching is authoritative file identity. Plain-byte DOI occurrence is not:
			// compressed/encrypted PDFs require an extractor or explicit human review.
			identity.identity = expected.sha256
				? identity.sha256 === expected.sha256
					? "hash-matched"
					: "mismatch"
				: identity.identity === "metadata-matched"
					? "metadata-matched"
					: "needs-review";
			if (identity.identity === "mismatch")
				throw error(
					"identity-mismatch",
					"File hash does not match the requested artifact; original file was not changed.",
				);
		}
		if (expected.sha256 && expected.kind !== "pdf" && identity.sha256 !== expected.sha256)
			throw error("artifact-changed", "File version differs from the expected hash.");
		return identity;
	} finally {
		await file.close();
	}
}

/** SDK branch entries are the durable authority, never model-authored status strings. */
export function createTaskWorkbench({
	persist = () => {},
	now = () => new Date().toISOString(),
	inspect = inspectTaskFile,
	getWikiStatus = async () => null,
	getZoteroStatus = async () => ({ state: "unavailable" }),
	onCheckpoint = () => {},
	requireAuthorization = false,
} = {}) {
	let book = {
			version: 2,
			scope: null,
			revision: 0,
			activeTaskId: null,
			selectionRequired: false,
			tasks: [],
		},
		requested = false,
		pinned = false;
	const active = () => book.tasks.find((t) => t.id === book.activeTaskId) || null;
	const save = () => {
		book.revision++;
		const t = active();
		if (t) t.updatedAt = now();
		persist(clone(book));
	};
	function attach(scope, entries = [], force = false) {
		if (book.scope === scope && !force) return;
		book = { version: 2, scope, revision: 0, activeTaskId: null, selectionRequired: false, tasks: [] };
		requested = false;
		pinned = false;
		for (const entry of entries) {
			const data = entry.data;
			if (
				entry.customType !== WORKBENCH_ENTRY ||
				data?.version !== 2 ||
				data.scope !== scope ||
				!Array.isArray(data.tasks) ||
				data.tasks.length > LIMITS.tasks ||
				JSON.stringify(data).length > 220000
			)
				continue;
			if (
				!data.tasks.every(
					(t) =>
						typeof t?.id === "string" &&
						typeof t.goal === "string" &&
						Array.isArray(t.operations) &&
						t.operations.length <= LIMITS.operations &&
						Array.isArray(t.milestones) &&
						Array.isArray(t.actions) &&
						t.budget &&
						Array.isArray(t.receipts),
				)
			)
				continue;
			book = clone(data);
		}
		// v0.7.8 records remain intact. Import observations as unreviewed legacy history only.
		if (!book.tasks.length) {
			const legacy = [...entries]
				.reverse()
				.find(
					(e) =>
						e.customType === "drone-task-checkpoint-v1" &&
						e.data?.scope === scope &&
						typeof e.data?.goal === "string",
				);
			if (legacy) {
				const t = make(legacy.data.goal);
				t.state = "partial";
				t.reason = "legacy-checkpoint-unreviewed";
				t.receipts = (legacy.data.receipts || [])
					.slice(-24)
					.filter((r) => r && typeof r.tool === "string")
					.map((r) => ({
						id: clean(r.id),
						tool: clean(r.tool),
						state: "legacy-unreviewed",
						at: clean(r.at),
					}));
				book.tasks.push(t);
				book.activeTaskId = t.id;
			}
		}
		for (const t of book.tasks) {
			for (const op of t.operations)
				if (op.state === "started") {
					op.state = "unknown";
					t.state = "blocked";
					t.reason = "reconcile-before-retry";
				}
			if (t.state === "running") {
				t.state = "partial";
				t.reason = "session-restored";
			}
			if (t.waitStartedAt) {
				t.waitMs += Math.max(0, Date.parse(now()) - Date.parse(t.waitStartedAt));
				t.waitStartedAt = now();
			}
		}
	}
	function make(goal) {
		return {
			id: randomUUID(),
			goal: clean(goal),
			state: "pending",
			createdAt: now(),
			updatedAt: now(),
			reason: null,
			stage: 1,
			stageProgress: 0,
			authorizationRequired: requireAuthorization,
			progressCount: 0,
			stageStartProgress: 0,
			progressKeys: [],
			pendingObservations: [],
			budget: { calls: 0, stageCalls: 0, recoveries: 0, bytes: 0, autoResumes: 0 },
			milestones: [],
			actions: [],
			operations: [],
			receipts: [],
			capabilities: [],
			waitMs: 0,
			waitStartedAt: null,
		};
	}
	function requireTask() {
		const t = active();
		if (!t || book.selectionRequired) throw error("task-selection-required", "Select a task first.");
		return t;
	}
	function begin(query, capabilities = [], binding = null) {
		const eligible = book.tasks.filter((t) => !terminal(t.state));
		if (continuation(query)) {
			if (eligible.length > 1 && !pinned) {
				book.selectionRequired = true;
				save();
				return { selectionRequired: true };
			}
			if (!active() && eligible.length === 1) book.activeTaskId = eligible[0].id;
		} else {
			const t = make(query);
			if (book.tasks.length >= LIMITS.tasks) {
				// Archived tasks are already exported/closed; drop the oldest one to make room, never an open task.
				const archived = book.tasks.filter((x) => x.state === "archived");
				if (archived.length) book.tasks.splice(book.tasks.indexOf(archived[0]), 1);
			}
			if (book.tasks.length >= LIMITS.tasks)
				throw error(
					"task-capacity",
					"Task history is full. Archive a finished task from the task panel (export first if needed); no open task is silently discarded.",
				);
			if (active()?.state === "running") active().state = "partial";
			book.tasks.push(t);
			book.activeTaskId = t.id;
			pinned = false;
		}
		if (!active()) {
			const t = make(query);
			book.tasks.push(t);
			book.activeTaskId = t.id;
		}
		const t = requireTask();
		if (t.binding === undefined) t.binding = binding;
		if (t.binding !== binding) {
			t.state = "blocked";
			t.reason = "binding-changed";
			save();
			return { blocked: true };
		}
		if (terminal(t.state))
			throw error(
				"task-terminal",
				"Start a new task rather than silently reopening a completed/cancelled/archived one.",
			);
		if (t.operations.some((o) => ["started", "unknown"].includes(o.state))) {
			t.state = "blocked";
			t.reason = "reconcile-before-retry";
		} else if (t.actions.some((a) => a.state === "pending")) t.state = "waiting_user";
		else if (t.milestones.length && !t.planApproved) {
			t.state = "waiting_user";
			t.reason = "task-authorization-required";
		} else if (t.budget.stageCalls >= LIMITS.stageCalls && advanceStage()) t.state = "running";
		else if (t.budget.calls >= LIMITS.totalCalls || t.budget.stageCalls >= LIMITS.stageCalls) {
			t.state = "blocked";
			t.reason = "budget-review-required";
		} else t.state = "running";
		t.capabilities = [...new Set([...t.capabilities, ...capabilities])]
			.filter((c) => typeof c === "string")
			.slice(0, 16);
		requested = false;
		save();
		return { taskId: t.id };
	}
	function plan(input) {
		const t = requireTask();
		if (t.milestones.length)
			throw error(
				"plan-exists",
				"Existing acceptance criteria are immutable; use a new task for a changed contract.",
			);
		if (
			!Array.isArray(input.milestones) ||
			!input.milestones.length ||
			input.milestones.length > LIMITS.milestones
		)
			throw error("plan-limit", "Plan needs 1–24 milestones.");
		const ids = new Set(input.milestones.map((m) => m.id));
		if (ids.size !== input.milestones.length || [...ids].some((id) => !/^[a-zA-Z0-9-]{1,40}$/.test(id)))
			throw error("plan-id", "Milestone IDs must be unique.");
		const seen = new Set();
		const milestones = input.milestones.map((m) => {
			if ((m.dependsOn || []).some((id) => !seen.has(id)))
				throw error(
					"plan-dependency",
					"Dependencies must refer to earlier milestones, not cycles or missing IDs.",
				);
			if (!["file", "human_review", "wiki_review", "zotero_item"].includes(m.acceptance?.kind))
				throw error(
					"acceptance-required",
					"Acceptance must be an observed file, explicit human review, or Wiki review; model labels cannot complete it.",
				);
			seen.add(m.id);
			return {
				id: m.id,
				title: clean(m.title),
				dependsOn: [...(m.dependsOn || [])],
				acceptance: {
					kind: m.acceptance.kind,
					path: clean(m.acceptance.path, 512),
					doi: clean(m.acceptance.doi),
					libraryId: clean(m.acceptance.libraryId),
					collection: clean(m.acceptance.collection),
					sha256: /^[a-f0-9]{64}$/.test(m.acceptance.sha256 || "") ? m.acceptance.sha256 : null,
				},
				state: "pending",
				evidence: null,
			};
		});
		if (input.goal) t.goal = clean(input.goal);
		t.authorizationSummary = clean(input.summary || t.goal, 1200);
		t.writeRoots = [...(input.writeRoots || [])];
		t.milestones = milestones;
		t.planApproved = false;
		t.state = "waiting_user";
		t.reason = "task-authorization-required";
		save();
		return clone(milestones);
	}
	function wait(input) {
		const t = requireTask();
		if (!["file", "download", "authorization", "review"].includes(input.kind))
			throw error("action-kind", "Unknown user action.");
		if (t.actions.filter((a) => a.state === "pending").length >= LIMITS.actions)
			throw error("action-limit", "Resolve an existing action first.");
		let url = null;
		if (input.url) {
			const parsed = new URL(input.url);
			if (
				!["https:", "http:"].includes(parsed.protocol) ||
				parsed.username ||
				parsed.password ||
				/(?:token|key|secret|auth)=/i.test(parsed.search)
			)
				throw error("action-url", "Use a public browser link without embedded credentials.");
			url = parsed.href;
		}
		const action = {
			id: randomUUID(),
			kind: input.kind,
			title: clean(input.title),
			reason: clean(input.reason),
			url,
			expected: {
				kind: input.kind === "download" ? "pdf" : "file",
				doi: clean(input.doi),
				title: clean(input.title),
				sha256: /^[a-f0-9]{64}$/.test(input.sha256 || "") ? input.sha256 : null,
			},
			milestoneId: t.milestones.some((m) => m.id === input.milestoneId) ? input.milestoneId : null,
			state: "pending",
			createdAt: now(),
			file: null,
		};
		t.actions.push(action);
		t.state = "waiting_user";
		t.waitStartedAt ||= now();
		save();
		return clone(action);
	}
	function checkRevision(id, revision) {
		if (revision !== book.revision) throw error("stale-task-view", "Task changed. Refresh before acting.");
		const t = book.tasks.find((t) => t.id === id);
		if (!t) throw error("task-scope", "Task does not belong to this session/branch.");
		return t;
	}
	function settleWait(t) {
		if (!t.actions.some((a) => a.state === "pending") && t.waitStartedAt) {
			t.waitMs += Math.max(0, Date.parse(now()) - Date.parse(t.waitStartedAt));
			t.waitStartedAt = null;
			if (t.state === "waiting_user") t.state = "partial";
		}
	}
	function command(input) {
		const t = checkRevision(input.taskId, input.revision);
		if (book.tasks.some((x) => x.operations.some((o) => o.state === "started")))
			throw error("task-busy", "Stop the running agent before changing task state.");
		if (input.action === "authorize-task") {
			if (terminal(t.state) || !t.milestones.length)
				throw error("plan-required", "Review a non-empty task plan before authorizing execution.");
			if (!hasTaskConsent(t, LIMITS.totalCalls)) {
				t.executionConsent = {
					version: 1,
					contractHash: contractHash(t),
					approvedAt: now(),
					maxCalls: LIMITS.totalCalls,
					maxAutoResumes: MAX_AUTO_RESUMES,
				};
				t.stage++;
				t.budget.stageCalls = 0;
				t.stageStartProgress = t.progressCount || 0;
			}
			t.planApproved = true;
			t.planApprovedAt = t.executionConsent.approvedAt;
			book.activeTaskId = t.id;
			book.selectionRequired = false;
			pinned = true;
			t.state = "partial";
			t.reason = null;
		} else if (input.action === "approve-plan") {
			t.planApproved = true;
			t.planApprovedAt = now();
		} else if (input.action === "select") {
			book.activeTaskId = t.id;
			book.selectionRequired = false;
			pinned = true;
		} else if (input.action === "cancel") {
			if (t.operations.some((o) => o.state === "started"))
				throw error("task-busy", "Stop the running agent before cancelling this task.");
			t.state = "cancelled";
			t.reason = "user-cancelled";
			for (const a of t.actions) if (a.state === "pending") a.state = "cancelled";
			settleWait(t);
		} else if (input.action === "archive") {
			if (!["completed", "cancelled", "partial", "blocked"].includes(t.state))
				throw error("archive-state", "Cancel or finish the task before archiving it.");
			if (t.operations.some((o) => ["started", "unknown"].includes(o.state)))
				throw error(
					"archive-unknown",
					"Reconcile unknown effects before archiving; archiving is not confirmation.",
				);
			if (t.actions.some((a) => a.state === "pending"))
				throw error("archive-pending", "Resolve or dismiss pending user actions before archiving.");
			t.archivedFrom = t.state;
			t.state = "archived";
			t.reason = "user-archived";
			t.archivedAt = now();
			settleWait(t);
			if (book.activeTaskId === t.id) {
				book.activeTaskId = null;
				pinned = false;
			}
		} else if (input.action === "next-stage") {
			if (t.budget.calls >= LIMITS.totalCalls)
				throw error(
					"total-budget",
					"Absolute task budget reached. Export the checkpoint and explicitly scope a new task; no automatic continuation.",
				);
			if (
				t.operations.some((o) => ["started", "unknown"].includes(o.state)) ||
				t.actions.some((a) => a.state === "pending")
			)
				throw error(
					"reconcile-before-resume",
					"Resolve unknown effects and pending user actions before another stage.",
				);
			book.activeTaskId = t.id;
			book.selectionRequired = false;
			pinned = true;
			t.stage++;
			t.budget.stageCalls = 0;
			t.state = "partial";
			t.reason = null;
		} else if (input.action === "acknowledge" || input.action === "dismiss") {
			const a = t.actions.find((a) => a.id === input.actionId && a.state === "pending");
			if (!a) throw error("action-stale", "Action no longer pending.");
			if (input.action === "acknowledge" && ["download", "file"].includes(a.kind) && !a.file)
				throw error("file-required", "Inspect the selected file first.");
			// Acknowledgment only dismisses coordination; the current permission gate still decides every tool call.
			if (
				input.action === "acknowledge" &&
				a.kind === "review" &&
				a.milestoneId &&
				t.milestones.find((m) => m.id === a.milestoneId)?.acceptance.kind === "wiki_review"
			)
				throw error(
					"wiki-review-required",
					"Use the existing Wiki review entry; task cards cannot approve live Wiki.",
				);
			a.state = input.action === "dismiss" ? "cancelled" : "acknowledged";
			a.resolvedAt = now();
			if (a.file) a.file.identity = a.file.identity === "hash-matched" ? "hash-matched" : "human-confirmed";
			const m = t.milestones.find((m) => m.id === a.milestoneId);
			if (
				m &&
				a.state === "acknowledged" &&
				m.acceptance.kind === "human_review" &&
				m.dependsOn.every((id) => t.milestones.find((x) => x.id === id)?.state === "completed")
			) {
				m.state = "completed";
				m.evidence = { kind: "human-review", at: now(), scope: m.title };
			}
			settleWait(t);
			if (input.action === "dismiss") {
				t.state = "blocked";
				t.reason = "user-action-cancelled";
			}
		} else if (input.action === "confirm-outcome") {
			const op = t.operations.find((o) => o.id === input.operationId);
			if (!op || !["unknown", "returned"].includes(op.state))
				throw error("operation-stale", "No uncertain operation to confirm.");
			op.state = "human-confirmed";
			op.checkedAt = now();
			op.verifier = "explicit-user-attestation-not-scientific-proof";
			t.reason = null;
			t.state = "partial";
		} else throw error("task-command", "Unsupported task action.");
		save();
		return view();
	}
	async function acceptFile(input, cwd) {
		const t = checkRevision(input.taskId, input.revision),
			a = t.actions.find((a) => a.id === input.actionId && a.state === "pending");
		if (!a || !["file", "download"].includes(a.kind))
			throw error("action-file", "Select an active file/download action.");
		const file = await inspect(cwd, input.path, a.expected);
		checkRevision(input.taskId, input.revision);
		if (t.actions.some((other) => other.id !== a.id && other.file?.sha256 === file.sha256))
			throw error(
				"duplicate-file",
				"This exact file is already associated with another action; original file was not changed.",
			);
		a.file = file;
		a.fileCheckedAt = now();
		save();
		return clone(a);
	}
	async function reconcile(cwd) {
		const t = requireTask(),
			id = t.id,
			revision = book.revision;
		const updates = [];
		for (const m of t.milestones.filter((m) => m.acceptance.kind === "zotero_item")) {
			const result = await getZoteroStatus(m.acceptance);
			checkRevision(id, revision);
			m.state =
				result.state === "found" &&
				m.dependsOn.every((dep) => t.milestones.find((x) => x.id === dep)?.state === "completed")
					? "completed"
					: "blocked";
			m.evidence = { ...result, kind: "zotero-read-only-item-identity", at: now() };
		}
		for (const m of t.milestones) {
			if (m.acceptance.kind !== "file") continue;
			try {
				const artifact = await inspect(cwd, m.acceptance.path, {
					sha256: m.acceptance.sha256 || m.evidence?.sha256,
				});
				updates.push({ id: m.id, artifact });
			} catch (e) {
				updates.push({ id: m.id, error: e.code || "file-unavailable" });
			}
		}
		checkRevision(id, revision);
		for (const update of updates) {
			const m = t.milestones.find((m) => m.id === update.id);
			if (update.error) {
				m.state = "blocked";
				m.evidence = { code: update.error, at: now() };
			} else if (m.dependsOn.every((dep) => t.milestones.find((m) => m.id === dep)?.state === "completed")) {
				m.state = "completed";
				m.evidence = { ...update.artifact, kind: "file-observed", at: now() };
			}
		}
		for (const op of t.operations) {
			if (!op.artifact || !["verified", "returned", "unknown"].includes(op.state)) continue;
			try {
				const artifact = await inspect(cwd, op.artifact.path, { sha256: op.artifact.sha256 });
				op.state = "verified";
				op.checkedAt = now();
				op.artifact = artifact;
			} catch (e) {
				op.state = e.code === "ENOENT" ? "not-found" : "changed";
				op.checkedAt = now();
			}
		}
		checkRevision(id, revision);
		for (const op of t.operations.filter((o) => o.state === "awaiting-review" && o.candidateId)) {
			const result = await getWikiStatus(op.candidateId);
			checkRevision(id, revision);
			if (!result) continue;
			op.checkedAt = now();
			if (result.status === "applied" && !result.stale) {
				op.state = "verified";
				op.verifier = "wiki-review-record-not-scientific-proof";
				for (const m of t.milestones)
					if (
						m.acceptance.kind === "wiki_review" &&
						m.acceptance.path === result.path &&
						m.dependsOn.every((dep) => t.milestones.find((x) => x.id === dep)?.state === "completed")
					) {
						m.state = "completed";
						m.evidence = { kind: "wiki-applied", candidateId: op.candidateId, at: now() };
					}
			} else if (result.status === "rejected" || result.stale) {
				op.state = "failed";
				t.reason = "wiki-rejected-or-stale";
			}
		}
		t.lastReconciledAt = now();
		derive(t);
		save();
		return view();
	}
	function derive(t) {
		if (terminal(t.state) && t.state !== "completed") return;
		if (t.operations.some((o) => ["unknown", "started", "changed"].includes(o.state))) {
			t.state = "blocked";
			t.reason = "reconcile-before-retry";
		} else if (t.actions.some((a) => a.state === "pending")) t.state = "waiting_user";
		else if (
			t.planApproved &&
			t.milestones.length &&
			t.milestones.every((m) => m.state === "completed") &&
			!t.operations.some((o) => ["failed", "returned"].includes(o.state))
		) {
			t.state = "completed";
			t.reason = null;
		} else if (
			t.milestones.some((m) => m.state === "blocked") ||
			t.operations.some((o) => o.state === "failed")
		)
			t.state = "partial";
		else t.state = "partial";
	}
	/** Readback may inspect approved output roots even while an effect needs reconciliation.
	 * The caller must still apply CURRENT read permissions. This never grants a write. */
	function readRoots() {
		const t = active();
		return t &&
			hasTaskConsent(t, LIMITS.totalCalls) &&
			!["cancelled", "archived"].includes(t.state) &&
			!book.selectionRequired &&
			t.reason !== "binding-changed"
			? [...(t.writeRoots || [])]
			: [];
	}
	function authorization(forWrite = false) {
		const t = active();
		if (
			!t ||
			!hasTaskConsent(t, LIMITS.totalCalls) ||
			terminal(t.state) ||
			book.selectionRequired ||
			t.reason === "binding-changed" ||
			t.state === "waiting_user" ||
			t.operations.some((o) =>
				(forWrite ? ["unknown", "changed"] : ["started", "unknown", "changed"]).includes(o.state),
			)
		)
			return null;
		return { taskId: t.id, writeRoots: [...(t.writeRoots || [])], ...t.executionConsent };
	}
	/** A bounded host-observed recovery, not a new user message or a bigger budget. */
	function reserveContinuation(reason) {
		const t = active();
		const recoverable = new Set([
			"tool-loop-stopped",
			"source-unread",
			"source-changed",
			"search-required",
			"search-stale",
			"citation-required",
			"check-timeout",
		]);
		if (
			!authorization() ||
			!recoverable.has(reason) ||
			t.budget.calls >= LIMITS.totalCalls ||
			(t.budget.autoResumes || 0) >= MAX_AUTO_RESUMES ||
			t.actions.some((a) => a.state === "pending") ||
			(t.progressCount || 0) <= (t.lastResumeProgress || 0)
		)
			return false;
		t.budget.autoResumes = (t.budget.autoResumes || 0) + 1;
		t.lastResumeProgress = t.progressCount;
		t.stage++;
		t.budget.stageCalls = 0;
		t.stageStartProgress = t.progressCount;
		t.reason = "automatic-recovery";
		t.state = "partial";
		save();
		return true;
	}
	function advanceStage() {
		const t = active();
		if (
			!t?.planApproved ||
			t.budget.calls >= LIMITS.totalCalls ||
			t.operations.some((o) => ["started", "unknown"].includes(o.state))
		)
			return false;
		const count = t.milestones.filter((m) => m.state === "completed").length;
		const automatic =
			hasTaskConsent(t, LIMITS.totalCalls) &&
			(t.progressCount || 0) > (t.stageStartProgress || 0) &&
			!t.actions.some((a) => a.state === "pending");
		if (!automatic && count <= (t.stageProgress || 0)) return false;
		t.stageStartProgress = t.progressCount || 0;
		t.stageProgress = count;
		t.stage++;
		t.budget.stageCalls = 0;
		t.state = "partial";
		t.reason = automatic ? "automatic-stage-checkpoint" : "verified-stage-checkpoint";
		save();
		onCheckpoint();
		return true;
	}
	function guard(event) {
		const t = requireTask();
		if (t.budget.stageCalls >= LIMITS.stageCalls) advanceStage();
		if (event.toolName === "task_status") return null;
		// A single immutable proposal remains possible after a read-only preflight hits a stage limit.
		if (
			event.toolName === "task_plan" &&
			t.authorizationRequired &&
			!t.milestones.length &&
			!terminal(t.state)
		)
			return null;
		if (terminal(t.state) || book.selectionRequired)
			return { block: true, reason: "Select an unfinished task before starting tools." };
		// Knowledge-vault tools (research_*) are host-governed: run-dir scoped, evidence-gated and
		// Wiki-reviewed. They never touch user files or run commands, so an ordinary research answer
		// must not require the one-task authorization card. Commands/file writes still do.
		const vaultTool = /^research_/.test(event.toolName);
		if (
			t.authorizationRequired &&
			!hasTaskConsent(t, LIMITS.totalCalls) &&
			!controls.has(event.toolName) &&
			!readOnly(event.toolName) &&
			!vaultTool &&
			event.toolName !== "ask_user"
		) {
			t.state = "waiting_user";
			t.reason = "task-authorization-required";
			save();
			return {
				block: true,
				reason:
					"Do read-only preparation, then call task_plan once with the goal, scope, write directories and deliverables. The host opens ask_user for that exact task contract; the card alone never authorizes it. Do not start commands/writes or ask for separate stage approvals.",
			};
		}
		if (t.budget.calls >= LIMITS.totalCalls || t.budget.stageCalls >= LIMITS.stageCalls) {
			t.state = "blocked";
			t.reason = t.budget.calls >= LIMITS.totalCalls ? "total-budget" : "stage-budget";
			save();
			return {
				block: true,
				reason: hasTaskConsent(t, LIMITS.totalCalls)
					? "The approved task reached a hard limit or made no new progress. Deliver observed results, remaining work and the specific blocker. Do not request routine stage approval or silently reset the total budget."
					: "The host kept the checkpoint. Propose one task_plan covering execution and acceptance for the user to authorize. Do not repeatedly request stage budgets.",
			};
		}
		if (t.reason === "binding-changed")
			return {
				block: true,
				reason: "Binding changed: start a newly scoped task; old evidence/permissions cannot be reused.",
			};
		const resourceKey = hash(`${book.scope}\0${event.toolName}\0${stable(event.input || {})}`);
		if (
			book.tasks.some(
				(other) =>
					other.id !== t.id &&
					other.operations.some(
						(o) => o.resourceKey === resourceKey && ["unknown", "started"].includes(o.state),
					),
			)
		)
			return {
				block: true,
				reason: "Another task has this unknown effect; reconcile its outcome before repeating it.",
			};
		const effect = !controls.has(event.toolName) && !readOnly(event.toolName),
			key = hash(`${book.scope}\0${t.id}\0${event.toolName}\0${stable(event.input || {})}`);
		if (effect && t.operations.some((o) => o.state === "unknown"))
			return {
				block: true,
				reason:
					"Unknown side effect: read-only reconciliation or explicit human outcome review required before new writes.",
			};
		if (effect && t.operations.some((o) => o.key === key && !["failed", "not-found"].includes(o.state)))
			return {
				block: true,
				reason:
					"idempotency-check: this effect already returned or has an unknown outcome. Query the saved receipt/read-only state before retrying; do not replay writes.",
			};
		if (effect && t.operations.filter((o) => o.key === key && o.state === "failed").length >= LIMITS.retries)
			return {
				block: true,
				reason: "no-progress: identical effect failed twice. Repair the input or deliver the checkpoint.",
			};
		if (t.operations.length >= LIMITS.operations && effect)
			return {
				block: true,
				reason: "Bounded operation ledger full. Deliver/export checkpoint; no entries silently removed.",
			};
		t.budget.calls++;
		t.budget.stageCalls++;
		if (!controls.has(event.toolName) && event.toolCallId) {
			t.pendingObservations ||= [];
			t.pendingObservations.push(clean(event.toolCallId, 100));
			t.pendingObservations = t.pendingObservations.slice(-LIMITS.totalCalls);
		}
		if (effect) {
			const op = {
				id: clean(event.toolCallId, 100),
				key,
				tool: clean(event.toolName, 80),
				state: "started",
				at: now(),
				stage: t.stage,
			};
			if (
				event.toolName === "write" &&
				typeof event.input?.path === "string" &&
				typeof event.input?.content === "string"
			) {
				op.artifact = {
					path: clean(event.input.path, 512),
					sha256: hash(event.input.content),
					bytes: Buffer.byteLength(event.input.content),
					intentOnly: true,
				};
			}
			op.resourceKey = hash(`${book.scope}\0${event.toolName}\0${stable(event.input || {})}`);
			t.operations.push(op);
			if (event.toolName === "ask_user") {
				t.state = "waiting_user";
				t.waitStartedAt ||= now();
			}
		}
		save();
		return null;
	}
	async function observe(event, cwd) {
		const t = active();
		if (!t) return;
		if (event.toolName === "capability_load") {
			t.capabilities = [...new Set([...t.capabilities, ...(event.input?.capabilities || [])])]
				.filter((c) => typeof c === "string")
				.slice(0, 16);
			save();
			return;
		}
		const bad = toolResultFailed(event);
		const observedCall = t.pendingObservations?.includes(clean(event.toolCallId, 100));
		t.pendingObservations = (t.pendingObservations || []).filter((id) => id !== clean(event.toolCallId, 100));
		if (observedCall && !bad && !controls.has(event.toolName) && event.toolName !== "ask_user") {
			const progressKey = hash(`${event.toolName}\0${stable(event.input || {})}`);
			t.progressKeys ||= [];
			if (!t.progressKeys.includes(progressKey)) {
				t.progressKeys.push(progressKey);
				t.progressKeys = t.progressKeys.slice(-64);
				t.progressCount = (t.progressCount || 0) + 1;
			}
		}
		const op = t.operations.find((o) => o.id === event.toolCallId);
		if (bad && (observedCall || op?.state === "started")) {
			const failure = failureObservation(event, now());
			t.failures = [...(t.failures || []).filter((f) => f.id !== failure.id), failure].slice(-4);
			// Failed reads also deserve an explanation, but do not discard pending permission/reconciliation gates.
			if (!op && !terminal(t.state) && !["blocked", "waiting_user"].includes(t.state)) {
				t.state = "partial";
				t.reason = "tool-failure";
			}
		}
		if (!op) {
			save();
			return;
		}
		const details = event.details || {},
			text = (event.content || [])
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join(" ");
		const failed = bad;
		const cancelled =
			event.toolName === "ask_user" && (details.cancelled || /cancelled|canceled/i.test(text));
		op.state = failed ? "failed" : cancelled ? "cancelled" : "returned";
		op.at = now();
		if (!failed && ["write", "edit"].includes(event.toolName) && typeof event.input?.path === "string") {
			try {
				op.artifact = await inspect(cwd, event.input.path);
				op.state = "verified";
				op.verifier = "workspace-file-readback-not-scientific-review";
				for (const m of t.milestones)
					if (
						m.acceptance.kind === "file" &&
						sameArtifactPath(cwd, m.acceptance.path, op.artifact.path) &&
						(!m.acceptance.sha256 || m.acceptance.sha256 === op.artifact.sha256) &&
						m.dependsOn.every((dep) => t.milestones.find((x) => x.id === dep)?.state === "completed")
					) {
						m.state = "completed";
						m.evidence = { ...op.artifact, kind: "file-observed", at: now() };
					}
			} catch {
				/* Unverified remains returned. */
			}
		}
		if (!failed && event.toolName === "research_propose_wiki_update") {
			op.state = "awaiting-review";
			op.candidateId = clean(details.id);
		}
		t.receipts.push({
			id: op.id,
			tool: op.tool,
			state: op.state,
			at: op.at,
			...(op.artifact ? { artifact: op.artifact } : {}),
		});
		t.receipts = t.receipts.slice(-24);
		if (cancelled) {
			t.state = "waiting_user";
			t.reason = "user-cancelled-choice-not-consent";
		} else if (failed) {
			t.state = "partial";
			t.reason = "tool-failure";
		} else if (event.toolName === "ask_user") {
			if (t.waitStartedAt) {
				t.waitMs += Math.max(0, Date.parse(now()) - Date.parse(t.waitStartedAt));
				t.waitStartedAt = null;
			}
			t.state = "running";
		}
		save();
	}
	function pause(reason) {
		const t = active();
		if (t) {
			t.state = "partial";
			t.reason = clean(reason);
			for (const op of t.operations) if (op.state === "started") op.state = "unknown";
			save();
		}
	}
	function settle() {
		const t = active();
		if (t && !terminal(t.state)) {
			if (t.state === "running") derive(t);
			save();
		}
	}
	function view() {
		return clone({
			version: 2,
			revision: book.revision,
			activeTaskId: book.activeTaskId,
			selectionRequired: book.selectionRequired,
			tasks: book.tasks.map(({ progressKeys, pendingObservations, ...t }) => ({
				...t,
				operations: t.operations.map(({ key, ...op }) => op),
				waitMs:
					t.waitMs + (t.waitStartedAt ? Math.max(0, Date.parse(now()) - Date.parse(t.waitStartedAt)) : 0),
			})),
			limits: LIMITS,
		});
	}
	function render() {
		const t = active();
		if (!t) return "暂无本会话的任务执行记录。旧会话不会被自动标记为已完成。";
		const labels = {
			pending: "待开始",
			running: "执行中",
			waiting_user: "等待用户",
			blocked: "受阻",
			partial: "部分完成",
			completed: "已满足记录的验收条件",
			cancelled: "已取消",
			archived: "已归档",
		};
		return [
			"### 任务执行记录",
			`任务：${t.goal}`,
			`状态：${labels[t.state]}；上次确认：${t.updatedAt}`,
			`已满足验收：${t.milestones.filter((m) => m.state === "completed").length}/${t.milestones.length}；阶段 ${t.stage}；调用 ${t.budget.calls}/${LIMITS.totalCalls}`,
			...[
				...new Map(
					t.operations
						.filter((o) => o.artifact && !o.artifact.intentOnly && o.state !== "started")
						.map((o) => [o.artifact.path, o]),
				).values(),
			]
				.slice(-6)
				.map((o) => {
					const path = o.artifact.path.replaceAll("\\", "/");
					const encoded = path
						.split("/")
						.map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`))
						.join("/");
					const href = /^[a-z]:\//i.test(path)
						? `file:///${path.slice(0, 2)}${encoded.slice(4)}`
						: path.startsWith("/")
							? `file://${encoded}`
							: `./${encoded}`;
					const label = (path.split("/").pop() || "产物").replace(/[[\]\\]/g, "\\$&");
					return `- 文件：[${label}](${href}) · ${o.state === "changed" ? "版本已变化，需重新核对" : o.state}`;
				}),
			t.reason ? `说明：${t.reason === "tool-failure" ? failureReceipt(t) : explainReason(t.reason)}` : null,
			book.selectionRequired
				? "有多个可继续任务，请先在任务面板选择。"
				: t.reason === "tool-failure"
					? null
					: "详情中可核对产物、等待事项和下一阶段。",
			t.reason === "tool-failure"
				? null
				: "以上是程序观察到的执行情况，不是科研结论，也不代表结果已经过科学验证。",
		]
			.filter(Boolean)
			.join("\n");
	}
	return {
		advanceStage,
		authorization,
		scope: () => book.scope,
		readRoots,
		reserveContinuation,
		attach,
		begin,
		plan,
		wait,
		guard,
		observe,
		command,
		acceptFile,
		reconcile,
		pause,
		settle,
		view,
		render,
		snapshot: () =>
			active()
				? clone({
						...active(),
						pending: active().operations.filter((o) => ["started", "unknown"].includes(o.state)),
					})
				: null,
		requestReport: () => {
			requested = true;
		},
		takeReport: () => {
			const yes = requested;
			requested = false;
			return yes ? render() : null;
		},
	};
}
