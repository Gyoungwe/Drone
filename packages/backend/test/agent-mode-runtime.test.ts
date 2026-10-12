import { describe, expect, it } from "vitest";
import { CapabilityResourceLoader, SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../src/capabilities/runtime";

// P12 / P18：模式切换联动工具白名单（single 去掉 subagent，切回主从再加上）
function loader(skills: Array<{ name: string; description: string }> = []) {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: { flagValues: new Map() } }),
		getSkills: () => ({
			skills: skills.map((s) => ({
				...s,
				filePath: `/skills/${s.name}/SKILL.md`,
				baseDir: `/skills/${s.name}`,
				disableModelInvocation: false,
				sourceInfo: { source: "test", scope: "temporary" },
			})),
			diagnostics: [],
		}),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [],
		getAppendSystemPromptSources: () => [],
		extendResources: () => undefined,
		reload: async () => undefined,
	} as never;
}

function session(resourceLoader: unknown) {
	const tools = ["read", "bash", "ask_user", "todo", "subagent"].map((name) => ({
		name,
		description: name,
		parameters: { type: "object", properties: {} },
	}));
	let active = tools.map((t) => t.name);
	return {
		resourceLoader,
		getAllTools: () => tools,
		getActiveToolNames: () => [...active],
		setActiveToolsByName: (names: string[]) => {
			active = names.filter((n) => tools.some((t) => t.name === n));
		},
	} as never;
}

describe("agent mode ↔ tool whitelist", () => {
	it("single hides subagent; lead / swarm restore it", () => {
		const visibility = new SkillVisibility();
		const s = session(new CapabilityResourceLoader(loader(), visibility));
		const runtime = new CapabilityRuntime(visibility);
		runtime.bind(s, { extraAlwaysOn: ["subagent", "read", "bash"] });
		expect(runtime.agentMode()).toBe("lead");
		expect(runtime.state().activeTools).toContain("subagent");
		runtime.setAgentMode("single");
		expect(runtime.state().activeTools).not.toContain("subagent");
		expect(runtime.state().activeTools).toContain("read");
		runtime.setAgentMode("swarm");
		expect(runtime.state().activeTools).toContain("subagent");
	});
});
