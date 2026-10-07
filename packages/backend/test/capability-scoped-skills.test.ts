/**
 * 验收测试：按能力路由技能，每个能力只看到自己的技能（上下文控制）。
 * 被测（远端快照）：capabilities/runtime.ts、resource-loader.ts、tools/capability-load.ts
 * 用 it.fails 标注；修复后改回 it。
 */

import { WORKFLOW_PROFILES, workflowStage } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { CapabilityResourceLoader, SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../src/capabilities/runtime";
import { makeCapabilityLoadTool } from "../src/tools/capability-load";

// —— 设计中的能力→技能映射（由 workflow-catalog / workflow-profiles 推导）——
const dir = (d: string) => WORKFLOW_PROFILES.filter((p) => p.direction === d).map((p) => p.name);
const stageSkills = (id: string) =>
	(workflowStage(id)?.commands ?? []).filter((c) => c.startsWith("skill:")).map((c) => c.slice(6));
const VIS = ["nature-figure", "scientific-visualization", "matplotlib", "seaborn"];
const BIO = ["scikit-bio", "waypoint-bio"];
const CODE = ["nextflow"];
const BODY_MARK = "<<SKILL-BODY-SENTINEL>>";

function setup() {
	const skills = [...VIS, ...BIO, ...CODE].map((name) => ({
		name,
		description: `${name} desc`,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		disableModelInvocation: false,
		sourceInfo: { source: "test", scope: "temporary" },
		body: BODY_MARK,
	}));
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
	const visibility = new SkillVisibility();
	const loader = new CapabilityResourceLoader(inner, visibility);
	const tools = ["read", "capability_load", "ask_user", "set_status", "todo"].map((name) => ({
		name,
		description: name,
		parameters: { type: "object", properties: {} },
	}));
	let active = tools.map((t) => t.name);
	const session: any = {
		resourceLoader: loader,
		getAllTools: () => tools,
		getActiveToolNames: () => [...active],
		setActiveToolsByName: (n: string[]) => {
			active = n;
		},
	};
	const runtime = new CapabilityRuntime(visibility);
	runtime.bind(session);
	const tool = makeCapabilityLoadTool(runtime);
	const load = async (capabilities: string[], task?: string) => {
		const r: any = await tool.execute(
			"id",
			{ capabilities, task } as any,
			undefined as any,
			undefined as any,
			undefined as any,
		);
		return { text: r.content[0].text as string, details: r.details };
	};
	const modelSkills = () => loader.getSkills().skills; // 模型侧可见的技能列表
	return { runtime, load, modelSkills };
}
const names = (s: { name: string }[]) => s.map((x) => x.name).sort();

describe("1) 能力→技能映射（目录推导）", () => {
	it("presentation 方向含 nature-figure 等绘图技能；figures 阶段 = nature-figure + scientific-visualization", () => {
		expect(dir("presentation")).toEqual(expect.arrayContaining(VIS));
		expect(stageSkills("figures")).toEqual(["nature-figure", "scientific-visualization"]);
	});
	it("bioinformatics 阶段 = scikit-bio + waypoint-bio，且为 analysis 方向", () => {
		expect(stageSkills("bioinformatics")).toEqual(BIO);
		expect(dir("analysis")).toEqual(expect.arrayContaining(BIO));
	});
	it("存在显式的 能力→技能 映射 API（如 skillsForCapability('visualization')）", async () => {
		const shared: any = await import("@drone/shared");
		expect(typeof (shared.skillsForCapability ?? shared.CAPABILITY_SKILLS)).not.toBe("undefined");
	});
});

describe("2) capability_load 后只见本能力技能（名称/描述/SKILL.md 路径）", () => {
	it("只加载 visualization（无 task）→ 可见 = 全部绘图技能", async () => {
		const { load, modelSkills } = setup();
		await load(["visualization"]);
		expect(names(modelSkills())).toEqual([...VIS].sort());
	});
	it("只加载 visualization → 不出现 bioinformatics / coding 技能（今日通过：本来就全空）", async () => {
		const { load, modelSkills } = setup();
		await load(["visualization"]);
		const v = names(modelSkills());
		for (const n of [...BIO, ...CODE]) expect(v).not.toContain(n);
	});
	it("capability_load 返回结果含每个技能的 description 与 SKILL.md 路径", async () => {
		const { load } = setup();
		const { text } = await load(["visualization"]);
		expect(text).toContain("nature-figure desc");
		expect(text).toContain("/skills/nature-figure/SKILL.md");
	});
	it("模型侧技能条目带 name/description/filePath（今日：若可见则字段齐全）", async () => {
		const { load, modelSkills } = setup();
		await load(["visualization"], "帮我做论文配图");
		const s = modelSkills().find((x) => x.name === "nature-figure")!;
		expect(s).toMatchObject({
			description: "nature-figure desc",
			filePath: "/skills/nature-figure/SKILL.md",
		});
	});
	it("只加载 research（生信）→ 可见 = scikit-bio/waypoint-bio，且不含绘图技能", async () => {
		const { load, modelSkills } = setup();
		await load(["research"], "DHX16 结构域比对");
		expect(names(modelSkills())).toEqual([...BIO].sort());
	});
});

describe("3) 加载多个能力 → 可见技能为并集", () => {
	it("visualization + research → VIS ∪ BIO", async () => {
		const { load, modelSkills } = setup();
		await load(["visualization", "research"], "DHX16 结构域比对并画论文配图");
		expect(names(modelSkills())).toEqual([...VIS, ...BIO].sort());
	});
	it("分两次加载也累加为并集", async () => {
		const { load, modelSkills } = setup();
		await load(["research"], "DHX16 结构域比对");
		await load(["visualization"]);
		expect(names(modelSkills())).toEqual(expect.arrayContaining([...VIS, ...BIO]));
	});
});

describe("4) 期刊风格绘图 + 加载 visualization", () => {
	const PROMPT = "按 Nature 期刊规范重绘 DHX16 的结构域 + 比对图";
	it("nature-figure 可见", async () => {
		const { runtime, load, modelSkills } = setup();
		runtime.prepareForPrompt(PROMPT, false);
		await load(["visualization"], PROMPT);
		expect(names(modelSkills())).toContain("nature-figure");
	});
	it("返回结果提示先 read nature-figure 的 SKILL.md", async () => {
		const { runtime, load } = setup();
		runtime.prepareForPrompt(PROMPT, false);
		const { text } = await load(["visualization"], PROMPT);
		expect(text).toMatch(/nature-figure/);
		expect(text).toMatch(/read[\s\S]{0,80}SKILL\.md|先读[\s\S]{0,40}SKILL\.md/i);
	});
});

describe("5) 未加载能力 → 不注入技能正文", () => {
	it("bind 后未加载：模型可见技能为空，返回/状态中无正文", () => {
		const { runtime, modelSkills } = setup();
		expect(modelSkills()).toEqual([]);
		expect(JSON.stringify(runtime.state())).not.toContain(BODY_MARK);
	});
	it("即使加载 visualization，capability_load 结果也不含正文（只给元数据）", async () => {
		const { load } = setup();
		const r = await load(["visualization"], "帮我做论文配图");
		expect(JSON.stringify(r)).not.toContain(BODY_MARK);
	});
});
