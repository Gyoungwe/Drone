export const CAPABILITY_IDS = [
	"knowledge",
	"research",
	"analysis",
	"literature",
	"writing",
	"planning",
	"coding",
	"web",
	"files",
	"visualization",
	"external",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export interface CapabilityDefinition {
	id: CapabilityId;
	label: { zh: string; en: string };
	summary: string;
}

export const CAPABILITY_CATALOG: readonly CapabilityDefinition[] = [
	{
		id: "knowledge",
		label: { zh: "知识库", en: "Knowledge" },
		summary: "Vault/Wiki navigation, evidence reading and publication checks",
	},
	{
		id: "research",
		label: { zh: "科研", en: "Research" },
		summary:
			"research tools plus the always-on research base skills; pass task to add the matching skill groups",
	},
	{
		id: "analysis",
		label: { zh: "科研分析", en: "Research analysis" },
		summary: "bioinformatics, statistics, omics, chemistry and other analysis skills",
	},
	{
		id: "literature",
		label: { zh: "文献与证据", en: "Literature & evidence" },
		summary: "literature search, reading, citation and evidence skills",
	},
	{
		id: "writing",
		label: { zh: "论文写作", en: "Writing" },
		summary: "manuscript drafting, polishing, review and rebuttal skills",
	},
	{
		id: "planning",
		label: { zh: "研究规划", en: "Planning" },
		summary: "research questions, experimental design, power and grant planning skills",
	},
	{
		id: "coding",
		label: { zh: "工程", en: "Coding" },
		summary: "code inspection, shell execution and file edits",
	},
	{ id: "web", label: { zh: "网络", en: "Web" }, summary: "web retrieval and network-backed lookup" },
	{ id: "files", label: { zh: "文件", en: "Files" }, summary: "local file and document reading" },
	{
		id: "visualization",
		label: { zh: "可视化", en: "Visualization" },
		summary: "images, figures, journal-style plots, schematics, slides and posters",
	},
	{
		id: "external",
		label: { zh: "外部能力", en: "External apps" },
		summary: "MCP, plugins, channels and uncategorized extension tools",
	},
] as const;

export interface CapabilityToolInfo {
	name: string;
	capabilities: CapabilityId[];
	schemaBytes: number;
	active: boolean;
	alwaysOn: boolean;
	lastUsedAt?: number;
	invocations: number;
}

export interface CapabilityFootprint {
	allToolSchemaBytes: number;
	activeToolSchemaBytes: number;
	reductionRatio: number;
	allTools: number;
	activeTools: number;
	totalSkills: number;
	visibleSkills: number;
}

export interface CapabilityState {
	activeCapabilities: CapabilityId[];
	activeTools: string[];
	tools: CapabilityToolInfo[];
	visibleSkills: string[];
	footprint: CapabilityFootprint;
}
