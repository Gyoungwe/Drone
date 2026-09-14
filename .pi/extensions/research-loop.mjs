import { USER_QUESTION_FOCUS } from "../lib/reply-focus.mjs";
import { observeResearchReceipt, startResearchRun, updateResearchLoop } from "../lib/research-loop.mjs";

export default function researchLoop(pi) {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	const runs = new Map();
	const pending = new Map();
	const sessionKey = (ctx) => ctx?.sessionManager?.getSessionId?.() || ctx?.sessionId || ctx?.cwd || "";
	pi.registerTool({
		name: "research_loop",
		label: "Research evidence loop",
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
				outcome: { type: "string" },
				notes: { type: "string" },
			},
			required: ["action"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const result =
				params.action === "start"
					? await startResearchRun({
							cwd: ctx.cwd,
							project: params.project,
							resultSlug: params.result_slug,
							query: params.query,
						})
					: await updateResearchLoop({
							cwd: ctx.cwd,
							runDir: params.run_dir,
							action: params.action,
							query: params.query,
							sourceRefs: params.source_refs || [],
							claimRefs: params.claim_refs || [],
							outcome: params.outcome,
							notes: params.notes,
						});
			const runDir = result.run_dir || params.run_dir;
			if (runDir) runs.set(sessionKey(ctx), runDir);
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});
	pi.on("tool_execution_start", (event, ctx) => {
		if (pending.size > 256) pending.delete(pending.keys().next().value);
		pending.set(event.toolCallId, event.args || {});
		if (event.args?.run_dir) runs.set(sessionKey(ctx), event.args.run_dir);
	});
	pi.on("tool_execution_end", async (event, ctx) => {
		const args = pending.get(event.toolCallId) || {};
		pending.delete(event.toolCallId);
		const runDir = args.run_dir || event.result?.details?.run_dir || runs.get(sessionKey(ctx));
		if (!runDir || event.toolName === "research_loop") return;
		const observed = await observeResearchReceipt({
			cwd: ctx.cwd,
			runDir,
			toolName: event.toolName,
			args,
			details: event.result?.details || {},
			isError: !!event.isError,
		});
		if (observed?.run_dir) runs.set(sessionKey(ctx), observed.run_dir);
	});
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nFor substantive research, start a run with research_loop(action=start). The host records search, inspection, archive and close-out from successful tools; use record_external only to skip web search with a reason, or complete/status to inspect the gate. Failed or browser-required retrieval is not evidence. ${USER_QUESTION_FOCUS}`,
	}));
}
