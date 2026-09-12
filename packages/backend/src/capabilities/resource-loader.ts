import type { ResourceLoader } from "@earendil-works/pi-coding-agent";

/** Mutable per-session skill visibility. Full skill files stay registered for explicit /skill:* use. */
export class SkillVisibility {
	private names = new Set<string>();
	set(names: Iterable<string>): void {
		this.names = new Set(names);
	}
	has(name: string): boolean {
		return this.names.has(name);
	}
	list(): string[] {
		return [...this.names].sort();
	}
}

/**
 * ResourceLoader view used by one AgentSession. Discovery remains complete in the wrapped loader,
 * while the model-facing system prompt only receives skills selected for the active capability set.
 */
export class CapabilityResourceLoader implements ResourceLoader {
	constructor(
		private readonly inner: ResourceLoader,
		private readonly visibility: SkillVisibility,
	) {}
	getAllSkills(): ReturnType<ResourceLoader["getSkills"]> {
		return this.inner.getSkills();
	}
	getExtensions(): ReturnType<ResourceLoader["getExtensions"]> {
		return this.inner.getExtensions();
	}
	getSkills(): ReturnType<ResourceLoader["getSkills"]> {
		const result = this.inner.getSkills();
		return { ...result, skills: result.skills.filter((skill) => this.visibility.has(skill.name)) };
	}
	getPrompts(): ReturnType<ResourceLoader["getPrompts"]> { return this.inner.getPrompts(); }
	getThemes(): ReturnType<ResourceLoader["getThemes"]> { return this.inner.getThemes(); }
	getAgentsFiles(): ReturnType<ResourceLoader["getAgentsFiles"]> { return this.inner.getAgentsFiles(); }
	getSystemPrompt(): ReturnType<ResourceLoader["getSystemPrompt"]> { return this.inner.getSystemPrompt(); }
	getSystemPromptSource(): ReturnType<ResourceLoader["getSystemPromptSource"]> { return this.inner.getSystemPromptSource(); }
	getAppendSystemPrompt(): ReturnType<ResourceLoader["getAppendSystemPrompt"]> { return this.inner.getAppendSystemPrompt(); }
	getAppendSystemPromptSources(): ReturnType<ResourceLoader["getAppendSystemPromptSources"]> { return this.inner.getAppendSystemPromptSources(); }
	extendResources(paths: Parameters<ResourceLoader["extendResources"]>[0]): void { this.inner.extendResources(paths); }
	async reload(options?: Parameters<ResourceLoader["reload"]>[0]): Promise<void> { await this.inner.reload(options); }
}

export function allSkillsFromLoader(loader: ResourceLoader): ReturnType<ResourceLoader["getSkills"]> {
	const candidate = loader as ResourceLoader & { getAllSkills?: () => ReturnType<ResourceLoader["getSkills"]> };
	return candidate.getAllSkills?.() ?? loader.getSkills();
}
