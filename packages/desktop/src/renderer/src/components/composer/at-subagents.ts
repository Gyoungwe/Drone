import type { SubagentPanelAgent } from "@drone/shared";
import { fuzzyScore } from "./at-files";
import { buildQuoteBlock } from "./quote";

/**
 * 输入框 `@` 子智能体选择器的纯逻辑（S9）：`@` 在消息开头时，@ 菜单先列子智能体、再列文件；
 * 选中子智能体后成为一枚不可拆分的胶囊，Enter 发送按胶囊走「直接派发」（= 面板表单的单任务派发）。
 * 不引入新的后端能力：派发仍是 `dispatchSubagents`，工作目录 = 会话 cwd，必需工具不填，followUp 默认开。
 */

/** @ 菜单条目：子智能体（仅消息开头）或项目文件 */
export type AtMenuItem =
	| { kind: "agent"; key: string; agent: SubagentPanelAgent }
	| { kind: "file"; key: string; path: string };

/** 子智能体候选最多列出条数（定义通常个位数；超出靠输入过滤） */
export const AT_AGENT_LIMIT = 8;

/**
 * 子智能体候选是否出现在 @ 菜单。四个条件缺一不可：
 * - `@` 在消息开头（token.start === 0；胶囊不算文本，所以已有 @ 文件胶囊时仍算开头）——避免误伤正文里的邮箱 / 提及；
 * - 没有 slash 胶囊（与 `/` 菜单互斥：命令参数里的 @ 只是文件引用）；
 * - 还没选过子智能体（输入框路径只支持单任务，多任务用面板）；
 * - 当前是可派发的真实会话（草稿会话 / 只读会话与面板一致：不派发）。
 */
export function subagentsOfferable(input: {
	tokenStart: number;
	slashCommand: string | null;
	subagent: string | null;
	dispatchable: boolean;
}): boolean {
	return input.tokenStart === 0 && !input.slashCommand && !input.subagent && input.dispatchable;
}

/** 按名称模糊匹配（与 @ 文件同一 fzf 评分）；空 query 保持发现顺序（内置 → 用户 → 项目） */
export function filterSubagents(
	agents: readonly SubagentPanelAgent[],
	query: string,
	limit = AT_AGENT_LIMIT,
): SubagentPanelAgent[] {
	if (!query) return agents.slice(0, limit);
	return agents
		.map((agent) => ({ agent, score: fuzzyScore(query, agent.name) }))
		.filter((item): item is { agent: SubagentPanelAgent; score: number } => item.score !== null)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((item) => item.agent);
}

/** 合并成一份扁平列表：子智能体在前、文件在后；键盘 ↑↓ 下标跨组连续 */
export function atMenuItems(input: {
	agents: readonly SubagentPanelAgent[];
	files: readonly string[];
}): AtMenuItem[] {
	return [
		...input.agents.map((agent): AtMenuItem => ({ kind: "agent", key: `agent:${agent.name}`, agent })),
		...input.files.map((path): AtMenuItem => ({ kind: "file", key: `file:${path}`, path })),
	];
}

/**
 * 输入框能否直接派发该子智能体：
 * - `ready`：内置 / 用户级定义，Enter 即派发；
 * - `needs_panel`：项目级定义每次派发都要勾选信任（面板决策，会话内不记忆）→ 选中后转到面板表单预填；
 * - `untrusted`：未信任项目里的项目级定义，任何路径都不可派发（列出但置灰，与面板一致）。
 */
export type AtAgentAvailability = "ready" | "needs_panel" | "untrusted";

export function atAgentAvailability(agent: SubagentPanelAgent): AtAgentAvailability {
	if (!agent.trusted) return "untrusted";
	if (agent.source === "project") return "needs_panel";
	return "ready";
}

/**
 * 胶囊之后的内容 → 派发任务文本，与普通发送同一拼装序：引用块最前（先给上下文）、@ 文件引用其次、正文最后。
 * 子智能体自己有 read 工具，@path 保留为纯文本引用即可；空正文返回空串由调用方拦截（任务必填）。
 */
export function subagentTaskText(input: {
	text: string;
	attachments: readonly string[];
	quotes: readonly string[];
}): string {
	const body = input.text.trim();
	if (!body) return "";
	const atText = input.attachments.map((path) => `@${path}`).join(" ");
	const main = [atText, body].filter(Boolean).join("\n");
	const quoteBlock = buildQuoteBlock([...input.quotes]);
	return [quoteBlock, main].filter(Boolean).join("\n\n");
}

/** 胶囊撤销（Esc / 空文本 Backspace / ×）：`@name ` 拼回文本开头，等待继续编辑（与 slash 胶囊同一恢复语义） */
export function restoreSubagentText(agent: string, text: string): string {
	return text ? `@${agent} ${text}` : `@${agent} `;
}
