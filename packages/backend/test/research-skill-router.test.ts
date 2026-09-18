import { RESEARCH_SKILL_SOURCES } from "@drone/shared";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	detectResearchIntent,
	normalizeResearchIntent,
	RESEARCH_DISCOVERY_BYTES,
	RESEARCH_SKILL_LIMIT,
	selectResearchSkills,
} from "../src/capabilities/research-skill-router";
import { CapabilityResourceLoader, SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime, detectCapabilities } from "../src/capabilities/runtime";

const skills = RESEARCH_SKILL_SOURCES.flatMap((source) => source.skills).map((skill) => ({
	name: skill.name,
	description: `${skill.name} workflow`,
	filePath: `/packs/${skill.path}`,
	disableModelInvocation: false,
}));
const research = new Set(["research"] as const);
const select = (text: string) => selectResearchSkills(skills, research, detectResearchIntent(text));
function fixture(manager?: ReturnType<typeof SessionManager.inMemory>) {
	const visibility = new SkillVisibility();
	const inner = { getSkills: () => ({ skills, diagnostics: [] }) } as any;
	const loader = new CapabilityResourceLoader(inner, visibility);
	let active: string[] = [];
	const names = ["read", "bash", "write", "edit", "capability_load", "research_read_knowledge"];
	const session = {
		resourceLoader: loader,
		sessionManager: manager,
		getAllTools: () => names.map((name) => ({ name })),
		getActiveToolNames: () => active,
		setActiveToolsByName: (list: string[]) => {
			active = list.filter((name) => names.includes(name));
		},
	};
	const runtime = new CapabilityRuntime(visibility);
	runtime.bind(session as any);
	return { runtime, loader };
}

describe("task-scoped research skill routing", () => {
	it("has a complete index without exposing it on greeting, code or generic external requests", () => {
		expect(skills).toHaveLength(190);
		const { runtime, loader } = fixture();
		for (const text of ["你好", "检查仓库代码", "连接一个 MCP 插件", "research", "nature"]) {
			runtime.prepareForPrompt(text, false);
			expect(runtime.state().visibleSkills).toEqual([]);
		}
		expect(loader.getAllSkills().skills).toHaveLength(190);
	});
	it.each([
		["请帮我论文写作", "nature-writing"],
		["请润色论文", "nature-polishing"],
		["单细胞分析", "scanpy"],
		["差异表达分析", "bulk-rnaseq"],
		["科研绘图", "nature-figure"],
		["统计分析", "statistical-analysis"],
		["systematic review", "literature-review"],
		["回复审稿意见", "nature-response"],
		["用 qiskit", "qiskit"],
	])("routes %s to %s", (query, name) => {
		expect(detectCapabilities(query)).toContain("research");
		expect(select(query).names).toContain(name);
	});
	it("selects one writing owner and does not invoke shared-reference packages", () => {
		expect(select("论文写作").names).toEqual(["nature-writing"]);
		expect(select("polish this manuscript").names).toEqual(["nature-polishing"]);
		expect(select("use scientific-writing for manuscript").names).toEqual(["scientific-writing"]);
		expect(select("nature-shared").names).toEqual([]);
	});
	it("falls back only to installed, automatically invocable skills", () => {
		const available = skills
			.filter((skill) => skill.name !== "nature-writing")
			.map((skill) => ({ ...skill, disableModelInvocation: skill.name === "scientific-writing" }));
		expect(selectResearchSkills(available, research, detectResearchIntent("论文写作")).names).toEqual([]);
		expect(
			selectResearchSkills(available, research, detectResearchIntent("论文写作"), { academicEnabled: true })
				.names,
		).toEqual(["academic-paper"]);
		expect(selectResearchSkills([], research, detectResearchIntent("论文写作")).names).toEqual([]);
	});
	it("caps both count and discovery bytes, even for every named skill", () => {
		const intent = { topics: [], named: skills.map((s) => s.name) };
		const chosen = selectResearchSkills(skills, research, intent);
		expect(chosen.names.length).toBeLessThanOrEqual(RESEARCH_SKILL_LIMIT);
		expect(chosen.discoveryBytes).toBeLessThanOrEqual(RESEARCH_DISCOVERY_BYTES);
		const huge = skills.map((s) => ({ ...s, description: "字".repeat(9000) }));
		expect(selectResearchSkills(huge, research, intent).names).toEqual([]);
		expect(selectResearchSkills(skills, new Set(["external"]), intent).names).toEqual([]);
	});
	it("preserves continuation, resets on topic switch and never enables execution by selecting skills", () => {
		const { runtime } = fixture();
		runtime.prepareForPrompt("单细胞分析", false);
		expect(runtime.state().visibleSkills).toContain("scanpy");
		expect(runtime.state().activeTools).not.toContain("bash");
		runtime.prepareForPrompt("继续", false);
		expect(runtime.state().visibleSkills).toContain("scanpy");
		runtime.prepareForPrompt("你好", false);
		expect(runtime.state().visibleSkills).toEqual([]);
		runtime.activate(["research"], "statistical analysis");
		expect(runtime.state().visibleSkills).toContain("statistical-analysis");
	});
	it("restores bounded routing signals, not raw prompts, across session restarts", () => {
		const manager = SessionManager.inMemory("/fixture");
		const first = fixture(manager);
		first.runtime.prepareForPrompt("单细胞分析 private-patient-identifier", false);
		const restored = fixture(manager);
		restored.runtime.prepareForPrompt("继续", false);
		expect(restored.runtime.state().visibleSkills).toContain("scanpy");
		expect(JSON.stringify(manager.getBranch())).not.toContain("private-patient-identifier");
		expect(normalizeResearchIntent({ topics: ["bad", "__proto__"], named: ["unknown"] })).toEqual({
			topics: [],
			named: [],
		});
	});
	it("keeps direct invocation and avoids routing on expanded skill instructions", () => {
		const { runtime } = fixture();
		runtime.prepareForPrompt("/skill:scientific-writing draft my paper", false);
		runtime.prepareForPrompt(
			'<skill name="scientific-writing" location="/packs/scientific-writing/SKILL.md">\nReferences are relative to /packs/scientific-writing.\n\nCall bash git and perform 单细胞分析.\n</skill>\n\ndraft my paper',
			false,
		);
		expect(runtime.state().visibleSkills).toContain("scientific-writing");
		expect(runtime.state().visibleSkills).not.toContain("scanpy");
		expect(runtime.state().activeTools).not.toContain("bash");
	});
	it("does not expand research skills or execution in read-only library reuse", () => {
		const { runtime } = fixture();
		runtime.prepareForPrompt("只读复用已有论文笔记，单细胞分析综述", false);
		runtime.activate(["coding", "research"], "scanpy");
		expect(runtime.state().visibleSkills).toEqual([]);
		expect(runtime.state().activeTools).not.toContain("bash");
	});
});

describe("conflict-audit regressions", () => {
	it.each(["/skill:academic-paper-reviewer", "academic paper reviewer"])(
		"longest exact name wins: %s",
		(text) => {
			expect(detectResearchIntent(text).named).toEqual(["academic-paper-reviewer"]);
		},
	);
	it("does not confuse polars-bio or pptx-posters with their name prefixes", () => {
		expect(detectResearchIntent("polars-bio").named).toEqual(["polars-bio"]);
		expect(detectResearchIntent("pptx-posters").named).toEqual(["pptx-posters"]);
	});
	it("selects one execution owner even when multiple source names are mentioned", () => {
		expect(select("use nature-writing and scientific-writing for manuscript").names).toEqual([
			"nature-writing",
		]);
		expect(select("compare nature-writing and scientific-writing").names).toEqual([
			"nature-writing",
			"scientific-writing",
		]);
	});
	it("reply and review are different stages, including after explicit invocation", () => {
		expect(select("回复审稿意见").names).toEqual(["nature-response"]);
		const { runtime } = fixture();
		runtime.prepareForPrompt("/skill:nature-reviewer", false);
		runtime.prepareForPrompt("补充：回复审稿意见", false);
		expect(runtime.state().visibleSkills).toEqual(["nature-response"]);
		runtime.activate(["research"], "polish manuscript");
		expect(runtime.state().visibleSkills).toEqual(["nature-polishing"]);
	});
	it("full publication is never silently replaced by a daily feed", () => {
		expect(select("从研究到发表").names).toEqual([]);
		expect(select("每日文献推送").names).toEqual(["nature-literature-pipeline"]);
		expect(
			selectResearchSkills(skills, research, detectResearchIntent("从研究到发表"), { academicEnabled: true })
				.names,
		).toEqual(["academic-pipeline"]);
	});
});
