import { CLAIM_BINDING_SCHEMA } from "../lib/claim-bindings.mjs";
import { USER_QUESTION_FOCUS } from "../lib/reply-focus.mjs";
import { startResearchRun, updateResearchLoop } from "../lib/research-loop.mjs";
import { createResearchReceiptJournal } from "../lib/research-receipt-journal.mjs";
import { registerTool } from "../lib/tool-manifest.mjs";

export default function researchLoop(pi) {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	const journals = new Map();
	const pending = new Map();
	const awaitingUserStart = new Set();
	const sessionKey = (ctx) => ctx?.sessionManager?.getSessionId?.() || ctx?.sessionId || ctx?.cwd || "";
	const journalFor = (ctx) => {
		const key = sessionKey(ctx);
		if (!journals.has(key))
			journals.set(key, createResearchReceiptJournal(ctx.cwd, { sessionId: sessionKey(ctx) }));
		return journals.get(key);
	};
	registerTool(pi, {
		name: "research_loop",
		label: "Research evidence loop",
		drone: {
			// 创建 / 推进运行目录有副作用，但只读文献复用与只读恢复都需要 research_loop.start / status
			libraryMode: true,
			recoverySafe: true,
			capabilities: ["research"],
			activity: { text: "正在检查研究证据链…", phase: "verification" },
		},
		description:
			"Create or inspect a scientific evidence gate. Prefer start and status; the host advances search, inspection, archive, claims and finalize from successful tools. Use complete to close the gate in one host-serial step, or record_external with a skip reason.",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: [
						"start",
						"record_local",
						"record_external",
						"inspect_sources",
						"verify_archive",
						"bind_claims",
						"finalize",
						"complete",
						"status",
					],
				},
				run_dir: { type: "string" },
				project: { type: "string" },
				result_slug: { type: "string" },
				query: { type: "string" },
				source_refs: { type: "array", items: { type: "string" } },
				claim_refs: { type: "array", items: { type: "string" } },
				claim_bindings: CLAIM_BINDING_SCHEMA,
				outcome: { type: "string" },
				notes: { type: "string" },
			},
			required: ["action"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const journal = journalFor(ctx),
				runDir = params.run_dir || journal.currentRun();
			if (params.action === "status" && !runDir) {
				const value = {
					run_dir: null,
					evidence_gate: { stage: "not-started", answerable: false },
					next_action: "start",
					guidance:
						"Call research_loop(action=start,query=the research question). The host creates the correct results directory; no filesystem lookup or task_plan is needed.",
				};
				return { content: [{ type: "text", text: JSON.stringify(value) }], details: value };
			}
			const result = await journal.execute(runDir, async () =>
				params.action === "start"
					? await startResearchRun({
							cwd: ctx.cwd,
							project: params.project,
							resultSlug: params.result_slug,
							query: params.query,
						})
					: await updateResearchLoop({
							cwd: ctx.cwd,
							runDir,
							action: params.action,
							query: params.query,
							sourceRefs: params.source_refs || [],
							claimRefs: params.claim_refs || [],
							claimBindings: params.claim_bindings || [],
							outcome: params.outcome,
							notes: params.notes,
						}),
			);
			const gate = result?.evidence_gate;
			const visible =
				params.action === "status"
					? result
					: {
							run_dir: result?.run_dir,
							topic_id: result?.metadata?.topic_id,
							evidence_gate: gate && {
								stage: gate.stage,
								answerable: gate.answerable,
								archive_count: gate.archive_count,
								reuse_count: gate.reuse_count,
								source_refs: gate.source_refs,
								claim_count: gate.claim_refs.length,
								structured_claim_count: gate.claim_bindings.length,
								warnings: gate.warnings,
								scientificallyVerified: false,
							},
							receipt_journal: result?.receipt_journal,
						};
			return { content: [{ type: "text", text: JSON.stringify(visible, null, 2) }], details: result };
		},
	});
	pi.on("tool_execution_start", (event, ctx) => {
		if (pending.size > 256) pending.delete(pending.keys().next().value);
		pending.set(event.toolCallId, { args: event.args || {}, journal: journalFor(ctx), key: sessionKey(ctx) });
	});
	pi.on("tool_execution_end", async (event, ctx) => {
		const started = pending.get(event.toolCallId);
		pending.delete(event.toolCallId);
		if (
			!started ||
			started.key !== sessionKey(ctx) ||
			started.journal !== journals.get(started.key) ||
			event.toolName === "research_loop"
		)
			return;
		await started.journal.record({
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: started.args,
			details: event.result?.details || {},
			isError: !!event.isError,
		});
	});
	pi.on("before_agent_start", async (_event, ctx) => {
		const key = sessionKey(ctx);
		awaitingUserStart.add(key);
		const previous = journals.get(key);
		journals.set(key, createResearchReceiptJournal(ctx.cwd, { sessionId: sessionKey(ctx) }));
		for (const [id, item] of pending) if (item.key === key) pending.delete(id);
		await previous?.close();
	});
	pi.on("message_start", async (event, ctx) => {
		if (event.message?.role !== "user") return;
		const key = sessionKey(ctx);
		if (awaitingUserStart.delete(key)) return;
		const old = journals.get(key);
		journals.set(key, createResearchReceiptJournal(ctx.cwd, { sessionId: sessionKey(ctx) }));
		for (const [id, item] of pending) if (item.key === key) pending.delete(id);
		await old?.close();
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		const key = sessionKey(ctx);
		await journals.get(key)?.close();
		journals.delete(key);
		for (const [id, item] of pending) if (item.key === key) pending.delete(id);
	});
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nFor substantive research, use research_loop(action=start) when a tracked run is needed; successful source tools earlier in this same turn are retained by the host and safely attached when the run starts. Do not repeat reads merely to satisfy tool ordering. For read-only planning/reuse, do not create a task_plan or human-confirmation milestone merely to inspect existing papers. First publish a brief provisional scientific framework via set_status, not just a loading message. Read the needed notes and verify their identities in parallel batches. Existing notes read this turn plus successful research_verify_literature receipts count as sources_reused, NOT new downloads or original fulltext reads. Then call complete once, preferring claim_bindings with exact note line ranges and verbatim quotes, relationship, organism/method and limitations. The host checks provenance, not scientific truth. Legacy claim_refs remain compatibility-only with an unstructured warning; local note reuse does not require an external-search bookkeeping call. A downloaded file is acquisition only, not a read or claim binding; do not manually walk inspect_sources/bind_claims/verify_archive/finalize. The host records search, inspection, archive or verified reuse and close-out from successful tools; use record_external only to skip web search with a reason, or complete/status to inspect the gate. Failed or browser-required retrieval is not evidence. ${USER_QUESTION_FOCUS}`,
	}));
}
