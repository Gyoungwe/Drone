import { describe, expect, it } from "vitest";
import { makeCapabilityExtension } from "../src/capabilities/extension";
import { SkillVisibility, CapabilityResourceLoader } from "../src/capabilities/resource-loader";
import { CapabilityRuntime, detectCapabilities } from "../src/capabilities/runtime";

function makeLoader() {
	const skills = [
		{ name: "research-vault", description: "knowledge", filePath: "/skills/research-vault/SKILL.md", baseDir: "/skills/research-vault", disableModelInvocation: false, sourceInfo: { source: "test", scope: "temporary" } },
		{ name: "research-workflow", description: "research", filePath: "/skills/research-workflow/SKILL.md", baseDir: "/skills/research-workflow", disableModelInvocation: false, sourceInfo: { source: "test", scope: "temporary" } },
		{ name: "code-review", description: "coding", filePath: "/skills/code-review/SKILL.md", baseDir: "/skills/code-review", disableModelInvocation: false, sourceInfo: { source: "test", scope: "temporary" } },
		{ name: "show-me", description: "visual", filePath: "/skills/show-me/SKILL.md", baseDir: "/skills/show-me", disableModelInvocation: false, sourceInfo: { source: "test", scope: "temporary" } },
	];
	return {
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
	} as any;
}

function makeSession(loader: any) {
	const tools = [
		{ name: "read", description: "read files", parameters: { type: "object", properties: { path: { type: "string" } } } },
		{ name: "bash", description: "run shell", parameters: { type: "object", properties: { command: { type: "string" } } } },
		{ name: "edit", description: "edit files", parameters: { type: "object", properties: {} } },
		{ name: "write", description: "write files", parameters: { type: "object", properties: {} } },
		{ name: "webfetch", description: "fetch URL", parameters: { type: "object", properties: { url: { type: "string" } } } },
		{ name: "show_image", description: "show image", parameters: { type: "object", properties: {} } },
		{ name: "ask_user", description: "ask", parameters: { type: "object", properties: {} } },
		{ name: "set_status", description: "status", parameters: { type: "object", properties: {} } },
		{ name: "todo", description: "todo", parameters: { type: "object", properties: {} } },
		{ name: "capability_load", description: "load capability", parameters: { type: "object", properties: {} } },
		{ name: "research_prepare_knowledge", description: "prepare knowledge", parameters: { type: "object", properties: {} } },
		{ name: "research_search_knowledge", description: "search knowledge", parameters: { type: "object", properties: {} } },
		{ name: "research_archive_source", description: "archive source", parameters: { type: "object", properties: {} } },
		{ name: "channel_post", description: "external channel", parameters: { type: "object", properties: {} } },
	];
	let active = tools.map((tool) => tool.name);
	return {
		resourceLoader: loader,
		getAllTools: () => tools,
		getActiveToolNames: () => [...active],
		setActiveToolsByName: (names: string[]) => { active = names.filter((name) => tools.some((tool) => tool.name === name)); },
	};
}

describe("lazy capability runtime", () => {
	it("detects task capabilities without requiring a model call", () => {
		expect(detectCapabilities("帮我搜索最新的转录组分析文献并整理证据")).toEqual(expect.arrayContaining(["knowledge", "research", "web"]));
		expect(detectCapabilities("帮我构建并调试这个仓库")).toContain("coding");
		expect(detectCapabilities("画一个流程图并展示图片")).toContain("visualization");
	});

	it("starts with only control tools and materially reduces tool schema", () => {
		const visibility = new SkillVisibility();
		const loader = new CapabilityResourceLoader(makeLoader(), visibility);
		const session = makeSession(loader);
		const runtime = new CapabilityRuntime(visibility);
		const result = runtime.bind(session as any);
		expect(result.state.activeCapabilities).toEqual([]);
		expect(result.state.activeTools).toEqual(["ask_user", "capability_load", "set_status", "todo"]);
		expect(result.state.visibleSkills).toEqual([]);
		expect(result.state.footprint.activeToolSchemaBytes).toBeLessThan(result.state.footprint.allToolSchemaBytes);
		expect(result.state.footprint.reductionRatio).toBeGreaterThan(0.5);
	});

	it("loads research/knowledge tools and skill metadata only when the task needs them", () => {
		const visibility = new SkillVisibility();
		const loader = new CapabilityResourceLoader(makeLoader(), visibility);
		const session = makeSession(loader);
		const runtime = new CapabilityRuntime(visibility);
		runtime.bind(session as any);
		const { state } = runtime.prepareForPrompt("请检索转录组文献并核对知识库证据", false);
		expect(state.activeCapabilities).toEqual(expect.arrayContaining(["knowledge", "research"]));
		expect(state.activeTools).toEqual(expect.arrayContaining(["read", "webfetch", "research_prepare_knowledge", "research_search_knowledge", "research_archive_source"]));
		expect(state.activeTools).not.toContain("bash");
		expect(state.visibleSkills).toEqual(expect.arrayContaining(["research-vault", "research-workflow"]));
		expect(state.visibleSkills).not.toContain("code-review");
	});

	it("makes an explicitly invoked skill visible even when its category was not preloaded", () => {
		const visibility = new SkillVisibility();
		const loader = new CapabilityResourceLoader(makeLoader(), visibility);
		const session = makeSession(loader);
		const runtime = new CapabilityRuntime(visibility);
		runtime.bind(session as any);
		const { state } = runtime.prepareForPrompt("/skill:show-me explain this result", false);
		expect(state.activeCapabilities).toContain("visualization");
		expect(state.visibleSkills).toContain("show-me");
		expect(loader.getSkills().skills.map((skill: any) => skill.name)).toContain("show-me");
		expect(loader.getAllSkills().skills).toHaveLength(4);
	});

	it("selects capabilities in the SDK input hook before skill expansion and adds direct queued SDK input", async () => {
		const visibility = new SkillVisibility();
		const loader = new CapabilityResourceLoader(makeLoader(), visibility);
		const session = makeSession(loader);
		const runtime = new CapabilityRuntime(visibility);
		runtime.bind(session as any);
		const handlers = new Map<string, (event: any) => unknown>();
		makeCapabilityExtension(runtime)({
			on: (name: string, handler: (event: any) => unknown) => handlers.set(name, handler),
		} as any);

		await handlers.get("input")?.({
			type: "input",
			text: "/skill:show-me explain this result",
			source: "interactive",
		});
		expect(runtime.state().activeCapabilities).toContain("visualization");
		expect(loader.getSkills().skills.map((skill: any) => skill.name)).toContain("show-me");

		await handlers.get("message_start")?.({
			type: "message_start",
			message: { role: "user", content: [{ type: "text", text: "also inspect the repository code" }] },
		});
		expect(runtime.state().activeCapabilities).toEqual(expect.arrayContaining(["visualization", "coding"]));
		expect(runtime.state().activeTools).toContain("bash");
	});

	it("can expand capabilities mid-run without dropping already selected packs", () => {
		const visibility = new SkillVisibility();
		const loader = new CapabilityResourceLoader(makeLoader(), visibility);
		const session = makeSession(loader);
		const runtime = new CapabilityRuntime(visibility);
		runtime.bind(session as any);
		runtime.prepareForPrompt("检查这个仓库的代码", false);
		const { state } = runtime.activate(["web"]);
		expect(state.activeCapabilities).toEqual(expect.arrayContaining(["coding", "web"]));
		expect(state.activeTools).toEqual(expect.arrayContaining(["bash", "edit", "write", "webfetch"]));
	});
});
