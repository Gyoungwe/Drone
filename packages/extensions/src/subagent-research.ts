import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { bindExtensionRuntime, runExtensionExclusive, withExtensionRuntime } from "./internal/runtime";

/** Maximum number of concurrent research workers allowed by the host policy. */
export const MAX_CONCURRENT_SUBAGENTS = 3;

export const ROLE_MAP = Object.freeze({
	scout: { purpose: "快速定位本地代码、数据和已有知识", writes: "none", mcp: "read-local" },
	planner: { purpose: "提出竞争假设、证据缺口和可执行计划", writes: "plan.md", mcp: "read-local" },
	analyst: {
		purpose: "在单次运行目录内执行 Python/R 分析并保存可复现产物",
		writes: "run-directory-only",
		mcp: "read-local",
	},
	reviewer: { purpose: "检查证据链、反例、可复现性和过度结论", writes: "none", mcp: "read-local" },
} as const);

type PiLike = {
	events?: {
		on?: (event: string, listener: (payload: unknown) => void) => unknown;
		emit?: (event: string, payload?: unknown) => unknown;
	};
	registerTool: (definition: {
		name: string;
		label: string;
		description: string;
		parameters: Record<string, unknown>;
		drone?: Record<string, unknown>;
		execute: (...args: any[]) => Promise<unknown>;
	}) => void;
	registerCommand: (
		name: string,
		command: {
			description: string;
			handler: (
				args: string,
				ctx: { cwd?: string; ui: { notify: (message: string, level: string) => void } },
			) => Promise<void>;
		},
	) => void;
};

type WorkspaceConfig = {
	resultsRoot: string;
	maxConcurrentSubagents: number;
};

const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = Object.freeze({
	resultsRoot: "./results",
	maxConcurrentSubagents: MAX_CONCURRENT_SUBAGENTS,
});

/**
 * Read the small portion of workspace configuration needed by the policy tool.
 *
 * This adapter intentionally owns no knowledge or research-domain state. It
 * reads the host's JSON configuration directly so the packaged extension is
 * self-contained and does not reach back into `.pi/lib` at runtime.
 */
async function loadWorkspacePolicy(cwd: string): Promise<WorkspaceConfig> {
	const projectRoot = resolve(cwd);
	let raw: Record<string, unknown> = {};
	const desktopPath = process.env.PI_RESEARCH_DESKTOP_CONFIG;
	try {
		raw = JSON.parse(
			await readFile(desktopPath || join(projectRoot, ".pi", "research-workspace.json"), "utf8"),
		);
	} catch {
		// Missing or malformed configuration falls back to the documented defaults.
	}
	const configuredResults =
		typeof raw.resultsRoot === "string" && raw.resultsRoot.trim()
			? raw.resultsRoot
			: DEFAULT_WORKSPACE_CONFIG.resultsRoot;
	const configuredMax = raw.maxConcurrentSubagents;
	const maxConcurrentSubagents = [1, 2, 3].includes(configuredMax as number)
		? (configuredMax as number)
		: DEFAULT_WORKSPACE_CONFIG.maxConcurrentSubagents;
	return {
		resultsRoot: resolve(projectRoot, configuredResults),
		maxConcurrentSubagents,
	};
}

function isRunDirectory(resultsRoot: string, candidate: string): boolean {
	const rel = relative(resolve(resultsRoot), resolve(candidate));
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
	const parts = rel.split(sep);
	return parts.length === 2 && parts[1]?.startsWith("run-") === true;
}

function toolResponse(value: unknown) {
	return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: value };
}

export function registerResearchSubagents(pi: PiLike, options: { cwd?: string } = {}): void {
	bindExtensionRuntime(pi);
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
		async execute(_id, params: { role?: string; run_dir?: string }, _signal, _update, ctx) {
			return runExtensionExclusive(pi, "research-subagent-policy", async () => {
				const role = params?.role ? ROLE_MAP[params.role as keyof typeof ROLE_MAP] : undefined;
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
			});
		},
	});

	pi.registerCommand("research-subagents", {
		description: "Show research subagent roles and concurrency policy",
		handler: async (_args, ctx) => {
			await withExtensionRuntime(pi, async () => {
				ctx.ui.notify(
					`Roles: ${Object.keys(ROLE_MAP).join(", ")}; max concurrent: ${MAX_CONCURRENT_SUBAGENTS}`,
					"info",
				);
			});
		},
	});
}

export default registerResearchSubagents;
