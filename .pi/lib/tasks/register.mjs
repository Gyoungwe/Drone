import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { readKnowledgeBinding } from "../knowledge/config.mjs";
import { currentProject } from "../knowledge/extension-helpers.mjs";
import { getKnowledgeService } from "../knowledge/service.mjs";
import { previewWikiProposal } from "../knowledge/wiki-review.mjs";
import { createTaskAuthorization } from "./ask-authorization.mjs";
import { resolveWriteRoots } from "./consent.mjs";
import { createEvidenceRecovery } from "./evidence.mjs";
import {
	FAILURE_EXPLANATION_POLICY,
	failureContext,
	failureObservation,
	TASK_HANDOFF_POLICY,
	taskProgressContext,
	toolResultFailed,
} from "./failure-feedback.mjs";
import { clean, createTaskWorkbench, inspectTaskFile, WORKBENCH_ENTRY } from "./workbench.mjs";
import { createZoteroReconciler } from "./zotero-reconcile.mjs";

export function registerWorkbench(pi) {
	let context,
		prepared = false,
		awaitingUser = false,
		halted = false;
	// 回合执行中被挂起的状态卡内容；由 agent_end 补发。见 send()。
	let pendingStatus = null;
	// 已发出但结果尚未写回的 tool_call 数。>0 表示当前正处于
	// assistant(tool_calls) 与其 tool 结果之间，此窗口内禁止注入 custom 消息。
	let unpairedToolCalls = 0;
	const authorize = async (cwd, path) => {
		if (!context || !pi.events?.emit)
			throw new Error("Current read-permission adapter unavailable; refusing recovery read.");
		let handled = false;
		const allowed = await new Promise((resolveResult) => {
			const request = {
				cwd,
				path: resolve(cwd, path),
				sessionId: context.sessionManager?.getSessionId?.(),
				resolve: resolveResult,
				claim: () => {
					handled = true;
				},
			};
			pi.events.emit("drone:task-read-check", request);
			if (!handled) resolveResult(false);
		});
		if (!allowed) throw new Error("Current permission policy denied this read.");
	};
	const inspect = async (cwd, path, expected) => {
		await authorize(cwd, path);
		const full = resolve(cwd, path);
		const root = journal.readRoots().find((candidate) => {
			const rel = relative(candidate, full);
			return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
		});
		if (root) {
			if (relative(root, await realpath(root)) !== "")
				throw new Error("Approved directory identity changed.");
			const artifact = await inspectTaskFile(root, full, expected);
			return { ...artifact, path: (isAbsolute(path) ? full : relative(cwd, full)).replaceAll("\\", "/") };
		}
		return inspectTaskFile(cwd, path, expected);
	};
	const journal = createTaskWorkbench({
		requireAuthorization: true,
		persist: (snapshot) => pi.appendEntry(WORKBENCH_ENTRY, snapshot),
		onCheckpoint: () => send(),
		getZoteroStatus: createZoteroReconciler(),
		getWikiStatus: async (id) => {
			try {
				const service = await getKnowledgeService();
				const p = await previewWikiProposal(service, id, await currentProject(context.cwd));
				return { status: p.status, path: p.path, stale: p.sources.some((s) => s.changed) };
			} catch {
				return null;
			}
		},
		inspect,
	});
	const askAuthorization = createTaskAuthorization(journal, () => bindingKey());
	const evidence = createEvidenceRecovery({
		authorize,
		persist: (data) => pi.appendEntry("drone-task-evidence-v1", data),
	});
	const attach = (ctx, force = false) => {
		context = ctx;
		const scope = createHash("sha256")
			.update(`${ctx.sessionManager?.getSessionId?.() || ctx.sessionId || "isolated"}\0${resolve(ctx.cwd)}`)
			.digest("hex");
		journal.attach(scope, ctx.sessionManager?.getBranch?.() || [], force);
		evidence.attach(scope, journal.snapshot()?.id, ctx.sessionManager?.getBranch?.() || [], force);
	};
	const bindingKey = async () => {
		const b = await readKnowledgeBinding();
		return b ? `${b.vaultId}:${b.revision}` : null;
	};
	/**
	 * 状态卡只能在回合边界注入。
	 *
	 * tool_call 钩子触发的 advanceStage → onCheckpoint → send() 会落在
	 * 「模型已发出 tool_calls、tool 结果尚未写回」的窗口内。此刻插入 custom
	 * 消息会把 assistant(tool_calls) 与其 tool 结果拆开，OpenAI 兼容协议据此
	 * 判非法，整轮 400「Messages with role 'tool' must be a response to a
	 * preceding message with 'tool_calls'」；且 stageCalls 不复位，用户每次
	 * 「继续」都会复现，形成死局。
	 *
	 * 非空闲时挂起，agent_end 统一补发，卡片内容不丢失。
	 */
	const send = (content = journal.render()) => {
		if (unpairedToolCalls > 0) {
			pendingStatus = content;
			return;
		}
		pendingStatus = null;
		return pi.sendMessage(
			{
				customType: "drone-task-status",
				display: true,
				content,
				details: { operational: true, reportId: randomUUID(), taskView: journal.view() },
			},
			{ triggerTurn: false },
		);
	};
	let handoffGeneration = 0;
	let handoffTimer;
	let automaticTurn = false;
	let continuationToken = null;
	journal.isAutoContinuation = (message) =>
		!!(
			message?.role === "custom" &&
			message.customType === "drone-task-autocontinue" &&
			continuationToken &&
			message.details?.nonce === continuationToken &&
			message.details?.taskId === journal.snapshot()?.id &&
			journal.authorization()
		);
	const cancelHandoff = () => {
		handoffGeneration++;
		clearTimeout(handoffTimer);
		automaticTurn = false;
		continuationToken = null;
	};
	const continueAuthorized = (ctx) => {
		const taskId = journal.snapshot()?.id;
		const generation = ++handoffGeneration;
		let idleChecks = 0;
		const handoff = async () => {
			if (
				generation !== handoffGeneration ||
				context !== ctx ||
				journal.snapshot()?.id !== taskId ||
				!journal.authorization()
			)
				return;
			if (ctx.isIdle && !ctx.isIdle()) {
				if (++idleChecks < 40) handoffTimer = setTimeout(() => void handoff(), 25);
				else {
					journal.pause("auto-handoff-not-idle");
					send();
				}
				return;
			}
			try {
				const binding = await bindingKey();
				if (generation !== handoffGeneration || context !== ctx || journal.snapshot()?.id !== taskId) return;
				const result = journal.begin("继续", [], binding);
				if (
					result.blocked ||
					["blocked", "waiting_user"].includes(journal.snapshot()?.state) ||
					!journal.authorization()
				) {
					send();
					return;
				}
				prepared = true;
				automaticTurn = true;
				continuationToken = randomUUID();
				pi.sendMessage(
					{
						customType: "drone-task-autocontinue",
						display: false,
						details: { taskId, nonce: continuationToken },
						content: `Continue the user-authorized task: ${journal.snapshot().goal}. Scope: ${journal.snapshot().authorizationSummary}. Use saved results, verify uncertain effects before any retry, and complete the remaining deliverables. Do not request routine stage approval. Respect declined installs and all permission/validation gates. If blocked, clearly deliver what exists and the one real blocker instead of silently extending scope.`,
					},
					{ triggerTurn: true, deliverAs: "followUp" },
				);
			} catch (e) {
				if (
					generation !== handoffGeneration ||
					context !== ctx ||
					journal.snapshot()?.id !== taskId ||
					["completed", "cancelled", "archived"].includes(journal.snapshot()?.state)
				)
					return;
				journal.pause("auto-handoff-failed");
				send(`自动续作未启动：${clean(e.message)}。已保留原结果，没有重复执行。`);
			}
		};
		handoffTimer = setTimeout(() => void handoff(), 0);
	};
	pi.on("session_shutdown", cancelHandoff);
	// Current task consent is exposed only to the existing permission adapter, never to model tool inputs.
	pi.events?.on?.("drone:task-write-consent", (request) => {
		if (
			context &&
			request.cwd === context.cwd &&
			request.sessionId === context.sessionManager?.getSessionId?.()
		)
			request.respond?.(journal.authorization(true));
	});
	const prepare = async (query, ctx) => {
		attach(ctx);
		const entries = ctx.sessionManager?.getBranch?.() || [];
		const caps =
			[...entries].reverse().find((e) => e.customType === "drone-capability-checkpoint-v1")?.data
				?.capabilities || [];
		const result = journal.begin(query, caps, await bindingKey());
		evidence.attach(evidence.scope(), journal.snapshot()?.id, entries);
		halted = false;
		return result;
	};
	pi.on("session_start", (_event, ctx) => {
		cancelHandoff();
		attach(ctx, true);
		prepared = false;
		awaitingUser = false;
	});
	pi.on("session_tree", (_event, ctx) => {
		cancelHandoff();
		attach(ctx, true);
		prepared = false;
		halted = false;
	});
	pi.on("input", async (event, ctx) => {
		cancelHandoff();
		if (ctx.isIdle && !ctx.isIdle()) return { action: "continue" };
		try {
			const result = await prepare(event.text, ctx);
			if (result.selectionRequired || result.blocked) {
				send();
				return { action: "handled" };
			}
			prepared = true;
		} catch (e) {
			halted = true;
			pi.sendMessage(
				{
					customType: "drone-task-status",
					display: true,
					content: `任务未开始：${clean(e.message)}\n${journal.render()}`,
					details: { reportId: randomUUID(), taskView: journal.view() },
				},
				{ triggerTurn: false },
			);
			return { action: "handled" };
		}
		return { action: "continue" };
	});
	pi.on("before_agent_start", async (event, ctx) => {
		// 新回合开始：配对计数归零，避免上一回合残留导致状态卡永久挂起
		unpairedToolCalls = 0;
		if (!prepared) {
			try {
				await prepare(event.prompt, ctx);
			} catch {
				halted = true;
			}
		}
		prepared = false;
		awaitingUser = !automaticTurn;
		automaticTurn = false;
		return {
			systemPrompt: `${event.systemPrompt || ""}\n\n${FAILURE_EXPLANATION_POLICY}\n\n${TASK_HANDOFF_POLICY}`,
			message: {
				customType: "drone-task-context",
				display: false,
				content: `${journal.render()}\nHost observations only. For substantial execution, first do read-only preparation, consolidate necessary choices/assumptions and call task_plan ONCE with the original user goal, a plain-language scope summary, existing write directories, and file-based deliverables. task_plan automatically opens the host ask_user form for task execution, directory writes, acceptance and automatic stage continuation. Task cards are status and request-entry UI, not consent. Do not duplicate the host question or treat free text as authorization. If declined, stop at the checkpoint. Additional authorization actions from task_wait also open ask_user. Within approved scope, perform routine steps and bounded recovery autonomously; only new risk/scope, credentials, genuinely unavailable user data or actual required human review need intervention. Never claim human/scientific review happened automatically. Prefer machine-checkable deliverables over unnecessary human-review milestones. Preserve prior refusals. File/command denies, sensitive files, unknown effects, total call budget and provenance checks remain binding. task_status delivers host-only results.`,
			},
		};
	});
	pi.on("message_start", async (event, ctx) => {
		if (journal.isAutoContinuation(event.message)) {
			prepared = false;
			automaticTurn = false;
			awaitingUser = false;
			const result = journal.begin("继续", [], await bindingKey());
			halted = !!result.blocked;
			return;
		}
		if (event.message.role !== "user") return;
		if (awaitingUser) {
			awaitingUser = false;
			return;
		}
		const content = event.message.content,
			query =
				typeof content === "string"
					? content
					: (content || [])
							.filter((b) => b.type === "text")
							.map((b) => b.text)
							.join("\n");
		try {
			const result = await prepare(query, ctx);
			if (result.selectionRequired || result.blocked) {
				halted = true;
				send();
			}
		} catch {
			halted = true;
		}
	});
	pi.on("tool_call", (event) => {
		// 结果写回前，任何 custom 注入都会拆散 assistant(tool_calls)/tool 配对
		unpairedToolCalls++;
		if (halted && event.toolName !== "task_status")
			return {
				block: true,
				reason:
					"Task selection/recovery is required. Return the saved task status; do not perform queued effects.",
			};
		try {
			return journal.guard(event) || undefined;
		} catch (e) {
			return { block: true, reason: clean(e.message) };
		}
	});
	pi.on("tool_result", async (event, ctx) => {
		if (unpairedToolCalls > 0) unpairedToolCalls--;
		await journal.observe(event, ctx.cwd);
		if (event.toolName === "read" && !event.isError)
			await evidence.capture(event, ctx.cwd, await bindingKey());
		// 全部结果已配对：补发执行中被挂起的状态卡（阶段推进卡不因此丢失）
		if (unpairedToolCalls === 0 && pendingStatus !== null) {
			const held = pendingStatus;
			pendingStatus = null;
			send(held);
		}
		if (toolResultFailed(event)) {
			const context = failureContext(journal.snapshot(), failureObservation(event, new Date().toISOString()));
			return { content: [...(event.content || []), { type: "text", text: context }] };
		}
	});
	pi.events?.on?.("drone:context-evicted", (event) => {
		if (event.sessionId === context?.sessionManager?.getSessionId?.()) evidence.evict(event.toolCallIds);
	});
	pi.on("agent_end", async (event, ctx) => {
		const last = [...(event.messages || [])].reverse().find((m) => m.role === "assistant");
		// 回合结束：清零配对计数（错误/中断回合可能留下未配对项，否则状态卡将永久挂起），
		// 再释放执行中被挂起的卡片。
		unpairedToolCalls = 0;
		const held = pendingStatus;
		pendingStatus = null;
		if (held) send(held);
		if (
			last?.stopReason === "aborted" ||
			ctx?.signal?.aborted ||
			/was aborted|request aborted/i.test(last?.errorMessage || "")
		) {
			cancelHandoff();
			journal.pause("user-aborted");
			send();
			return;
		}
		journal.settle();
		if (journal.authorization()) {
			try {
				await journal.reconcile(context.cwd);
			} catch {
				/* no consent or proof is fabricated */
			}
			if (
				last?.knowledgePublication?.status === "blocked" &&
				last.stopReason !== "error" &&
				journal.reserveContinuation(last.knowledgePublication.reason)
			) {
				send("已按本任务授权自动续作：沿用已保存结果，先核对再继续，无需再次确认阶段。");
				continueAuthorized(context);
				return;
			}
		}
		send();
	});
	const tool = (name, description, properties, required, execute) =>
		pi.registerTool({
			name,
			label: name,
			description,
			parameters: { type: "object", properties, required, additionalProperties: false },
			execute: async (_id, input, _signal, _update, ctx) => {
				attach(ctx);
				const result = await execute(input, ctx, _signal);
				return {
					content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
					details: { operational: true },
				};
			},
		});
	const str = { type: "string", minLength: 1, maxLength: 512 };
	tool(
		"task_status",
		"Host task ledger for any scientific workflow. No model/evidence certification. Query before repeating uncertain effects.",
		{},
		[],
		async (_input, ctx) => {
			let notice = "";
			if (journal.authorization()) {
				try {
					await journal.reconcile(ctx.cwd);
				} catch (e) {
					notice = `\n本次只读核对未完成：${String(e.message).replace(/\s+/g, " ").slice(0, 120)}。下列信息可能仍是上一次观察，不能当作本次已确认。`;
				}
			} else {
				notice =
					"\n本次只返回已保存的观察，未进行新的文件核对；这不表示需要重新授权或重复执行。请结合当前权限、待办和未确定操作说明下一步。";
			}
			return `${journal.render()}${notice}${taskProgressContext(journal.snapshot())}`;
		},
	);
	tool(
		"task_plan",
		"Prepare ONE task authorization after read-only discovery: original goal, understandable scope, existing write directories, and immutable deliverables. Bundle necessary choices here instead of asking about each step. The host opens ask_user automatically; only its explicit approval authorizes the shown task revision. The user authorizes once; normal stages and bounded recovery then proceed automatically. No authorization of new risks, arbitrary commands, credentials or scientific conclusions.",
		{
			goal: { ...str, maxLength: 180 },
			summary: { type: "string", minLength: 1, maxLength: 1200 },
			writeDirectories: { type: "array", maxItems: 8, items: str },
			milestones: {
				type: "array",
				minItems: 1,
				maxItems: 24,
				items: {
					type: "object",
					properties: {
						id: str,
						title: str,
						dependsOn: { type: "array", maxItems: 24, items: str },
						acceptance: {
							type: "object",
							properties: {
								kind: { type: "string", enum: ["file", "human_review", "wiki_review", "zotero_item"] },
								path: str,
								doi: str,
								libraryId: str,
								collection: str,
								sha256: str,
							},
							required: ["kind"],
							additionalProperties: false,
						},
					},
					required: ["id", "title", "acceptance"],
					additionalProperties: false,
				},
			},
		},
		["summary", "milestones"],
		async (input, ctx, signal) => {
			const writeRoots = await resolveWriteRoots(ctx.cwd, input.writeDirectories || []);
			const result = journal.plan({ ...input, writeRoots });
			send("方案已准备好，授权通过 ask_user 提问；任务卡仅展示状态，不会直接授予权限。");
			const authorized = await askAuthorization(
				{ taskId: journal.snapshot().id, revision: journal.view().revision, action: "authorize-task" },
				ctx,
				signal,
			);
			send(
				authorized
					? "ask_user：已同意所示任务范围，可以继续执行。"
					: "ask_user：尚未授权，任务保留在检查点；不执行写入。",
			);
			return {
				milestones: result,
				authorized,
				next: authorized
					? "Continue within the approved scope."
					: "Stop and retain the checkpoint. Do not repeat the authorization question.",
			};
		},
	);
	tool(
		"task_wait",
		"Create a tracked human download/file, permission or review action. Supply the requested identity (title/DOI/hash), not generic download instructions. Cancellation is not consent; Wiki approval uses its existing review UI.",
		{
			kind: { type: "string", enum: ["file", "download", "authorization", "review"] },
			title: str,
			reason: str,
			url: str,
			doi: str,
			sha256: str,
			milestoneId: str,
		},
		["kind", "title", "reason"],
		async (input, ctx, signal) => {
			const action = journal.wait(input);
			if (action.kind !== "authorization") return action;
			const authorized = await askAuthorization(
				{
					taskId: journal.snapshot().id,
					revision: journal.view().revision,
					action: "ask-authorization",
					actionId: action.id,
				},
				ctx,
				signal,
			);
			send(
				authorized
					? "ask_user：已记录此次范围确认；具体操作仍受权限检查约束。"
					: "ask_user：未授权，保留待处理事项；不会默认同意。",
			);
			return { ...action, state: authorized ? "acknowledged" : "pending", authorized };
		},
	);
	tool(
		"task_reconcile",
		"Read-only revalidation of recorded workspace artifacts under CURRENT read permissions. Does not rerun commands, certify scientific conclusions or approve Wiki.",
		{},
		[],
		(_input, ctx) => journal.reconcile(ctx.cwd),
	);
	tool(
		"task_evidence_restore",
		"Recover a host-recorded, actually evicted file window only after current permission and version checks. At most two recoveries per task, bounded bytes. Does not mint scientific evidence receipts.",
		{ receiptId: str, path: str },
		["receiptId", "path"],
		(input, ctx) => evidence.restore(input, ctx.cwd, awaitBinding),
	);
	// Resolve current binding at execution time, not registration time.
	const awaitBinding = () => bindingKey();
	pi.registerCommand("task-status", {
		description: "任务工作台：无模型状态、任务选择、产物与人工动作",
		handler: async (_args, ctx) => {
			attach(ctx);
			send();
		},
	});
	pi.registerCommand("task-action", {
		description: "任务面板的版本化用户操作；不授予新权限",
		handler: async (args, ctx) => {
			cancelHandoff();
			attach(ctx);
			if (ctx.isIdle && !ctx.isIdle())
				throw new Error("Stop the agent before changing tasks or inspecting recovery files.");
			if (args.length > 6000) throw new Error("Task command too large.");
			const input = JSON.parse(Buffer.from(args.trim(), "base64url").toString("utf8"));
			if (input.action === "authorize-task") {
				if (!(await askAuthorization(input, ctx))) {
					send("尚未授权。可稍后通过 ask_user 重新确认。");
					return;
				}
				send(
					"已通过 ask_user 确认本任务授权。我会自动推进并交付结果；你可随时停止，新的风险或范围变更仍需确认。",
				);
				continueAuthorized(ctx);
				return;
			}
			if (["approve-plan", "next-stage", "ask-authorization", "confirm-outcome"].includes(input.action)) {
				const accepted = await askAuthorization(input, ctx);
				send(accepted ? "ask_user：已记录本次确认。" : "ask_user：未确认，状态和授权不变。");
				return;
			}
			if (input.action === "acknowledge") {
				const action = journal
					.view()
					.tasks.find((t) => t.id === input.taskId)
					?.actions.find((a) => a.id === input.actionId);
				if (action?.kind === "authorization") {
					await askAuthorization({ ...input, action: "ask-authorization" }, ctx);
					send();
					return;
				}
			}
			if (input.action === "file") await journal.acceptFile(input, ctx.cwd);
			else if (input.action === "refresh") {
				journal.command({ ...input, action: "select" });
				await journal.reconcile(ctx.cwd);
			} else if (input.action === "resume") {
				journal.command({ ...input, action: "select" });
				const result = journal.begin("继续", [], await bindingKey());
				if (
					result.blocked ||
					journal.snapshot()?.state === "blocked" ||
					journal.snapshot()?.state === "waiting_user"
				) {
					send();
					return;
				}
				send();
				pi.sendUserMessage("继续", { expandPromptTemplates: true });
				return;
			} else journal.command(input);
			send();
		},
	});
	return journal;
}
