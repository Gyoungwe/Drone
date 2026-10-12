/**
 * 模式即工具白名单（P12）：单体模式不暴露 subagent；主从模式一次派发一个子智能体；集群模式允许并行派发。
 * 切换模式 = 换一组可用工具（会触发提示缓存重置，P18 的 UI 负责提示用户）。
 */
export type AgentMode = "single" | "lead" | "swarm";
export const AGENT_MODES: readonly AgentMode[] = ["single", "lead", "swarm"];

const SUBAGENT_TOOLS = ["subagent"];

const DENY: Record<AgentMode, ReadonlySet<string>> = {
	single: new Set(SUBAGENT_TOOLS),
	lead: new Set(),
	swarm: new Set(),
};

/** 同时在跑的子智能体上限：单体 0、主从 1、集群 4。 */
export function maxParallelSubagents(mode: AgentMode): number {
	return mode === "single" ? 0 : mode === "lead" ? 1 : 4;
}

export function isAgentMode(value: unknown): value is AgentMode {
	return typeof value === "string" && (AGENT_MODES as readonly string[]).includes(value);
}

export function toolAllowedInMode(mode: AgentMode, toolName: string): boolean {
	return !DENY[mode].has(toolName);
}

export function filterToolsForMode(mode: AgentMode, names: Iterable<string>): string[] {
	return [...names].filter((n) => toolAllowedInMode(mode, n));
}

/** 切换模式时工具集的变化，供 UI 提示。 */
export function modeToolDiff(from: AgentMode, to: AgentMode, names: Iterable<string>) {
	const all = [...names];
	const before = new Set(filterToolsForMode(from, all));
	const after = new Set(filterToolsForMode(to, all));
	return {
		added: all.filter((n) => after.has(n) && !before.has(n)),
		removed: all.filter((n) => before.has(n) && !after.has(n)),
	};
}
