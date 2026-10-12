/**
 * 技能清单预算（P12）：模型看到的技能清单（名字 + 描述）不超过上下文窗口的 ≈8%。
 * 按优先级顺序保留；描述先截到 MAX_DESCRIPTION_CHARS，仍超预算则从尾部丢弃（显式 /skill: 仍可调用全部技能）。
 */
export const SKILL_LISTING_BUDGET_RATIO = 0.08;
export const MAX_DESCRIPTION_CHARS = 250;
const DEFAULT_CONTEXT_WINDOW = 128_000;

export interface SkillListingEntry {
	name: string;
	description: string;
	/** 常驻 / 显式指定的技能，预算不够也保留 */
	pinned?: boolean;
}

/** 粗估 token：CJK 按 1 字 1 token，其余按 4 字符 1 token；外加每条固定开销（XML 标签、路径）。 */
export function estimateTokens(text: string): number {
	const cjk = (text.match(/[\u3000-\u9fff\uac00-\ud7af]/g) ?? []).length;
	return cjk + Math.ceil((text.length - cjk) / 4);
}

const ENTRY_OVERHEAD_TOKENS = 24;

export function skillEntryTokens(entry: SkillListingEntry): number {
	return (
		ENTRY_OVERHEAD_TOKENS +
		estimateTokens(entry.name) +
		estimateTokens(truncateDescription(entry.description))
	);
}

export function truncateDescription(description: string): string {
	return description.length > MAX_DESCRIPTION_CHARS
		? `${description.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`
		: description;
}

export function skillListingBudget(
	contextWindow: number | undefined,
	ratio = SKILL_LISTING_BUDGET_RATIO,
): number {
	const window = contextWindow && contextWindow > 0 ? contextWindow : DEFAULT_CONTEXT_WINDOW;
	return Math.floor(window * ratio);
}

/** 返回保留的技能名（保持输入顺序）与用量。 */
export function applySkillBudget(
	entries: SkillListingEntry[],
	contextWindow: number | undefined,
	ratio = SKILL_LISTING_BUDGET_RATIO,
): { kept: string[]; dropped: string[]; usedTokens: number; budgetTokens: number } {
	const budgetTokens = skillListingBudget(contextWindow, ratio);
	let used = 0;
	for (const e of entries) if (e.pinned) used += skillEntryTokens(e);
	const kept: string[] = [];
	const dropped: string[] = [];
	for (const e of entries) {
		if (e.pinned) {
			kept.push(e.name);
			continue;
		}
		const cost = skillEntryTokens(e);
		if (used + cost <= budgetTokens) {
			used += cost;
			kept.push(e.name);
		} else dropped.push(e.name);
	}
	return { kept, dropped, usedTokens: used, budgetTokens };
}
