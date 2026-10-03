import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { knowledgeDirectory } from "@drone/knowledge/config";
import { registerKnowledgeInterface } from "./knowledge-extension";

export const OBSIDIAN_SUBAGENT_READ_TOOLS = [
	"read_note",
	"read_multiple_notes",
	"search_notes",
	"list_directory",
	"get_notes_info",
	"get_frontmatter",
	"get_vault_stats",
	"list_all_tags",
	"wiki_link",
	"get_note_outline",
	"read_note_lines",
] as const;

function readProjectServer(cwd: string): Record<string, unknown> | null {
	try {
		const raw = JSON.parse(readFileSync(join(resolve(cwd), ".mcp.json"), "utf8"));
		return raw?.mcpServers?.["research-obsidian"] ?? null;
	} catch {
		return null;
	}
}

export function readonlyMcpAdapterUrl(workbenchRoot = process.env.DRONE_RESEARCH_WORKBENCH_ROOT): URL {
	return workbenchRoot
		? pathToFileURL(join(resolve(workbenchRoot), "npm/node_modules/pi-mcp-adapter/index.ts"))
		: new URL("../npm/node_modules/pi-mcp-adapter/index.ts", import.meta.url);
}

async function loadMcpAdapter() {
	return import(/* @vite-ignore */ readonlyMcpAdapterUrl().href);
}

/** Read-only Obsidian bridge used by isolated research subagents. */
export function makeSubagentReadonlyMcp(cwd: string, loadAdapter = loadMcpAdapter) {
	return async function subagentReadonlyMcp(pi: any) {
		if (knowledgeDirectory()) {
			const knowledge = registerKnowledgeInterface(pi, { readOnly: true });
			pi.on("before_agent_start", async (event: any, ctx: any) => {
				const prepared: any = await knowledge.beforeStart(event, ctx);
				return {
					...(prepared.message ? { message: prepared.message } : {}),
					systemPrompt: `${event.systemPrompt}\n${prepared.guidance || ""}`,
				};
			});
			return;
		}
		const server = readProjectServer(cwd);
		if (!server) return;
		const { createMcpAdapter } = await loadAdapter();
		createMcpAdapter({
			config: {
				mcpServers: {
					"research-obsidian": {
						...server,
						disabled: false,
						includeTools: [...OBSIDIAN_SUBAGENT_READ_TOOLS],
						directTools: true,
					},
				},
				settings: { scriptMode: false, directTools: false },
			},
		})(pi);
	};
}

export default makeSubagentReadonlyMcp(process.cwd());
