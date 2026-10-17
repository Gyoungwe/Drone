// The package entry deliberately composes the existing extension factories. The
// knowledge domain stays in @drone/knowledge and is bundled by the package build;
// this entry only provides the native-Pi registration boundary.
import { existsSync } from "node:fs";
import { depositKnowledge } from "@drone/extensions/internal/obsidian-workbench";
import registerObsidianWorkbench from "@drone/extensions/obsidian-workbench";
import registerWorkspaceConfig from "@drone/extensions/workspace-config";
import { knowledgeDirectory, readKnowledgeBinding } from "@drone/knowledge/config";
import { currentProject } from "@drone/knowledge/extension-helpers";
import { getKnowledgeService } from "@drone/knowledge/service";

const STATUS_TOOL = "knowledge_status";
const NATIVE_SEARCH_TOOL = "knowledge_search";
const NATIVE_READ_TOOL = "knowledge_read";
const NATIVE_DEPOSIT_TOOL = "knowledge_deposit";
const NATIVE_CONTEXT_TOOL = "knowledge_answer_context";
const WEB_ACCESS_TOOL = "pi-web-access";

// Native Pi hosts can reload an extension without restarting the process. Keep
// only bounded, non-content receipts here so a same-path/same-hash read can be
// acknowledged without putting Vault text in process state or traces.
const readReceipts = new Map<string, string>();
const searchRounds = new Map<string, number>();
const answerRounds = new Map<string, number>();
const MAX_RECEIPTS = 128;

function result(details: any, compact = false) {
	return {
		content: [{ type: "text", text: JSON.stringify(details, null, compact ? 0 : 2) }],
		details,
	};
}

function statusLine(revision: unknown, coverage: unknown): string {
	return `knowledge_status revision=${Number.isSafeInteger(revision) ? revision : 0} coverage=${String(coverage || "unknown")}`;
}

function toolAvailable(pi: any, ctx: any, name: string): boolean {
	const values = [
		...(Array.isArray(ctx?.tools) ? ctx.tools : []),
		...(Array.isArray(ctx?.availableTools) ? ctx.availableTools : []),
		...(Array.isArray(pi?.tools) ? pi.tools : []),
	];
	if (values.some((item) => String(item?.name || item) === name)) return true;
	for (const owner of [ctx, pi]) {
		try {
			if (typeof owner?.getToolDefinition === "function" && owner.getToolDefinition(name)) return true;
		} catch {
			/* Capability discovery is best effort and must never block local search. */
		}
	}
	return false;
}

async function localContext(ctx: any, query = "") {
	const binding = await readKnowledgeBinding();
	if (!binding) return null;
	const cwd = String(ctx?.cwd || process.cwd());
	const project = await currentProject(cwd, ctx);
	const service = await getKnowledgeService(binding);
	const prepared = await service.prepare({ cwd, project, query });
	return { binding, cwd, project, service, ticket: prepared.ticket };
}

function trimHits(found: any, limit: number) {
	const hits = Array.isArray(found?.hits) ? found.hits.slice(0, limit) : [];
	return hits.map((hit: any) => ({
		...hit,
		text: typeof hit.text === "string" ? hit.text.slice(0, 300) : "",
		...(typeof hit.text === "string" && hit.text.length > 300 ? { truncated: true } : {}),
	}));
}

function nativeTool(pi: any, definition: any) {
	// Keep this package usable on the minimal native Pi API used by the fixture
	// harness; registration metadata is optional on that API.
	pi.registerTool(definition);
}

function registerNativeKnowledgeTools(pi: any) {
	nativeTool(pi, {
		name: NATIVE_SEARCH_TOOL,
		label: "Knowledge · local-first search",
		drone: { readOnly: true, recoverySafe: true, capabilities: ["knowledge"] },
		description:
			"Search the bound local knowledge Vault first. If local coverage is insufficient, report whether pi-web-access is available and ask the host to use it; never invent remote results.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", minLength: 1 },
				limit: { type: "integer", minimum: 1, maximum: 12 },
			},
			required: ["query"],
		},
		async execute(_id: any, params: any, _signal: any, _update: any, ctx: any) {
			const query = String(params?.query || "")
				.trim()
				.slice(0, 2000);
			if (!query) throw new Error("query is required");
			const limit = Math.max(1, Math.min(12, Number(params?.limit) || 6));
			const local = await localContext(ctx, query);
			if (!local)
				return result({
					query,
					hits: [],
					local: { status: "unconfigured", hitCount: 0 },
					remoteFallback: { status: "blocked", reason: "knowledge Vault is not configured" },
				});
			const found = await local.service.request("search", { query, project: local.project, limit });
			const hits = trimHits(found, limit);
			const key = `${local.binding.vaultId || local.binding.vault}:${query}`;
			const round = (searchRounds.get(key) || 0) + 1;
			searchRounds.set(key, round);
			const insufficient = hits.length < limit;
			const webAvailable = toolAvailable(pi, ctx, WEB_ACCESS_TOOL);
			return result({
				query,
				answerRound: round,
				hits,
				local: {
					status: "searched",
					hitCount: hits.length,
					revision: found?.revision ?? null,
					coverage: found?.coverage ?? null,
				},
				remoteFallback: insufficient
					? {
							status: webAvailable ? "prompt" : "unavailable",
							available: webAvailable,
							tool: WEB_ACCESS_TOOL,
							message: webAvailable
								? "Local hits are insufficient. Ask the host to call pi-web-access and preserve returned source URLs before answering."
								: "Local hits are insufficient and pi-web-access is not available; do not infer or fabricate an answer.",
						}
					: { status: "not-needed", available: webAvailable, tool: WEB_ACCESS_TOOL },
			});
		},
	});

	nativeTool(pi, {
		name: NATIVE_READ_TOOL,
		label: "Knowledge · read with links",
		drone: { readOnly: true, recoverySafe: true, capabilities: ["knowledge"] },
		description:
			"Read a bounded local knowledge note and return outgoing links and backlinks. Re-reading an unchanged path/hash returns an explicit already-read receipt.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				start_line: { type: "integer", minimum: 1 },
				max_chars: { type: "integer", minimum: 200, maximum: 8000 },
			},
			required: ["path"],
		},
		async execute(_id: any, params: any, _signal: any, _update: any, ctx: any) {
			const local = await localContext(ctx);
			if (!local) return result({ status: "unconfigured", path: params?.path || null });
			const path = String(params?.path || "");
			const page = await local.service.read(local.ticket, local.cwd, {
				path,
				startLine: Number(params?.start_line) || 1,
				maxChars: Number(params?.max_chars) || 5000,
			});
			let links = { outgoing: [], backlinks: [] };
			if (page?.hash && !page.missing) {
				try {
					const graph = await local.service.request("noteLinks", { path: page.path || path });
					links = {
						outgoing: (graph?.outgoing || []).filter((item: any) => item.exists !== false).slice(0, 12),
						backlinks: (graph?.incoming || []).filter((item: any) => item.exists !== false).slice(0, 12),
					};
				} catch {
					/* A note can be read before its navigation index has caught up. */
				}
			}
			const key = `${local.binding.vaultId || local.binding.vault}:${page.path || path}`;
			const previous = readReceipts.get(key);
			const alreadyRead = Boolean(page?.hash && previous === page.hash);
			if (page?.hash && !page.missing) {
				readReceipts.set(key, page.hash);
				while (readReceipts.size > MAX_RECEIPTS) {
					const oldest = readReceipts.keys().next().value;
					if (oldest === undefined) break;
					readReceipts.delete(oldest);
				}
			}
			return result({
				...page,
				links,
				status: alreadyRead ? "already-read" : page?.missing ? "missing" : "read",
				alreadyRead,
			});
		},
	});

	nativeTool(pi, {
		name: NATIVE_DEPOSIT_TOOL,
		label: "Knowledge · deposit sourced note",
		drone: { capabilities: ["knowledge"] },
		description:
			"Deposit a sourced literature, software, method, or idea note through the existing knowledge contract. Source links are preserved; this does not claim scientific verification.",
		parameters: {
			type: "object",
			properties: {
				type: { type: "string", enum: ["paper", "software", "method", "idea"] },
				title: { type: "string", minLength: 1 },
				markdown: { type: "string", minLength: 1 },
				source_links: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 40 },
				project: { type: "string" },
			},
			required: ["type", "title", "markdown", "source_links"],
		},
		async execute(_id: any, params: any, _signal: any, _update: any, ctx: any) {
			const type = String(params?.type || "").toLowerCase();
			if (!["paper", "software", "method", "idea"].includes(type))
				throw new Error("Unsupported knowledge type");
			const sourceLinks = Array.isArray(params?.source_links) ? params.source_links : [];
			if (!sourceLinks.length) throw new Error("source_links must contain at least one source");
			const project = String(
				params?.project || (await currentProject(String(ctx?.cwd || process.cwd()), ctx)),
			);
			const deposited = await depositKnowledge({
				cwd: String(ctx?.cwd || process.cwd()),
				project,
				type,
				title: params.title,
				markdown: params.markdown,
				sourceLinks,
				status: "candidate",
				targetScope: "project",
			});
			return result({ ...deposited, sourceLinks, scientificallyVerified: false });
		},
	});

	nativeTool(pi, {
		name: NATIVE_CONTEXT_TOOL,
		label: "Knowledge · answer context",
		drone: { readOnly: true, recoverySafe: true, capabilities: ["knowledge"] },
		description:
			"Return bounded local evidence context for a fixed question. The host/model must base a second answer on these local hits or state that evidence is unavailable.",
		parameters: {
			type: "object",
			properties: { question: { type: "string", minLength: 1 } },
			required: ["question"],
		},
		async execute(_id: any, params: any, _signal: any, _update: any, ctx: any) {
			const query = String(params?.question || "").trim();
			const local = await localContext(ctx, query);
			if (!local) return result({ question: query, answerable: false, source: "none", hits: [] });
			const found = await local.service.request("search", { query, project: local.project, limit: 6 });
			const hits = trimHits(found, 6);
			const key = `${local.binding.vaultId || local.binding.vault}:${query}`;
			const answerRound = (answerRounds.get(key) || 0) + 1;
			answerRounds.set(key, answerRound);
			return result({
				question: query,
				answerRound,
				answerable: hits.length > 0,
				source: hits.length ? "local" : "none",
				revision: found?.revision ?? null,
				hits,
				instruction: hits.length
					? "Use these local notes for the answer and cite their paths."
					: "No local evidence was found; do not fabricate a second answer.",
			});
		},
	});
}

/**
 * Native Pi's first-run surface must be honest: no Vault binding means that
 * knowledge is unavailable, rather than an empty successful index. The full
 * existing extension remains responsible for the configured read/write tools.
 */
function registerPackageStatus(pi: any) {
	pi.registerTool({
		name: STATUS_TOOL,
		label: "Knowledge status",
		drone: { readOnly: true, capabilities: ["knowledge"] },
		description:
			"Report whether the application knowledge Vault is configured. When unconfigured, use /drone-init before claiming local knowledge was searched or saved.",
		parameters: { type: "object", properties: {} },
		async execute(_id: any, _params: any, _signal: any, _update: any, ctx: any) {
			const directory = knowledgeDirectory();
			if (!directory)
				return result(
					{
						status: "unconfigured",
						next: "/drone-init",
						revision: 0,
						stableLine: statusLine(0, "unconfigured"),
					},
					true,
				);
			const binding = await readKnowledgeBinding();
			if (!binding || !existsSync(binding.vault))
				return result(
					{
						status: "unconfigured",
						next: "/drone-init",
						revision: binding?.revision || 0,
						stableLine: statusLine(binding?.revision || 0, "unconfigured"),
					},
					true,
				);
			const service = await getKnowledgeService(binding);
			const index = await service.request("jobs", {
				project: await currentProject(ctx?.cwd || process.cwd(), ctx),
			});
			const revision = Number(index?.revision ?? binding.revision ?? 0);
			return result(
				{
					status: "configured",
					vault: binding.vault,
					project: await currentProject(ctx?.cwd || process.cwd(), ctx),
					revision,
					stableLine: statusLine(revision, index?.coverage),
					index,
				},
				true,
			);
		},
	});

	// Keep the package's first-run hint stable while preserving the existing
	// /obsidian-setup command and its consent/UI semantics.
	pi.registerCommand?.("drone-init", {
		description: "Initialize the Drone knowledge Vault",
		handler: async (_args: any, ctx: any) => {
			if (typeof pi.sendUserMessage === "function") {
				await pi.sendUserMessage("/obsidian-setup", { deliverAs: "followUp" });
			} else {
				ctx?.ui?.notify?.("Run /obsidian-setup to initialize the knowledge Vault", "info");
			}
		},
	});
}

export default function registerPiKnowledge(pi: any) {
	registerPackageStatus(pi);
	registerWorkspaceConfig(pi);
	registerObsidianWorkbench(pi, { readOnly: true });
	registerNativeKnowledgeTools(pi);
}
