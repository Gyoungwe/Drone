// packages/extensions/src/subagent-research.ts
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
var MAX_CONCURRENT_SUBAGENTS = 3;
var ROLE_MAP = Object.freeze({
	scout: {
		purpose:
			"\u5FEB\u901F\u5B9A\u4F4D\u672C\u5730\u4EE3\u7801\u3001\u6570\u636E\u548C\u5DF2\u6709\u77E5\u8BC6",
		writes: "none",
		mcp: "read-local",
	},
	planner: {
		purpose:
			"\u63D0\u51FA\u7ADE\u4E89\u5047\u8BBE\u3001\u8BC1\u636E\u7F3A\u53E3\u548C\u53EF\u6267\u884C\u8BA1\u5212",
		writes: "plan.md",
		mcp: "read-local",
	},
	analyst: {
		purpose:
			"\u5728\u5355\u6B21\u8FD0\u884C\u76EE\u5F55\u5185\u6267\u884C Python/R \u5206\u6790\u5E76\u4FDD\u5B58\u53EF\u590D\u73B0\u4EA7\u7269",
		writes: "run-directory-only",
		mcp: "read-local",
	},
	reviewer: {
		purpose:
			"\u68C0\u67E5\u8BC1\u636E\u94FE\u3001\u53CD\u4F8B\u3001\u53EF\u590D\u73B0\u6027\u548C\u8FC7\u5EA6\u7ED3\u8BBA",
		writes: "none",
		mcp: "read-local",
	},
});
var DEFAULT_WORKSPACE_CONFIG = Object.freeze({
	resultsRoot: "./results",
	maxConcurrentSubagents: MAX_CONCURRENT_SUBAGENTS,
});
async function loadWorkspacePolicy(cwd) {
	const projectRoot = resolve(cwd);
	let raw = {};
	const desktopPath = process.env.PI_RESEARCH_DESKTOP_CONFIG;
	try {
		raw = JSON.parse(
			await readFile(desktopPath || join(projectRoot, ".pi", "research-workspace.json"), "utf8"),
		);
	} catch {}
	const configuredResults =
		typeof raw.resultsRoot === "string" && raw.resultsRoot.trim()
			? raw.resultsRoot
			: DEFAULT_WORKSPACE_CONFIG.resultsRoot;
	const configuredMax = raw.maxConcurrentSubagents;
	const maxConcurrentSubagents = [1, 2, 3].includes(configuredMax)
		? configuredMax
		: DEFAULT_WORKSPACE_CONFIG.maxConcurrentSubagents;
	return {
		resultsRoot: resolve(projectRoot, configuredResults),
		maxConcurrentSubagents,
	};
}
function isRunDirectory(resultsRoot, candidate) {
	const rel = relative(resolve(resultsRoot), resolve(candidate));
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
	const parts = rel.split(sep);
	return parts.length === 2 && parts[1]?.startsWith("run-") === true;
}
function toolResponse(value) {
	return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: value };
}
function registerResearchSubagents(pi, options = {}) {
	const baseCwd = options.cwd ? resolve(options.cwd) : process.cwd();
	pi.registerTool({
		name: "research_subagent_policy",
		label: "Research subagent policy",
		drone: { readOnly: true, capabilities: ["research"] },
		description: "Show the scientific subagent role map and validate an analyst run directory.",
		parameters: {
			type: "object",
			properties: { role: { type: "string", enum: Object.keys(ROLE_MAP) }, run_dir: { type: "string" } },
			required: ["role"],
		},
		async execute(_id, params, _signal, _update, ctx) {
			const role = params?.role ? ROLE_MAP[params.role] : void 0;
			if (!role) throw new Error(`unknown research subagent role: ${params?.role}`);
			const cwd = typeof ctx?.cwd === "string" ? resolve(ctx.cwd) : baseCwd;
			const config = await loadWorkspacePolicy(cwd);
			const runDir = params.run_dir ? resolve(cwd, params.run_dir) : null;
			const runDirAllowed =
				params.role !== "analyst" || (runDir !== null && isRunDirectory(config.resultsRoot, runDir));
			if (params.role === "analyst" && !runDirAllowed) {
				throw new Error("analyst requires a run_dir directly inside the configured results root");
			}
			const details = {
				max_concurrent_subagents: Math.min(MAX_CONCURRENT_SUBAGENTS, config.maxConcurrentSubagents),
				role: params.role,
				...role,
				run_dir: runDir,
				run_dir_allowed: Boolean(runDirAllowed),
				main_session_owns_obsidian_writes: true,
				subagent_mcp_is_read_only: true,
			};
			return toolResponse(details);
		},
	});
	pi.registerCommand("research-subagents", {
		description: "Show research subagent roles and concurrency policy",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`Roles: ${Object.keys(ROLE_MAP).join(", ")}; max concurrent: ${MAX_CONCURRENT_SUBAGENTS}`,
				"info",
			);
		},
	});
}
var subagent_research_default = registerResearchSubagents;
export {
	MAX_CONCURRENT_SUBAGENTS,
	ROLE_MAP,
	subagent_research_default as default,
	registerResearchSubagents,
};
