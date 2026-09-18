import { type CapabilityId, RESEARCH_SKILL_SOURCES, researchSkillProfile } from "@drone/shared";

/** Topic IDs, not raw user prompts, are persisted in the session checkpoint. */
const TOPICS = {
	search:
		/文献检索|检索.{0,8}(?:论文|文献)|搜.{0,5}论文|literature search|search.{0,20}(?:papers|literature)/i,
	synthesis: /文献综述|系统综述|元分析|literature review|systematic review|meta.analysis/i,
	reading: /读.{0,5}论文|解读.{0,5}论文|论文解读|read.{0,12}paper|paper summary/i,
	citation: /引用|参考文献|引文|citation|bibliograph|verify references/i,
	writing:
		/写.{0,5}论文|论文写作|起草.{0,8}(?:摘要|引言|讨论)|撰写|manuscript|write.{0,15}(?:paper|abstract)|draft.{0,15}(?:paper|abstract|introduction)/i,
	polishing: /润色|学术翻译|polish|language.only|proofread/i,
	review: /审稿|同行评审|peer review|review.{0,12}(?:paper|manuscript)/i,
	response: /回复.{0,5}审稿|审稿.{0,5}回复|rebuttal|response to reviewers/i,
	figures:
		/科研绘图|论文配图|多面板图|科学.{0,5}可视化|scientific (?:figure|plot|visualization)|publication.ready (?:plot|figure)|volcano plot|火山图/i,
	slides: /论文.{0,5}(?:汇报|幻灯片|ppt)|科研汇报|research (?:slides|presentation)|paper.{0,5}slides/i,
	statistics:
		/统计(?:分析|检验|功效)|假设检验|效应量|statistical (?:analysis|test|power)|hypothesis test|effect size|anova|t.test/i,
	singlecell: /单细胞|single.cell|scRNA|scanpy|scvelo|scvi/i,
	rnaseq: /差异表达|bulk.{0,4}rna|rna.seq|RNA测序|转录组分析|deseq/i,
	chemistry: /化学信息|分子对接|药物发现|cheminformatics|molecular docking|drug discovery|rdkit/i,
	methods: /实验设计|研究设计|研究假设|experimental design|research design|hypothesis generation/i,
	grants: /基金申请|研究计划书|项目申请书|research proposal|research grant|grant proposal/i,
	pipeline:
		/全流程.{0,5}(?:论文|科研)|从研究到发表|academic pipeline|research.to.publication|end.to.end paper/i,
	subscription:
		/每日文献|文献订阅|定时.{0,6}(?:文献|推送)|daily literature|literature (?:feed|subscription)/i,
} as const;

export type ResearchTopic = keyof typeof TOPICS;
export interface ResearchSkillIntent {
	topics: ResearchTopic[];
	named: string[];
	primary?: string;
	comparison?: boolean;
}
export const EMPTY_RESEARCH_INTENT: ResearchSkillIntent = { topics: [], named: [] };
export function normalizeResearchIntent(value: unknown): ResearchSkillIntent {
	const v = value as Partial<ResearchSkillIntent> | null;
	const named = Array.isArray(v?.named)
		? [...new Set(v.named.filter((name) => typeof name === "string" && !!researchSkillProfile(name)))].slice(
				0,
				24,
			)
		: [];
	return {
		topics: Array.isArray(v?.topics)
			? [...new Set(v.topics.filter((id) => typeof id === "string" && Object.hasOwn(TOPICS, id)))].slice(
					0,
					24,
				)
			: [],
		named,
		...(typeof v?.primary === "string" && researchSkillProfile(v.primary) ? { primary: v.primary } : {}),
		...(v?.comparison === true ? { comparison: true } : {}),
	};
}
const namePatterns = RESEARCH_SKILL_SOURCES.flatMap((source) => source.skills).map(({ name }) => ({
	name,
	pattern: new RegExp(`(?<![a-z0-9-])${name.replace(/-/g, "[- ]")}(?![a-z0-9-])`, "gi"),
}));
export function detectResearchIntent(text: string): ResearchSkillIntent {
	const direct = text.trim().match(/^\/skill:([a-z0-9-]+)(?:\s+([\s\S]*))?$/i);
	const directName = direct?.[1];
	const primary = directName && researchSkillProfile(directName) ? directName : undefined;
	const bounded = (direct ? (direct[2] ?? "") : text).slice(0, 16000);
	const matches = namePatterns.flatMap(({ name, pattern }) =>
		[...bounded.matchAll(pattern)].map((m) => ({ name, start: m.index, end: m.index + m[0].length })),
	);
	matches.sort((a, b) => a.start - b.start || b.end - a.end);
	let end = -1;
	const named: string[] = primary ? [primary] : [];
	for (const match of matches)
		if (match.start >= end) {
			named.push(match.name);
			end = match.end;
		}
	let topics = Object.entries(TOPICS)
		.filter(([, pattern]) => pattern.test(bounded))
		.map(([id]) => id) as ResearchTopic[];
	// A reply/revision is not a request to run another reviewer panel.
	if (topics.includes("response")) topics = topics.filter((t) => t !== "review" && t !== "writing");
	if (topics.includes("polishing")) topics = topics.filter((t) => t !== "writing");
	return normalizeResearchIntent({
		topics,
		named,
		primary,
		comparison: !primary && named.length > 1 && /比较|对比|区别|\bcompare\b|\bdifferences?\b/i.test(bounded),
	});
}
const PHASE_TOPICS = new Set<ResearchTopic>([
	"pipeline",
	"response",
	"polishing",
	"review",
	"writing",
	"synthesis",
	"subscription",
]);
export function changesResearchWorkflow(intent: ResearchSkillIntent): boolean {
	return (
		(!!intent.primary && WORKFLOWS.has(intent.primary)) || intent.topics.some((t) => PHASE_TOPICS.has(t))
	);
}
export function isResearchWorkflowSkill(name: string): boolean {
	return WORKFLOWS.has(name);
}
export function mergeResearchIntent(a: ResearchSkillIntent, b: ResearchSkillIntent): ResearchSkillIntent {
	const changed = changesResearchWorkflow(b);
	let topics = [...(changed ? a.topics.filter((t) => !PHASE_TOPICS.has(t)) : a.topics), ...b.topics];
	if (b.topics.includes("response")) topics = topics.filter((t) => t !== "review" && t !== "writing");
	if (b.topics.includes("polishing")) topics = topics.filter((t) => t !== "writing");
	return normalizeResearchIntent({
		topics,
		named: [...b.named, ...(changed ? a.named.filter((n) => !WORKFLOWS.has(n)) : a.named)],
		primary: b.primary ?? (changed ? undefined : a.primary),
		comparison: b.comparison ?? a.comparison,
	});
}

/** Workflow owners compete globally, not just inside a single keyword rule. Specialists supplement them. */
const WORKFLOWS = new Set([
	"deep-research",
	"academic-paper",
	"academic-paper-reviewer",
	"academic-pipeline",
	"nature-writing",
	"nature-polishing",
	"nature-reviewer",
	"nature-response",
	"nature-literature-pipeline",
	"scientific-writing",
	"peer-review",
	"literature-review",
]);
const ROUTES: Array<{ topic: ResearchTopic; slot: string; names: string[]; academic?: string }> = [
	{ topic: "pipeline", slot: "workflow", names: [], academic: "academic-pipeline" },
	{ topic: "response", slot: "workflow", names: ["nature-response"], academic: "academic-paper" },
	{ topic: "polishing", slot: "workflow", names: ["nature-polishing", "scientific-writing"] },
	{
		topic: "review",
		slot: "workflow",
		names: ["nature-reviewer", "peer-review"],
		academic: "academic-paper-reviewer",
	},
	{
		topic: "writing",
		slot: "workflow",
		names: ["nature-writing", "scientific-writing"],
		academic: "academic-paper",
	},
	{ topic: "synthesis", slot: "workflow", names: ["literature-review"], academic: "academic-paper" },
	{ topic: "subscription", slot: "workflow", names: ["nature-literature-pipeline"] },
	{
		topic: "search",
		slot: "search",
		names: ["nature-academic-search", "research-lookup"],
		academic: "deep-research",
	},
	{ topic: "reading", slot: "reading", names: ["nature-reader", "paperclip"] },
	{
		topic: "citation",
		slot: "citation",
		names: ["nature-ref-verifier", "citation-management", "nature-citation"],
	},
	{ topic: "figures", slot: "figures", names: ["nature-figure", "scientific-visualization"] },
	{ topic: "slides", slot: "slides", names: ["nature-paper2ppt", "scientific-slides"] },
	{ topic: "statistics", slot: "statistics", names: ["statistical-analysis", "nature-statistics"] },
	{ topic: "singlecell", slot: "singlecell", names: ["scanpy", "scvi-tools"] },
	{ topic: "rnaseq", slot: "rnaseq", names: ["bulk-rnaseq", "pydeseq2"] },
	{ topic: "chemistry", slot: "chemistry", names: ["rdkit", "deepchem"] },
	{
		topic: "methods",
		slot: "methods",
		names: ["experimental-design", "hypothesis-generation", "scientific-critical-thinking"],
	},
	{ topic: "grants", slot: "grants", names: ["researchwrite", "research-grants"] },
];
export const RESEARCH_SKILL_LIMIT = 6;
export const RESEARCH_DISCOVERY_BYTES = 6000;
export interface RoutableSkill {
	name: string;
	description: string;
	filePath?: string;
	disableModelInvocation?: boolean;
}
export interface ResearchSkillSelection {
	names: string[];
	reasons: Record<string, string>;
	discoveryBytes: number;
}
export function selectResearchSkills(
	skills: readonly RoutableSkill[],
	capabilities: ReadonlySet<CapabilityId>,
	intent: ResearchSkillIntent,
	options: { academicEnabled?: boolean } = {},
): ResearchSkillSelection {
	const result: ResearchSkillSelection = { names: [], reasons: {}, discoveryBytes: 0 };
	if (!["research", "knowledge", "visualization"].some((id) => capabilities.has(id as CapabilityId)))
		return result;
	const candidates = new Map(
		skills
			.filter(
				(s) =>
					researchSkillProfile(s.name) &&
					!s.disableModelInvocation &&
					s.name !== "nature-shared" &&
					(researchSkillProfile(s.name)?.source !== "academic" || options.academicEnabled),
			)
			.map((s) => [s.name, s]),
	);
	const slots = new Set<string>();
	const slotFor = (name: string) =>
		WORKFLOWS.has(name) ? "workflow" : (ROUTES.find((r) => r.names.includes(name))?.slot ?? name);
	const add = (name: string, reason: string) => {
		const skill = candidates.get(name),
			slot = slotFor(name);
		if (!skill || result.names.includes(name) || (!intent.comparison && slots.has(slot))) return false;
		const bytes =
			Buffer.byteLength(
				JSON.stringify({ name, description: skill.description, location: skill.filePath ?? "" }),
			) + 96;
		if (
			result.names.length >= RESEARCH_SKILL_LIMIT ||
			result.discoveryBytes + bytes > RESEARCH_DISCOVERY_BYTES
		)
			return false;
		result.names.push(name);
		result.reasons[name] = reason;
		result.discoveryBytes += bytes;
		slots.add(slot);
		return true;
	};
	if (intent.primary) add(intent.primary, "explicit-command");
	for (const name of intent.named) add(name, intent.comparison ? "comparison-reference" : "named-in-task");
	// Full publication pipelines cannot fall back to a daily literature feed or a local writing task.
	if (intent.topics.includes("pipeline")) {
		if (options.academicEnabled) add("academic-pipeline", "topic:pipeline");
		return result;
	}
	for (const route of ROUTES) {
		if (!intent.topics.includes(route.topic)) continue;
		const names = options.academicEnabled && route.academic ? [route.academic, ...route.names] : route.names;
		for (const name of names) if (add(name, `topic:${route.topic}`)) break;
	}
	return result;
}
