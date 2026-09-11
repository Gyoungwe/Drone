import { relative, resolve, sep } from "node:path";
import { loadWorkspaceConfig } from "./workspace-config.mjs";

export const MAX_CONCURRENT_SUBAGENTS = 3;

export const ROLE_MAP = Object.freeze({
  scout: { purpose: "快速定位本地代码、数据和已有知识", writes: "none", mcp: "read-local" },
  planner: { purpose: "提出竞争假设、证据缺口和可执行计划", writes: "plan.md", mcp: "read-local" },
  analyst: { purpose: "在单次运行目录内执行 Python/R 分析并保存可复现产物", writes: "run-directory-only", mcp: "read-local" },
  reviewer: { purpose: "检查证据链、反例、可复现性和过度结论", writes: "none", mcp: "read-local" },
});

function isRunDirectory(resultsRoot, candidate) {
  const rel = relative(resolve(resultsRoot), resolve(candidate));
  if (!rel || rel.startsWith(".." + sep)) return false;
  const parts = rel.split(sep);
  return parts.length === 2 && parts[1].startsWith("run-");
}

export function registerResearchSubagents(pi, options = {}) {
  const baseCwd = options.cwd ? resolve(options.cwd) : process.cwd();
  pi.registerTool({
    name: "research_subagent_policy",
    label: "Research subagent policy",
    description: "Show the scientific subagent role map and validate an analyst run directory.",
    parameters: {
      type: "object",
      properties: { role: { type: "string", enum: Object.keys(ROLE_MAP) }, run_dir: { type: "string" } },
      required: ["role"],
    },
    async execute(_id, params) {
      const role = ROLE_MAP[params.role];
      if (!role) throw new Error(`unknown research subagent role: ${params.role}`);
      const config = await loadWorkspaceConfig(baseCwd);
      const runDir = params.run_dir ? resolve(baseCwd, params.run_dir) : null;
      const runDirAllowed = params.role !== "analyst" || (runDir && isRunDirectory(config.resultsRoot, runDir));
      if (params.role === "analyst" && !runDirAllowed) {
        throw new Error("analyst requires a run_dir directly inside the configured results root");
      }
      const details = {
        max_concurrent_subagents: Math.min(MAX_CONCURRENT_SUBAGENTS, config.maxConcurrentSubagents),
        role: params.role,
        ...role,
        run_dir: runDir,
        run_dir_allowed: Boolean(runDirAllowed),
        main_session_owns_obsidian_writes: true, subagent_mcp_is_read_only: true,
      };
      return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
    },
  });

  pi.registerCommand("research-subagents", {
    description: "Show research subagent roles and concurrency policy",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`Roles: ${Object.keys(ROLE_MAP).join(", ")}; max concurrent: ${MAX_CONCURRENT_SUBAGENTS}`, "info");
    },
  });
}

export default registerResearchSubagents;
