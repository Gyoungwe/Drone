/** Minimal A5-0 extension entry point. Domain logic remains in the legacy extension during migration. */
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
	registerCommand: (
		name: string,
		command: {
			description: string;
			handler: (
				_args: string,
				ctx: { ui: { notify: (message: string, level: string) => void } },
			) => Promise<void>;
		},
	) => void;
};

export function registerResearchSubagents(pi: PiLike): void {
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

export default registerResearchSubagents;
