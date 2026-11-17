import type { zhSkillsCatalog } from "./skills-catalog.zh";

export const enSkillsCatalog: typeof zhSkillsCatalog = {
	search: "Search skill names, purpose or source…",
	count: "{count} loaded skills · {groups} groups",
	aliases: "Compatibility:",
	scopeHint: "Grouped for browsing. Research-tool names, source files and permissions are unchanged.",
	setupHint:
		"These research tools configure their own engineering tools, not the Obsidian knowledge base. Collapsed by default; still searchable.",
	supportHint: "Retained as dependencies for other skills, not recommended as standalone workflows.",
	owner: "One Obsidian entry point",
	ownerHint:
		"Use /obsidian-setup to initialize and /obsidian-review to review; manage the literature library from the built-in Zotero connector on Skills & Connections. /setup and /research-setup remain compatibility aliases, not separate entries.",
	manage: "Manage knowledge",
	noMatch: "No matching skills",
	details: "Description and source",
	repository: "Source repository",
	repositoryUnknown: "Source repository not recorded (local or unmapped)",
	all: "All categories",
	group: {
		knowledge: "Knowledge",
		research: "Research and literature",
		writing: "Writing and review",
		presentation: "Figures and explanations",
		engineering: "Development and testing",
		collaboration: "Collaboration and planning",
		setup: "Tool-specific setup",
		support: "Internal shared references",
		other: "Other skills",
	},
};
