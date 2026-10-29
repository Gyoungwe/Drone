// @ts-nocheck
// packages/extensions/src/subagent-mcp-readonly.ts
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
var OBSIDIAN_SUBAGENT_READ_TOOLS = [
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
  "read_note_lines"
];
function readProjectServer(cwd) {
  try {
    const raw = JSON.parse(readFileSync(join(resolve(cwd), ".mcp.json"), "utf8"));
    return raw?.mcpServers?.["research-obsidian"] ?? null;
  } catch {
    return null;
  }
}
function readonlyMcpAdapterUrl(workbenchRoot = process.env.DRONE_RESEARCH_WORKBENCH_ROOT) {
  return workbenchRoot ? pathToFileURL(join(resolve(workbenchRoot), "npm/node_modules/pi-mcp-adapter/index.ts")) : new URL("../npm/node_modules/pi-mcp-adapter/index.ts", import.meta.url);
}
async function loadMcpAdapter() {
  return import(
    /* @vite-ignore */
    readonlyMcpAdapterUrl().href
  );
}
function makeSubagentReadonlyMcp(cwd, loadAdapter = loadMcpAdapter) {
  return async function subagentReadonlyMcp(pi) {
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
            directTools: true
          }
        },
        settings: { scriptMode: false, directTools: false }
      }
    })(pi);
  };
}
var subagent_mcp_readonly_default = makeSubagentReadonlyMcp(process.cwd());
export {
  OBSIDIAN_SUBAGENT_READ_TOOLS,
  subagent_mcp_readonly_default as default,
  makeSubagentReadonlyMcp,
  readonlyMcpAdapterUrl
};
