import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { CAPABILITY_IDS, type CapabilityId, type CapabilityState, getSkillCategory } from "@drone/shared";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { allSkillsFromLoader, type SkillVisibility } from "./resource-loader";

const ALWAYS_ON = new Set([
	"ask_user",
	"set_status",
	"todo",
	"capability_load",
	"task_status",
	"task_plan",
	"task_wait",
	"task_reconcile",
	"task_evidence_restore",
]);

export const READ_ONLY_LIBRARY_TOOLS = new Set([
	"set_status",
	"read",
	"research_prepare_knowledge",
	"research_wiki_navigate",
	"research_read_knowledge",
	"research_search_knowledge",
	"research_verify_literature",
	"research_loop",
	"research_reconcile_literature",
	"research_check_answer",
	"research_knowledge_status",
	"research_source_status",
	"research_task_status",
	"research_workspace_status",
	"research_zotero_status",
]);
export function isReadOnlyLibraryRequest(text: string): boolean {
	return (
		/只读|read[- ]only/i.test(text) &&
		/复用|既有|已有|reuse|existing/i.test(text) &&
		/文献|论文|笔记|literature|papers?|notes?/i.test(text) &&
		!/(?:修复|重构|实现|修改).{0,8}(?:代码|模块|系统)|\b(?:fix|refactor|implement)\b/i.test(text)
	);
}
const PATTERNS: Record<CapabilityId, RegExp[]> = {
	knowledge: [
		/(?:knowledge|wiki|obsidian|vault|evidence|知识库|知识图谱|维基|证据|来源|主题记忆|恢复主题|resume topic|topic memory)/i,
	],
	research: [
		/(?:research|paper|literature|citation|zotero|experiment|scientific|methodology|transcriptom|genom|phylogen|species|biology|bioinformatics|论文|文献|科研|研究|实验|转录组|基因组|系统发育|物种|生物信息)/i,
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
const ZOTERO_TOOL = /^research_(?:zotero_status|setup_zotero)$/;
const VISUAL_TOOL = /(?:show_image|explainer|show_me|figure|plot|chart|image)/i;

/** Continuations preserve tool visibility only, never permissions or evidence receipts. */
export function isTaskContinuation(text: string): boolean {
	if (/^(?:also\b|and\b|补充)/i.test(text.trim())) return true;
	return /^(?:继续(?:吧|执行|处理|完成|上一任务)?|接着(?:做|处理)?|下好了|下载好了|我下载了(?:，?手动的那几篇)?|完成到哪了|进度(?:如何|怎么样)?|查看(?:任务)?进度|任务状态|continue|resume|done|status|what(?:'s| is) the status)[\s,.!？，。！?]*$/i.test(
		text.trim(),
	);
}
export function isTaskStatusQuery(text: string): boolean {
	return /^(?:完成到哪了|进度(?:如何|怎么样)?|查看(?:任务)?进度|任务状态|task status|what(?:'s| is) the status)[\s.!？，。！?]*$/i.test(
		text.trim(),
	);
}
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
		if (ZOTERO_TOOL.test(name)) result.push("external");
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
> &
	Partial<Pick<AgentSession, "sessionManager">>;

export interface CapabilityChange {
	changed: boolean;
	state: CapabilityState;
}

export class CapabilityRuntime {
	private session?: RuntimeSession;
	private lastCheckpoint = "";
	private readOnlyLibrary = false;
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
		this.restoreCheckpoint();
		return this.apply();
	}

	prepareForPrompt(text: string, streaming: boolean): CapabilityChange {
		if (text.trim() === "/task-status" || text.startsWith("/task-action ")) return this.apply();
		if (!streaming && isTaskContinuation(text)) this.restoreCheckpoint();
		if (!streaming && !isTaskContinuation(text)) this.readOnlyLibrary = isReadOnlyLibraryRequest(text);
		const detected = detectCapabilities(text);
		const directSkill = text.match(/^\/skill:([a-z0-9-]+)/i)?.[1];
		if (!streaming && !isTaskContinuation(text)) {
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

	isReadOnlyLibrary(): boolean {
		return this.readOnlyLibrary;
	}
	guardTool(name: string, input: Record<string, unknown> = {}) {
		if (!this.readOnlyLibrary) return undefined;
		if (!READ_ONLY_LIBRARY_TOOLS.has(name))
			return {
				block: true,
				reason:
					"This is read-only existing-literature reuse. Use native knowledge/identity tools and research_loop.start; no task_plan, shell, downloads or library writes are needed.",
			};
		if (
			name === "read" &&
			!/(?:^|[\\/])skills[\\/][^\\/]+[\\/]SKILL\.md$/i.test(String(input.path || input.filePath || ""))
		)
			return {
				block: true,
				reason:
					"Read paper notes with research_read_knowledge; do not search filesystem run directories. research_loop.start creates the correct run directory.",
			};
		return undefined;
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

	/** Only restore routing visibility; never permission grants, tools or executable code. */
	private activeTaskRouting(): { id: string; capabilities: string[] } | null {
		const manager = this.session?.sessionManager;
		if (!manager) return null;
		const scope = createHash("sha256")
			.update(`${manager.getSessionId()}\0${resolve(manager.getCwd())}`)
			.digest("hex");
		for (const entry of [...manager.getBranch()].reverse()) {
			if (entry.type !== "custom" || entry.customType !== "drone-task-workbench-v2") continue;
			const b = entry.data as {
				scope?: string;
				activeTaskId?: string;
				tasks?: { id: string; capabilities: string[] }[];
			};
			if (b?.scope !== scope || !Array.isArray(b.tasks)) continue;
			return b.tasks.find((t) => t.id === b.activeTaskId) || null;
		}
		return null;
	}
	private restoreCheckpoint(): void {
		const manager = this.session?.sessionManager;
		if (!manager) return;
		this.active.clear();
		this.forcedSkills.clear();
		const scope = `${manager.getSessionId()}\0${manager.getCwd()}`;
		const task = this.activeTaskRouting();
		if (task)
			for (const id of task.capabilities || [])
				if (CAPABILITY_IDS.includes(id as CapabilityId)) this.active.add(id as CapabilityId);
		for (const entry of manager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== "drone-capability-checkpoint-v1") continue;
			const data = entry.data as {
				scope?: unknown;
				taskId?: unknown;
				capabilities?: unknown;
				skills?: unknown;
				readOnlyLibrary?: boolean;
			} | null;
			if (
				!data ||
				data.scope !== scope ||
				(task && data.taskId != null && data.taskId !== task.id) ||
				!Array.isArray(data.capabilities) ||
				data.capabilities.length > 16 ||
				!Array.isArray(data.skills) ||
				data.skills.length > 32
			)
				continue;
			this.active.clear();
			this.forcedSkills.clear();
			this.readOnlyLibrary = data.readOnlyLibrary === true;
			for (const id of data.capabilities) if (CAPABILITY_IDS.includes(id)) this.active.add(id);
			for (const name of data.skills)
				if (typeof name === "string" && /^[a-z0-9-]{1,100}$/.test(name)) this.forcedSkills.add(name);
		}
	}
	private saveCheckpoint(): void {
		const manager = this.session?.sessionManager;
		if (!manager) return;
		const data = {
			taskId: this.activeTaskRouting()?.id || null,
			scope: `${manager.getSessionId()}\0${manager.getCwd()}`,
			capabilities: [...this.active].sort(),
			readOnlyLibrary: this.readOnlyLibrary,
			skills: [...this.forcedSkills].sort().slice(0, 32),
		};
		const encoded = JSON.stringify(data);
		if (encoded === this.lastCheckpoint) return;
		manager.appendCustomEntry("drone-capability-checkpoint-v1", data);
		this.lastCheckpoint = encoded;
	}
	private apply(): CapabilityChange {
		if (!this.session) return { changed: false, state: this.state() };
		const beforeTools = this.session.getActiveToolNames().slice().sort().join("\0");
		const beforeSkills = this.skillVisibility.list().join("\0");
		const allSkills = allSkillsFromLoader(this.session.resourceLoader).skills;
		this.skillVisibility.set(
			allSkills
				.filter(
					(skill) =>
						skillMatches(skill.name, this.active, this.forcedSkills) &&
						(!this.readOnlyLibrary ||
							["research-vault", "research-workflow", "zotero-literature"].includes(skill.name) ||
							this.forcedSkills.has(skill.name)),
				)
				.map((skill) => skill.name),
		);
		const selected = new Set<string>([...ALWAYS_ON, ...this.extraAlwaysOn]);
		for (const tool of this.session.getAllTools()) {
			if (this.excludedTools.has(tool.name)) continue;
			if (toolCapabilities(tool.name).some((id) => this.active.has(id))) selected.add(tool.name);
		}
		this.session.setActiveToolsByName(
			[...selected].filter(
				(name) =>
					!this.excludedTools.has(name) && (!this.readOnlyLibrary || READ_ONLY_LIBRARY_TOOLS.has(name)),
			),
		);
		this.saveCheckpoint();
		const state = this.state();
		const afterTools = state.activeTools.join("\0");
		const afterSkills = state.visibleSkills.join("\0");
		return { changed: beforeTools !== afterTools || beforeSkills !== afterSkills, state };
	}
}
