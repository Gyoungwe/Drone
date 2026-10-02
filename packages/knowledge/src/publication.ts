// @ts-nocheck
import { createHash, randomUUID } from "node:crypto";
import { runtimeSlot } from "./runtime-host";
import { diagnosticText } from "./runtime-host";
import {
	advisoryLine,
	advisoryNotice,
	knowledgeFailure,
	publicationNotices as notices,
} from "./publication-policy";
import { evaluateMetacognitivePublication } from "./metacognitive-policy";
import { advisoryCodes, readReviewMode } from "./review-policy";

export { advisoryLine, advisoryNotice, knowledgeFailure };

import { publicationKnowledgeFlow, updateKnowledgeFlow } from "./ui-state";

const state = runtimeSlot(
	"knowledge",
	"publication",
	/** @returns {any} */
	() => ({
		proofs: new WeakSet(),
		projectEvent: projectKnowledgeEvent,
		projectSnapshot: projectKnowledgeSnapshot,
	}),
);
const FIELD = "knowledgePublication";
const hash = (content) =>
	createHash("sha256")
		.update(JSON.stringify(content ?? []))
		.digest("hex");
function sanitizeError(text) {
	return diagnosticText(text, 4096).trim();
}
// The SDK reports a user stop as stopReason="error" for an in-flight request.
// Keep this in the publication boundary so an ordinary cancellation cannot be
// replaced with a misleading knowledge-check failure notice.
function isUserAbortError(message) {
	return /was aborted|request aborted/i.test(String(message?.errorMessage || ""));
}
function base(message, content) {
	// Draft/thinking snapshots stay out of public history. Provider errors are not
	// published as answer text; a sanitized errorMessage is kept for the LLM error card.
	const errorMessage =
		message.stopReason === "error" && typeof message.errorMessage === "string"
			? sanitizeError(message.errorMessage)
			: "";
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
		...(errorMessage ? { errorMessage } : {}),
	};
}
function seal(message, content, detail) {
	const proof = { version: 1, id: randomUUID(), ...detail, contentHash: hash(content) };
	state.proofs.add(proof);
	return { ...base(message, content), [FIELD]: proof };
}
function blocked(message, code = "check-failed", turnId = null, operational = null, paths = [], extra = null) {
	return seal(
		message,
		[
			{
				type: "text",
				text:
					operational ||
					(code === "interrupted"
						? notices.interrupted
						: `【知识库检查未通过】${notices[code] || notices["check-failed"]}`),
			},
		],
		{
			status: "blocked",
			reason: code,
			turnId,
			...(paths.length ? { paths } : {}),
			...(extra && typeof extra === "object" ? extra : {}),
			scientificallyVerified: false,
		},
	);
}
/**
 * Evidence a failed check had already verified before it raised an advisory.
 * Only plain verification metadata is forwarded; never error text or stack data.
 */
function verifiedEvidence(error) {
	const verified = error?.verified;
	if (!verified || typeof verified !== "object") return {};
	const { sources, deliveries, ...rest } = verified;
	return {
		...rest,
		sources: Array.isArray(sources) ? sources : [],
		deliveries: Array.isArray(deliveries) ? deliveries : [],
	};
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
			"operational",
		].includes(proof.status) &&
		proof.contentHash === hash(message.content)
	);
}
function inplace(target, source) {
	for (const name of Object.keys(target)) delete target[name];
	Object.assign(target, source);
	return target;
}
function projectUnsealed(message) {
	if (message.stopReason === "error" && !isUserAbortError(message))
		return seal(message, [], { status: "blocked", reason: "model-error", scientificallyVerified: false });
	if (["aborted", "length", "pending"].includes(message.stopReason) || isUserAbortError(message))
		return blocked(message, "interrupted");
	return blocked(message);
}
export function projectKnowledgeEvent(event) {
	if (!process.env.DRONE_KNOWLEDGE_DIR) return event;
	if (event.type === "message_update") return null; // no draft text/thinking/partial snapshots cross the delivery boundary
	if (event.type === "message_start" && event.message?.role === "assistant")
		return { ...event, message: base(event.message, []) };
	if (event.type === "message_end" && event.message?.role === "assistant") {
		if (!isSealed(event.message)) inplace(event.message, projectUnsealed(event.message)); // runs before SDK persistence
		return event;
	}
	if (event.type === "turn_end" && event.message?.role === "assistant")
		return { ...event, message: isSealed(event.message) ? event.message : projectUnsealed(event.message) };
	if (event.type === "agent_end")
		return {
			...event,
			messages: event.messages.map((m) => (m.role === "assistant" && !isSealed(m) ? projectUnsealed(m) : m)),
		};
	return event;
}
export function projectKnowledgeSnapshot(messages, persisted = []) {
	if (!process.env.DRONE_KNOWLEDGE_DIR) return messages;
	const known = new Set(
		persisted.filter((m) => m.role === "assistant").map((m) => `${m.timestamp}:${hash(m.content)}`),
	);
	return messages.map((m) => {
		if (m.role !== "assistant" || isSealed(m)) return m;
		const saved = known.has(`${m.timestamp}:${hash(m.content)}`);
		if (saved && (!m[FIELD] || isSealed(m, true))) return m; // legacy history is not retroactively certified
		return projectUnsealed(m);
	});
}
export function registerAnswerPublication(
	pi,
	{
		runtime = null,
		getCurrent,
		evidenceOnly = false,
		getDeliveryFooter = null,
		getTaskFeedback = null,
		getTaskRuntime = null,
		getMetacognition = null,
		maxToolRounds = 24,
	},
) {
	const attachRuntime = (next) => {
		if (!next || typeof next !== "object" || !next.scheduler || !next.knowledge) return false;
		const slot = next.knowledge.publication || {};
		slot.proofs ??= new WeakSet();
		// The publication instance owns its proof set and its knowledge-service
		// turn state.  Keep these callbacks bound to that instance instead of
		// switching the whole extension into the host runtime: doing so would
		// create a second service/UI state and detach validation from the turn
		// that prepared it.  The host runtime still receives an explicit bridge;
		// no process-global mutable handoff is needed.
		slot.projectEvent = (event) => projectKnowledgeEvent(event);
		slot.projectSnapshot = (messages, persisted) => projectKnowledgeSnapshot(messages, persisted);
		next.knowledge.publication = slot;
		return true;
	};
	if (runtime) attachRuntime(runtime);
	let turnId = null,
		required = true,
		started = false,
		protocolBytes = 0,
		toolRounds = 0,
		setupReceipt = null;
	const protocol = new Map(),
		deliveries = new Map();
	// A nonblocking advisory must not hide host-generated delivery notices
	// (saved artifacts, pending Wiki candidates) from the published answer.
	const advisoryFooter = (ctx) => {
		const footer = typeof getDeliveryFooter === "function" ? getDeliveryFooter(ctx) : null;
		return footer ? [{ type: "text", text: `\n\n${String(footer).slice(0, 2000)}` }] : [];
	};
	const failure = (message, error) => {
		const info = knowledgeFailure(error);
		const metacognitive = error?.metacognition;
		const metacognitiveReport =
			metacognitive && Array.isArray(metacognitive.failures) && metacognitive.failures.length
				? metacognitive.failures
						.slice(0, 8)
						.map((item) => `- ${String(item.detail || item.code).slice(0, 600)}`)
						.join("\n")
				: "";
		const task = getTaskRuntime?.();
		if (task?.snapshot()) task.pause(info.code);
		const report = task?.snapshot()
			? `${task.render()}\n\n研究说明尚未发布：${info.message}`
			: getTaskFeedback?.()?.report(info.code, info.message, info.paths);
		return blocked(
			message,
			info.code,
			turnId,
			[report, metacognitiveReport].filter(Boolean).join("\n\n") || null,
			info.paths,
			metacognitive ? { metacognition: metacognitive } : null,
		);
	};
	const evaluateMetacognition = async (ctx, current, text) => {
		if (typeof getMetacognition !== "function") return null;
		let snapshot;
		try {
			snapshot = await getMetacognition(ctx, current);
		} catch {
			throw Object.assign(new Error("Metacognitive host snapshot unavailable"), {
				code: "metacognitive-inconsistency",
				metacognition: {
					ok: false,
					findings: [],
					failures: [
						{
							code: "metacognition-invalid",
							subject: "host-snapshot",
							detail: "Host metacognitive snapshot could not be read",
						},
					],
				},
			});
		}
		if (snapshot == null) return null;
		const evaluation = evaluateMetacognitivePublication(text, snapshot);
		if (!evaluation.ok)
			throw Object.assign(new Error("Metacognitive publication checks failed"), {
			code: "metacognitive-inconsistency",
			paths: evaluation.failures.map((item) => item.path).filter(Boolean).slice(0, 6),
			metacognition: evaluation,
			verified: { metacognition: evaluation },
			});
		return evaluation;
	};
	// Keep signed model protocol blocks unchanged in live provider context, not in public history.
	pi.on("context", async (event) => ({
		messages: event.messages.map((message) => {
			const original = protocol.get(message[FIELD]?.id);
			return original ? { ...message, content: original } : message;
		}),
	}));
	const handleMessageEnd = async (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		const report = (message) => {
			if (message[FIELD]?.status !== "tool-only" && message[FIELD]?.reason !== "model-error")
				publicationKnowledgeFlow(ctx, message[FIELD]);
			return { message };
		};
		const blocks = Array.isArray(message.content) ? message.content : [];
		const tools = blocks.filter((b) => b.type === "toolCall");
		if (tools.length) {
			toolRounds += 1;
			if (toolRounds > maxToolRounds && getTaskRuntime?.()?.advanceStage?.()) toolRounds = 1;
			const bytes = Buffer.byteLength(JSON.stringify(blocks), "utf8");
			// 熔断：软预算（tool-budget 的 read/search 上限）只是建议，弱模型会无视并空转。
			// 这里在本轮工具轮次超过硬上限（或字节/条数兜底）时强制结束本轮——早于旧的 64 轮/4MB，
			// 把「转几分钟还不作答」压到 ~1 分钟，并给出可操作提示而非「知识库检查未通过」。
			if (toolRounds > maxToolRounds || protocolBytes + bytes > 4 * 1024 * 1024 || protocol.size >= 64) {
				const limit =
					toolRounds > maxToolRounds
						? "tool-round-limit"
						: protocolBytes + bytes > 4 * 1024 * 1024
							? "protocol-byte-limit"
							: "protocol-entry-limit";
				const task = getTaskRuntime?.();
				task?.pause(limit);
				const reportText = [notices["tool-loop-stopped"], task?.snapshot() ? task.render() : null]
					.filter(Boolean)
					.join("\n\n");
				const denied = blocked(message, "tool-loop-stopped", turnId, reportText);
				denied[FIELD].limit = {
					kind: limit,
					toolRounds,
					maxToolRounds,
					protocolBytes,
					entries: protocol.size,
				};
				denied.stopReason = "stop";
				return report(denied);
			}
			const safe = seal(message, tools, { status: "tool-only", turnId, scientificallyVerified: false });
			protocol.set(safe[FIELD].id, structuredClone(blocks));
			protocolBytes += bytes;
			return report(safe);
		}
		if (message.stopReason === "error" && !isUserAbortError(message))
			return report(
				seal(message, [], {
					status: "blocked",
					reason: "model-error",
					turnId,
					scientificallyVerified: false,
				}),
			);
		if (
			["aborted", "length", "pending"].includes(message.stopReason) ||
			ctx.signal?.aborted ||
			isUserAbortError(message)
		)
			return report(failure(message, { code: "interrupted" }));
		const content = blocks.filter((b) => b.type === "text");
		// A status query must not replace the model's explanation with a stale host snapshot.
		// Drain legacy requests, but never use them to bypass the normal publication/evidence checks.
		if (!evidenceOnly) getTaskRuntime?.()?.takeReport();
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
								`作用范围：整个 Drone；当前项目：${done.project || "尚未创建项目分区"}。`,
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
		try {
			const c = getCurrent(ctx);
			if (!c) throw Object.assign(new Error("not prepared"), { code: "not-prepared" });
			let publishText = text;
			let publishContent = content;
			const attachMaterializedCitations = async (refresh = false) => {
				if (typeof c.service.materializeCitations !== "function") return;
				const paths = await c.service.materializeCitations(c.ticket, ctx.cwd, c.query, { refresh });
				if (!paths.length || /\[\[[^\]]+\]\]/.test(publishText)) return;
				const suffix = `\n\n依据：${paths.map((path) => `[[${path.replace(/\.md$/i, "")}]]`).join(" ")}`;
				publishText = `${publishText}${suffix}`;
				publishContent = publishContent.map((block, index) =>
					block.type === "text" && index === publishContent.length - 1
						? { ...block, text: `${block.text}${suffix}` }
						: block,
				);
			};
			const validateWithTimeout = async () => {
				let timer;
				try {
					return await Promise.race([
						c.service.validateAnswer(c.ticket, ctx.cwd, publishText, {
							deliveries: [...deliveries.values()],
						}),
						new Promise((_, reject) => {
							timer = setTimeout(
								() => reject(Object.assign(new Error("check timeout"), { code: "check-timeout" })),
								5000,
							);
						}),
					]);
				} finally {
					if (timer) clearTimeout(timer);
				}
			};
			const automatic = (await readReviewMode()) === "automatic";
			if (!automatic) await attachMaterializedCitations();
			let proof;
			try {
				proof = await validateWithTimeout();
			} catch (error) {
				if (automatic || !["coverage-incomplete", "search-stale"].includes(error?.code)) throw error;
				// A late watcher event can invalidate an otherwise current search. Refresh exactly once;
				// strict validation still decides whether the answer is publishable.
				await attachMaterializedCitations(true);
				proof = await validateWithTimeout();
			}
			if (ctx.signal?.aborted) return report(failure(message, { code: "interrupted" }));
			const metacognitive = await evaluateMetacognition(ctx, c, publishText);
			const published =
				proof.status === "no-hits"
					? [
							{
								type: "text",
								text: "【知识库检索无命中】本轮查询未找到匹配条目；下文不是基于本库证据的结论，也不表示全库不存在相关知识。\n\n",
							},
							...publishContent,
						]
					: publishContent;
			const footer = typeof getDeliveryFooter === "function" ? getDeliveryFooter(ctx) : null;
			const visible = footer
				? [...published, { type: "text", text: `\n\n${String(footer).slice(0, 2000)}` }]
				: published;
			return report(
				seal(message, visible, {
					...proof,
					...(metacognitive ? { metacognition: metacognitive } : {}),
					status: proof.status === "ready" ? "released" : "no-hits",
					turnId,
				}),
			);
		} catch (error) {
			const info = knowledgeFailure(error);
			if ((await readReviewMode()) === "automatic" && advisoryCodes.has(info.code) && !ctx.signal?.aborted) {
				try {
					const current = getCurrent(ctx);
					await current.service.check(current.ticket, ctx.cwd);
				} catch (authorityError) {
					return report(failure(message, authorityError));
				}
				return report(
					seal(
						message,
						[
							...content,
							{
								type: "text",
								text: `\n\n【有提醒】${advisoryLine(info.code, error)}`,
							},
							...advisoryFooter(ctx),
						],
						{
							status: "released",
							reviewMode: "automatic",
							...verifiedEvidence(error),
							warnings: [info],
							turnId,
							scientificallyVerified: false,
						},
					),
				);
			}
			return report(failure(message, error));
		}
	};
	pi.on("message_end", (event, ctx) => handleMessageEnd(event, ctx));
	return {
		attachRuntime,
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
				const metacognition = await evaluateMetacognition(ctx, c, text);
				return { ok: true, proof, ...(metacognition ? { metacognition } : {}) };
			} catch (error) {
				const info = knowledgeFailure(error);
				if ((await readReviewMode()) === "automatic" && advisoryCodes.has(info.code)) {
					try {
						const current = getCurrent(ctx);
						await current.service.check(current.ticket, ctx.cwd);
					} catch {
						return {
							ok: false,
							code: "binding-changed",
							message: "Refresh the current knowledge binding before continuing.",
						};
					}
					return {
						ok: true,
						status: "warning",
						...verifiedEvidence(error),
						warnings: [info],
						scientificallyVerified: false,
						next: "Deliver the answer with its limitations. Do not repeat read/search/check solely to clear this advisory.",
					};
				}
				return {
					ok: false,
					...info,
					next: "For operational progress, call task_status and deliver its host receipt without unrelated citations. For scientific claims, read the listed evidence or repair the reported stage, then check again. Never retry a write merely because output was lost.",
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
				toolRounds = 0;
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
			toolRounds = 0;
			setupReceipt = null;
		},
		get guidance() {
			return readReviewMode() === "automatic"
				? "Answer the user's question directly. For a planning request, first provide a concise provisional framework with explicit assumptions, then deepen only the evidence needed. Cite scientific claims inline using exact [[path]] citations from research_read_knowledge results read this turn; a saved report link is a deliverable, not an evidence citation. Reuse successful read receipts instead of reading the same source through both generic read and research_read_knowledge. Do not invent citations or cite a source merely to clear a warning. Label suggested sample sizes as design heuristics, not universal statistical thresholds. Acknowledge uncertainty and save useful knowledge. Evidence quality reminders are nonblocking: do not run repeated read/search/check just to clear them. Never claim scientific verification. Host permission, binding, abort and spending limits still apply; human Wiki edits require confirmation."
				: "For execution progress in ANY task (analysis, code, environment, experiments, writing), use task_status; its host-generated report needs no research citations. Never add irrelevant sources to an operational report. Scientific host-checked answers need a current-turn search, reads of cited [[path]] sources, then research_check_answer. Public text must answer the user's question; do not lecture about Vault policy or evidence-gate stages. Use short set_status about the task, not product design. Show Me/run links are deliverables, not evidence.";
		},
	};
}
