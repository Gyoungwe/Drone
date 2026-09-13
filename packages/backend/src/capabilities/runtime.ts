import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
	CAPABILITY_IDS,
	type CapabilityFootprint,
	type CapabilityId,
	type CapabilityState,
	getSkillCategory,
} from "@percho/shared";
import { allSkillsFromLoader, type SkillVisibility } from "./resource-loader";

const ALWAYS_ON = new Set(["ask_user", "set_status", "todo", "capability_load"]);

const PATTERNS: Record<CapabilityId, RegExp[]> = {
	knowledge: [
		/(?:knowledge|wiki|obsidian|vault|evidence|知识库|知识图谱|维基|证据|来源|主题记忆|恢复主题|resume topic|topic memory)/i,
	],
	research: [
		/(?:research|paper|literature|citation|experiment|scientific|methodology|transcriptom|genom|phylogen|species|biology|bioinformatics|论文|文献|科研|研究|实验|转录组|基因组|系统发育|物种|生物信息)/i,
	],
	coding: [
		/(?:\bcode\b|coding|repo(?:sitory)?|git|commit|push|pull request|build|compile|typecheck|test(?:ing)?|debug|bug|implement|refactor|代码|仓库|提交|构建|编译|测试|调试|修复|实现|重构)/i,
	],
	web: [
		/(?:https?:\/\/|\bweb\b|website|internet|online|latest|search (?:the )?web|网页|网站|联网|网上|最新|搜一下|搜索网络)/i,
	],
	files: [
		/(?:\bfile\b|folder|directory|path|pdf|docx?|xlsx?|csv|spreadsheet|document|文件|文件夹|目录|路径|文档|表格)/i,
	],
	visualization: [
		/(?:image|figure|plot|chart|diagram|visuali[sz]|show[ -]?me|slide|ppt|图片|图像|绘图|图表|可视化|流程图|幻灯片)/i,
	],
	external: [
		/(?:mcp|plugin|connector|github|gitlab|slack|drive|notion|zotero|channel|外部应用|插件|连接器)/i,
	],
};

const KNOWLEDGE_TOOL =
	/^research_(?:prepare_knowledge|read_knowledge|search_knowledge|search_explainers|knowledge_status|maintain_knowledge|delegate_knowledge|propose_wiki_update|wiki_|check_answer|task_status|deposit_knowledge|topics|resume_topic|update_topic|archive_topic)/;
const VISUAL_TOOL = /(?:show_image|explainer|show_me|figure|plot|chart|image)/i;

export function detectCapabilities(text: string): CapabilityId[] {
	const found = new Set<CapabilityId>();
	for (const id of CAPABILITY_IDS) if (PATTERNS[id].some((pattern) => pattern.test(text))) found.add(id);
	const directSkill = text.match(/^\/skill:([a-z0-9-]+)/i)?.[1];
	if (directSkill) {
		const category = getSkillCategory(directSkill);
		if (category === "knowledge") found.add("knowledge");
		else if (category === "research" || category === "writing") found.add("research");
		else if (category === "presentation") found.add("visualization");
		else if (category === "engineering" || category === "setup") found.add("coding");
		else found.add("external");
	}
	return CAPABILITY_IDS.filter((id) => found.has(id));
}

export function toolCapabilities(name: string): CapabilityId[] {
	if (ALWAYS_ON.has(name)) return [];
	if (name === "read") return ["files", "coding", "knowledge", "research", "visualization"];
	if (["bash", "edit", "write"].includes(name)) return ["coding"];
	if (name === "webfetch") return ["web", "research"];
	if (name === "show_image") return ["visualization"];
	if (name === "subagent") return ["coding", "research"];
	if (name.startsWith("research_")) {
		const result: CapabilityId[] = ["research"];
		if (KNOWLEDGE_TOOL.test(name)) result.push("knowledge");
		if (VISUAL_TOOL.test(name)) result.push("visualization");
		return result;
	}
	if (/^(?:channel_|contact_supervisor$|scout$)/.test(name)) return ["external"];
	return VISUAL_TOOL.test(name) ? ["visualization", "external"] : ["external"];
}

function skillMatches(
	name: string,
	capabilities: ReadonlySet<CapabilityId>,
	forced: ReadonlySet<string>,
): boolean {
	if (forced.has(name)) return true;
	const category = getSkillCategory(name);
	if (category === "knowledge") return capabilities.has("knowledge") || capabilities.has("research");
	if (category === "research" || category === "writing") return capabilities.has("research");
	if (category === "presentation") return capabilities.has("visualization");
	if (category === "engineering" || category === "setup") return capabilities.has("coding");
	if (category === "collaboration" || category === "support" || category === "other")
		return capabilities.has("external");
	return false;
}

function schemaBytes(tool: {
	name: string;
	description?: string;
	parameters?: unknown;
	promptGuidelines?: string[];
}): number {
	return Buffer.byteLength(
		JSON.stringify({
			name: tool.name,
			description: tool.description ?? "",
			parameters: tool.parameters ?? {},
			promptGuidelines: tool.promptGuidelines ?? [],
		}),
	);
}

type RuntimeSession = Pick<
	AgentSession,
	"getAllTools" | "getActiveToolNames" | "setActiveToolsByName" | "resourceLoader"
>;

export interface CapabilityChange {
	changed: boolean;
	state: CapabilityState;
}

export class CapabilityRuntime {
	private session?: RuntimeSession;
	private readonly active = new Set<CapabilityId>();
	private readonly forcedSkills = new Set<string>();
	private readonly excludedTools = new Set<string>();
	private readonly extraAlwaysOn = new Set<string>();
	private readonly toolUsage = new Map<string, { lastUsedAt: number; invocations: number }>();

	constructor(private readonly skillVisibility: SkillVisibility) {}

	bind(
		session: RuntimeSession,
		options?: { excludedToolNames?: Iterable<string>; extraAlwaysOn?: Iterable<string> },
	): CapabilityChange {
		this.session = session;
		for (const name of options?.excludedToolNames ?? []) this.excludedTools.add(name);
		for (const name of options?.extraAlwaysOn ?? []) this.extraAlwaysOn.add(name);
		return this.apply();
	}

	prepareForPrompt(text: string, streaming: boolean): CapabilityChange {
		const detected = detectCapabilities(text);
		const directSkill = text.match(/^\/skill:([a-z0-9-]+)/i)?.[1];
		if (!streaming) {
			this.active.clear();
			this.forcedSkills.clear();
		}
		for (const id of detected) this.active.add(id);
		if (directSkill) this.forcedSkills.add(directSkill);
		return this.apply();
	}

	activate(capabilities: readonly CapabilityId[]): CapabilityChange {
		for (const id of capabilities) this.active.add(id);
		return this.apply();
	}

	noteToolInvocation(name: string, at = Date.now()): void {
		const previous = this.toolUsage.get(name);
		this.toolUsage.set(name, { lastUsedAt: at, invocations: (previous?.invocations ?? 0) + 1 });
	}

	state(): CapabilityState {
		if (!this.session)
			return {
				activeCapabilities: [],
				activeTools: [],
				tools: [],
				visibleSkills: [],
				footprint: {
					allToolSchemaBytes: 0,
					activeToolSchemaBytes: 0,
					reductionRatio: 0,
					allTools: 0,
					activeTools: 0,
					totalSkills: 0,
					visibleSkills: 0,
				},
			};
		const allTools = this.session.getAllTools();
		const activeNames = new Set(this.session.getActiveToolNames());
		const toolInfo = allTools
			.map((tool) => {
				const usage = this.toolUsage.get(tool.name);
				return {
					name: tool.name,
					capabilities: toolCapabilities(tool.name),
					schemaBytes: schemaBytes(tool),
					active: activeNames.has(tool.name),
					alwaysOn: ALWAYS_ON.has(tool.name) || this.extraAlwaysOn.has(tool.name),
					invocations: usage?.invocations ?? 0,
					...(usage ? { lastUsedAt: usage.lastUsedAt } : {}),
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
		const allBytes = allTools.reduce((sum, tool) => sum + schemaBytes(tool), 0);
		const activeBytes = allTools
			.filter((tool) => activeNames.has(tool.name))
			.reduce((sum, tool) => sum + schemaBytes(tool), 0);
		const allSkills = allSkillsFromLoader(this.session.resourceLoader).skills;
		const visibleSkills = allSkills
			.filter((skill) => this.skillVisibility.has(skill.name))
			.map((skill) => skill.name)
			.sort();
		return {
			activeCapabilities: CAPABILITY_IDS.filter((id) => this.active.has(id)),
			activeTools: [...activeNames].sort(),
			tools: toolInfo,
			visibleSkills,
			footprint: {
				allToolSchemaBytes: allBytes,
				activeToolSchemaBytes: activeBytes,
				reductionRatio: allBytes > 0 ? Math.max(0, 1 - activeBytes / allBytes) : 0,
				allTools: allTools.length,
				activeTools: activeNames.size,
				totalSkills: allSkills.length,
				visibleSkills: visibleSkills.length,
			},
		};
	}

	private apply(): CapabilityChange {
		if (!this.session) return { changed: false, state: this.state() };
		const beforeTools = this.session.getActiveToolNames().slice().sort().join("\0");
		const beforeSkills = this.skillVisibility.list().join("\0");
		const allSkills = allSkillsFromLoader(this.session.resourceLoader).skills;
		this.skillVisibility.set(
			allSkills
				.filter((skill) => skillMatches(skill.name, this.active, this.forcedSkills))
				.map((skill) => skill.name),
		);
		const selected = new Set<string>([...ALWAYS_ON, ...this.extraAlwaysOn]);
		for (const tool of this.session.getAllTools()) {
			if (this.excludedTools.has(tool.name)) continue;
			if (toolCapabilities(tool.name).some((id) => this.active.has(id))) selected.add(tool.name);
		}
		this.session.setActiveToolsByName([...selected]);
		const state = this.state();
		const afterTools = state.activeTools.join("\0");
		const afterSkills = state.visibleSkills.join("\0");
		return { changed: beforeTools !== afterTools || beforeSkills !== afterSkills, state };
	}
}
