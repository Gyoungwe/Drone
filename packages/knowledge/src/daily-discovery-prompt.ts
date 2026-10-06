/**
 * 每日发现的提示词与解析（只由宿主 backend 使用；与读 Vault 的 daily-discovery.ts 分开，
 * 避免把解析逻辑带进扩展的类型图）。
 */
import { DAILY_DISCOVERY_LIMITS, type DailyIdea, type DiscoveryNote } from "./daily-discovery";

export const DAILY_DISCOVERY_SYSTEM = [
	"You are a research colleague looking for ideas the user has not considered.",
	"You get notes that were added or changed recently (NEW) and older related notes (OLD) from the user's knowledge base.",
	"Find connections between NEW and OLD: a contradiction between sources, a combination nobody has studied, a method that transfers from another field, a default assumption worth challenging, or the next implication of a conclusion.",
	"Keep only ideas that are new (not already stated in the notes), grounded (rest on specific notes given here) and testable (an experiment, dataset or analysis could confirm or refute them).",
	`Return ONLY a JSON array with at most ${DAILY_DISCOVERY_LIMITS.maxIdeas} objects: {"title": short title, "idea": one or two sentences, "basis": [note paths from the input], "test": how to test it, "whyOverlooked": why it may have been missed}.`,
	"Write title, idea, test and whyOverlooked in the language of the notes. If nothing passes all three checks, return []. Never invent a note path, paper or number.",
].join("\n");

/** 拼出用户消息：NEW 与 OLD 两组笔记，均为截断后的原文 */
export function buildDailyDiscoveryMessage(fresh: DiscoveryNote[], related: DiscoveryNote[]): string {
	const block = (note: DiscoveryNote) => `### ${note.path}\n${note.text}`;
	return [
		"NEW notes:",
		...fresh.map(block),
		"",
		"OLD related notes:",
		...(related.length ? related.map(block) : ["(none found)"]),
	].join("\n\n");
}

function firstJsonArray(text: string): unknown {
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start < 0 || end <= start) return [];
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return [];
	}
}

/** 解析并校验：依据必须是本次提供的笔记路径，且至少引用一篇 NEW 笔记；最多 3 条 */
export function parseDailyIdeas(
	text: string,
	allowedPaths: Iterable<string>,
	freshPaths: Iterable<string>,
): DailyIdea[] {
	const allowed = new Set(allowedPaths);
	const fresh = new Set(freshPaths);
	const raw = firstJsonArray(text);
	if (!Array.isArray(raw)) return [];
	const ideas: DailyIdea[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const value = item as Record<string, unknown>;
		const str = (key: string, max: number) =>
			typeof value[key] === "string" ? (value[key] as string).trim().slice(0, max) : "";
		const basis: string[] = [];
		for (const path of Array.isArray(value.basis) ? (value.basis as unknown[]) : [])
			if (typeof path === "string" && allowed.has(path) && !basis.includes(path)) basis.push(path);
		const idea = {
			title: str("title", 160),
			idea: str("idea", 1200),
			basis,
			test: str("test", 800),
			whyOverlooked: str("whyOverlooked", 600),
		};
		if (!idea.title || !idea.idea || !idea.test || !basis.some((path) => fresh.has(path))) continue;
		ideas.push(idea);
		if (ideas.length >= DAILY_DISCOVERY_LIMITS.maxIdeas) break;
	}
	return ideas;
}
