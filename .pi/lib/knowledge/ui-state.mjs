import { randomUUID } from "node:crypto";
import { flowCardBuilder, toolMeta } from "../tool-manifest.mjs";
import { failureCard, flowCard } from "./flow-cards.mjs";

const key = Symbol.for("drone.knowledge.ui.v1");
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
		cards: [],
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
	next.stages = deriveStages(next);
	state.flows.set(id, next);
	emitKnowledgeUi({ kind: "flow", flow: next });
}
/**
 * 门控四阶段进度的**单一派生点**（导航/Wiki/检索/发布）：从权威 flow 数据算出布尔，
 * 随 flow 一并下发。渲染端只读展示、不再自行重算——同一份判定，不会 UI 与后端各说各话。
 */
function deriveStages(flow) {
	return {
		navigation: (flow.navigation || []).some((p) => !p.missing),
		wiki: (flow.reads || []).some((p) => p.kind === "wiki" && !p.missing && p.endLine >= p.startLine),
		search: !!flow.search && !flow.search.wikiOnly,
		publication: ["released", "no-hits"].includes(flow.publication?.status || ""),
	};
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
			warnings: Array.isArray(proof.warnings) ? proof.warnings.slice(0, 6) : [],
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
const MAX_CARDS = 32;
const empty = (value) => value === null || value === undefined || value === "" || value === "unknown";
/** 同键合并：新卡覆盖旧卡，但空值 / unknown 不抹掉已知事实（例如后来的核对不会丢掉已知笔记路径）。 */
function mergeCard(previous, next) {
	if (!previous) return next;
	const fields = [...(previous.fields || [])];
	for (const field of next.fields || []) {
		const at = fields.findIndex((f) => f.label === field.label);
		if (at < 0) {
			fields.push(field);
			continue;
		}
		const old = fields[at];
		fields[at] = {
			...old,
			...field,
			value: empty(field.value) ? old.value : field.value,
			tone: empty(field.value) ? old.tone : field.tone,
			code: empty(field.code) ? (old.code ?? null) : field.code,
			note: empty(field.note) ? (old.note ?? null) : field.note,
		};
	}
	const links = [...(previous.links || [])];
	for (const link of next.links || [])
		if (!links.some((l) => l.kind === link.kind && l.target === link.target)) links.push(link);
	return {
		...previous,
		...next,
		title:
			next.provisionalTitle && previous.title && !previous.provisionalTitle ? previous.title : next.title,
		provisionalTitle: !!next.provisionalTitle && previous.provisionalTitle !== false,
		subtitle: next.subtitle ?? previous.subtitle ?? null,
		detail: next.detail ?? previous.detail ?? null,
		path: next.path ?? previous.path ?? null,
		fields,
		links,
	};
}
function validCard(card) {
	if (!card || typeof card !== "object" || typeof card.key !== "string" || !card.key) return null;
	return flowCard({ ...card, fields: card.fields, links: card.links });
}
/**
 * 挂钩 3 单一入口：工具结束后把它贡献的回执卡合并进 flow.cards。
 * 卡片来源：① 工具结果 `details.cards[]`；② 工具元数据 `drone.flowCards(event)`；
 * ③ 声明了 `drone.flow` 的工具出错时的失败卡。核心不再按工具名分支。
 */
export function noteKnowledgeOperation(ctx, event) {
	const id = sessionId(ctx),
		old = state.flows.get(id);
	if (!old || !event?.toolName) return;
	const meta = toolMeta(event.toolName);
	const builder = flowCardBuilder(event.toolName);
	const produced = [];
	if (event.isError) {
		if (meta?.flow || builder) produced.push(failureCard(event));
	} else {
		const declared = event.result?.details?.cards;
		if (Array.isArray(declared)) produced.push(...declared);
		if (builder) {
			try {
				const built = builder(event);
				if (Array.isArray(built)) produced.push(...built);
				else if (built) produced.push(built);
			} catch {
				/* a card builder must never fail the tool result */
			}
		}
	}
	const cards = produced.map(validCard).filter(Boolean);
	if (!cards.length) return;
	const next = [...(old.cards || [])];
	for (const card of cards) {
		const at = next.findIndex((x) => x.key === card.key);
		const merged = mergeCard(at < 0 ? null : next[at], card);
		if (at < 0) next.push(merged);
		else next.splice(at, 1, merged);
	}
	updateKnowledgeFlow(ctx, { cards: next.slice(-MAX_CARDS) });
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
