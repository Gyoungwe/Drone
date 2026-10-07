import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
	CAPABILITY_IDS,
	type CapabilityId,
	type CapabilityState,
	formatSkillCommand,
	getSkillCategory,
	isDeferReviewPhrase,
	parseExpandedSkillInvocation,
	RESEARCH_SKILL_CAPABILITIES,
	researchSkillProfile,
	type TurnRoute,
	type TurnRouteHost,
	workflowProfile,
} from "@drone/shared";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { globalToolManifest, ToolManifest } from "../tools/manifest";
import {
	changesResearchWorkflow,
	detectResearchIntent,
	EMPTY_RESEARCH_INTENT,
	intentCapabilities,
	mergeResearchIntent,
	normalizeResearchIntent,
	orderedCapabilitySkills,
	type ResearchSkillIntent,
	selectResearchSkills,
} from "./research-skill-router";
import { allSkillsFromLoader, type SkillVisibility } from "./resource-loader";
import { type SkillLike, skillAlwaysWith } from "./skill-frontmatter";

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

/** 只读文献复用模式下可用的工具：由工具清单（drone.readOnly / drone.libraryMode）决定，核心不再枚举。 */
export function isReadOnlyLibraryTool(name: string, manifest: ToolManifest = globalToolManifest): boolean {
	return manifest.allowedInLibraryMode(name);
}
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
		/(?:research|paper|literature|citation|zotero|experiment|scientific|methodology|transcriptom|genom|phylogen|species|biology|bioinformatics|sequencing|rna-?seq|fastq|\bbam\b|\bvcf\b|single[- ]cell|alignment|variant|blast|fasta|ncbi|uniprot|ensembl|protein|gene|domain|homolog|论文|文献|科研|研究|实验|转录组|基因组|系统发育|物种|生物信息|测序|比对|联配|基因|蛋白|序列|结构域|同源|变异|单细胞|组装|注释|昆虫|细菌|真菌|病毒)/i,
	],
	analysis: [],
	literature: [],
	writing: [],
	planning: [],
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
		/(?:image|figure|plot|chart|diagram|visuali[sz]|show[ -]?me|slide|ppt|redraw|schematic|flow.?chart|图片|图像|绘图|图表|可视化|流程图|幻灯片|配图|重绘|示意图|柱状图|折线图|散点图|热图|箱线图)/i,
	],
	external: [
		/(?:mcp|plugin|connector|github|gitlab|slack|drive|notion|zotero|channel|ssh|远程主机|服务器|外部应用|插件|连接器)/i,
	],
};

/** Continuations preserve tool visibility only, never permissions or evidence receipts. */
export function isTaskContinuation(text: string): boolean {
	if (/^(?:also\b|and\b|补充)/i.test(text.trim())) return true;
	// 明确的接续词，或对宿主提示的短回应（「启动了」「装好了」「好的」…）：都不是新话题，不能清空当前工具可见性。
	return /^(?:继续(?:吧|执行|处理|完成|上一任务)?|接着(?:做|处理)?|下好了|下载好了|我下载了(?:，?手动的那几篇)?|完成到哪了|进度(?:如何|怎么样)?|查看(?:任务)?进度|任务状态|continue|resume|done|status|what(?:'s| is) the status|(?:我)?(?:已经?)?(?:启动|打开|开启|安装|装|下载|放|弄|搞定|准备|设置|配置)(?:好|完|定)?了(?:吧)?|(?:好|可以|行|搞定|弄好|装好|开好|启动好)了|好的|嗯|收到|ok(?:ay)?|ready|started|opened|installed|it(?:'s| is) (?:running|open|ready|installed))[\s,.!？，。！?~]*$/i.test(
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
	const intent = detectResearchIntent(text);
	if (intent.topics.length || intent.named.length) {
		found.add("research");
		for (const id of intentCapabilities(intent)) found.add(id);
	}
	for (const id of CAPABILITY_IDS) if (PATTERNS[id].some((pattern) => pattern.test(text))) found.add(id);
	// 「构建系统发育树 / build a phylogenetic tree」is analysis, not coding, unless other coding words appear.
	if (
		found.has("coding") &&
		intent.topics.includes("phylogeny") &&
		!PATTERNS.coding.some((pattern) => pattern.test(text.replace(/构建|build/gi, "")))
	)
		found.delete("coding");
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

/** 工具 → 能力：读工具清单的 drone.capabilities（挂钩 1）；常驻控制工具恒为空。 */
export function toolCapabilities(name: string, manifest: ToolManifest = globalToolManifest): CapabilityId[] {
	if (ALWAYS_ON.has(name)) return [];
	return manifest.capabilities(name);
}

/**
 * 技能可见性：显式 /skill: 优先；随后看 SKILL.md 的 `alwaysWith` 常驻声明（挂钩 5）——
 * 声明了常驻能力的技能，其可见性只由这些能力是否激活决定（不经研究技能路由）；
 * 其余研究工作流技能由路由选择，普通技能按目录分类映射到能力。
 */
function skillMatches(
	skill: SkillLike,
	capabilities: ReadonlySet<CapabilityId>,
	forced: ReadonlySet<string>,
	selectedResearch: ReadonlySet<string>,
): boolean {
	const name = skill.name;
	if (forced.has(name)) return true;
	const pinned = skillAlwaysWith(skill);
	if (pinned.size) {
		for (const id of pinned) if (capabilities.has(id)) return true;
		return false;
	}
	if (workflowProfile(name)) return selectedResearch.has(name);
	// Non-workflow skills (e.g. ~/.agents/skills) are grouped by category into a capability and selected
	// by the same per-capability limit as workflow skills (see orderedCapabilitySkills).
	return selectedResearch.has(name);
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

interface TaskRouting {
	id: string;
	capabilities: string[];
	state?: string;
	planApproved?: boolean;
	reason?: string | null;
	progressCount?: number;
	stageStartProgress?: number;
	budget?: { calls?: number; stageCalls?: number };
	actions?: { kind?: string; state?: string; milestoneId?: string | null }[];
	milestones?: { id?: string; state?: string; acceptance?: { kind?: string } }[];
	lastDefer?: { reviews?: number; releasedStage?: boolean } | null;
}
const TERMINAL_TASK_STATES = new Set(["completed", "cancelled", "archived"]);

type RuntimeSession = Pick<
	AgentSession,
	"getAllTools" | "getActiveToolNames" | "setActiveToolsByName" | "resourceLoader"
> &
	Partial<Pick<AgentSession, "sessionManager" | "getToolDefinition">>;

export interface CapabilityChange {
	changed: boolean;
	state: CapabilityState;
}

export class CapabilityRuntime {
	private session?: RuntimeSession;
	private manifest: ToolManifest = globalToolManifest;
	/** 本会话的工具清单（注册声明 → 运行时桥 → 核心默认）。 */
	get tools(): ToolManifest {
		return this.manifest;
	}
	private lastCheckpoint = "";
	private readOnlyLibrary = false;
	private researchIntent: ResearchSkillIntent = EMPTY_RESEARCH_INTENT;
	private academicManaged = false;
	private academicEnabled = false;
	private readonly active = new Set<CapabilityId>();
	/** Capabilities loaded through capability_load (not keyword-detected); their skill lists are filled. */
	private readonly loaded = new Set<CapabilityId>();
	/** In-memory only (never persisted): current prompt + capability_load task text, used to rank fill. */
	private taskText = "";
	/** Visible skill order from the last apply(): primary → companion → fill. */
	private skillOrder: string[] = [];
	private primarySkill: string | undefined;
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
		this.manifest = new ToolManifest(session);
		for (const name of options?.excludedToolNames ?? []) this.excludedTools.add(name);
		for (const name of options?.extraAlwaysOn ?? []) this.extraAlwaysOn.add(name);
		this.restoreCheckpoint();
		return this.apply();
	}

	manageAcademic(): void {
		this.academicManaged = true;
	}
	skillPath(name: string): string | undefined {
		return this.session
			? allSkillsFromLoader(this.session.resourceLoader).skills.find((s) => s.name === name)?.filePath
			: undefined;
	}
	setAcademicMode(enabled: boolean): CapabilityChange {
		this.academicEnabled = enabled;
		if (!enabled) this.clearAcademicSelection();
		return this.apply();
	}
	private clearAcademicSelection(): void {
		for (const name of this.forcedSkills)
			if (researchSkillProfile(name)?.source === "academic") this.forcedSkills.delete(name);
		this.researchIntent = normalizeResearchIntent({
			...this.researchIntent,
			named: this.researchIntent.named.filter((n) => researchSkillProfile(n)?.source !== "academic"),
			primary:
				researchSkillProfile(this.researchIntent.primary ?? "")?.source === "academic"
					? undefined
					: this.researchIntent.primary,
		});
	}
	restoreRouting(academicEnabled = this.academicEnabled): CapabilityChange {
		this.academicEnabled = academicEnabled;
		this.restoreCheckpoint();
		if (!academicEnabled && this.academicManaged) this.clearAcademicSelection();
		return this.apply();
	}
	getWorkflowSelection() {
		return selectResearchSkills(
			this.session ? allSkillsFromLoader(this.session.resourceLoader).skills : [],
			this.active,
			this.researchIntent,
			{ academicEnabled: this.academicEnabled },
		);
	}
	/**
	 * Explain the route that prepareForPrompt just chose, plus the host gate already on the book.
	 * Call it after prepareForPrompt. It does not route again and does not change the ledger.
	 */
	describeTurn(text: string): TurnRoute {
		const trimmed = text.trim().replace(/\s+/g, " ");
		const utterance = trimmed.slice(0, 180) || "(empty)";
		const taskCommand = trimmed === "/task-status" || trimmed.startsWith("/task-action ");
		const deferPhrase = isDeferReviewPhrase(trimmed);
		const inProgress = this.taskInProgress();
		const continuation = !taskCommand && (isTaskContinuation(trimmed) || deferPhrase || inProgress);
		const readOnly = !taskCommand && !continuation && this.readOnlyLibrary;
		const intake = taskCommand
			? "task-command"
			: readOnly
				? "read-only"
				: isTaskStatusQuery(trimmed)
					? "status"
					: continuation
						? "continuation"
						: "new-topic";
		const selection = this.getWorkflowSelection();
		const visible = new Set(this.state().visibleSkills);
		const primary = selection.primaryWorkflow ?? null;
		const host = this.hostGate();
		const visiblePrimary = Boolean(primary && visible.has(primary));
		let landing: TurnRoute["landing"] = "ordinary";
		if (readOnly) landing = "library";
		else if (
			host &&
			(host.pendingReview ||
				host.deferredReviews > 0 ||
				host.stageLimited ||
				host.reason === "total-budget" ||
				host.state === "blocked" ||
				host.state === "waiting_user")
		)
			landing = "host-gate";
		else if (visiblePrimary) landing = "workflow";
		return {
			utterance,
			intake,
			capabilities: CAPABILITY_IDS.filter((id) => this.active.has(id)),
			topics: this.researchIntent.topics.slice(0, 8),
			direction: selection.direction ?? null,
			stage: selection.stage ?? null,
			contract: selection.contract ?? null,
			primary,
			reason: primary ? (selection.reasons[primary] ?? null) : null,
			unavailableStage: selection.unavailableStage ?? null,
			comparison: this.researchIntent.comparison === true,
			academic: this.academicEnabled,
			keptCheckpoint: continuation && !taskCommand,
			deferPhrase,
			visiblePrimary,
			landing,
			host,
		};
	}
	isResearchComparison(): boolean {
		return this.researchIntent.comparison === true;
	}
	prepareForPrompt(text: string, streaming: boolean): CapabilityChange {
		// Never route on expanded third-party skill instructions as if they were user intent.
		const invocation = parseExpandedSkillInvocation(text);
		if (invocation) text = formatSkillCommand(invocation);
		if (/^\/ars-pi-(?:start|stop|doctor)(?:\s|$)/.test(text.trim())) return this.apply();
		if (text.trim() === "/task-status" || text.startsWith("/task-action ")) return this.apply();
		// 任务进行中（计划已批准、尚未结束）的任何新消息都视为接续：保留检查点里的工具可见性，
		// 新检测到的能力只做叠加；只有没有进行中任务的新话题才从零开始。这里只影响路由可见性，不影响权限。
		const continuation = !streaming && (isTaskContinuation(text) || this.taskInProgress());
		if (continuation) this.restoreCheckpoint();
		if (!streaming && !continuation) this.readOnlyLibrary = isReadOnlyLibraryRequest(text);
		const detected = detectCapabilities(text);
		const directSkill = text.match(/^\/skill:([a-z0-9-]+)/i)?.[1];
		if (!streaming && !continuation) {
			this.taskText = "";
			this.active.clear();
			this.loaded.clear();
			this.forcedSkills.clear();
			this.researchIntent = EMPTY_RESEARCH_INTENT;
		}
		if (!streaming) this.taskText = `${this.taskText}\n${text}`.slice(-4000);
		const incomingResearch = detectResearchIntent(text);
		if (changesResearchWorkflow(incomingResearch)) {
			for (const name of this.forcedSkills)
				if (workflowProfile(name) && workflowProfile(name)?.direction !== "internal")
					this.forcedSkills.delete(name);
		}
		this.researchIntent = mergeResearchIntent(this.researchIntent, incomingResearch);
		for (const id of detected) this.active.add(id);
		if (directSkill) this.forcedSkills.add(directSkill);
		return this.apply();
	}

	activate(capabilities: readonly CapabilityId[], task?: string): CapabilityChange {
		if (task) {
			this.taskText = `${this.taskText}\n${task}`.slice(-4000);
			const incoming = detectResearchIntent(task);
			if (changesResearchWorkflow(incoming))
				for (const name of this.forcedSkills)
					if (workflowProfile(name) && workflowProfile(name)?.direction !== "internal")
						this.forcedSkills.delete(name);
			this.researchIntent = mergeResearchIntent(this.researchIntent, incoming);
		}
		for (const id of capabilities) {
			this.active.add(id);
			this.loaded.add(id);
		}
		// `research` is an umbrella: with a task it also loads the skill groups that task needs.
		if (task && capabilities.includes("research"))
			for (const id of intentCapabilities(detectResearchIntent(task))) {
				this.active.add(id);
				this.loaded.add(id);
			}
		return this.apply();
	}

	/** Metadata (never bodies) of currently visible skills, for capability_load results. */
	visibleSkillMetadata(): {
		name: string;
		description: string;
		filePath?: string;
		role: "primary" | "routed" | "base";
	}[] {
		if (!this.session) return [];
		const rank = new Map(this.skillOrder.map((name, index) => [name, index]));
		const order = (name: string) => rank.get(name) ?? Number.MAX_SAFE_INTEGER;
		return allSkillsFromLoader(this.session.resourceLoader)
			.skills.filter((skill) => this.skillVisibility.has(skill.name))
			.map((skill) => ({
				name: skill.name,
				description: skill.description ?? "",
				filePath: skill.filePath,
				role: (skill.name === this.primarySkill ? "primary" : rank.has(skill.name) ? "routed" : "base") as
					| "primary"
					| "routed"
					| "base",
			}))
			.sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
	}

	isReadOnlyLibrary(): boolean {
		return this.readOnlyLibrary;
	}
	guardTool(name: string, input: Record<string, unknown> = {}) {
		if (!this.readOnlyLibrary) return undefined;
		if (!this.manifest.allowedInLibraryMode(name))
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
					capabilities: toolCapabilities(tool.name, this.manifest),
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
	private activeTaskRouting(): TaskRouting | null {
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
				tasks?: TaskRouting[];
			};
			if (b?.scope !== scope || !Array.isArray(b.tasks)) continue;
			return b.tasks.find((t) => t.id === b.activeTaskId) || null;
		}
		return null;
	}
	/** Host gate as persisted before this read. Null when the session has no active task book. */
	private hostGate(): TurnRouteHost | null {
		const manager = this.session?.sessionManager;
		if (!manager?.getSessionId || !manager.getCwd || !manager.getBranch) return null;
		const scope = createHash("sha256")
			.update(`${manager.getSessionId()}\0${resolve(manager.getCwd())}`)
			.digest("hex");
		for (const entry of [...manager.getBranch()].reverse()) {
			if (entry.type !== "custom" || entry.customType !== "drone-task-workbench-v2") continue;
			const book = entry.data as {
				scope?: string;
				activeTaskId?: string;
				limits?: { stageCalls?: number };
				tasks?: TaskRouting[];
			};
			if (book?.scope !== scope || !Array.isArray(book.tasks)) continue;
			const task = book.tasks.find((item) => item.id === book.activeTaskId);
			if (!task) return null;
			const stageLimit = book.limits?.stageCalls ?? 48;
			const stageCalls = task.budget?.stageCalls ?? 0;
			const progressCount = task.progressCount ?? 0;
			const stageStartProgress = task.stageStartProgress ?? 0;
			const pending = (task.actions ?? []).filter(
				(action) => action.kind === "review" && action.state === "pending",
			);
			const review = pending[0];
			const milestone = review?.milestoneId
				? task.milestones?.find((item) => item.id === review.milestoneId)
				: undefined;
			return {
				reason: typeof task.reason === "string" ? task.reason : null,
				state: task.state ?? null,
				stageCalls,
				calls: task.budget?.calls ?? 0,
				progressCount,
				stageStartProgress,
				stageLimited: stageCalls >= stageLimit,
				hasProgress: progressCount > stageStartProgress,
				pendingReview: pending.length > 0,
				reviewLinked: Boolean(
					milestone && milestone.acceptance?.kind === "human_review" && milestone.state !== "completed",
				),
				deferredReviews: task.lastDefer?.reviews ?? 0,
				releasedStage: task.lastDefer?.releasedStage === true,
			};
		}
		return null;
	}
	/** 当前任务已获用户批准且未结束：新消息默认是对它的接续，而不是新话题。 */
	private taskInProgress(): boolean {
		const task = this.activeTaskRouting();
		return !!task && task.planApproved === true && !TERMINAL_TASK_STATES.has(task.state ?? "");
	}
	private restoreCheckpoint(): void {
		const manager = this.session?.sessionManager;
		if (!manager) return;
		this.active.clear();
		this.loaded.clear();
		this.forcedSkills.clear();
		this.researchIntent = EMPTY_RESEARCH_INTENT;
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
				researchIntent?: unknown;
				loaded?: unknown;
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
			this.researchIntent = normalizeResearchIntent(data.researchIntent);
			this.loaded.clear();
			for (const id of data.capabilities) if (CAPABILITY_IDS.includes(id)) this.active.add(id);
			if (Array.isArray(data.loaded))
				for (const id of data.loaded) if (CAPABILITY_IDS.includes(id)) this.loaded.add(id);
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
			...(this.loaded.size ? { loaded: [...this.loaded].sort() } : {}),
			readOnlyLibrary: this.readOnlyLibrary,
			researchIntent: this.researchIntent,
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
		const ordered = orderedCapabilitySkills(allSkills, this.active, this.researchIntent, {
			academicEnabled: this.academicEnabled,
			fill: this.loaded,
			taskText: this.taskText,
			isPinned: (skill) => skillAlwaysWith(skill).size > 0,
		});
		const selectedResearch = new Set(ordered.names);
		this.skillOrder = ordered.names;
		this.primarySkill = ordered.primary;
		this.skillVisibility.set(
			allSkills
				.filter(
					(skill) =>
						(researchSkillProfile(skill.name)?.source !== "academic" ||
							!this.academicManaged ||
							this.academicEnabled) &&
						skillMatches(skill, this.active, this.forcedSkills, selectedResearch) &&
						(!this.readOnlyLibrary ||
							// 只读文献复用：仅保留声明 `alwaysWith: research` 的技能与显式 /skill: 技能
							skillAlwaysWith(skill).has("research") ||
							this.forcedSkills.has(skill.name)),
				)
				.map((skill) => skill.name),
		);
		const selected = new Set<string>([...ALWAYS_ON, ...this.extraAlwaysOn]);
		// Research sub-capabilities (analysis/literature/writing/planning) carry the research tool pack.
		const toolPacks = new Set<CapabilityId>(this.active);
		if (RESEARCH_SKILL_CAPABILITIES.some((id) => this.active.has(id))) toolPacks.add("research");
		for (const tool of this.session.getAllTools()) {
			if (this.excludedTools.has(tool.name)) continue;
			if (toolCapabilities(tool.name, this.manifest).some((id) => toolPacks.has(id))) selected.add(tool.name);
		}
		this.session.setActiveToolsByName(
			[...selected].filter(
				(name) =>
					!this.excludedTools.has(name) &&
					(!this.readOnlyLibrary || this.manifest.allowedInLibraryMode(name)),
			),
		);
		this.saveCheckpoint();
		const state = this.state();
		const afterTools = state.activeTools.join("\0");
		const afterSkills = state.visibleSkills.join("\0");
		return { changed: beforeTools !== afterTools || beforeSkills !== afterSkills, state };
	}
}
