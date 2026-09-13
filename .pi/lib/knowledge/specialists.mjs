import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { deliveryContract } from "../source-delivery.mjs";
import { readKnowledgeBinding } from "./config.mjs";
import { canRead, validateNote } from "./files.mjs";
import {
	createSpecialistBudget,
	decideSpecialistRun,
	specialistRequestSignature,
} from "./orchestration-policy.mjs";
import {
	knowledgeSpecialistHost,
	specialistQueueSnapshot,
	specialistSettings,
	withSpecialistSlot,
} from "./specialist-host.mjs";
import { noteKnowledgeSpecialist } from "./ui-state.mjs";

const profiles = {
	navigator: ["knowledge-navigator", "知识导航员"],
	evidence: ["knowledge-evidence-curator", "证据整理员"],
	wiki: ["knowledge-wiki-editor", "Wiki 修订员"],
	explainer: ["knowledge-explainer", "Show Me 讲解员"],
};
const derived = (path) => /(?:^|\/)(?:Explainers|Runs)\//i.test(path);
const brief = (page) => ({
	path: page.path,
	hash: page.hash,
	startLine: page.startLine,
	endLine: page.endLine,
	text: page.text,
	humanReview: page.humanReview,
	truncated: page.truncated,
	missing: page.missing,
});
const readSchema = {
	type: "object",
	properties: { path: { type: "string", maxLength: 512 }, start_line: { type: "integer", minimum: 1 } },
	required: ["path"],
	additionalProperties: false,
};
const searchSchema = {
	type: "object",
	properties: { query: { type: "string", minLength: 1, maxLength: 1000 }, wiki_only: { type: "boolean" } },
	required: ["query"],
	additionalProperties: false,
};
export function shouldOrientKnowledge(prompt) {
	const text = String(prompt || "").trim();
	if (!text || text.startsWith("/") || /初始化|取消任务|停止任务/.test(text)) return false;
	return (
		!!deliveryContract(text) ||
		(/比较|对比|分析|综述|compare|analy[sz]|review/i.test(text) &&
			/论文|文献|研究|证据|方法|软件|papers?|evidence|software/i.test(text)) ||
		/知识库|已有知识|主题.{0,8}(?:知识|进展)|根据.{0,10}(?:文献|笔记)|show\s*-?\s*me|\bwiki\b/i.test(text)
	);
}
export function createKnowledgeSpecialists(pi, { getCurrent, readOnly = false }) {
	let epoch = 0,
		goal = "",
		oriented = false,
		handoffs = [],
		used = new Set(),
		controllers = new Set(),
		decisions = [],
		budget = createSpecialistBudget();
	function begin(prompt = "") {
		for (const c of controllers) c.abort();
		controllers = new Set();
		epoch++;
		goal = String(prompt || "").slice(0, 4000);
		oriented = false;
		handoffs = [];
		decisions = [];
		used = new Set();
		budget.begin();
	}
	async function showMeSkill() {
		const commands = pi.getCommands?.() || [];
		const entry =
			commands.find((item) => item.source === "skill" && item.name === "skill:show-me") ||
			commands.find((item) => item.source === "skill" && item.name === "skill:research-show-me");
		if (!entry?.sourceInfo?.path) return null;
		const path = entry.sourceInfo.path,
			info = await lstat(path);
		if (!info.isFile() || info.size > 18000)
			throw new Error("Loaded show-me skill exceeds the specialist context budget");
		return { text: await readFile(path, "utf8"), name: entry.name.slice(6) };
	}
	async function run(
		ctx,
		role,
		{
			task = goal,
			sourcePaths = [],
			sourceHashes = [],
			summary = "",
			automatic = false,
			targetPath = null,
		} = {},
	) {
		if (!profiles[role]) throw new Error("Unknown knowledge specialist role");
		const generation = epoch,
			reservations = used,
			parentSignal = ctx.signal,
			turnToken = budget.snapshot.turn;
		const c = getCurrent(ctx),
			host = knowledgeSpecialistHost(ctx),
			settings = await specialistSettings();
		budget.configure(settings);
		const signature = specialistRequestSignature({
			role,
			task,
			sourcePaths,
			sourceHashes,
			summary,
			targetPath,
		});
		const remember = (value) => {
			decisions.push({ role, ...value, at: Date.now() });
			if (decisions.length > 32) decisions.splice(0, decisions.length - 32);
			return value;
		};
		const decision = decideSpecialistRun({
			role,
			task,
			sourcePaths,
			targetPath,
			automatic,
			mode: settings.mode,
			trusted: !!ctx.isProjectTrusted?.(),
			policy: c.binding.subagentPolicy,
			hasEvidence: Array.isArray(sourcePaths) && sourcePaths.length > 0,
			duplicate: false,
			turnRuns: budget.snapshot.turnRuns,
			maxRunsPerTurn: settings.maxRunsPerTurn,
			sessionRuns: budget.snapshot.sessionRuns,
			maxRunsPerSession: settings.maxRunsPerSession,
			active: specialistQueueSnapshot().active,
			concurrency: settings.concurrency,
			queueLength: specialistQueueSnapshot().queueLength,
			queueLimit: settings.queueLimit,
			summary,
			sourceHashes,
		});
		const skip = (reason, status = "skipped", requestedDecision = null, record = true) => {
			const publicDecision = requestedDecision || (status === "waiting" ? "ask-user" : "skip");
			if (record) remember({ decision: publicDecision, reasonCode: reason });
			return {
				status,
				role,
				reason,
				reasonCode: reason,
				decision: publicDecision,
				nextAction:
					publicDecision === "ask-user"
						? "Start a new session or use human settings to reset/extend the specialist budget."
						: reason === "permission-denied"
							? "Ask a human to change project trust or specialist settings."
							: "Read sources or adjust the task before retrying.",
			};
		};
		if (generation !== epoch || getCurrent(ctx) !== c || parentSignal?.aborted)
			return skip("parent-turn-changed", "cancelled");
		if (readOnly) return skip("permission-denied");
		if (!host) return skip("host-unavailable");
		if (decision.decision !== "run") {
			remember({ decision: decision.decision, reasonCode: decision.reasonCode });
			const id = randomUUID();
			noteKnowledgeSpecialist(ctx, {
				id,
				role,
				name: profiles[role][0],
				label: profiles[role][1],
				status: decision.decision === "ask-user" ? "waiting" : "skipped",
				decision: decision.decision,
				reasonCode: decision.reasonCode,
				endedAt: Date.now(),
			});
			return skip(
				decision.reasonCode,
				decision.decision === "ask-user" ? "waiting" : "skipped",
				decision.decision,
				false,
			);
		}
		if (automatic && ["wiki", "explainer"].includes(role) && c.binding.depositMode === "run-only")
			return skip("run-only");
		if (!Array.isArray(sourcePaths) || sourcePaths.length > 6 || summary.length > 12000)
			throw new Error("Specialist task packet exceeds its limit");
		if (used.has(role)) return skip("already-called-this-turn");
		if (!budget.reserve(signature, turnToken, { dedupe: sourceHashes.length > 0 }))
			return skip("duplicate-request");
		remember({ decision: "run", reasonCode: decision.reasonCode });
		reservations.add(role); // Reserve before asynchronous skill loading: one role per turn even under parallel tool calls.
		let skillText = "",
			skillName = null;
		try {
			if (role === "explainer") {
				const skill = await showMeSkill();
				if (!skill) {
					reservations.delete(role);
					budget.release(signature, turnToken);
					return skip("show-me-not-loaded");
				}
				skillText = skill.text;
				skillName = skill.name;
			}
		} catch (error) {
			reservations.delete(role);
			budget.release(signature, turnToken);
			throw error;
		}
		if (generation !== epoch || getCurrent(ctx) !== c || parentSignal?.aborted) {
			budget.release(signature, turnToken);
			return {
				status: "cancelled",
				role,
				reason: "parent-turn-changed",
				reasonCode: "parent-turn-changed",
				decision: "skip",
				nextAction: "Start a new turn before retrying.",
			};
		}
		const controller = new AbortController(),
			abort = () => controller.abort();
		controllers.add(controller);
		if (parentSignal?.aborted) abort();
		else parentSignal?.addEventListener("abort", abort, { once: true });
		const deadline = setTimeout(abort, settings.timeoutMs);
		const [name, label] = profiles[role],
			id = randomUUID();
		let progress = {
			id,
			role,
			name,
			label,
			status: "queued",
			startedAt: Date.now(),
			decision: "run",
			reasonCode: decision.reasonCode,
			budget: budget.snapshot,
		};
		const publish = (patch) => {
			progress = { ...progress, ...patch };
			if (generation === epoch) noteKnowledgeSpecialist(ctx, progress);
		};
		publish({});
		let prepared;
		let committed = false;
		let resultUsage = null;
		const check = async () => {
			controller.signal.throwIfAborted();
			const currentBudget = budget.snapshot;
			if (
				currentBudget.turnTokens >= currentBudget.maxTokensPerTurn ||
				currentBudget.sessionTokens >= currentBudget.maxTokensPerSession ||
				currentBudget.turnCost >= currentBudget.maxCostPerTurn ||
				currentBudget.sessionCost >= currentBudget.maxCostPerSession
			)
				throw new Error("Specialist usage budget exhausted");
			if (generation !== epoch || getCurrent(ctx) !== c) throw new Error("Parent knowledge turn changed");
			if (!ctx.isProjectTrusted?.()) throw new Error("Project trust was revoked");
			const binding = await readKnowledgeBinding({ fresh: true }),
				latest = await specialistSettings();
			if (
				binding?.vaultId !== c.binding.vaultId ||
				binding?.revision !== c.binding.revision ||
				binding.subagentPolicy !== "read-local"
			)
				throw new Error("Knowledge binding or child permissions changed");
			if (latest.mode === "off" || (automatic && latest.mode !== "automatic"))
				throw new Error("Knowledge specialists were disabled");
		};
		try {
			const answer = await withSpecialistSlot(
				controller.signal,
				async () => {
					committed = budget.commit(signature, turnToken);
					if (!committed) throw new Error("Parent knowledge turn changed");
					await check();
					publish({ status: "running", action: "navigation" });
					prepared = await c.service.prepare({ cwd: ctx.cwd, project: c.project, query: task });
					const allowed = new Set(prepared.linkedWiki),
						readPages = new Map();
					let readCount = 0,
						searchCount = 0,
						lastSearch = null;
					for (const path of sourcePaths) {
						validateNote(path);
						if (!canRead(path, c.project) || derived(path))
							throw new Error("Source is outside the permitted evidence scope");
						allowed.add(path);
					}
					if (targetPath) {
						validateNote(targetPath);
						if (!canRead(targetPath, c.project))
							throw new Error("Wiki target is outside the permitted scope");
						allowed.add(targetPath);
					}
					const read = async ({ path, start_line = 1 }) => {
						await check();
						if (!budget.addToolOperation() || ++readCount > 8)
							throw new Error("Specialist read budget exhausted");
						validateNote(path);
						if (!allowed.has(path) || !canRead(path, c.project))
							throw new Error("Knowledge specialist may read only supplied or discovered paths");
						const page = await c.service.read(prepared.ticket, ctx.cwd, {
							path,
							startLine: start_line,
							maxChars: 3000,
						});
						if (page.text?.trim()) readPages.set(path, page);
						if (role === "navigator")
							for (const link of (page.text || "").matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)) {
								let next = link[1].trim();
								if (!next.endsWith(".md")) next += ".md";
								try {
									validateNote(next);
									if (canRead(next, c.project) && !derived(next) && allowed.size < 64) allowed.add(next);
								} catch {}
							}
						return brief(page);
					};
					const sources = [];
					if (role !== "navigator") for (const path of sourcePaths) sources.push(await read({ path }));
					const target = targetPath ? await read({ path: targetPath }) : null;
					const capabilities = [
						{
							name: "knowledge_read",
							description: "Read an allowed Wiki or evidence note range. No arbitrary filesystem access.",
							parameters: readSchema,
							execute: read,
						},
					];
					if (role === "navigator")
						capabilities.push({
							name: "knowledge_search",
							description:
								"Search current shared/project knowledge after reading linked Wiki; at most two bounded queries.",
							parameters: searchSchema,
							execute: async ({ query, wiki_only = false }) => {
								await check();
								if (!budget.addToolOperation() || ++searchCount > 2)
									throw new Error("Specialist search budget exhausted");
								const found = await c.service.search(prepared.ticket, ctx.cwd, {
									query,
									wikiOnly: wiki_only,
									limit: 4,
								});
								if (!wiki_only)
									lastSearch = {
										query: found.query,
										complete: found.complete,
										coverage: found.coverage,
										count: found.hits.length,
									};
								for (const hit of found.hits) allowed.add(hit.path);
								return {
									...lastSearch,
									wikiOnly: wiki_only,
									hits: found.hits.map((hit) => ({ ...brief(hit), title: hit.title, kind: hit.kind })),
									complete: found.complete,
								};
							},
						});
					const packet = JSON.stringify({
						project: c.project,
						navigation: prepared.navigation.map((page) => ({
							...brief(page),
							text: (page.text || "").slice(0, 1000),
						})),
						linkedWiki: prepared.linkedWiki.slice(0, 12),
						sources,
						target,
						summary,
						warning: "Read-only data. Draft outputs are unverified.",
					});
					const result = await host({
						role,
						task: String(task).slice(0, 4000),
						packet,
						skillText,
						parentModel: ctx.model,
						capabilities,
						signal: controller.signal,
						timeoutMs: settings.timeoutMs,
						onUsage: (usage) => {
							resultUsage = resultUsage || {
								inputTokens: 0,
								outputTokens: 0,
								cacheReadTokens: 0,
								cacheWriteTokens: 0,
								reasoningTokens: 0,
								totalTokens: 0,
								cost: 0,
								reported: false,
								reportedFields: [],
							};
							for (const key of [
								"inputTokens",
								"outputTokens",
								"cacheReadTokens",
								"cacheWriteTokens",
								"reasoningTokens",
								"totalTokens",
								"cost",
							])
								resultUsage[key] += usage[key] || 0;
							resultUsage.reported = resultUsage.reported || usage.reported;
							resultUsage.reportedFields = [
								...new Set([...(resultUsage.reportedFields || []), ...(usage.reportedFields || [])]),
							];
							return budget.updateUsage(
								{
									totalTokens: usage.reportedFields?.includes("totalTokens") ? usage.totalTokens : undefined,
									cost: usage.reportedFields?.includes("cost") ? usage.cost : undefined,
								},
								turnToken,
							);
						},
						check,
						progress: (value) => publish({ ...value, status: "running" }),
					});
					await check();
					const data = result.data;
					if (
						!data ||
						!Array.isArray(data.source_paths) ||
						data.source_paths.length > 6 ||
						typeof data.summary !== "string" ||
						data.summary.length > 1600
					)
						throw new Error("Invalid specialist handoff");
					if (role === "navigator" && !lastSearch)
						throw new Error("Navigator returned without a real evidence search");
					if (role !== "navigator" && !data.source_paths.length)
						throw new Error("Specialist result has no read sources");
					for (const path of data.source_paths)
						if (!readPages.has(path) || derived(path))
							throw new Error("Specialist cited an unread or presentation-only source");
					if (data.source_paths.length)
						await c.service.evidenceReceipts(prepared.ticket, ctx.cwd, data.source_paths);
					const refs = data.source_paths.map((path) => {
						const page = readPages.get(path);
						return {
							path,
							hash: page.hash,
							startLine: page.startLine,
							endLine: page.endLine,
							excerpt: (page.text || "").slice(0, 500),
							truncated: page.truncated,
						};
					});
					return { ...result, refs, search: lastSearch };
				},
				{
					concurrency: settings.concurrency,
					queueLimit: settings.queueLimit,
					queueWaitMs: settings.queueWaitMs,
				},
			);
			publish({
				status: "completed",
				endedAt: Date.now(),
				...visibleUsage(answer.usage),
				model: answer.model,
				thinkingLevel: answer.thinkingLevel,
				sourceCount: answer.refs.length,
				sources: answer.refs.map((ref) => ({ ...ref, excerpt: ref.excerpt.slice(0, 280) })),
				summary: answer.data.summary.slice(0, 500),
				elapsedMs: Math.max(0, Date.now() - progress.startedAt),
				budget: budget.snapshot,
			});
			return { status: "completed", role, id, skillName, ...answer };
		} catch (error) {
			const cancelled = controller.signal.aborted || generation !== epoch;
			publish({
				status: cancelled ? "cancelled" : "failed",
				endedAt: Date.now(),
				error: String(error.message).slice(0, 300),
				...visibleUsage(resultUsage),
				elapsedMs: Math.max(0, Date.now() - progress.startedAt),
				budget: budget.snapshot,
			});
			return {
				status: cancelled ? "cancelled" : "failed",
				role,
				id,
				reason: String(error.message).slice(0, 300),
				decision: cancelled ? "skip" : "run",
				nextAction: cancelled
					? "Start a new turn before retrying."
					: "Inspect the provider failure before retrying.",
			};
		} finally {
			clearTimeout(deadline);
			if (prepared) c.service.tickets.delete(prepared.ticket);
			controllers.delete(controller);
			if (!committed) budget.release(signature, turnToken);
			parentSignal?.removeEventListener("abort", abort);
		}
	}
	function visibleUsage(usage) {
		if (!usage) return {};
		const visible = { usageReported: usage.reported === true, reportedFields: usage.reportedFields || [] };
		for (const key of usage.reportedFields || [])
			if (
				[
					"inputTokens",
					"outputTokens",
					"cacheReadTokens",
					"cacheWriteTokens",
					"reasoningTokens",
					"totalTokens",
					"cost",
				].includes(key)
			)
				visible[key] = usage[key];
		return visible;
	}
	function compact(result) {
		if (result.status !== "completed")
			return {
				role: result.role,
				status: result.status,
				reason: result.reason,
				reasonCode: result.reasonCode || result.reason,
				decision: result.decision || (result.status === "cancelled" ? "skip" : "run"),
				nextAction:
					result.status === "waiting" || result.decision === "ask-user"
						? "Start a new session or use human settings to reset/extend the specialist budget."
						: "Read sources or adjust the task before retrying.",
			};
		return {
			role: result.role,
			status: result.status,
			decision: "run",
			summary: result.data.summary.slice(0, 1100),
			cautions: result.data.cautions,
			refs: result.refs.slice(0, 4).map((ref) => ({ ...ref, excerpt: ref.excerpt.slice(0, 280) })),
			search: result.search,
			usageReported: result.usage?.reported === true,
			elapsedMs: result.elapsedMs,
			budget: budget.snapshot,
			warning:
				"Unverified specialist handoff; this does NOT grant the parent evidence/read/search receipts. Read cited originals and complete native publication checks.",
		};
	}
	async function orient(ctx) {
		if (oriented || readOnly) return handoffs;
		oriented = true;
		const generation = epoch;
		if (!shouldOrientKnowledge(goal)) return handoffs;
		const nav = await run(ctx, "navigator", { automatic: true });
		if (generation !== epoch) return []; // Do not insert an old task result into the replacement user turn.
		if (nav.status === "skipped") return handoffs;
		handoffs = [compact(nav)];
		if (
			nav.status === "completed" &&
			nav.refs.length >= 2 &&
			/比较|对比|冲突|矛盾|compare|conflict/i.test(goal)
		) {
			const paths = nav.refs
				.map((r) => r.path)
				.filter((p) => !/(?:^|\/)Wiki\//.test(p))
				.slice(0, 4);
			if (paths.length >= 2) {
				const evidence = await run(ctx, "evidence", {
					sourcePaths: paths,
					sourceHashes: nav.refs.map((r) => r.hash).filter(Boolean),
					automatic: true,
				});
				if (generation !== epoch) return [];
				handoffs.push(compact(evidence));
			}
		}
		return handoffs;
	}
	return {
		begin,
		run,
		orient,
		compact,
		goal: () => goal,
		budget: () => budget.snapshot,
		decisions: () => decisions.slice(),
		decisionHistory: () => decisions.slice(),
		close: () => begin(""),
	};
}
