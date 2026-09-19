import { cardLink, flowCard, literatureCard } from "../lib/knowledge/flow-cards.mjs";
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
import { registerTool } from "../lib/tool-manifest.mjs";
import { loadWorkspaceConfig } from "./workspace-config.mjs";

/** 归档来源的回执卡：来源已归档 ≠ 已阅读或已综合。 */
function archiveCard(event) {
	const d = event.result?.details || {};
	return flowCard({
		key: d.path || d.url || event.toolCallId,
		kind: "source",
		title: d.metadata?.title || d.category || event.toolName,
		status: d.status,
		path: d.path,
		detail:
			d.knowledge_status === "written"
				? "Source note saved; not a full manual or reviewed synthesis."
				: d.reason || d.obsidian_error || d.knowledge_status,
		links: [d.path ? cardLink("path", d.path, "打开", "flow.link.open") : null],
		source: event.toolName,
	});
}
function sourceStatusCards(event) {
	const d = event.result?.details || {};
	return [
		...(d.manifest?.items || []).slice(-20).map((item) =>
			flowCard({
				key: item.path || item.id,
				kind: "source",
				title: item.metadata?.title || item.category,
				status: item.status,
				path: item.path,
				detail: "Source archived; interpretation and manual coverage are separate.",
				links: [item.path ? cardLink("path", item.path, "打开", "flow.link.open") : null],
				source: event.toolName,
			}),
		),
		...(d.manifest?.failures || []).slice(-6).map((item) =>
			flowCard({
				key: item.url,
				kind: "source",
				title: item.url,
				status: "failed",
				detail: item.reason,
				source: event.toolName,
			}),
		),
	];
}

export default function sourceArchive(pi) {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	registerTool(pi, {
		name: "research_archive_source",
		label: "Archive research source",
		drone: {
			capabilities: ["research"],
			journal: true,
			subagent: "exclude",
			activity: { text: "正在归档研究证据…", phase: "archive" },
			flow: "source",
			flowCards: archiveCard,
		},
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
	registerTool(pi, {
		name: "research_source_status",
		label: "Research source status",
		drone: {
			readOnly: true,
			recoverySafe: true,
			capabilities: ["research"],
			activity: { text: "正在检查归档来源…", phase: "archive" },
			flow: "source",
			flowCards: sourceStatusCards,
		},
		description: "Show archived source manifest and browser-required or failed downloads for a research run.",
		parameters: { type: "object", properties: { run_dir: { type: "string" } } },
		async execute(_id, params, _signal, _update, ctx) {
			const result = await sourceStatus({ cwd: ctx.cwd, run_dir: params.run_dir });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
		},
	});
	registerTool(pi, {
		name: "research_verify_literature",
		label: "Verify Zotero and Obsidian paper identity",
		drone: {
			readOnly: true,
			recoverySafe: true,
			capabilities: ["research"],
			journal: true,
			activity: { text: "正在核对文献双库身份…", phase: "verification" },
			flow: "literature",
			flowCards: (event) => literatureCard(event),
		},
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
	registerTool(pi, {
		name: "research_reconcile_literature",
		label: "Reconcile dual-library operation",
		drone: {
			readOnly: true,
			recoverySafe: true,
			capabilities: ["research"],
			journal: true,
			activity: { text: "正在读回双库文献记录…", phase: "verification" },
			flow: "literature",
			flowCards: (event) => literatureCard(event),
		},
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
	registerTool(pi, {
		name: "research_record_run_manifest",
		label: "Record reproducibility manifest",
		drone: { capabilities: ["research"], subagent: "exclude" },
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
