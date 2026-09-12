import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { knowledgeDirectory } from "../lib/knowledge/config.mjs";
import { registerKnowledgeInterface } from "../lib/knowledge/extension.mjs";

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
];

function readProjectServer(cwd) {
	try {
		const raw = JSON.parse(readFileSync(join(resolve(cwd), ".mcp.json"), "utf8"));
		return raw?.mcpServers?.["research-obsidian"] ?? null;
	} catch {
		return null;
	}
}

export function makeSubagentReadonlyMcp(cwd) {
	return async function subagentReadonlyMcp(pi) {
		if (knowledgeDirectory()) {
			const knowledge = registerKnowledgeInterface(pi, { readOnly: true });
			pi.on("before_agent_start", async (event, ctx) => {
				const prepared = await knowledge.beforeStart(event, ctx);
				return {
					...(prepared.message ? { message: prepared.message } : {}),
					systemPrompt: `${event.systemPrompt}\n${prepared.guidance || ""}`,
				};
			});
			return;
		}
		const { createMcpAdapter } = await import("../npm/node_modules/pi-mcp-adapter/index.ts");
		const server = readProjectServer(cwd);
		if (!server) return;
		createMcpAdapter({
			config: {
				mcpServers: {
					"research-obsidian": {
						...server,
						disabled: false,
						includeTools: OBSIDIAN_SUBAGENT_READ_TOOLS,
						directTools: true,
					},
				},
				settings: { scriptMode: false, directTools: false },
			},
		})(pi);
	};
}

export default makeSubagentReadonlyMcp(process.cwd());
