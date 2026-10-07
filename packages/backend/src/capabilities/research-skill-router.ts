import {
	CAPABILITY_SKILL_DIRECTIONS,
	type CapabilityId,
	capabilityForDirection,
	capabilityForSkill,
	skillCapability,
	WORKFLOW_OWNER_NAMES,
	WORKFLOW_PROFILES,
	workflowProfile,
	workflowStage,
	workflowStageForSkill,
} from "@drone/shared";

/** Topic IDs, not raw user prompts, are persisted in the session checkpoint. */
const TOPICS = {
	ideation: /科研选题|研究问题|研究假设|research question|hypothesis generation|scientific brainstorming/i,
	power: /样本量|统计功效|功效分析|效能分析|sample.size|power analysis|statistical power/i,
	paperCard: /论文.{0,4}(?:精读卡|证据卡)|paper card/i,
	library: /zotero|文献库/i,
	vault: /知识库|obsidian|wiki.{0,10}(?:review|update|search)/i,
	explore: /数据探索|探索性.{0,4}分析|数据质量检查|exploratory data|data quality check/i,
	de: /已有.{0,8}(?:计数|counts)|从.{0,5}(?:计数|counts)|differential expression from counts/i,
	enrichment:
		/通路富集|基因集富集|富集分析|功能注释|\bKEGG\b|gene ontology|\bGO\b.{0,4}(?:富集|注释|enrichment|analysis)|pathway enrichment|gene.set enrichment|\bGSEA\b/i,
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
		/文献检索|检索.{0,24}(?:论文|文献)|(?:查找|查询|搜索|搜|找).{0,16}(?:相关)?(?:论文|文献)|literature search|search.{0,20}(?:papers|literature)|find.{0,20}(?:papers|literature)/i,
	synthesis: /文献综述|系统综述|元分析|literature review|systematic review|meta.analysis/i,
	reading: /读.{0,5}论文|解读.{0,5}论文|论文解读|read.{0,12}paper|paper summary/i,
	citation: /引用.{0,6}(?:论文|文献)|引用核验|参考文献|引文|citation|bibliograph|verify references/i,
	writing:
		/写.{0,5}论文|论文写作|起草.{0,8}(?:摘要|引言|讨论)|撰写|manuscript|write.{0,15}(?:paper|abstract)|draft.{0,15}(?:paper|abstract|introduction)/i,
	polishing: /润色|学术翻译|polish|language.only|proofread/i,
	review: /审稿|同行评审|peer review|review.{0,12}(?:paper|manuscript)/i,
	response: /回复.{0,5}审稿|审稿.{0,5}回复|rebuttal|response to reviewers/i,
	figures:
		/科研绘图|论文配图|多面板图|科学.{0,5}可视化|scientific (?:figure|plot|visualization)|publication.ready (?:plot|figure)|volcano plot|火山图|(?:Nature|Science|Cell|期刊|杂志|顶刊).{0,10}(?:规范|风格|格式|标准|要求|级别?).{0,24}(?:图|figure|plot|chart)|重绘.{0,16}图|(?:期刊|Nature|Science|Cell).{0,6}(?:配图|插图|图表)|(?:redraw|re-draw|restyle).{0,30}(?:figure|plot|chart|graph)|(?:journal|nature|science|cell).{0,6}(?:style|format).{0,20}(?:figure|plot|chart)|(?:figure|plot|chart).{0,30}(?:journal|nature|science|cell).{0,6}(?:style|format|guidelines)|画.{0,16}图|(?:联配|比对|进化树|系统发育树|结构域|保守性)(?:示意)?图|(?:alignment|tree|domain|phylogen\w*|conservation)\s+(?:figure|plot|chart|graph|visuali[sz]ation)|\bplot(?:s|ting)?\b|draw.{0,20}(?:figure|chart|graph|tree|alignment)|(?:make|draw|plot).{0,20}(?:publication|journal).{0,10}(?:figure|plot)/i,
	schematic:
		/示意图|流程示意|机制图|模式图|技术路线图|实验流程图|schematic|flow.?chart|graphical abstract|图形摘要/i,
	phylogeny: /系统发育|进化树|系统树|phylogen|evolutionary tree|\biq-?tree\b|\braxml\b|newick/i,
	structure:
		/蛋白(?:质)?.{0,4}(?:结构预测|三维结构|折叠|语言模型)|结构预测|alphafold|esmfold|\besm[23c]?\b|\bpdb\b|protein (?:structure|folding|language model)|structure prediction/i,
	variant:
		/变异(?:检测|识别|注释|calling)|突变检测|体细胞突变|call.{0,6}variants?|variant call|\bvcf\b|\bbam\b|snp calling|somatic (?:mutation|variant)/i,
	epigenomics:
		/表观(?:遗传|基因组)|甲基化|chip.?seq|atac.?seq|bigwig|epigenom|chromatin accessibility|染色质(?:开放|可及)/i,
	microbiome:
		/宏基因组|微生物(?:组|群落)|16s|扩增子|metagenom|microbiome|alpha.diversity|beta.diversity|unifrac|多样性分析/i,
	proteomics: /蛋白(?:质)?组学?|质谱|代谢组|proteomic|metabolom|mass spectrometry|\blc.?ms\b/i,
	genomics:
		/基因组(?:注释|坐标|区间)|genome annotation|genomic (?:coordinates|intervals)|\bbed (?:file|intervals)|liftover|alphagenome/i,
	crispr: /crispr|sgrna|guide rna|引物设计|primer design|pcr.?引物|\bprimers?\b/i,
	dynamics: /分子动力学|molecular dynamics|\bmd simulation|gromacs|openmm/i,
	docking: /分子对接|molecular docking|\bdocking\b|diffdock/i,
	bioDb:
		/\bncbi\b|uniprot|ensembl|genbank|登录号|accession|\bgget\b|(?:基因|蛋白|序列).{0,6}(?:数据库|下载)|(?:public|biological) database/i,
	slides: /论文.{0,5}(?:汇报|幻灯片|ppt)|科研汇报|research (?:slides|presentation)|paper.{0,5}slides/i,
	statistics:
		/统计(?:分析|检验|功效)|假设检验|效应量|statistical (?:analysis|test|power)|hypothesis test|effect size|anova|t.test/i,
	singlecell: /单细胞|single.cell|scRNA|scanpy|scvelo|scvi/i,
	rnaseq: /差异表达|bulk.{0,4}rna|rna.seq|RNA测序|转录组分析|deseq/i,
	chemistry: /化学信息|分子对接|药物发现|cheminformatics|molecular docking|drug discovery|rdkit/i,
	bioinformatics:
		/基因(?:组|序列)?|蛋白(?:质)?|序列|结构域|保守域|联配|多序列比对|比对|同源|直系同源|blast|fasta|ncbi|uniprot|ensembl|转录本|昆虫|细菌|真菌|病毒|bioinformatics|sequence alignment|domain analysis/i,
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
	"phylogeny",
	"structure",
	"variant",
	"epigenomics",
	"microbiome",
	"proteomics",
	"genomics",
	"crispr",
	"dynamics",
	"docking",
	"bioDb",
	"bioinformatics",
	"review",
	"writing",
	"synthesis",
	"subscription",
	// Analysis stages own a mixed "analyse + plot" request; the figure skill joins as companion.
	"singlecell",
	"rnaseq",
	"statistics",
	"chemistry",
	"schematic",
	"figures",
	"slides",
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
/** Topics without a catalogued stage map straight to their specialist skill. */
const TOPIC_SKILLS: Partial<Record<ResearchTopic, string[]>> = {
	phylogeny: ["phylogenetics", "etetoolkit"],
	structure: ["esm"],
	variant: ["pysam", "tiledbvcf", "pacsomatic"],
	epigenomics: ["deeptools", "gtars"],
	microbiome: ["scikit-bio", "waypoint-bio"],
	proteomics: ["pyopenms", "matchms"],
	genomics: ["genomic-coordinates", "pysam", "alphagenome"],
	crispr: ["biopython"],
	dynamics: ["molecular-dynamics"],
	docking: ["diffdock", "rdkit"],
	bioDb: ["gget", "bioservices", "database-lookup"],
	schematic: ["scientific-schematics"],
};
function topicCapability(topic: ResearchTopic): CapabilityId | undefined {
	const stage = workflowStage(topic);
	return capabilityForDirection(
		stage?.direction ?? workflowProfile(TOPIC_SKILLS[topic]?.[0] ?? "")?.direction,
	);
}
function topicSkills(topic: ResearchTopic): string[] {
	const stage = workflowStage(topic);
	const fromStage = stage?.commands.filter((n) => n.startsWith("skill:")).map((n) => n.slice(6)) ?? [];
	return [...(TOPIC_SKILLS[topic] ?? []), ...fromStage];
}
/** Skill capabilities requested by an intent (topics, named skills, explicit command). */
export function intentCapabilities(intent: ResearchSkillIntent): CapabilityId[] {
	const found = new Set<CapabilityId>();
	for (const topic of intent.topics) {
		const id = topicCapability(topic);
		if (id) found.add(id);
	}
	for (const name of [...intent.named, ...(intent.primary ? [intent.primary] : [])]) {
		const id = capabilityForDirection(workflowProfile(name)?.direction);
		if (id) found.add(id);
	}
	return [...found];
}
/**
 * `research` is now an umbrella: on its own it owns no workflow skills, but a research task adds the
 * skill capabilities its intent asks for. Sub-capabilities are always kept as loaded.
 */
export function effectiveSkillCapabilities(
	capabilities: ReadonlySet<CapabilityId>,
	intent: ResearchSkillIntent,
): Set<CapabilityId> {
	const out = new Set<CapabilityId>();
	for (const id of capabilities) if (CAPABILITY_SKILL_DIRECTIONS[id]) out.add(id);
	if (capabilities.has("research")) for (const id of intentCapabilities(intent)) out.add(id);
	return out;
}
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
	const owned = effectiveSkillCapabilities(capabilities, intent);
	if (!owned.size) return result;
	// The primary stage is the highest-priority topic whose owning capability is loaded.
	const stageId = STAGE_PRIORITY.find((t) => {
		if (!intent.topics.includes(t)) return false;
		const owner = topicCapability(t);
		return !owner || owned.has(owner);
	});
	// Strict ownership: a workflow skill is a candidate only when its own capability is loaded (no cross-leak).
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
				const owner = capabilityForDirection(profile.direction);
				return !!owner && owned.has(owner);
			})
			.map((s) => [s.name, s]),
	);
	const perCapability = new Map<CapabilityId, { count: number; bytes: number }>();
	const add = (name: string, reason: string, supporting = false) => {
		const skill = candidates.get(name);
		if (!skill || result.names.includes(name)) return false;
		if (!supporting && !intent.comparison && result.primaryWorkflow && WORKFLOW_OWNER_NAMES.has(name))
			return false;
		if (result.names.length >= RESEARCH_SKILL_LIMIT && !supporting) return false;
		const owner = capabilityForDirection(workflowProfile(name)?.direction) as CapabilityId;
		const used = perCapability.get(owner) ?? { count: 0, bytes: 0 };
		const bytes =
			Buffer.byteLength(
				JSON.stringify({ name, description: skill.description, location: skill.filePath ?? "" }),
			) + 96;
		if (
			used.count >= RESEARCH_SKILL_LIMIT ||
			(supporting ? used.bytes : result.discoveryBytes) + bytes > RESEARCH_DISCOVERY_BYTES
		)
			return false;
		perCapability.set(owner, { count: used.count + 1, bytes: used.bytes + bytes });
		result.names.push(name);
		result.reasons[name] = reason;
		result.discoveryBytes += bytes;
		return true;
	};
	const setPrimary = (name: string) => {
		if (intent.comparison || result.primaryWorkflow || !result.names.includes(name)) return;
		result.primaryWorkflow = name;
		const stage = workflowStageForSkill(name);
		result.stage = stage?.id;
		result.direction = workflowProfile(name)?.direction;
		result.contract = stage?.contract;
	};
	if (intent.primary && add(intent.primary, "explicit-command")) setPrimary(intent.primary);
	for (const name of intent.named)
		if (add(name, intent.comparison ? "comparison-reference" : "named-in-task")) setPrimary(name);
	// Exact/native choices are authoritative; do not start a second broad workflow from words in their arguments.
	if (result.names.length || intent.primary || intent.comparison) return result;
	// 1) One primary workflow owner from the highest-priority stage (keeps the stage contract).
	if (stageId) {
		const names = topicSkills(stageId);
		const academic = ACADEMIC[stageId];
		if (options.academicEnabled && academic) names.unshift(academic);
		for (const name of names)
			if (add(name, `topic:${stageId}`)) {
				setPrimary(name);
				break;
			}
		if (!result.names.length) result.unavailableStage = stageId;
	}
	// 2) Mixed requests (analysis/writing + figure): one supporting skill from the other side (visualization
	//    vs. the primary's capability), so the figure skill is not squeezed out by the analysis/writing owner.
	const primaryCapability = capabilityForSkill(result.primaryWorkflow ?? "");
	for (const topic of STAGE_PRIORITY) {
		if (!intent.topics.includes(topic) || topic === stageId) continue;
		const owner = topicCapability(topic);
		if (!owner || owner === primaryCapability || !owned.has(owner)) continue;
		// Companions: the figure side of analysis/writing + plot, and public bio databases next to an analysis.
		if (
			owner !== "visualization" &&
			primaryCapability !== "visualization" &&
			topic !== "bioDb" &&
			stageId !== "bioDb"
		)
			continue;
		if (result.names.some((n) => capabilityForSkill(n) === owner)) continue;
		for (const name of topicSkills(topic)) if (add(name, `topic:${topic}`, true)) break;
	}
	return result;
}
/**
 * Visible workflow skills: the routed owner + supporting skills, then each loaded capability filled up to
 * RESEARCH_SKILL_LIMIT by task relevance (catalog order as tie-break). Never crosses capability ownership.
 */
export interface CapabilitySkillOptions {
	academicEnabled?: boolean;
	/** Capabilities explicitly loaded through capability_load: their workflow skills are filled up to the limit. */
	fill?: ReadonlySet<CapabilityId>;
	/** Raw task / prompt text, used only in memory to rank fill candidates (never persisted). */
	taskText?: string;
	/** Skills pinned by `alwaysWith` are the always-on base and never count toward a capability. */
	isPinned?: (skill: RoutableSkill) => boolean;
}
export interface CapabilitySkillList {
	/** Ordered: primary → companion (routed) → fill. */
	names: string[];
	primary?: string;
	companions: string[];
}
/**
 * Visible skills: the routed owner + companion skills, then every active capability filled up to
 * RESEARCH_SKILL_LIMIT by task relevance. Workflow skills are only filled for explicitly loaded capabilities;
 * non-workflow skills (catalog category, e.g. ~/.agents) obey the same per-capability limit.
 */
export function selectCapabilitySkills(
	skills: readonly RoutableSkill[],
	capabilities: ReadonlySet<CapabilityId>,
	intent: ResearchSkillIntent,
	options: CapabilitySkillOptions = {},
): string[] {
	return orderedCapabilitySkills(skills, capabilities, intent, options).names;
}
export function orderedCapabilitySkills(
	skills: readonly RoutableSkill[],
	capabilities: ReadonlySet<CapabilityId>,
	intent: ResearchSkillIntent,
	options: CapabilitySkillOptions = {},
): CapabilitySkillList {
	const routed = selectResearchSkills(skills, capabilities, intent, options);
	const primary = routed.primaryWorkflow;
	const head = { names: [...routed.names], primary, companions: routed.names.filter((n) => n !== primary) };
	// An explicit /skill: or named choice stays authoritative: do not pad it with other skills.
	if (intent.primary || intent.comparison || (routed.names.length && intent.named.length)) return head;
	const owned = effectiveSkillCapabilities(capabilities, intent);
	const fill = new Set<CapabilityId>(options.fill ?? capabilities);
	const names = head.names;
	const count = new Map<CapabilityId, number>();
	for (const n of names) {
		const id = capabilityForSkill(n);
		if (id) count.set(id, (count.get(id) ?? 0) + 1);
	}
	const words = taskWords(intent, options.taskText);
	const groups = new Set<CapabilityId>([...owned]);
	for (const id of capabilities) groups.add(id);
	for (const id of groups) {
		const ranked = skills
			.filter((s) => {
				if (s.disableModelInvocation || options.isPinned?.(s)) return false;
				const profile = workflowProfile(s.name);
				if (profile) {
					if (!fill.has(id) || capabilityForDirection(profile.direction) !== id) return false;
					return profile.source !== "academic" || !!options.academicEnabled;
				}
				return skillCapability(s.name) === id;
			})
			.map((s, index) => ({
				s,
				index,
				score: relevance(s, words) + (workflowProfile(s.name) ? 0.5 : 0),
			}))
			.sort((a, b) => b.score - a.score || a.index - b.index);
		for (const { s } of ranked) {
			if ((count.get(id) ?? 0) >= RESEARCH_SKILL_LIMIT) break;
			if (names.includes(s.name)) continue;
			names.push(s.name);
			count.set(id, (count.get(id) ?? 0) + 1);
		}
	}
	return head;
}
/** Ranking tokens: routed topic skill names + task words (latin ≥3 chars, CJK bigrams). */
function taskWords(intent: ResearchSkillIntent, taskText = ""): string[] {
	const words = intent.topics.flatMap((t) => topicSkills(t)).flatMap((n) => n.split("-"));
	const text = taskText.toLowerCase().slice(0, 2000);
	for (const m of text.matchAll(/[a-z][a-z0-9]{2,}/g)) words.push(m[0]);
	for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? [])
		for (let i = 0; i + 1 < run.length; i++) words.push(run.slice(i, i + 2));
	return [...new Set(words.filter((w) => w.length >= 2 && !STOP_WORDS.has(w)))];
}
const STOP_WORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"this",
	"that",
	"from",
	"into",
	"帮我",
	"一个",
	"所有",
]);
function relevance(skill: RoutableSkill, words: string[]): number {
	if (!words.length) return 0;
	const text = `${skill.name} ${skill.description}`.toLowerCase();
	return words.filter((w) => text.includes(w)).length;
}
