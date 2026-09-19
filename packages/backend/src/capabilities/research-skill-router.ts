import {
	type CapabilityId,
	WORKFLOW_PROFILES,
	WORKFLOW_OWNER_NAMES,
	workflowProfile,
	workflowStage,
	workflowStageForSkill,
	researchSkillProfile,
} from "@drone/shared";

/** Topic IDs, not raw user prompts, are persisted in the session checkpoint. */
const TOPICS = {
	ideation: /科研选题|研究问题|研究假设|research question|hypothesis generation|scientific brainstorming/i,
	power: /样本量|统计功效|功效分析|效能分析|sample.size|power analysis|statistical power/i,
	paperCard: /论文.{0,4}(?:精读卡|证据卡)|paper card/i,
	library: /zotero|文献库/i,
	vault: /知识库|obsidian|wiki.{0,10}(?:review|update|search)/i,
	explore: /数据探索|探索性.{0,4}分析|数据质量检查|exploratory data|data quality check/i,
	de: /已有.{0,8}(?:计数|counts)|从.{0,5}计数|differential expression from counts/i,
	enrichment: /通路富集|基因集富集|pathway enrichment|gene.set enrichment/i,
	blindReview: /互盲|三份.{0,5}评审|three blind reviews/i,
	arsReview: /五席.{0,5}(?:评审|评议)|five.seat.{0,15}(?:review|panel)/i,
	reporting: /统计(?:报告|审查|呈现)|统计方法小节|statistical reporting/i,
	availability: /数据可用性|代码可用性|data.{0,6}availability|code.{0,6}availability/i,
	patent: /专利.{0,8}(?:撰写|交底|草稿)|技术交底书|patent disclosure|patent draft/i,
	reconstruct:
		/图片.{0,8}(?:PPT|幻灯片)|截图.{0,8}(?:PPT|幻灯片)|image.{0,8}editable.{0,8}(?:slide|powerpoint)/i,
	poster: /(?:学术|科研|LaTeX).{0,5}海报|latex poster|research poster/i,
	pptPoster: /(?:ppt|powerpoint).{0,6}(?:海报|poster)/i,
	explainer: /解释页|交互式解读|show me.{0,15}(?:paper|research)|source.grounded explainer/i,
	handoff: /设计.{0,8}交接|交接.{0,8}任务|design handoff/i,
	pickup: /接手.{0,8}(?:交接|任务|频道)|pick up.{0,8}handoff|channel pickup/i,
	plugin: /(?:定制|修改).{0,8}(?:Drone|聊天界面|工具卡)|drone ui plugin/i,
	resources: /(?:检查|检测).{0,8}(?:计算资源|GPU|内存)|inspect compute resources/i,
	nextflow: /\bnextflow\b|nf-core/i,
	search:
		/文献检索|检索.{0,8}(?:论文|文献)|搜.{0,5}论文|literature search|search.{0,20}(?:papers|literature)/i,
	synthesis: /文献综述|系统综述|元分析|literature review|systematic review|meta.analysis/i,
	reading: /读.{0,5}论文|解读.{0,5}论文|论文解读|read.{0,12}paper|paper summary/i,
	citation: /引用.{0,6}(?:论文|文献)|引用核验|参考文献|引文|citation|bibliograph|verify references/i,
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
	methods: /实验设计|研究设计|experimental design|research design/i,
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
		? [...new Set(v.named.filter((name) => typeof name === "string" && !!workflowProfile(name)))].slice(0, 24)
		: [];
	return {
		topics: Array.isArray(v?.topics)
			? [...new Set(v.topics.filter((id) => typeof id === "string" && Object.hasOwn(TOPICS, id)))].slice(
					0,
					24,
				)
			: [],
		named,
		...(typeof v?.primary === "string" && workflowProfile(v.primary) ? { primary: v.primary } : {}),
		...(v?.comparison === true ? { comparison: true } : {}),
	};
}
const namePatterns = WORKFLOW_PROFILES.map(({ name }) => ({
	name,
	pattern: new RegExp(`(?<![a-z0-9-])${name.replace(/-/g, "[- ]")}(?![a-z0-9-])`, "gi"),
}));
export function detectResearchIntent(text: string): ResearchSkillIntent {
	const direct = text.trim().match(/^\/skill:([a-z0-9-]+)(?:\s+([\s\S]*))?$/i);
	const directName = direct?.[1];
	const primary = directName && workflowProfile(directName) ? directName : undefined;
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
/** A new task/stage replaces old owners AND specialists. Bare continuation retains the checkpoint. */
export function changesResearchWorkflow(intent: ResearchSkillIntent): boolean {
	return (
		!!intent.primary ||
		intent.topics.length > 0 ||
		intent.named.some((n) => workflowProfile(n)?.direction !== "internal")
	);
}
export function isResearchWorkflowSkill(name: string): boolean {
	return WORKFLOW_OWNER_NAMES.has(name);
}
export function mergeResearchIntent(a: ResearchSkillIntent, b: ResearchSkillIntent): ResearchSkillIntent {
	return changesResearchWorkflow(b) ? normalizeResearchIntent(b) : normalizeResearchIntent(a);
}
// More specific stages precede broad contextual words. A specialist request never silently falls back to a different contract.
const STAGE_PRIORITY: ResearchTopic[] = [
	"pipeline",
	"response",
	"polishing",
	"arsReview",
	"blindReview",
	"reporting",
	"availability",
	"patent",
	"pptPoster",
	"reconstruct",
	"poster",
	"explainer",
	"pickup",
	"handoff",
	"plugin",
	"resources",
	"nextflow",
	"library",
	"vault",
	"power",
	"de",
	"enrichment",
	"paperCard",
	"review",
	"writing",
	"synthesis",
	"subscription",
	"figures",
	"slides",
	"singlecell",
	"rnaseq",
	"statistics",
	"chemistry",
	"methods",
	"ideation",
	"grants",
	"explore",
	"citation",
	"reading",
	"search",
];
const ACADEMIC: Partial<Record<ResearchTopic, string>> = {
	pipeline: "academic-pipeline",
	arsReview: "academic-paper-reviewer",
	writing: "academic-paper",
	search: "deep-research",
};
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
	primaryWorkflow?: string;
	stage?: string;
	direction?: string;
	contract?: string;
	unavailableStage?: string;
}
export function selectResearchSkills(
	skills: readonly RoutableSkill[],
	capabilities: ReadonlySet<CapabilityId>,
	intent: ResearchSkillIntent,
	options: { academicEnabled?: boolean } = {},
): ResearchSkillSelection {
	const result: ResearchSkillSelection = { names: [], reasons: {}, discoveryBytes: 0 };
	if (
		!["research", "knowledge", "visualization", "coding"].some((id) => capabilities.has(id as CapabilityId))
	)
		return result;
	const stageId = STAGE_PRIORITY.find((t) => intent.topics.includes(t));
	const candidates = new Map(
		skills
			.filter((s) => {
				const profile = workflowProfile(s.name);
				if (
					!profile ||
					profile.direction === "internal" ||
					(s.disableModelInvocation && intent.primary !== s.name)
				)
					return false;
				if (profile.source === "academic" && !options.academicEnabled) return false;
				return profile.direction === "engineering"
					? capabilities.has("coding") || capabilities.has("research")
					: profile.direction === "presentation"
						? capabilities.has("visualization") || capabilities.has("research")
						: capabilities.has("research") || capabilities.has("knowledge");
			})
			.map((s) => [s.name, s]),
	);
	const add = (name: string, reason: string) => {
		const skill = candidates.get(name);
		if (!skill || result.names.includes(name)) return false;
		if (!intent.comparison && result.primaryWorkflow && WORKFLOW_OWNER_NAMES.has(name)) return false;
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
		if (!intent.comparison && !result.primaryWorkflow) {
			result.primaryWorkflow = name;
			const stage = workflowStageForSkill(name);
			result.stage = stage?.id;
			result.direction = workflowProfile(name)?.direction;
			result.contract = stage?.contract;
		}
		return true;
	};
	if (intent.primary) add(intent.primary, "explicit-command");
	for (const name of intent.named) add(name, intent.comparison ? "comparison-reference" : "named-in-task");
	// Exact/native choices are authoritative; do not start a second broad workflow from words in their arguments.
	if (result.names.length || intent.primary || intent.comparison) return result;
	if (stageId) {
		const stage = workflowStage(stageId);
		const names = stage?.commands.filter((n) => n.startsWith("skill:")).map((n) => n.slice(6)) ?? [];
		const academic = ACADEMIC[stageId];
		if (options.academicEnabled && academic) names.unshift(academic);
		for (const name of names) if (add(name, `topic:${stageId}`)) break;
		if (!result.names.length) result.unavailableStage = stageId;
	}
	return result;
}
