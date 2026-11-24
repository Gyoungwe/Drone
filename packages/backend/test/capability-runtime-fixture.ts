import {
	createExtensionRuntime,
	createSyntheticSourceInfo,
	type ResourceLoader,
	type Skill,
} from "@earendil-works/pi-coding-agent";

export function makeLoader(extraSkills: Skill[] = []): ResourceLoader {
	const skill = (name: string, description: string, alwaysWith?: string | string[]) => {
		const baseDir = `/skills/${name}`;
		const filePath = `${baseDir}/SKILL.md`;
		return {
			name,
			description,
			filePath,
			baseDir,
			disableModelInvocation: false,
			sourceInfo: createSyntheticSourceInfo(filePath, { source: "test" }),
			alwaysWith,
		};
	};
	const skills = [
		skill("research-vault", "knowledge", ["knowledge", "research"]),
		skill("research-workflow", "research", "research"),
		skill("code-review", "coding"),
		skill("show-me", "visual"),
		...extraSkills,
	];
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
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
}

export function makeSession(loader: ResourceLoader) {
	const tools = [
		{
			name: "read",
			description: "read files",
			parameters: { type: "object", properties: { path: { type: "string" } } },
		},
		{
			name: "bash",
			description: "run shell",
			parameters: { type: "object", properties: { command: { type: "string" } } },
		},
		{ name: "edit", description: "edit files", parameters: { type: "object", properties: {} } },
		{ name: "write", description: "write files", parameters: { type: "object", properties: {} } },
		{
			name: "webfetch",
			description: "fetch URL",
			parameters: { type: "object", properties: { url: { type: "string" } } },
		},
		{ name: "show_image", description: "show image", parameters: { type: "object", properties: {} } },
		{ name: "ask_user", description: "ask", parameters: { type: "object", properties: {} } },
		{ name: "set_status", description: "status", parameters: { type: "object", properties: {} } },
		{ name: "todo", description: "todo", parameters: { type: "object", properties: {} } },
		{
			name: "capability_load",
			description: "load capability",
			parameters: { type: "object", properties: {} },
		},
		{
			name: "research_prepare_knowledge",
			description: "prepare knowledge",
			parameters: { type: "object", properties: {} },
		},
		{
			name: "research_search_knowledge",
			description: "search knowledge",
			parameters: { type: "object", properties: {} },
		},
		{
			name: "research_archive_source",
			description: "archive source",
			parameters: { type: "object", properties: {} },
		},
		{ name: "channel_post", description: "external channel", parameters: { type: "object", properties: {} } },
	];
	let active = tools.map((tool) => tool.name);
	return {
		resourceLoader: loader,
		getAllTools: () => tools,
		getActiveToolNames: () => [...active],
		setActiveToolsByName: (names: string[]) => {
			active = names.filter((name) => tools.some((tool) => tool.name === name));
		},
	};
}
