/**
 * 按能力路由技能：典型请求跑批（来自测试 bot 的 INVENTORY 28 条样本）。
 * Capability-scoped skill routing over every catalogued workflow skill.
 */
import {
	CAPABILITY_SKILL_LIMIT,
	capabilityForSkill,
	skillsForCapability,
	WORKFLOW_PROFILES,
} from "@drone/shared";
import { describe, expect, it } from "vitest";
import { CapabilityResourceLoader, SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../src/capabilities/runtime";

const skills = WORKFLOW_PROFILES.filter((p) => p.source !== "academic").map((p) => ({
	name: p.name,
	description: `${p.name.replace(/-/g, " ")} skill`,
	filePath: `/skills/${p.name}/SKILL.md`,
	baseDir: `/skills/${p.name}`,
	disableModelInvocation: false,
	sourceInfo: { source: "test", scope: "temporary" },
	alwaysWith: [],
}));

function runtime() {
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
	const r = new CapabilityRuntime(vis);
	r.bind({
		resourceLoader: loader,
		getAllTools: () => tools,
		getActiveToolNames: () => [...active],
		setActiveToolsByName: (n: string[]) => {
			active = n;
		},
	} as any);
	return { r, visible: () => loader.getSkills().skills.map((s: { name: string }) => s.name) };
}

const SAMPLES: [string, string[]][] = [
	["按 Nature 期刊规范重绘 DHX16 的结构域 + 比对图", ["nature-figure"]],
	["按 Nature 期刊风格重绘这张柱状图", ["nature-figure"]],
	["Redraw this figure in Nature journal style", ["nature-figure"]],
	["帮我做一张论文配图，三个面板", ["nature-figure"]],
	["用 matplotlib 画一个散点图", ["matplotlib"]],
	["Make a publication-ready volcano plot from my DESeq2 results", ["nature-figure"]],
	["画一个火山图", ["nature-figure"]],
	["把这篇论文做成组会 PPT", ["nature-paper2ppt"]],
	["做一张 LaTeX 学术海报", ["latex-posters"]],
	["画一个实验流程示意图", ["scientific-schematics"]],
	["分析 DHX16 蛋白的保守结构域", ["scikit-bio"]],
	["对这几条 FASTA 序列做多序列比对", ["scikit-bio"]],
	["Run a scanpy single-cell clustering on my h5ad", ["scanpy"]],
	["从 counts 做差异表达分析", ["pydeseq2"]],
	["做 GO/KEGG 通路富集分析", ["pathway-enrichment"]],
	["构建系统发育树", ["phylogenetics"]],
	["用 RDKit 计算分子描述符", ["rdkit"]],
	["Write a nextflow pipeline for RNA-seq", ["nextflow"]],
	["帮我写论文的引言部分", ["nature-writing"]],
	["润色这段摘要的英文", ["nature-polishing"]],
	["回复审稿人意见", ["nature-response"]],
	["检索近五年关于 DHX16 的文献", ["nature-academic-search"]],
	["做一个样本量和统计功效分析", ["statistical-power"]],
	["分析 DHX16 结构域并画成论文配图", ["scikit-bio", "nature-figure"]],
	["Analyze RNA-seq differential expression and make a publication-ready figure", ["nature-figure"]],
	["写论文方法部分，并画统计结果图", ["nature-writing", "nature-figure"]],
];

describe("capability-scoped routing samples", () => {
	it.each(SAMPLES)("%s", (text, expected) => {
		const { r, visible } = runtime();
		r.prepareForPrompt(text, false);
		const shown = visible();
		expect(shown).toEqual(expect.arrayContaining(expected));
		const active = new Set(r.state().activeCapabilities);
		for (const name of shown) {
			const owner = capabilityForSkill(name);
			expect(owner && active.has(owner), `${name} leaked without ${owner}`).toBe(true);
		}
		for (const id of active)
			expect(shown.filter((n) => capabilityForSkill(n) === id).length).toBeLessThanOrEqual(
				CAPABILITY_SKILL_LIMIT,
			);
	});
	it("mixed RNA-seq + figure keeps an analysis skill and the figure skill", () => {
		const { r, visible } = runtime();
		r.prepareForPrompt("Analyze RNA-seq differential expression and make a publication-ready figure", false);
		const shown = visible();
		expect(shown.some((n) => capabilityForSkill(n) === "analysis")).toBe(true);
		expect(r.state().activeCapabilities).toEqual(expect.arrayContaining(["analysis", "visualization"]));
	});
	it("phylogenetic tree does not trigger coding", () => {
		const { r } = runtime();
		r.prepareForPrompt("构建系统发育树", false);
		expect(r.state().activeCapabilities).not.toContain("coding");
	});
	it("pure coding request exposes no research skills", () => {
		const { r, visible } = runtime();
		r.prepareForPrompt("修复这个 TypeScript 构建报错", false);
		expect(visible().filter((n) => capabilityForSkill(n) !== "coding")).toEqual([]);
	});
	it("small talk exposes nothing", () => {
		const { r, visible } = runtime();
		r.prepareForPrompt("你好", false);
		expect(visible()).toEqual([]);
	});
	it("every catalogued workflow skill except internal ones has exactly one capability", () => {
		for (const p of WORKFLOW_PROFILES)
			if (p.direction !== "internal") expect(capabilityForSkill(p.name), p.name).toBeDefined();
		expect(skillsForCapability("visualization")).toContain("nature-figure");
		expect(skillsForCapability("research")).toEqual([]);
	});
	it("each capability alone lists at most the limit", () => {
		for (const id of ["visualization", "analysis", "literature", "writing", "planning", "coding"] as const) {
			const { r, visible } = runtime();
			r.activate([id]);
			const shown = visible();
			expect(shown.length).toBeGreaterThan(0);
			expect(shown.length).toBeLessThanOrEqual(CAPABILITY_SKILL_LIMIT);
			for (const n of shown) expect(capabilityForSkill(n)).toBe(id);
		}
	});
});
