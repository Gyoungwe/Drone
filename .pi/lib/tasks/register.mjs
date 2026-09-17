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
import { createTaskProgression } from "./progress-action.mjs";
import { singleFlightCommand } from "./single-flight.mjs";
import { restoreTaskToolOrder } from "./tool-protocol.mjs";
import { shouldAskToContinue } from "./turn-end-prompt.mjs";
import { clean, createTaskWorkbench, inspectTaskFile, WORKBENCH_ENTRY } from "./workbench.mjs";
import { createZoteroReconciler } from "./zotero-reconcile.mjs";

export function registerWorkbench(pi) {
	let context,
		prepared = false,
		awaitingUser = false,
		halted = false;
	// A tool_result hook runs BEFORE the SDK appends its toolResult message.
	// Lock the entire provider turn, including future calls in a sequential batch.
	let pendingStatus = null;
	let providerTurnOpen = false;
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
	// Status messages enter history only after the complete SDK tool batch is appended.
	const send = (content = journal.render()) => {
		if (providerTurnOpen) {
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
			let idle;
			try {
				idle = !ctx.isIdle || ctx.isIdle();
			} catch {
				// SDK contexts expire on session replacement/disposal; never resume through one.
				cancelHandoff();
				return;
			}
			if (!idle) {
				if (++idleChecks < 40) handoffTimer = setTimeout(() => void handoff().catch(cancelHandoff), 25);
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
						content: `Continue the user-authorized task: ${journal.snapshot().goal}. Scope: ${journal.snapshot().authorizationSummary}. Use saved results, verify uncertain effects before any retry, and complete the remaining deliverables. Do not request routine stage approval. Respect declined installs and all permission/validation gates. If blocked, explain each remaining deliverable: actual evidence, confirmed blocker (or explicitly unknown cause), next action, and whether the user must decide. Use task_status for the latest remaining summary. Resolve routine gaps autonomously; create a specific task_wait only for genuinely needed input/approval. Never change acceptance criteria or mark an item complete to fill the progress bar.`,
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
		handoffTimer = setTimeout(() => void handoff().catch(cancelHandoff), 0);
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
		providerTurnOpen = false;
		pendingStatus = null;
		attach(ctx, true);
		prepared = false;
		awaitingUser = false;
	});
	pi.on("session_tree", (_event, ctx) => {
		cancelHandoff();
		providerTurnOpen = false;
		pendingStatus = null;
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
		providerTurnOpen = true;
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
	pi.on("context", async (event) => ({ messages: restoreTaskToolOrder(event.messages) }));
	pi.on("turn_start", () => {
		providerTurnOpen = true;
	});
	pi.on("turn_end", () => {
		providerTurnOpen = false;
		if (pendingStatus !== null) send(pendingStatus);
	});
	pi.on("tool_call", (event) => {
		providerTurnOpen = true;
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
		await journal.observe(event, ctx.cwd);
		if (event.toolName === "read" && !event.isError)
			await evidence.capture(event, ctx.cwd, await bindingKey());
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
		// Fallback for errors/aborts that end without a normal turn_end.
		providerTurnOpen = false;
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
			// 授权过但停在半路（tool-failure 等原因不在 reserveContinuation 白名单里）：
			// 主动问一次，而不是只刷一张卡让用户自己去侧栏发现任务停了。
			const snapshot = journal.snapshot();
			if (
				last?.stopReason !== "error" &&
				!ctx?.signal?.aborted &&
				shouldAskToContinue(snapshot ? journal.view().tasks.find((t) => t.id === snapshot.id) : null)
			) {
				send();
				try {
					await progressTask({ taskId: snapshot.id, revision: journal.view().revision }, context);
				} catch {
					/* 弹窗失败不应吃掉回合结束；状态卡已发出 */
				}
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
	const progressTask = createTaskProgression(journal, {
		getGeneration: () => handoffGeneration,
		askAuthorization,
		checkBinding: bindingKey,
		continueAuthorized,
		prepareRemaining: () => pi.sendUserMessage("继续", { expandPromptTemplates: false }),
		send,
	});
	pi.registerCommand("task-action", {
		description: "任务面板的版本化用户操作；不授予新权限",
		handler: singleFlightCommand(async (args, ctx) => {
			cancelHandoff();
			attach(ctx);
			if (ctx.isIdle && !ctx.isIdle())
				throw new Error("Stop the agent before changing tasks or inspecting recovery files.");
			if (args.length > 6000) throw new Error("Task command too large.");
			const input = JSON.parse(Buffer.from(args.trim(), "base64url").toString("utf8"));
			if (input.action === "progress") {
				await progressTask(input, ctx);
				return;
			}
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
				if (accepted) {
					journal.command({ taskId: input.taskId, revision: journal.view().revision, action: "select" });
					continueAuthorized(ctx);
				}
				return;
			}
			if (input.action === "acknowledge") {
				const action = journal
					.view()
					.tasks.find((t) => t.id === input.taskId)
					?.actions.find((a) => a.id === input.actionId);
				if (action?.kind === "authorization") {
					const accepted = await askAuthorization({ ...input, action: "ask-authorization" }, ctx);
					send();
					if (accepted) {
						journal.command({ taskId: input.taskId, revision: journal.view().revision, action: "select" });
						continueAuthorized(ctx);
					}
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
		}),
	});
	return journal;
}
