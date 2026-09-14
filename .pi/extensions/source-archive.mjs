import { USER_QUESTION_FOCUS } from "../lib/reply-focus.mjs";
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
		systemPrompt: `${event.systemPrompt}\n\nArchive papers, manuals and software with research_archive_source into the active run. Do not invent citations or treat browser_required/failed downloads as evidence. ${USER_QUESTION_FOCUS}`,
	}));
}
