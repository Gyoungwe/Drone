import profiles from "./workflow-profiles.json";

/** Navigation/task metadata, never a replacement for source SKILL bodies or permissions. */
export const WORKFLOW_DIRECTIONS = [
	{
		id: "planning",
		label: {
			zh: "研究规划与设计",
			en: "Research planning and design",
		},
	},
	{
		id: "evidence",
		label: {
			zh: "文献证据与知识管理",
			en: "Evidence and knowledge",
		},
	},
	{
		id: "analysis",
		label: {
			zh: "数据分析与专业计算",
			en: "Data analysis and computing",
		},
	},
	{
		id: "writing",
		label: {
			zh: "论文写作与审校",
			en: "Writing and review",
		},
	},
	{
		id: "presentation",
		label: {
			zh: "可视化与成果交付",
			en: "Visualization and delivery",
		},
	},
	{
		id: "engineering",
		label: {
			zh: "工程集成与协作",
			en: "Engineering and collaboration",
		},
	},
] as const;
export type WorkflowDirection = (typeof WORKFLOW_DIRECTIONS)[number]["id"];
export type WorkflowGroup = WorkflowDirection | "internal";
export const WORKFLOW_PROFILES = profiles as Array<{
	name: string;
	direction: WorkflowGroup;
	subdomain: string;
	source: string;
}>;
const byName = new Map(WORKFLOW_PROFILES.map((p) => [p.name, p]));
export function workflowProfile(name: string) {
	return byName.get(name.replace(/^skill:/, ""));
}
export interface WorkflowStage {
	id: string;
	direction: WorkflowDirection;
	label: { zh: string; en: string };
	commands: readonly string[];
	contract: string;
}
export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
	{
		id: "ideation",
		direction: "planning",
		label: {
			zh: "科研选题与假设",
			en: "Questions and hypotheses",
		},
		commands: ["skill:hypothesis-generation", "skill:scientific-brainstorming"],
		contract: "Question, rival hypotheses, discriminating evidence; no claim of completed experiments.",
	},
	{
		id: "methods",
		direction: "planning",
		label: {
			zh: "实验设计",
			en: "Experimental design",
		},
		commands: ["skill:experimental-design"],
		contract: "Design, experimental units, controls and assumptions before data collection.",
	},
	{
		id: "power",
		direction: "planning",
		label: {
			zh: "样本量与统计效能",
			en: "Sample size and power",
		},
		commands: ["skill:statistical-power"],
		contract: "Prospective sample-size assumptions, effect size and uncertainty.",
	},
	{
		id: "grants",
		direction: "planning",
		label: {
			zh: "开题与项目申请",
			en: "Proposals and grants",
		},
		commands: ["skill:researchwrite", "skill:research-grants"],
		contract: "Evidence-grounded proposal; preserve the selected funder or opening-report format.",
	},
	{
		id: "pipeline",
		direction: "planning",
		label: {
			zh: "ARS 完整项目 · 逐阶段确认",
			en: "ARS full project · stage confirmations",
		},
		commands: ["ars-full"],
		contract: "ARS original stage confirmations and resume semantics; host owns task state.",
	},
	{
		id: "search",
		direction: "evidence",
		label: {
			zh: "文献发现",
			en: "Literature discovery",
		},
		commands: ["skill:nature-academic-search", "skill:paper-lookup", "skill:research-lookup"],
		contract: "Bounded search scope, provenance and failures; a search hit is not a source read.",
	},
	{
		id: "reading",
		direction: "evidence",
		label: {
			zh: "论文阅读与对照翻译",
			en: "Paper reading and translation",
		},
		commands: ["skill:nature-reader"],
		contract:
			"Source-linked reading within requested scope; do not translate the full paper for a local question.",
	},
	{
		id: "paperCard",
		direction: "evidence",
		label: {
			zh: "论文证据卡",
			en: "Evidence-grounded paper card",
		},
		commands: ["skill:nature-paper-card"],
		contract: "Reuse supplied reader source maps; mark unsupported sections rather than invent evidence.",
	},
	{
		id: "synthesis",
		direction: "evidence",
		label: {
			zh: "系统文献综述",
			en: "Systematic literature review",
		},
		commands: ["skill:literature-review"],
		contract: "Search, eligibility and synthesis; no mandatory AI images, payments or uploads.",
	},
	{
		id: "citation",
		direction: "evidence",
		label: {
			zh: "引文核验与导出",
			en: "Citation verification and export",
		},
		commands: ["skill:nature-ref-verifier", "skill:citation-management"],
		contract: "Bibliographic identity and formatting are distinct from scientific claim support.",
	},
	{
		id: "library",
		direction: "evidence",
		label: {
			zh: "Zotero 文献库",
			en: "Zotero library",
		},
		commands: ["skill:zotero-literature"],
		contract: "Use host-controlled library writes and separate Zotero/Vault receipts.",
	},
	{
		id: "vault",
		direction: "evidence",
		label: {
			zh: "知识库检索与维护",
			en: "Knowledge retrieval and maintenance",
		},
		commands: ["skill:research-vault"],
		contract: "Keep application binding, evidence reads and Wiki approval under host control.",
	},
	{
		id: "subscription",
		direction: "evidence",
		label: {
			zh: "文献订阅 · 需授权推送",
			en: "Literature feeds · authorized delivery",
		},
		commands: ["skill:nature-literature-pipeline"],
		contract: "Subscription is not publication orchestration; scheduling and delivery require authorization.",
	},
	{
		id: "explore",
		direction: "analysis",
		label: {
			zh: "数据探索与质量检查",
			en: "Data exploration and QC",
		},
		commands: ["skill:exploratory-data-analysis"],
		contract: "Inspect supplied data locally and disclose supported formats and actual executed checks.",
	},
	{
		id: "statistics",
		direction: "analysis",
		label: {
			zh: "统计分析",
			en: "Statistical analysis",
		},
		commands: ["skill:statistical-analysis"],
		contract:
			"Assumptions, effect sizes, uncertainty and provenance; do not infer analysis from manuscript prose.",
	},
	{
		id: "rnaseq",
		direction: "analysis",
		label: {
			zh: "Bulk RNA-seq",
			en: "Bulk RNA-seq",
		},
		commands: ["skill:bulk-rnaseq"],
		contract: "Enter at the supplied input stage; existing counts must not trigger a fresh FASTQ pipeline.",
	},
	{
		id: "de",
		direction: "analysis",
		label: {
			zh: "已有计数的差异表达",
			en: "Differential expression from counts",
		},
		commands: ["skill:pydeseq2"],
		contract: "Validate counts, biological replicates, design and contrasts before differential expression.",
	},
	{
		id: "enrichment",
		direction: "analysis",
		label: {
			zh: "通路与基因集富集",
			en: "Pathway enrichment",
		},
		commands: ["skill:pathway-enrichment"],
		contract: "Preserve gene identifiers, method and background universe.",
	},
	{
		id: "singlecell",
		direction: "analysis",
		label: {
			zh: "单细胞标准分析",
			en: "Standard single-cell analysis",
		},
		commands: ["skill:scanpy"],
		contract: "Standard analysis; keep AnnData structure and specialized models as distinct modules.",
	},
	{
		id: "chemistry",
		direction: "analysis",
		label: {
			zh: "化学信息与分子处理",
			en: "Cheminformatics",
		},
		commands: ["skill:rdkit", "skill:datamol"],
		contract:
			"Choose molecular operations explicitly; docking, dynamics and property prediction are different tasks.",
	},
	{
		id: "writing",
		direction: "writing",
		label: {
			zh: "论文起草与重构",
			en: "Draft or restructure a manuscript",
		},
		commands: ["skill:nature-writing", "skill:scientific-writing"],
		contract: "Complete the requested section; preserve evidence scope and do not force a full pipeline.",
	},
	{
		id: "polishing",
		direction: "writing",
		label: {
			zh: "语言润色与学术翻译",
			en: "Polish or translate prose",
		},
		commands: ["skill:nature-polishing"],
		contract: "Preserve facts and terminology; no new study design or automatic full rewrite.",
	},
	{
		id: "review",
		direction: "writing",
		label: {
			zh: "普通审校",
			en: "Manuscript assessment",
		},
		commands: ["skill:peer-review"],
		contract: "Evidence-bounded assessment with confidentiality and venue-policy checks.",
	},
	{
		id: "blindReview",
		direction: "writing",
		label: {
			zh: "Nature 三份互盲评审",
			en: "Nature: three blind reviews",
		},
		commands: ["skill:nature-reviewer"],
		contract: "Three genuinely isolated reports frozen before synthesis; disclose inability to isolate.",
	},
	{
		id: "arsReview",
		direction: "writing",
		label: {
			zh: "ARS 五席角色评议",
			en: "ARS: five-seat role-separated panel",
		},
		commands: ["ars-reviewer"],
		contract:
			"Original five-seat contract and provenance; role separation is not independent error processes.",
	},
	{
		id: "response",
		direction: "writing",
		label: {
			zh: "逐点回复与返修",
			en: "Respond to reviewers",
		},
		commands: ["skill:nature-response"],
		contract:
			"Respond to actual reviewer comments and trace manuscript changes; do not run another review panel.",
	},
	{
		id: "reporting",
		direction: "writing",
		label: {
			zh: "统计报告审查",
			en: "Statistical reporting audit",
		},
		commands: ["skill:nature-statistics"],
		contract: "Review reported units, replication and uncertainty; compute only if requested with data.",
	},
	{
		id: "availability",
		direction: "writing",
		label: {
			zh: "数据与代码可用性声明",
			en: "Data/code availability statements",
		},
		commands: ["skill:nature-data"],
		contract: "Availability/FAIR statements, not data cleaning; never invent accessions or permissions.",
	},
	{
		id: "patent",
		direction: "writing",
		label: {
			zh: "专利技术交底",
			en: "Patent disclosure drafting",
		},
		commands: ["skill:nature-paper-to-patent"],
		contract: "Source-grounded disclosure with original stage gates; do not infer inventorship or rights.",
	},
	{
		id: "figures",
		direction: "presentation",
		label: {
			zh: "真实数据图表",
			en: "Data-backed figures",
		},
		commands: ["skill:nature-figure", "skill:scientific-visualization"],
		contract: "Truthful data, uncertainty and accessible figures; AI diagrams are not data plots.",
	},
	{
		id: "slides",
		direction: "presentation",
		label: {
			zh: "论文汇报与演示",
			en: "Research presentations",
		},
		commands: ["skill:nature-paper2ppt", "skill:scientific-slides"],
		contract: "Preserve source figures, speaker notes and requested output format.",
	},
	{
		id: "reconstruct",
		direction: "presentation",
		label: {
			zh: "图片重建可编辑 PPT",
			en: "Editable slides from images",
		},
		commands: ["skill:nature-image2ppt"],
		contract: "Reconstruct object-level editable slides; this is not authoring a new deck.",
	},
	{
		id: "poster",
		direction: "presentation",
		label: {
			zh: "LaTeX 学术海报",
			en: "LaTeX research poster",
		},
		commands: ["skill:latex-posters"],
		contract: "Deliver the requested poster format using authorized content and assets.",
	},
	{
		id: "pptPoster",
		direction: "presentation",
		label: {
			zh: "可编辑 PPT 海报",
			en: "Editable PowerPoint poster",
		},
		commands: ["skill:pptx-posters"],
		contract: "Preserve editable poster objects; do not silently substitute a PDF-only artifact.",
	},
	{
		id: "explainer",
		direction: "presentation",
		label: {
			zh: "来源可追溯的解释页",
			en: "Source-grounded explainer",
		},
		commands: ["skill:research-show-me"],
		contract: "Static self-contained presentation, not evidence; use authorized artifact sinks.",
	},
	{
		id: "handoff",
		direction: "engineering",
		label: {
			zh: "设计并交接任务",
			en: "Design and hand off work",
		},
		commands: ["skill:design-handoff"],
		contract: "Produce spec, plan and HANDOFF; notify in batches and preserve channel protocol.",
	},
	{
		id: "pickup",
		direction: "engineering",
		label: {
			zh: "接手已有交接",
			en: "Pick up a handoff",
		},
		commands: ["skill:channel-pickup"],
		contract: "Read HANDOFF/spec/plan; verify changes, report completion and unsubscribe at termination.",
	},
	{
		id: "plugin",
		direction: "engineering",
		label: {
			zh: "定制 Drone 界面",
			en: "Customize Drone UI",
		},
		commands: ["skill:drone-ui-plugin"],
		contract: "Respect UI plugin SPEC, sandbox and user-only enablement; do not auto-enable.",
	},
	{
		id: "resources",
		direction: "engineering",
		label: {
			zh: "检查计算资源",
			en: "Inspect compute resources",
		},
		commands: ["skill:get-available-resources"],
		contract: "Bounded inventory only; no installation, cloud job or paid resource reservation.",
	},
	{
		id: "nextflow",
		direction: "engineering",
		label: {
			zh: "Nextflow 管线",
			en: "Nextflow pipelines",
		},
		commands: ["skill:nextflow"],
		contract: "Preserve samplesheets, executor/container versions and execution authorization.",
	},
];
export function workflowStage(id: string) {
	return WORKFLOW_STAGES.find((s) => s.id === id);
}
export function workflowStageForSkill(name: string) {
	const native = `skill:${name.replace(/^skill:/, "")}`;
	return (
		WORKFLOW_STAGES.find((s) => s.commands.includes(native)) ??
		(name === "academic-paper"
			? workflowStage("writing")
			: name === "academic-paper-reviewer"
				? workflowStage("arsReview")
				: name === "academic-pipeline"
					? workflowStage("pipeline")
					: name === "deep-research"
						? workflowStage("search")
						: undefined)
	);
}
/** Resolve only commands actually registered by the current SDK. No catalog-only/disabled capability is invented. */
export function resolveWorkflowStage<T extends { name: string; supported: boolean; source?: string }>(
	stage: WorkflowStage,
	commands: readonly T[],
): T | undefined {
	return stage.commands
		.map((name) =>
			commands.find(
				(c) =>
					c.name === name &&
					c.supported &&
					(!c.source || c.source === (name.startsWith("skill:") ? "skill" : "template")),
			),
		)
		.find((c) => c !== undefined);
}
export const WORKFLOW_OWNER_NAMES: ReadonlySet<string> = new Set([
	...WORKFLOW_STAGES.flatMap((s) => s.commands.filter((n) => n.startsWith("skill:")).map((n) => n.slice(6))),
	"academic-paper",
	"academic-paper-reviewer",
	"academic-pipeline",
	"deep-research",
]);
