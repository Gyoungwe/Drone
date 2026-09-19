import { researchSkillCategory } from "./research-skills";

/** Presentation-only taxonomy. It never changes SDK invocation names, permissions or source files. */
export const SKILL_CATEGORY_ORDER = [
	"knowledge",
	"research",
	"writing",
	"presentation",
	"engineering",
	"collaboration",
	"setup",
	"support",
	"other",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORY_ORDER)[number];
const groups: Partial<Record<SkillCategory, readonly string[]>> = {
	knowledge: ["research-vault", "nature-experiment-log"],
	research: [
		"research-workflow",
		"zotero-literature",
		"research",
		"nature-academic-search",
		"nature-downloader",
		"nature-literature-pipeline",
		"nature-paper-card",
		"nature-reader",
		"nature-ref-verifier",
		"nature-statistics",
	],
	writing: [
		"nature-citation",
		"nature-data",
		"nature-paper-to-patent",
		"nature-polishing",
		"nature-response",
		"nature-reviewer",
		"nature-writing",
		"researchwrite",
		"writing-beats",
		"writing-for-agents",
		"writing-fragments",
		"writing-great-skills",
		"writing-shape",
	],
	presentation: [
		"show-me",
		"teach",
		"nature-figure",
		"nature-image2ppt",
		"nature-paper2ppt",
		"drone-ui-plugin",
	],
	engineering: [
		"code-review",
		"codebase-design",
		"diagnosing-bugs",
		"domain-modeling",
		"git-guardrails-claude-code",
		"grill-me",
		"grill-with-docs",
		"grilling",
		"implement",
		"implement-spec",
		"improve-codebase-architecture",
		"loop-me",
		"migrate-to-shoehorn",
		"prototype",
		"resolving-merge-conflicts",
		"retro",
		"scaffold-exercises",
		"tdd",
		"to-questionnaire",
		"to-spec",
		"to-tickets",
		"triage",
		"wait-what",
		"wayfinder",
	],
	collaboration: [
		"channel-pickup",
		"design-handoff",
		"claude-handoff",
		"codexhost-delegation",
		"handoff",
		"council-mode",
		"pi-subagents",
		"ask-user",
		"ask-matt",
		"find-skills",
		"wizard",
		"mcp-scripting",
	],
	support: ["nature-shared"],
};
const categoryByName = new Map(
	Object.entries(groups).flatMap(([category, names]) =>
		(names ?? []).map((name) => [name, category as SkillCategory] as const),
	),
);
export function bareSkillName(name: string): string {
	return name.startsWith("skill:") ? name.slice(6) : name;
}
export function getSkillCategory(name: string): SkillCategory {
	const bare = bareSkillName(name);
	return researchSkillCategory(bare) ?? categoryByName.get(bare) ?? (/^setup(?:-|$)|-setup$/.test(bare) ? "setup" : "other");
}
/** Clear product labels without renaming third-party workflows. */
const labels: Record<string, { zh: string; en: string }> = {
	"research-vault": { zh: "Obsidian 知识库", en: "Obsidian knowledge" },
	"research-workflow": { zh: "研究与证据工作流", en: "Research and evidence workflow" },
	"zotero-literature": { zh: "Zotero 文献库", en: "Zotero literature" },
	"setup-matt-pocock-skills": {
		zh: "工程技能配置 · 议题与项目文档",
		en: "Engineering skills · issues and project docs",
	},
	"setup-pre-commit": {
		zh: "Git 提交前检查 · 格式、类型与测试",
		en: "Git pre-commit · formatting, types and tests",
	},
	"setup-ts-deep-modules": {
		zh: "TypeScript 模块边界 · 依赖约束",
		en: "TypeScript module boundaries · dependency rules",
	},
	"nature-shared": {
		zh: "Nature 共用参考 · 非独立工作流",
		en: "Nature shared references · not a standalone workflow",
	},
};
export function skillDisplayName(name: string, language: "zh" | "en"): string {
	return labels[bareSkillName(name)]?.[language] ?? bareSkillName(name);
}
export function skillCatalogSearchText(name: string): string {
	const label = labels[bareSkillName(name)];
	return label ? `${label.zh} ${label.en}` : "";
}
export function groupSkillCatalog<T extends { name: string }>(
	skills: readonly T[],
): Array<{ category: SkillCategory; items: T[] }> {
	const buckets = new Map<SkillCategory, T[]>();
	for (const skill of skills) {
		const category = getSkillCategory(skill.name);
		const list = buckets.get(category) ?? [];
		list.push(skill);
		buckets.set(category, list);
	}
	return SKILL_CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => ({
		category,
		items: buckets.get(category) ?? [],
	}));
}
