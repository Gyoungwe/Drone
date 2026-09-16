import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readKnowledgeBinding } from "../knowledge/config.mjs";
import { currentProject } from "../knowledge/extension-helpers.mjs";
import { getKnowledgeService } from "../knowledge/service.mjs";
import { previewWikiProposal } from "../knowledge/wiki-review.mjs";
import { createEvidenceRecovery } from "./evidence.mjs";
import { clean, createTaskWorkbench, inspectTaskFile, WORKBENCH_ENTRY } from "./workbench.mjs";
import { createZoteroReconciler } from "./zotero-reconcile.mjs";

export function registerWorkbench(pi) {
	let context,
		prepared = false,
		awaitingUser = false,
		halted = false;
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
			pi.events.emit("percho:task-read-check", request);
			if (!handled) resolveResult(false);
		});
		if (!allowed) throw new Error("Current permission policy denied this read.");
	};
	const inspect = async (cwd, path, expected) => {
		await authorize(cwd, path);
		return inspectTaskFile(cwd, path, expected);
	};
	const journal = createTaskWorkbench({
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
	const evidence = createEvidenceRecovery({
		authorize,
		persist: (data) => pi.appendEntry("percho-task-evidence-v1", data),
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
	const send = () =>
		pi.sendMessage(
			{
				customType: "percho-task-status",
				display: true,
				content: journal.render(),
				details: { operational: true, reportId: randomUUID(), taskView: journal.view() },
			},
			{ triggerTurn: false },
		);
	const prepare = async (query, ctx) => {
		attach(ctx);
		const entries = ctx.sessionManager?.getBranch?.() || [];
		const caps =
			[...entries].reverse().find((e) => e.customType === "percho-capability-checkpoint-v1")?.data
				?.capabilities || [];
		const result = journal.begin(query, caps, await bindingKey());
		evidence.attach(evidence.scope(), journal.snapshot()?.id, entries);
		halted = false;
		return result;
	};
	pi.on("session_start", (_event, ctx) => {
		attach(ctx, true);
		prepared = false;
		awaitingUser = false;
	});
	pi.on("session_tree", (_event, ctx) => {
		attach(ctx, true);
		prepared = false;
		halted = false;
	});
	pi.on("input", async (event, ctx) => {
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
					customType: "percho-task-status",
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
		if (!prepared) {
			try {
				await prepare(event.prompt, ctx);
			} catch {
				halted = true;
			}
		}
		prepared = false;
		awaitingUser = true;
		return {
			message: {
				customType: "percho-task-context",
				display: false,
				content: `${journal.render()}\nHost observations only. Use task_plan to propose bounded milestones/acceptance and task_wait for human actions. Only host readback or explicit scoped review can satisfy milestones. Unknown effects must be reconciled, not retried. Stage limits cannot be reset with status messages. task_status delivers host-only results.`,
			},
		};
	});
	pi.on("message_start", async (event, ctx) => {
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
	});
	pi.events?.on?.("percho:context-evicted", (event) => {
		if (event.sessionId === context?.sessionManager?.getSessionId?.()) evidence.evict(event.toolCallIds);
	});
	pi.on("agent_end", (event) => {
		const last = [...(event.messages || [])].reverse().find((m) => m.role === "assistant");
		if (last?.stopReason === "aborted") journal.pause("user-aborted");
		else journal.settle();
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
				const result = await execute(input, ctx);
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
		() => {
			journal.requestReport();
			return journal.render();
		},
	);
	tool(
		"task_plan",
		"Propose immutable milestones and dependencies. The user must approve acceptance conditions. Model completion labels are never accepted.",
		{
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
		["milestones"],
		(input) => journal.plan(input),
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
		(input) => journal.wait(input),
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
			attach(ctx);
			if (ctx.isIdle && !ctx.isIdle())
				throw new Error("Stop the agent before changing tasks or inspecting recovery files.");
			if (args.length > 6000) throw new Error("Task command too large.");
			const input = JSON.parse(Buffer.from(args.trim(), "base64url").toString("utf8"));
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
