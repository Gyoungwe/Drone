import { WORKFLOW_PROFILES, WORKFLOW_STAGES } from "@drone/shared";
import { describe, expect, it } from "vitest";
import {
	detectResearchIntent,
	mergeResearchIntent,
	selectResearchSkills,
} from "../src/capabilities/research-skill-router";
import { CapabilityResourceLoader, SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../src/capabilities/runtime";

const skills = WORKFLOW_PROFILES.map((p) => ({
	name: p.name,
	description: p.name,
	filePath: `/fixture/${p.name}/SKILL.md`,
	disableModelInvocation: false,
}));
const caps = new Set(["research", "coding", "visualization"] as const);
const select = (text: string) => selectResearchSkills(skills, caps, detectResearchIntent(text));
describe("consolidated stage execution", () => {
	it.each([
		["实验设计", "experimental-design"],
		["研究假设", "hypothesis-generation"],
		["样本量和统计功效", "statistical-power"],
		["数据可用性声明", "nature-data"],
		["统计报告审查", "nature-statistics"],
		["统计分析", "statistical-analysis"],
		["已有计数矩阵做差异表达", "pydeseq2"],
		["通路富集分析", "pathway-enrichment"],
		["单细胞分析", "scanpy"],
		["普通同行评审", "peer-review"],
		["三份互盲评审", "nature-reviewer"],
		["回复审稿意见", "nature-response"],
		["图片转PPT", "nature-image2ppt"],
		["PPT海报", "pptx-posters"],
		["LaTeX学术海报", "latex-posters"],
		["设计并交接任务", "design-handoff"],
		["接手已有交接任务", "channel-pickup"],
		["定制Drone界面", "drone-ui-plugin"],
		["检查计算资源", "get-available-resources"],
		["Zotero文献库", "zotero-literature"],
	])("%s has one primary owner %s", (text, name) => {
		const result = select(text);
		expect(result.names).toEqual([name]);
		expect(result.primaryWorkflow).toBe(name);
		expect(result.contract).toBeTruthy();
	});
	it("keeps all specialist modules and never starts competing general pipelines for an explicit choice", () => {
		expect(select("/skill:anndata 单细胞数据格式").names).toEqual(["anndata"]);
		expect(select("/skill:anndata 单细胞数据格式").stage).toBeUndefined();
		expect(select("/skill:scvi-tools 单细胞建模").contract).toBeUndefined();
		expect(select("/skill:scvi-tools 单细胞建模").names).toEqual(["scvi-tools"]);
		expect(select("scanpy and anndata 单细胞分析").names).toEqual(["scanpy", "anndata"]);
		expect(select("nature-academic-search and research-lookup 文献检索").names).toEqual([
			"nature-academic-search",
		]);
		expect(select("nature-figure and scientific-visualization 科研绘图").names).toEqual(["nature-figure"]);
	});
	it("manual-only skills get a native-command contract but remain excluded from automatic selection", () => {
		const manual = skills.map((s) => ({ ...s, disableModelInvocation: s.name === "nature-writing" }));
		expect(
			selectResearchSkills(manual, caps, detectResearchIntent("/skill:nature-writing")).primaryWorkflow,
		).toBe("nature-writing");
		expect(selectResearchSkills(manual, caps, detectResearchIntent("论文写作")).names).not.toContain(
			"nature-writing",
		);
	});
	it("enabling ARS never converts ordinary or blind review into a five-seat panel", () => {
		for (const [text, owner] of [
			["普通同行评审", "peer-review"],
			["三份互盲评审", "nature-reviewer"],
			["五席评审", "academic-paper-reviewer"],
		]) {
			expect(
				selectResearchSkills(skills, caps, detectResearchIntent(text!), { academicEnabled: true })
					.primaryWorkflow,
			).toBe(owner);
		}
		expect(
			selectResearchSkills(
				skills.filter((s) => s.name !== "peer-review"),
				caps,
				detectResearchIntent("普通同行评审"),
				{ academicEnabled: true },
			).unavailableStage,
		).toBe("review");
	});
	it("comparisons are reference-only, never assigned an execution owner", () => {
		const selected = select("compare nature-reviewer and academic-paper-reviewer");
		expect(selected.primaryWorkflow).toBeUndefined();
		const all = selectResearchSkills(
			skills,
			caps,
			detectResearchIntent("compare nature-reviewer and academic-paper-reviewer"),
			{ academicEnabled: true },
		);
		expect(all.names).toEqual(["nature-reviewer", "academic-paper-reviewer"]);
		expect(all.primaryWorkflow).toBeUndefined();
	});
	it("refuses non-equivalent fallbacks and reports missing stages", () => {
		for (const [text, missing] of [
			["统计分析", "statistical-analysis"],
			["单细胞分析", "scanpy"],
			["普通同行评审", "peer-review"],
		]) {
			const result = selectResearchSkills(
				skills.filter((s) => s.name !== missing),
				caps,
				detectResearchIntent(text!),
			);
			expect(result.names).toEqual([]);
			expect(result.unavailableStage).toBeTruthy();
		}
		expect(select("从研究到发表").names).toEqual([]);
		expect(select("从研究到发表").unavailableStage).toBe("pipeline");
	});
	it("stage changes remove old specialists, native forced owners and stale comparison mode", () => {
		const prior = detectResearchIntent("compare scanpy and anndata");
		const next = mergeResearchIntent(prior, detectResearchIntent("科研绘图"));
		expect(next.named).toEqual([]);
		expect(next.comparison).toBeUndefined();
		expect(selectResearchSkills(skills, caps, next).names).toEqual(["nature-figure"]);
		const visibility = new SkillVisibility();
		let active: string[] = [];
		const resourceLoader = new CapabilityResourceLoader(
			{ getSkills: () => ({ skills, diagnostics: [] }) } as any,
			visibility,
		);
		const runtime = new CapabilityRuntime(visibility);
		runtime.bind({
			resourceLoader,
			getAllTools: () => [{ name: "read" }, { name: "bash" }],
			getActiveToolNames: () => active,
			setActiveToolsByName: (names: string[]) => {
				active = names;
			},
		} as any);
		runtime.prepareForPrompt("/skill:anndata", false);
		runtime.activate(["research"], "科研绘图");
		expect(runtime.state().visibleSkills).not.toContain("anndata");
		expect(runtime.getWorkflowSelection().primaryWorkflow).toBe("nature-figure");
		runtime.prepareForPrompt("继续", false);
		expect(runtime.getWorkflowSelection().primaryWorkflow).toBe("nature-figure");
		runtime.prepareForPrompt("你好", false);
		expect(runtime.getWorkflowSelection().names).toEqual([]);
	});
	it("does not make arbitrary catalog entries visible when a direction is mentioned", () => {
		for (const word of ["research", "数据分析与专业计算", "工程集成与协作", "你好"])
			expect(select(word).names).toEqual([]);
	});
	it("all stage contracts point to existing inventory skill names or actual ARS aliases", () => {
		const names = new Set(skills.map((s) => `skill:${s.name}`));
		for (const stage of WORKFLOW_STAGES)
			for (const command of stage.commands)
				expect(names.has(command) || ["ars-full", "ars-reviewer"].includes(command)).toBe(true);
	});
});
