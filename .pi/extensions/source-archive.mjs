import { reconcileLiteratureOperation } from "../lib/literature-operations.mjs";
import { verifyLiteratureReceipt } from "../lib/literature-receipt.mjs";
import { USER_QUESTION_FOCUS } from "../lib/reply-focus.mjs";
import { recordRunProvenance } from "../lib/run-provenance.mjs";
import {
	archiveSource,
	DEFAULT_MAX_BYTES,
	DEFAULT_TIMEOUT_MS,
	SOURCE_CATEGORIES,
	sourceStatus,
} from "../lib/source-archive.mjs";
import { loadWorkspaceConfig } from "./workspace-config.mjs";

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
	pi.registerTool({
		name: "research_verify_literature",
		label: "Verify Zotero and Obsidian paper identity",
		description:
			"Read-only dual-library check against the current local Zotero personal library and bound Vault. Confirms exact DOI/key/note identity, not scientific truth, original-source reading, PDF bytes, collection placement, or cloud sync. Use after authorized import or reuse; unavailable is not absent.",
		parameters: {
			type: "object",
			properties: { doi: { type: "string" }, zotero_key: { type: "string" }, note_path: { type: "string" } },
			required: ["doi", "zotero_key", "note_path"],
		},
		async execute(_id, params, signal, _update, ctx) {
			const config = await loadWorkspaceConfig(ctx.cwd);
			const result = await verifyLiteratureReceipt({ ...params, vault: config.obsidianVault, signal });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});
	pi.registerTool({
		name: "research_reconcile_literature",
		label: "Reconcile dual-library operation",
		description:
			"Read back both destinations and persist a resumable per-DOI operation log inside the run. Never imports/downloads or writes Vault notes. A verified destination must be reused; unavailable is not absent. Returns the missing/conflicting destination and safe next action; authorization for writes is separate.",
		parameters: {
			type: "object",
			properties: {
				run_dir: { type: "string" },
				doi: { type: "string" },
				zotero_key: { type: "string" },
				note_path: { type: "string" },
			},
			required: ["run_dir", "doi", "zotero_key", "note_path"],
		},
		async execute(_id, p, _signal, _update, ctx) {
			const value = await reconcileLiteratureOperation({
				cwd: ctx.cwd,
				runDir: p.run_dir,
				doi: p.doi,
				zoteroKey: p.zotero_key,
				notePath: p.note_path,
			});
			return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: value };
		},
	});
	pi.registerTool({
		name: "research_record_run_manifest",
		label: "Record reproducibility manifest",
		description:
			"Record current hashes of explicitly selected project files and host-observed command references in an existing run. Does not execute analyses or read file contents to the model. File hashes are current/post-hoc snapshots; declarations of versions, parameters, seeds and QC are not independently verified. No library writes.",
		parameters: {
			type: "object",
			properties: {
				run_dir: { type: "string" },
				files: {
					type: "array",
					maxItems: 64,
					items: {
						type: "object",
						properties: {
							path: { type: "string" },
							role: { type: "string", enum: ["input", "output", "script", "log"] },
						},
						required: ["path", "role"],
					},
				},
				declarations: { type: "object" },
			},
			required: ["run_dir"],
		},
		async execute(_id, p, _signal, _update, ctx) {
			const value = await recordRunProvenance({
				cwd: ctx.cwd,
				runDir: p.run_dir,
				files: p.files || [],
				declarations: p.declarations || {},
			});
			return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: value };
		},
	});
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nArchive papers, manuals and software with research_archive_source into the active run. Do not invent citations or treat browser_required/failed downloads as evidence. ${USER_QUESTION_FOCUS}`,
	}));
}
