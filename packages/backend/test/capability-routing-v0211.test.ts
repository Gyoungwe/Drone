/**
 * v0.21.1 回归：会话 01a1172e（「帮我画一个所有生物DHX16基因的联配图」）暴露的路由问题。
 * B1 非工作流技能（~/.agents）也按能力分组、每能力最多 6 个；B2 返回按 主技能→配套→补满 排序，首行点名 SKILL.md；
 * B4 联配图/比对图等识别为绘图；B5 补满按任务文本排序；B6 不自动加 coding。
 */
import { CAPABILITY_SKILL_LIMIT, skillCapability, WORKFLOW_PROFILES } from "@drone/shared";
import { describe, expect, it } from "vitest";
import { CapabilityResourceLoader, SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime, detectCapabilities } from "../src/capabilities/runtime";
import { makeCapabilityLoadTool } from "../src/tools/capability-load";
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
	const tool = makeCapabilityLoadTool(runtime);
	const load = async (capabilities: string[], task?: string) => {
		const r: any = await tool.execute(
			"id",
			{ capabilities, task } as any,
			undefined as any,
			undefined as any,
			undefined as any,
		);
		return r.content[0].text as string;
	};
	return { runtime, load, visible: () => runtime.state().visibleSkills };
}
const PROMPT = "帮我画一个所有生物DHX16基因的联配图";
const TASK =
	"Multiple sequence alignment and visualization of DHX16 orthologs across representative organisms";
const perCapabilityOk = (names: string[]) => {
	const counts = new Map<string, number>();
	for (const n of names.filter((n) => !BASE.includes(n))) {
		const id = skillCapability(n) ?? "none";
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	for (const [id, c] of counts) expect(c, id).toBeLessThanOrEqual(CAPABILITY_SKILL_LIMIT);
	return counts;
};

describe("DHX16 联配图 replay (session 01a1172e)", () => {
	it("prompt routing: primary scikit-bio, figure companion, no coding", () => {
		const { runtime, visible } = setup();
		expect(detectCapabilities(PROMPT)).not.toContain("coding");
		runtime.prepareForPrompt(PROMPT, false);
		const sel = runtime.getWorkflowSelection();
		expect(sel.primaryWorkflow).toBe("scikit-bio");
		expect(runtime.state().activeCapabilities).toEqual(expect.arrayContaining(["analysis", "visualization"]));
		expect(runtime.state().activeCapabilities).not.toContain("coding");
		const v = visible();
		expect(v.some((n) => n === "nature-figure" || n === "scientific-visualization")).toBe(true);
		perCapabilityOk(v);
	});
	it("capability_load as the model called it: ≤21 skills, first line names primary SKILL.md", async () => {
		const { runtime, load, visible } = setup();
		runtime.prepareForPrompt(PROMPT, false);
		const text = await load(["analysis", "visualization"], TASK);
		const v = visible();
		expect(v.length).toBeLessThanOrEqual(2 * CAPABILITY_SKILL_LIMIT + 3 + 6); // analysis+visualization (+research umbrella groups)
		expect(v.length).toBeLessThanOrEqual(21);
		expect(v).toContain("scikit-bio");
		expect(v.some((n) => n === "nature-figure" || n === "scientific-visualization")).toBe(true);
		const first = text.split("\n")[0];
		expect(first).toMatch(/^Read first: .*scikit-bio\\SKILL\.md/);
		const order = text
			.split("\n")
			.filter((l) => l.startsWith("- "))
			.map((l) => l.slice(2).split(/[: ]/)[0]);
		expect(order[0]).toBe("scikit-bio");
		expect(order.slice(-3).every((n) => BASE.includes(n)) || text.includes("Also visible")).toBe(true);
		expect(text.length).toBeLessThan(4000);
		perCapabilityOk(v);
	});
	it("even when coding is (wrongly) loaded, ~/.agents skills obey the per-capability cap", async () => {
		const { runtime, load, visible } = setup();
		runtime.prepareForPrompt(PROMPT, false);
		await load(["analysis", "coding", "visualization"], TASK);
		const v = visible();
		const counts = perCapabilityOk(v);
		expect(v.length).toBeLessThanOrEqual(counts.size * CAPABILITY_SKILL_LIMIT + BASE.length);
		expect(v.length).toBeLessThanOrEqual(3 * CAPABILITY_SKILL_LIMIT + 3 + CAPABILITY_SKILL_LIMIT);
		expect(v.filter((n) => AGENT_SKILLS.includes(n)).length).toBeLessThanOrEqual(2 * CAPABILITY_SKILL_LIMIT);
		// coding loaded only for its shell next to analysis: no engineering skills are listed
		expect(v.filter((n) => skillCapability(n) === "coding")).toEqual([]);
	});
	it("fill ranks by task text: alignment/tree skills beat unrelated catalog-first ones", async () => {
		const { runtime, load, visible } = setup();
		runtime.prepareForPrompt(PROMPT, false);
		await load(["analysis"], `${TASK}; phylogenetic tree with MAFFT`);
		const order = runtime.visibleSkillMetadata().map((s) => s.name);
		expect(order).toContain("phylogenetics");
		if (order.includes("bids")) expect(order.indexOf("phylogenetics")).toBeLessThan(order.indexOf("bids"));
		expect(visible()).toContain("phylogenetics");
	});
	it("capability_load description restricts coding to real code changes", () => {
		const { runtime } = setup();
		expect(makeCapabilityLoadTool(runtime).description).toMatch(
			/coding carries the shell[\s\S]*adds tools only/,
		);
	});
});

describe("~/.agents style skills", () => {
	it("every capability (incl. external/knowledge) lists at most the limit; total ≤ groups×6 + 3", async () => {
		const { load, visible } = setup();
		await load([
			"research",
			"analysis",
			"literature",
			"writing",
			"planning",
			"coding",
			"visualization",
			"knowledge",
			"external",
		]);
		const v = visible();
		const counts = perCapabilityOk(v);
		expect(v.length).toBeLessThanOrEqual(counts.size * CAPABILITY_SKILL_LIMIT + BASE.length);
	});
	it("a coding prompt shows ranked ~/.agents engineering skills, at most 6", () => {
		const { runtime, visible } = setup();
		runtime.prepareForPrompt("帮我做 code review 并修复这个 bug", false);
		const v = visible();
		expect(v).toContain("code-review");
		expect(v.length).toBeLessThanOrEqual(CAPABILITY_SKILL_LIMIT);
	});
});

describe("B4 figure keywords", () => {
	it.each([
		"画 DHX16 的比对图",
		"画一张进化树图",
		"画结构域图",
		"做一个联配图",
		"make an alignment figure",
		"draw a phylogenetic tree figure",
		"plot the domain architecture",
	])("%s → visualization", (text) => {
		expect(detectCapabilities(text)).toContain("visualization");
	});
});
