import { createHash, randomUUID } from "node:crypto";
import { publicationKnowledgeFlow, updateKnowledgeFlow } from "./ui-state.mjs";

const key = Symbol.for("percho.knowledge.publication.v1");
globalThis[key] ??= { proofs: new WeakSet() };
const state = globalThis[key];
const FIELD = "knowledgePublication";
const hash = (content) =>
	createHash("sha256")
		.update(JSON.stringify(content ?? []))
		.digest("hex");
const notices = {
	"search-required": "本轮尚未完成知识库检索。请先检索，再阅读需要引用的内容。",
	"coverage-incomplete": "知识索引尚未完整可用。请检查索引状态或故障，不能将此情况当作无命中。",
	"citation-required": "检索有命中，但回答没有引用本轮读过的知识条目。",
	"citation-invalid": "回答中的知识库引用格式不合法。",
	"citation-budget": "本次回答的引用超过检查上限，请拆分为更小的回答。",
	"source-unread": "回答引用了本轮没有实际阅读的条目。",
	"delivery-changed": "本轮生成的产物在保存后发生变化，不能沿用旧的产物回执。",
	"source-changed": "引用内容在阅读后发生了变化，请读取新版本并重新检索。",
	"wiki-changed": "相关 Wiki 已变化，请读取当前版本后重新检索。",
	"search-stale": "检索后索引版本发生变化，请重新检索当前内容。",
	"binding-changed": "当前知识库绑定已变化，请重新读取导航，不沿用旧知识库的证据。",
	"navigation-changed": "本轮导航已失效，请重新读取导航并完成检索。",
	"not-prepared": "知识库准备步骤尚未完成，回答没有发布。",
	interrupted: "本次请求已中断，未完成的回答没有发布。",
	"check-timeout": "回答前检查超时，草稿没有发布。",
	"check-failed": "回答前检查发生错误，草稿没有发布。",
	"empty-answer": "任务已结束，但模型没有生成可显示的回复。请查看本轮产物或要求继续交付说明。",
	"answer-too-large": "本次回答超出单次检查的大小上限，请分段完成。",
	"protocol-budget": "本轮工具上下文超过安全缓存上限，请开启新一轮任务。",
};
function reason(error) {
	if (notices[error?.code]) return error.code;
	const text = String(error?.message || "");
	if (/binding changed/i.test(text)) return "binding-changed";
	if (/navigation changed/i.test(text)) return "navigation-changed";
	if (/navigation|prepare_knowledge/i.test(text)) return "not-prepared";
	return "check-failed";
}
function base(message, content) {
	// Do not retain unvalidated provider error strings or auxiliary content snapshots.
	return {
		role: "assistant",
		content,
		api: message.api,
		provider: message.provider,
		model: message.model,
		usage: message.usage,
		timestamp: message.timestamp,
		stopReason: message.stopReason,
		...(message.responseId ? { responseId: message.responseId } : {}),
		...(message.stopReason === "error" ? { errorMessage: "请求出错；未经检查的回答没有发布。" } : {}),
	};
}
function seal(message, content, detail) {
	const proof = { version: 1, id: randomUUID(), ...detail, contentHash: hash(content) };
	state.proofs.add(proof);
	return { ...base(message, content), [FIELD]: proof };
}
function blocked(message, code = "check-failed", turnId = null, operational = null, paths = []) {
	return seal(
		message,
		[
			{
				type: "text",
				text: operational || `【知识库检查未通过】${notices[code] || notices["check-failed"]}`,
			},
		],
		{
			status: "blocked",
			reason: code,
			turnId,
			...(paths.length ? { paths } : {}),
			scientificallyVerified: false,
		},
	);
}
export function knowledgeFailure(error) {
	const code = reason(error),
		paths = [];
	for (const path of Array.isArray(error?.paths) ? error.paths : []) {
		if (typeof path === "string" && path.length <= 512 && !/[\r\n<>]/.test(path)) paths.push(path);
		if (paths.length >= 6) break;
	}
	return { code, message: notices[code] || notices["check-failed"], paths };
}

function isSealed(message, restore = false) {
	const proof = message?.[FIELD];
	return (
		proof?.version === 1 &&
		(state.proofs.has(proof) || restore) &&
		[
			"released",
			"no-hits",
			"blocked",
			"tool-only",
			"unconfigured",
			"evidence-only",
			"setup-complete",
		].includes(proof.status) &&
		proof.contentHash === hash(message.content)
	);
}
function inplace(target, source) {
	for (const name of Object.keys(target)) delete target[name];
	Object.assign(target, source);
	return target;
}
export function projectKnowledgeEvent(event) {
	if (!process.env.PERCHO_KNOWLEDGE_DIR) return event;
	if (event.type === "message_update") return null; // no draft text/thinking/partial snapshots cross the delivery boundary
	if (event.type === "message_start" && event.message?.role === "assistant")
		return { ...event, message: base(event.message, []) };
	if (event.type === "message_end" && event.message?.role === "assistant") {
		if (!isSealed(event.message)) inplace(event.message, blocked(event.message)); // runs before SDK persistence
		return event;
	}
	if (event.type === "turn_end" && event.message?.role === "assistant")
		return { ...event, message: isSealed(event.message) ? event.message : blocked(event.message) };
	if (event.type === "agent_end")
		return {
			...event,
			messages: event.messages.map((m) => (m.role === "assistant" && !isSealed(m) ? blocked(m) : m)),
		};
	return event;
}
export function projectKnowledgeSnapshot(messages, persisted = []) {
	if (!process.env.PERCHO_KNOWLEDGE_DIR) return messages;
	const known = new Set(
		persisted.filter((m) => m.role === "assistant").map((m) => `${m.timestamp}:${hash(m.content)}`),
	);
	return messages.map((m) => {
		if (m.role !== "assistant" || isSealed(m)) return m;
		const saved = known.has(`${m.timestamp}:${hash(m.content)}`);
		if (saved && (!m[FIELD] || isSealed(m, true))) return m; // legacy history is not retroactively certified
		return blocked(m);
	});
}
state.projectEvent = projectKnowledgeEvent;
state.projectSnapshot = projectKnowledgeSnapshot;

export function registerAnswerPublication(
	pi,
	{ getCurrent, evidenceOnly = false, getDeliveryFooter = null, getTaskFeedback = null },
) {
	let turnId = null,
		required = true,
		started = false,
		protocolBytes = 0,
		setupReceipt = null;
	const protocol = new Map(),
		deliveries = new Map();
	const failure = (message, error) => {
		const info = knowledgeFailure(error);
		const report = getTaskFeedback?.()?.report(info.code, info.message, info.paths);
		return blocked(message, info.code, turnId, report, info.paths);
	};
	// Keep signed model protocol blocks unchanged in live provider context, not in public history.
	pi.on("context", async (event) => ({
		messages: event.messages.map((message) => {
			const original = protocol.get(message[FIELD]?.id);
			return original ? { ...message, content: original } : message;
		}),
	}));
	pi.on("message_end", async (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		const report = (message) => {
			if (message[FIELD]?.status !== "tool-only") publicationKnowledgeFlow(ctx, message[FIELD]);
			return { message };
		};
		const blocks = Array.isArray(message.content) ? message.content : [];
		const tools = blocks.filter((b) => b.type === "toolCall");
		if (tools.length) {
			const bytes = Buffer.byteLength(JSON.stringify(blocks), "utf8");
			if (protocolBytes + bytes > 4 * 1024 * 1024 || protocol.size >= 64) {
				const denied = blocked(message, "protocol-budget", turnId);
				denied.stopReason = "stop";
				return report(denied);
			}
			const safe = seal(message, tools, { status: "tool-only", turnId, scientificallyVerified: false });
			protocol.set(safe[FIELD].id, structuredClone(blocks));
			protocolBytes += bytes;
			return report(safe);
		}
		if (["error", "aborted", "length", "pending"].includes(message.stopReason) || ctx.signal?.aborted)
			return report(failure(message, { code: "interrupted" }));
		const content = blocks.filter((b) => b.type === "text");
		// Only the controlled setup writer can set this receipt. Never whitelist model-written claims.
		if (setupReceipt) {
			const done = setupReceipt;
			setupReceipt = null;
			try {
				await done.checkCurrent?.();
			} catch {
				return report(blocked(message, "binding-changed", turnId));
			}
			return report(
				seal(
					message,
					[
						{
							type: "text",
							text: [
								"知识库初始化已完成。",
								`当前知识库：${done.vault}`,
								`作用范围：整个 Percho；当前项目：${done.project || "尚未创建项目分区"}。`,
								`结构：${done.profile}；沉淀策略：${done.depositMode}；子智能体访问：${done.subagentMcpPolicy}。`,
								"已保存绑定并创建缺失的导航和模板，未搬迁或删除已有笔记。",
								"这只是初始化完成，不代表论文已经下载、知识已经整理或原始 MCP 已连接。",
								"接下来可以要求检索或下载资料；论文应交付主要观点与方法，软件应交付版本对应的命令、参数与示例。",
							].join("\n\n"),
						},
					],
					{
						status: "setup-complete",
						turnId,
						vaultId: done.vaultId,
						bindingRevision: done.bindingRevision,
						scientificallyVerified: false,
					},
				),
			);
		}
		if (!content.some((block) => block.text?.trim()))
			return report(failure(message, { code: "empty-answer" }));
		if (evidenceOnly)
			return {
				message: seal(
					message,
					[{ type: "text", text: "【子智能体待核验材料】以下不是主会话已核验的最终结论。\n\n" }, ...content],
					{ status: "evidence-only", turnId, scientificallyVerified: false },
				),
			};
		if (!started) return report(blocked(message, "not-prepared", turnId));
		if (!required)
			return report(
				seal(message, content, { status: "unconfigured", turnId, scientificallyVerified: false }),
			);
		const text = content.map((b) => b.text).join("\n");
		if (Buffer.byteLength(text, "utf8") > 128 * 1024)
			return report(blocked(message, "answer-too-large", turnId));
		updateKnowledgeFlow(ctx, { phase: "checking" });
		let timer;
		try {
			const c = getCurrent(ctx);
			if (!c) throw Object.assign(new Error("not prepared"), { code: "not-prepared" });
			const proof = await Promise.race([
				c.service.validateAnswer(c.ticket, ctx.cwd, text, { deliveries: [...deliveries.values()] }),
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(Object.assign(new Error("check timeout"), { code: "check-timeout" })),
						5000,
					);
				}),
			]);
			if (ctx.signal?.aborted) return report(failure(message, { code: "interrupted" }));
			const published =
				proof.status === "no-hits"
					? [
							{
								type: "text",
								text: "【知识库检索无命中】本轮查询未找到匹配条目；下文不是基于本库证据的结论，也不表示全库不存在相关知识。\n\n",
							},
							...content,
						]
					: content;
			const footer = typeof getDeliveryFooter === "function" ? getDeliveryFooter(ctx) : null;
			const visible = footer
				? [...published, { type: "text", text: `\n\n${String(footer).slice(0, 2000)}` }]
				: published;
			return report(
				seal(message, visible, {
					...proof,
					status: proof.status === "ready" ? "released" : "no-hits",
					turnId,
				}),
			);
		} catch (error) {
			return report(failure(message, error));
		} finally {
			if (timer) clearTimeout(timer);
		}
	});
	return {
		async recordDelivery(ctx, path) {
			const c = getCurrent(ctx);
			if (!c) return;
			const receipt = await c.service.deliveryReceipt(c.ticket, ctx.cwd, path);
			deliveries.set(receipt.path, receipt);
			while (deliveries.size > 12) deliveries.delete(deliveries.keys().next().value);
		},
		async preflight(ctx, text) {
			let timer;
			try {
				if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 128 * 1024)
					throw { code: "answer-too-large" };
				const c = getCurrent(ctx),
					proof = await Promise.race([
						c.service.validateAnswer(c.ticket, ctx.cwd, text, { deliveries: [...deliveries.values()] }),
						new Promise((_, reject) => {
							timer = setTimeout(() => reject({ code: "check-timeout" }), 5000);
						}),
					]);
				return { ok: true, proof };
			} catch (error) {
				const info = knowledgeFailure(error);
				return {
					ok: false,
					...info,
					next: "Read the listed evidence paths or repair the reported stage, then call research_check_answer again. Do not redownload existing artifacts or cite a presentation as evidence.",
					task: getTaskFeedback?.()?.facts(),
				};
			} finally {
				if (timer) clearTimeout(timer);
			}
		},
		recordSetup(result, checkCurrent) {
			if (result?.state === "ready" && result.scope === "application")
				setupReceipt = {
					vault: result.vault,
					project: result.project,
					profile: result.profile,
					depositMode: result.depositMode,
					subagentMcpPolicy: result.subagentMcpPolicy,
					vaultId: result.vaultId,
					bindingRevision: result.bindingRevision,
					checkCurrent,
				};
		},
		begin(isRequired = true, newTurn = true) {
			started = true;
			required = isRequired;
			if (newTurn) {
				turnId = randomUUID();
				protocol.clear();
				deliveries.clear();
				protocolBytes = 0;
				setupReceipt = null;
			}
		},
		invalidate() {
			started = false;
			required = true;
			turnId = null;
			protocol.clear();
			deliveries.clear();
			protocolBytes = 0;
			setupReceipt = null;
		},
		guidance:
			"Answer publication is host-checked. Before a final text answer, use the native knowledge search, read the cited current sources, and include Vault-relative [[path]] citations. Raw hidden reasoning and tool-turn drafts are withheld. Use set_status({text,kind,detail,next}) before each meaningful tool batch for a short public plan, and after a completed stage for observed results/gaps (kind=summary). Keep the sequence public summary → tools → next public summary; no raw private chain-of-thought or invented historical summaries. Do not expose private chain-of-thought. Before sending the final answer, call research_check_answer with the exact draft; fix its explicit missing paths or state the remaining blocker. Generated Show Me/run links are deliverables, not evidence citations. An empty successful search is explicitly labeled, not scientific validation. A failed check publishes only a host notice; do not retry endlessly or use tool outputs as a substitute answer.",
	};
}
