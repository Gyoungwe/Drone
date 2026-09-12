import {
	archiveSource,
	DEFAULT_MAX_BYTES,
	DEFAULT_TIMEOUT_MS,
	SOURCE_CATEGORIES,
	sourceStatus,
} from "../lib/source-archive.mjs";

export default function sourceArchive(pi) {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	pi.registerTool({
		name: "research_archive_source",
		label: "Archive research source",
		description:
			"Download a literature or software source into the current run's sources directory with provenance and SHA-256. Browser-required responses are handed off for manual Computer Use verification; downloaded files are never executed.",
		parameters: {
			type: "object",
			properties: {
				run_dir: { type: "string" },
				url: { type: "string" },
				category: { type: "string", enum: SOURCE_CATEGORIES },
				filename: { type: "string" },
				metadata: { type: "object" },
				local_file: {
					type: "string",
					description: "Optional file imported from .pi/browser-downloads after manual browser verification",
				},
				human_verified: { type: "boolean", description: "Must be true explicitly when importing local_file" },
				content_type: { type: "string" },
				max_bytes: { type: "integer", minimum: 1, maximum: 524288000, default: DEFAULT_MAX_BYTES },
				timeout_ms: { type: "integer", minimum: 100, maximum: 600000, default: DEFAULT_TIMEOUT_MS },
			},
			required: ["run_dir", "url", "category"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const result = await archiveSource({ ...params, cwd: ctx.cwd });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});
	pi.registerTool({
		name: "research_source_status",
		label: "Research source status",
		description: "Show archived source manifest and browser-required or failed downloads for a research run.",
		parameters: { type: "object", properties: { run_dir: { type: "string" } } },
		async execute(_id, params, _signal, _update, ctx) {
			const result = await sourceStatus({ cwd: ctx.cwd, run_dir: params.run_dir });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nEvidence policy (mandatory for substantive scientific, software and technical factual answers): query the configured local knowledge base first and record the lookup; use external search only when local evidence is absent, incomplete, stale or conflicting; inspect original content before citing it; archive selected papers, manuals and software with research_archive_source and verify research_source_status. Distinguish Observed, Supported interpretation, Hypothesis, Unknown, Conflict and Unverified. Never invent citations, downloads, tool calls or evidence. A browser_required, unavailable or failed result is not success and may only produce a limitation and next-step plan. User-provided files require a hash and provenance record before supporting claims. For software, include available official README, manual, LICENSE, CITATION and dependency specifications; no full Git history. Preserve DOI/PMID/commit/version/license metadata, never execute downloaded code, and inspect research_source_status after downloads. Successful files are linked to categorized Obsidian notes with managed indexes; check knowledge_status and report any publication failure separately from the download. If the tool returns browser_required, use the configured research-browser/Computer Use browser for the URL, ask the user to complete any challenge or login manually, then retry with local_file inside .pi/browser-downloads and human_verified=true. Do not claim a challenge was bypassed.`,
	}));
}
