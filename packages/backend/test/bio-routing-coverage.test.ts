/**
 * 生信全覆盖路由样本（中英文）。原注释：v0.21.1 回归：会话 01a1172e（「帮我画一个所有生物DHX16基因的联配图」）暴露的路由问题。
 * B1 非工作流技能（~/.agents）也按能力分组、每能力最多 6 个；B2 返回按 主技能→配套→补满 排序，首行点名 SKILL.md；
 * B4 联配图/比对图等识别为绘图；B5 补满按任务文本排序；B6 不自动加 coding。
 */
import { CAPABILITY_SKILL_LIMIT, skillCapability, WORKFLOW_PROFILES } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { CapabilityResourceLoader, SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../src/capabilities/runtime";
import descriptions from "./fixtures/skill-descriptions.json";

const AGENT_SKILLS = [
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
	"research",
	"resolving-merge-conflicts",
	"retro",
	"scaffold-exercises",
	"setup-matt-pocock-skills",
	"setup-pre-commit",
	"setup-ts-deep-modules",
	"tdd",
	"teach",
	"to-questionnaire",
	"to-spec",
	"to-tickets",
	"triage",
	"wait-what",
	"wayfinder",
	"writing-beats",
	"writing-for-agents",
	"writing-fragments",
	"writing-shape",
];
const BASE = ["research-vault", "research-workflow", "zotero-literature"];
const desc = descriptions as Record<string, string>;
const skill = (name: string, path: string, alwaysWith: unknown = []) => ({
	name,
	description: desc[name] || `${name.replace(/-/g, " ")} helper`,
	filePath: path,
	baseDir: path.replace(/[\\/]SKILL\.md$/, ""),
	disableModelInvocation: false,
	sourceInfo: { source: "test", scope: "temporary" },
	alwaysWith,
});
const skills = [
	...WORKFLOW_PROFILES.filter((p) => p.source !== "academic" && !BASE.includes(p.name)).map((p) =>
		skill(p.name, `C:\\Drone\\research-skills\\${p.name}\\SKILL.md`),
	),
	...AGENT_SKILLS.map((n) => skill(n, `C:\\Users\\me\\.agents\\skills\\${n}\\SKILL.md`)),
	skill("research-vault", "C:\\Drone\\workbench\\research-vault\\SKILL.md", ["knowledge", "research"]),
	skill("research-workflow", "C:\\Drone\\workbench\\research-workflow\\SKILL.md", ["research"]),
	skill("zotero-literature", "C:\\Drone\\workbench\\zotero-literature\\SKILL.md", ["research"]),
];

function setup() {
	const inner: any = {
		getExtensions: () => ({ extensions: [], errors: [], runtime: { flagValues: new Map() } }),
		getSkills: () => ({ skills, diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [],
		getAppendSystemPromptSources: () => [],
		extendResources: () => undefined,
		reload: async () => undefined,
	};
	const vis = new SkillVisibility();
	const loader = new CapabilityResourceLoader(inner, vis);
	const tools = ["read", "capability_load"].map((name) => ({ name, description: name, parameters: {} }));
	let active = tools.map((t) => t.name);
	const runtime = new CapabilityRuntime(vis);
	runtime.bind({
		resourceLoader: loader,
		getAllTools: () => tools,
		getActiveToolNames: () => [...active],
		setActiveToolsByName: (n: string[]) => {
			active = n;
		},
	} as any);
	return { runtime, visible: () => runtime.state().visibleSkills };
}

type Row = [string, string, string[]];
// [请求, 期望主技能, 期望同时可见]
const ROWS: Row[] = [
	// 序列 / 比对 / MSA
	["对这几条 FASTA 序列做多序列比对", "scikit-bio", []],
	["Run a multiple sequence alignment of these FASTA sequences", "scikit-bio", []],
	// 系统发育
	["用 IQ-TREE 构建系统发育树", "phylogenetics", []],
	["Build a phylogenetic tree from the alignment", "phylogenetics", []],
	// 结构 / 结构域 / 蛋白
	["用 ESMFold 做蛋白质结构预测", "esm", []],
	["Predict the protein structure with AlphaFold and compare to the PDB entry", "esm", []],
	["分析 DHX16 蛋白的保守结构域", "scikit-bio", []],
	// 基因组 / 变异
	["对 BAM 文件做变异检测并输出 VCF", "pysam", []],
	["Call variants from my BAM files", "pysam", []],
	["把这些基因组坐标 liftover 到 hg38", "genomic-coordinates", []],
	// 转录组 bulk / 单细胞
	["从 counts 做差异表达分析", "pydeseq2", []],
	["Run bulk RNA-seq differential expression with DESeq2", "bulk-rnaseq", []],
	["用 scanpy 做单细胞聚类", "scanpy", []],
	["Single-cell RNA-seq clustering and UMAP", "scanpy", []],
	// 表观
	["分析 ChIP-seq 和 ATAC-seq 的信号并生成 bigWig", "deeptools", []],
	["Profile DNA methylation and chromatin accessibility", "deeptools", []],
	// 宏基因组 / 微生物组
	["做 16S 扩增子微生物组 alpha 多样性分析", "scikit-bio", []],
	["Metagenomics microbiome beta diversity with UniFrac", "scikit-bio", []],
	// 蛋白组 / 代谢组
	["分析 LC-MS 蛋白质组学数据", "pyopenms", []],
	["Process untargeted metabolomics mass spectrometry spectra", "pyopenms", []],
	// 注释 / GO / 通路
	["做 GO/KEGG 通路富集分析", "pathway-enrichment", []],
	["Run GSEA gene set enrichment on my ranked genes", "pathway-enrichment", []],
	// CRISPR / 引物
	["为这个基因设计 CRISPR sgRNA 和 PCR 引物", "biopython", []],
	["Design primers for qPCR of DHX16", "biopython", []],
	// 分子动力学 / 对接
	["用 GROMACS 做分子动力学模拟", "molecular-dynamics", []],
	["Run molecular docking of this ligand with DiffDock", "diffdock", []],
	// 公共数据库
	["从 NCBI 下载 DHX16 的蛋白序列", "gget", []],
	["Look up the UniProt and Ensembl IDs for DHX16", "gget", []],
	// 流程引擎
	["写一个 nextflow 流程跑 RNA-seq", "nextflow", []],
	["Write a nextflow pipeline for variant calling", "nextflow", []],
	// 混合：分析 + 画图
	["帮我画一个所有生物DHX16基因的联配图", "scikit-bio", ["nature-figure"]],
	["构建进化树并画进化树图", "phylogenetics", ["nature-figure"]],
	["做差异表达并画火山图", "bulk-rnaseq", ["nature-figure"]],
	["Single-cell clustering and plot the UMAP as a publication-ready figure", "scanpy", ["nature-figure"]],
	["做 GO 富集并画结果图", "pathway-enrichment", ["nature-figure"]],
	["从 UniProt 下载序列后做多序列比对", "gget", ["scikit-bio"]],
];

describe("bioinformatics routing coverage (zh + en)", () => {
	it.each(ROWS)("%s → %s", (text, primary, also) => {
		const { runtime, visible } = setup();
		runtime.prepareForPrompt(text, false);
		expect(runtime.getWorkflowSelection().primaryWorkflow).toBe(primary);
		const v = visible();
		expect(v).toEqual(expect.arrayContaining([primary, ...also]));
		expect(v.length).toBeLessThanOrEqual(21);
		const counts = new Map<string, number>();
		for (const n of v.filter((n) => !BASE.includes(n))) {
			const id = skillCapability(n) ?? "none";
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		for (const [id, c] of counts) expect(c, id).toBeLessThanOrEqual(CAPABILITY_SKILL_LIMIT);
	});
});
