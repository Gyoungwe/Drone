import { startResearchRun, updateResearchLoop } from "../lib/research-loop.mjs";

export default function researchLoop(pi) {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	pi.registerTool({
		name: "research_loop",
		label: "Research evidence loop",
		description:
			"Create or advance a persistent scientific evidence gate. Use start, record_local, record_external, inspect_sources, verify_archive, bind_claims, finalize, or status.",
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
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nResearch evidence gate: for substantive scientific/technical research, create a run with research_loop(action=start). Record the exact local query, then the external-search decision, inspect original sources, archive selected evidence, bind explicit claim references, and finalize the gate before research_summarize_run. External search may be recorded as skipped only with a reason. Failed/browser-required retrieval is not evidence.`,
	}));
}
