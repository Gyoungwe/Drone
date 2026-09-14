import { randomUUID } from "node:crypto";

const key = Symbol.for("percho.knowledge.ui.v1");
globalThis[key] ??= { listeners: new Set(), flows: new Map(), seq: 0 };
const state = globalThis[key];
const MAX_SESSIONS = 64,
	MAX_RECORDS = 40;
const sessionId = (ctx) => ctx?.sessionManager?.getSessionId?.() || ctx?.sessionId || null;
export function subscribeKnowledgeUi(listener) {
	state.listeners.add(listener);
	return () => state.listeners.delete(listener);
}
export function emitKnowledgeUi(event) {
	const value = { ...event, sequence: ++state.seq };
	for (const fn of state.listeners) {
		try {
			fn(structuredClone(value));
		} catch {
			/* a closed UI must not fail a read/write */
		}
	}
	return value;
}
export function flowFor(id) {
	const flow = state.flows.get(id);
	return flow ? structuredClone(flow) : null;
}
export function beginKnowledgeFlow(ctx, binding) {
	const id = sessionId(ctx);
	if (!id) return;
	const flow = {
		sessionId: id,
		turnId: randomUUID(),
		vaultId: binding?.vaultId || null,
		bindingRevision: binding?.revision || null,
		vault: binding?.vault || null,
		project: null,
		phase: binding ? "preparing" : "unconfigured",
		updatedAt: Date.now(),
		navigation: [],
		reads: [],
		search: null,
		publication: null,
		artifacts: [],
	};
	state.flows.delete(id);
	state.flows.set(id, flow);
	while (state.flows.size > MAX_SESSIONS) state.flows.delete(state.flows.keys().next().value);
	updateKnowledgeFlow(ctx, {});
}
export function updateKnowledgeFlow(ctx, patch) {
	const id = sessionId(ctx),
		old = state.flows.get(id);
	if (!old) return;
	const next = { ...old, ...patch, updatedAt: Date.now() };
	state.flows.set(id, next);
	emitKnowledgeUi({ kind: "flow", flow: next });
}
export function noteKnowledgeRead(ctx, page) {
	const id = sessionId(ctx),
		old = state.flows.get(id);
	if (!old) return;
	const row = {
		path: page.path,
		hash: page.hash || null,
		startLine: page.startLine || 0,
		endLine: page.endLine || 0,
		title: String(page.title || page.path).slice(0, 200),
		excerpt: knowledgeExcerpt(page.text),
		missing: !!page.missing,
		truncated: !!page.truncated,
		kind: /(?:^|\/)Wiki\//.test(page.path) ? "wiki" : "evidence",
	};
	const reads = [...old.reads.filter((x) => x.path !== row.path), row].slice(-MAX_RECORDS);
	updateKnowledgeFlow(ctx, { reads, phase: row.kind === "wiki" ? "reading-wiki" : "reading-evidence" });
}
export function publicationKnowledgeFlow(ctx, proof) {
	const id = sessionId(ctx);
	if (!state.flows.has(id)) return;
	const phase =
		proof.status === "setup-complete"
			? "setup-complete"
			: proof.status === "released"
				? "released"
				: proof.status === "no-hits"
					? "no-hits"
					: proof.status === "blocked"
						? "blocked"
						: proof.status === "evidence-only"
							? "evidence-only"
							: proof.status === "unconfigured"
								? "unconfigured"
								: "checking";
	updateKnowledgeFlow(ctx, {
		phase,
		publication: {
			status: proof.status,
			reason: proof.reason || null,
			paths: Array.isArray(proof.paths) ? proof.paths.slice(0, 6) : [],
			scientificallyVerified: false,
		},
	});
}
export function requestWikiReviewUi(ctx, id = "") {
	const sid = sessionId(ctx);
	if (!sid) return false;
	emitKnowledgeUi({ kind: "open-review", sessionId: sid, id: String(id || "") });
	return state.listeners.size > 0;
}
export function notifyKnowledgeUi(text, severity = "info", id = null) {
	if (typeof text !== "string" || !text.trim()) return;
	emitKnowledgeUi({
		kind: "notice",
		id: randomUUID(),
		sessionId: id,
		severity: ["info", "warning", "error"].includes(severity) ? severity : "info",
		text: text.slice(0, 2000),
	});
}
export function invalidateKnowledgeUi() {
	emitKnowledgeUi({ kind: "invalidate" });
}
export function clearKnowledgeFlow(id) {
	state.flows.delete(id);
}

// Whitelisted tool facts only: never expose assistant thoughts or unchecked answer drafts.
export function knowledgeExcerpt(text, limit = 320) {
	return String(text || "")
		.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, limit);
}
export function noteKnowledgeSearch(ctx, found, wikiOnly = false) {
	updateKnowledgeFlow(ctx, {
		phase: wikiOnly ? "reading-wiki" : "reading-evidence",
		search: {
			query: String(found.query || "").slice(0, 2000),
			wikiOnly,
			hits: found.hits.length,
			complete: found.complete,
			coverage: found.coverage,
			revision: found.revision,
			previews: found.hits.slice(0, 6).map((p) => ({
				path: p.path,
				title: String(p.title || p.path).slice(0, 200),
				excerpt: knowledgeExcerpt(p.text),
				hash: p.hash,
				startLine: p.startLine,
				endLine: p.endLine,
				kind: p.kind,
			})),
		},
	});
}
export function noteKnowledgeOperation(ctx, event) {
	const id = sessionId(ctx),
		old = state.flows.get(id);
	if (!old) return;
	const names = new Set([
		"research_setup_obsidian",
		"research_archive_source",
		"research_deposit_knowledge",
		"research_summarize_run",
		"research_propose_wiki_update",
		"research_archive_explainer",
		"research_source_status",
	]);
	if (!names.has(event.toolName)) return;
	const d = event.result?.details || {},
		rows = [];
	const row = (key, title, path, status, detail = "") => ({
		key,
		title: String(title || "").slice(0, 200),
		path: typeof path === "string" ? path.slice(0, 4096) : null,
		status,
		detail: String(detail).slice(0, 400),
	});
	if (event.isError) {
		rows.push(
			row(
				event.toolCallId,
				event.toolName,
				null,
				"failed",
				(event.result?.content || [])
					.filter((b) => b.type === "text")
					.map((b) => b.text)
					.join(" "),
			),
		);
	} else if (event.toolName === "research_source_status") {
		for (const item of (d.manifest?.items || []).slice(-20))
			rows.push(
				row(
					item.path || item.id,
					item.metadata?.title || item.category,
					item.path,
					item.status,
					"Source archived; interpretation and manual coverage are separate.",
				),
			);
		for (const item of (d.manifest?.failures || []).slice(-6))
			rows.push(row(item.url, item.url, null, "failed", item.reason));
	} else if (event.toolName === "research_archive_source")
		rows.push(
			row(
				d.path || d.url || event.toolCallId,
				d.metadata?.title || d.category || event.toolName,
				d.path,
				d.status,
				d.knowledge_status === "written"
					? "Source note saved; not a full manual or reviewed synthesis."
					: d.reason || d.obsidian_error || d.knowledge_status,
			),
		);
	else if (event.toolName === "research_deposit_knowledge")
		rows.push(
			row(
				d.note || event.toolCallId,
				d.type || event.toolName,
				d.note,
				d.note ? "note-written" : "failed",
				d.scope,
			),
		);
	else if (event.toolName === "research_summarize_run")
		rows.push(
			row(
				d.run || event.toolCallId,
				"Run summary",
				d.run,
				d.partial ? "partial" : d.run ? "summary-written" : "failed",
				d.obsidian_error ||
					d.index_error ||
					(d.obsidian_note ? "Vault run note saved." : "No Vault run note."),
			),
		);
	else if (event.toolName === "research_archive_explainer")
		rows.push(
			row(
				d.note || event.toolCallId,
				"Show Me explainer",
				d.note,
				d.knowledge_status === "written" ? "explainer-archived" : d.knowledge_status || "failed",
				"Presentation layer only; not scientific evidence.",
			),
		);
	else if (event.toolName === "research_setup_obsidian")
		rows.push(
			row(
				event.toolCallId,
				"Obsidian setup",
				d.vault,
				d.cancelled ? "cancelled" : d.state === "ready" ? "setup-complete" : "failed",
				"Global binding and missing structure only.",
			),
		);
	else
		rows.push(
			row(
				d.id || event.toolCallId,
				"Wiki proposal",
				d.path,
				"pending-review",
				"Not yet part of live Wiki knowledge.",
			),
		);
	const artifacts = [...(old.artifacts || [])];
	for (const item of rows) {
		const at = artifacts.findIndex((x) => x.key === item.key);
		if (at < 0) artifacts.push(item);
		else artifacts[at] = item;
	}
	updateKnowledgeFlow(ctx, { artifacts: artifacts.slice(-24) });
}

// Compact specialist status; never copy its raw model/chain/tool transcript into the parent UI.
export function noteKnowledgeSpecialist(ctx, run) {
	const id = sessionId(ctx),
		old = state.flows.get(id);
	if (!old) return;
	const allowed = [
		"id",
		"role",
		"name",
		"label",
		"status",
		"decision",
		"reasonCode",
		"action",
		"model",
		"startedAt",
		"endedAt",
		"inputTokens",
		"outputTokens",
		"cacheReadTokens",
		"cacheWriteTokens",
		"reasoningTokens",
		"totalTokens",
		"cost",
		"usageReported",
		"reportedFields",
		"sourceCount",
		"summary",
		"error",
		"elapsedMs",
		"budget",
		"nextAction",
	];
	const safe = Object.fromEntries(
		allowed
			.filter((k) => run[k] !== undefined)
			.map((k) => [k, typeof run[k] === "string" ? run[k].slice(0, k === "summary" ? 500 : 300) : run[k]]),
	);
	if (Array.isArray(run.sources))
		safe.sources = run.sources
			.slice(0, 6)
			.filter((ref) => typeof ref.path === "string")
			.map((ref) => ({
				path: ref.path.slice(0, 512),
				hash: String(ref.hash || "").slice(0, 64),
				startLine: Number(ref.startLine) || 0,
				endLine: Number(ref.endLine) || 0,
				excerpt: String(ref.excerpt || "").slice(0, 280),
			}));
	const specialists = [...(old.specialists || [])],
		at = specialists.findIndex((x) => x.id === safe.id);
	if (at < 0) specialists.push(safe);
	else specialists[at] = safe;
	updateKnowledgeFlow(ctx, { specialists: specialists.slice(-8) });
}
