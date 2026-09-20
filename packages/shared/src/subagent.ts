export interface SubagentLaunchInput {
	required_tools?: string[];
	agent: string;
	/** 子会话 id（live progress / 内联 transcript 绑定） */
	sessionId?: string;
	task?: string;
	cwd?: string;
}

/**
 * Normalize model-emitted subagent launch args. Models occasionally emit both a direct
 * agent/task and a tasks[] fanout even though the schema describes them as exclusive.
 * Treat that shape as intentional fanout, merge both sources, and de-duplicate exact lanes.
 */
export function normalizeSubagentLaunchInputs(args: unknown): SubagentLaunchInput[] {
	const raw = (args ?? {}) as {
		action?: unknown;
		agent?: unknown;
		task?: unknown;
		cwd?: unknown;
		required_tools?: unknown;
		tasks?: Array<{ agent?: unknown; task?: unknown; cwd?: unknown; required_tools?: unknown }>;
	};
	if (raw.action != null) return [];
	const candidates: SubagentLaunchInput[] = [];
	if (typeof raw.agent === "string" && raw.agent.length > 0) {
		candidates.push({
			agent: raw.agent,
			...(typeof raw.task === "string" ? { task: raw.task } : {}),
			...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
			...(Array.isArray(raw.required_tools)
				? { required_tools: raw.required_tools.filter((name): name is string => typeof name === "string") }
				: {}),
		});
	}
	for (const item of Array.isArray(raw.tasks) ? raw.tasks : []) {
		if (typeof item.agent !== "string" || item.agent.length === 0) continue;
		candidates.push({
			agent: item.agent,
			...(typeof item.task === "string" ? { task: item.task } : {}),
			...(typeof item.cwd === "string" ? { cwd: item.cwd } : {}),
			...(Array.isArray(item.required_tools)
				? { required_tools: item.required_tools.filter((name): name is string => typeof name === "string") }
				: {}),
		});
	}
	const seen = new Set<string>();
	return candidates.filter((item) => {
		const key = `${item.agent}\u0000${item.task ?? ""}\u0000${item.cwd ?? ""}\u0000${[...(item.required_tools || [])].sort().join(",")}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * 子代理运行数据提取（跨进程共用）：从 subagent 工具结果的 details 结构检测运行组。
 * 从 session.ts 拆出（session.ts 回归纯类型 + 消息 union 定义）。
 */
/** 子代理运行结果（扩展 subagent 工具 details 提取，独立消息展示用） */
export interface SubagentRunData {
	/** 子代理名（如 reviewer / scout） */
	agent: string;
	/** 子会话 id（live progress / 内联 transcript 绑定） */
	sessionId?: string;
	task?: string;
	status: "done" | "error";
	model?: string;
	/** 子代理消耗的 token 数 */
	tokens?: number;
	/** 非 0 表示子代理执行出错 */
	exitCode?: number;
	/** 产物目录 */
	artifactsDir?: string;
	/** 子代理会话文件路径（点击可打开完整对话） */
	sessionFile?: string;
	/** 运行中的用户可见状态（仅 live progress 携带） */
	statusText?: string;
	statusPhase?: string;
	currentAction?: string;
	currentTool?: string;
	startedAt?: number;
	lastSteerAt?: number;
	supervisorRequest?: {
		id: string;
		reason: "need_decision" | "interview_request" | "progress_update";
		message: string;
		expectsReply: boolean;
	} | null;
	/** 面板派发的运行携带全量面板记录（排队 / 中止 / 上下文状态等只有面板运行才有） */
	panel?: SubagentPanelRun;
}

/**
 * subagent 家族工具名判定（互斥/接管 badge 的单一来源）：
 * 内置同名工具 `subagent` + 第三方家族配套 `subagent_*`（wait/status 等）。
 */
export function isSubagentToolName(name: string): boolean {
	return name === "subagent" || name.startsWith("subagent_");
}

/**
 * 从工具结果 details 提取子代理运行数据。
 * 结构检测（不依赖工具名）：details.results 数组且至少一项带 agent/sessionFile → 返回运行组，否则 null。
 * 兼容 pi-subagents 及遵循同约定的社区扩展：
 * - 同步/foreground：details.results[]（agent/task/exitCode/usage/model/artifactPaths.jsonlPath）
 * - 后台并行：subagent_wait 的 details.completions[].results[]（agent/success/artifactPaths.outputPath 可能是子会话 jsonl）
 */
export function extractSubagentRuns(details: unknown): SubagentRunData[] | null {
	const d = details as
		| {
				results?: unknown[];
				completions?: unknown[];
				artifacts?: { dir?: unknown };
		  }
		| null
		| undefined;
	if (!d) return null;
	const runs: SubagentRunData[] = [];
	const artifactsDir = typeof d.artifacts?.dir === "string" ? d.artifacts.dir : undefined;

	const pushRun = (
		agent: unknown,
		rest: {
			sessionId?: unknown;
			task?: unknown;
			model?: unknown;
			exitCode?: unknown;
			error?: unknown;
			sessionFile?: unknown;
			tokens?: unknown;
			statusText?: unknown;
			statusPhase?: unknown;
			currentAction?: unknown;
			currentTool?: unknown;
			startedAt?: unknown;
			lastSteerAt?: unknown;
			supervisorRequest?: unknown;
		},
	) => {
		if (typeof agent !== "string") return;
		const sessionFile = typeof rest.sessionFile === "string" ? rest.sessionFile : undefined;
		const task = typeof rest.task === "string" && rest.task.length > 0 ? rest.task : undefined;
		const exitCode = typeof rest.exitCode === "number" ? rest.exitCode : undefined;
		const error = typeof rest.error === "string" && rest.error.length > 0 ? rest.error : undefined;
		runs.push({
			agent,
			sessionId: typeof rest.sessionId === "string" ? rest.sessionId : undefined,
			task,
			status: exitCode != null && exitCode !== 0 ? "error" : error ? "error" : "done",
			model: typeof rest.model === "string" ? rest.model : undefined,
			tokens: typeof rest.tokens === "number" ? rest.tokens : undefined,
			exitCode,
			artifactsDir,
			sessionFile,
			statusText: typeof rest.statusText === "string" ? rest.statusText : undefined,
			statusPhase: typeof rest.statusPhase === "string" ? rest.statusPhase : undefined,
			currentAction: typeof rest.currentAction === "string" ? rest.currentAction : undefined,
			currentTool: typeof rest.currentTool === "string" ? rest.currentTool : undefined,
			startedAt: typeof rest.startedAt === "number" ? rest.startedAt : undefined,
			lastSteerAt: typeof rest.lastSteerAt === "number" ? rest.lastSteerAt : undefined,
			supervisorRequest: (() => {
				if (rest.supervisorRequest === null) return null;
				const value = rest.supervisorRequest as Record<string, unknown> | undefined;
				if (!value || typeof value.id !== "string" || typeof value.message !== "string") return undefined;
				const reason = value.reason;
				if (reason !== "need_decision" && reason !== "interview_request" && reason !== "progress_update")
					return undefined;
				return { id: value.id, reason, message: value.message, expectsReply: value.expectsReply === true };
			})(),
		});
	};

	// 后台并行完成：subagent_wait 的 completions（子代理会话文件可能在 artifactPaths.outputPath，须以 .jsonl 结尾）
	const completions = Array.isArray(d.completions) ? d.completions : [];
	for (const rawCompletion of completions) {
		const completion = rawCompletion as
			| { agent?: unknown; success?: unknown; results?: unknown[] }
			| undefined;
		if (!completion || !Array.isArray(completion.results)) continue;
		for (const rawChild of completion.results) {
			const child = rawChild as
				| {
						agent?: unknown;
						success?: unknown;
						error?: unknown;
						artifactPaths?: { jsonlPath?: unknown; outputPath?: unknown };
				  }
				| undefined;
			if (!child) continue;
			const outputPath =
				typeof child.artifactPaths?.outputPath === "string" ? child.artifactPaths.outputPath : undefined;
			const jsonlPath =
				typeof child.artifactPaths?.jsonlPath === "string" ? child.artifactPaths.jsonlPath : undefined;
			const sessionFile = jsonlPath ?? (outputPath?.endsWith(".jsonl") ? outputPath : undefined);
			pushRun(child.agent, {
				error: child.error,
				sessionFile,
				exitCode: child.success === false ? 1 : undefined,
			});
		}
	}

	// 同步/foreground：details.results[]（会话文件在 artifactPaths.jsonlPath）
	const results = Array.isArray(d.results) ? d.results : [];
	for (const raw of results) {
		const r = raw as Record<string, unknown>;
		const agent = typeof r.agent === "string" ? r.agent : undefined;
		const sessionFile = typeof r.sessionFile === "string" ? r.sessionFile : undefined;
		if (!agent && !sessionFile) continue;
		const artifactPaths = r.artifactPaths as { jsonlPath?: unknown } | undefined;
		const usage = r.usage as
			| { totalTokens?: { tokens?: unknown }; tokens?: unknown; input?: unknown; output?: unknown }
			| undefined;
		const progress = r.progressSummary as { tokens?: unknown } | undefined;
		const totalTokens = r.totalTokens as { tokens?: unknown } | undefined;
		const tokenValue =
			usage?.totalTokens?.tokens ??
			usage?.tokens ??
			(typeof usage?.input === "number" && typeof usage?.output === "number"
				? usage.input + usage.output
				: undefined) ??
			progress?.tokens ??
			totalTokens?.tokens;
		const exitCode = typeof r.exitCode === "number" ? r.exitCode : undefined;
		const error = typeof r.error === "string" && r.error.length > 0 ? r.error : undefined;
		pushRun(agent ?? sessionFile ?? "subagent", {
			sessionId: r.sessionId,
			task: r.task,
			model: r.model,
			exitCode,
			error,
			sessionFile:
				sessionFile ?? (typeof artifactPaths?.jsonlPath === "string" ? artifactPaths.jsonlPath : undefined),
			tokens: tokenValue,
			statusText: r.statusText,
			statusPhase: r.statusPhase,
			currentAction: r.currentAction,
			currentTool: r.currentTool,
			startedAt: r.startedAt,
			lastSteerAt: r.lastSteerAt,
			supervisorRequest: r.supervisorRequest,
		});
	}
	return runs.length > 0 ? runs : null;
}

/* ───────────────────────── 子智能体面板（会话内专属派发） ───────────────────────── */

/** 子智能体定义来源：内置（Drone）/ 用户（~/.pi/agent/agents）/ 项目（.pi/agents） */
export type SubagentPanelSource = "builtin" | "user" | "project";

/**
 * 面板运行状态机：queued（等运行槽）→ running（子会话已创建）⇄ needs_reply / waiting_approval
 * → done / error / aborted。needs_reply / waiting_approval 都是「运行中」的子态，只是需要用户。
 */
export type SubagentPanelRunStatus =
	| "queued"
	| "running"
	| "needs_reply"
	| "waiting_approval"
	| "done"
	| "error"
	| "aborted";

/**
 * 结果进入主模型上下文的状态：none = 未勾选 followUp（只留结果卡，用户手动引用）；
 * pending = 已交给 followUp 队列，主模型仍在生成；delivered = 已进入上下文。
 */
export type SubagentPanelContextState = "none" | "pending" | "delivered";

/** 面板可见的子智能体（session:listSubagents 返回项） */
export interface SubagentPanelAgent {
	name: string;
	description: string;
	source: SubagentPanelSource;
	/** 定义声明的工具集（必需工具只能从中勾选） */
	tools: string[];
	/** 定义固定的模型（缺省跟随主会话 / 设置页覆盖） */
	model?: string;
	/** MCP 访问：none / read-local（研究策略只读） */
	mcpAccess: "none" | "read-local";
	/** 项目级定义在未信任项目里为 false：列表可见但不可派发 */
	trusted: boolean;
	/** 定义文件路径（内置为空） */
	path?: string;
}

/** session:listSubagents 快照：可用列表 + 会话边界信息（并发上限 / 项目信任 / 目录） */
export interface SubagentPanelSnapshot {
	sessionId: string;
	cwd: string;
	agents: SubagentPanelAgent[];
	/** 本项目并发上限（.pi/research-workspace.json maxConcurrentSubagents，1–3） */
	maxConcurrent: number;
	projectTrusted: boolean;
	/** 用户级定义目录（空态「打开目录」用） */
	userAgentsDir: string;
	/** 项目级定义目录 */
	projectAgentsDir: string;
	/** 只读会话（子智能体产物检视）不能派发 */
	readOnly: boolean;
}

export interface SubagentDispatchTask {
	agent: string;
	task: string;
	/** 必需工具（须落在 agent 工具集内；后端复用 required_tools 校验） */
	requiredTools?: string[];
}

export interface SubagentDispatchInput {
	tasks: SubagentDispatchTask[];
	/** 工作目录；缺省 = 会话 cwd */
	cwd?: string;
	/** 完成后把摘要作为 followUp 交给主模型（默认 true） */
	followUp?: boolean;
	/** 本次派发信任项目级定义（对应 confirmProjectAgents；不写入信任文件） */
	trustProjectAgents?: boolean;
}

/** 最多并行任务数（与 subagent 工具 MAX_TASKS 一致） */
export const SUBAGENT_PANEL_MAX_TASKS = 8;

/** 面板派发运行记录（后端事实源；`subagent_run` 事件整条推送） */
export interface SubagentPanelRun {
	runId: string;
	/** 同一次派发（一批任务）共享 */
	dispatchId: string;
	parentSessionId: string;
	agent: string;
	source: SubagentPanelSource;
	task: string;
	cwd: string;
	requiredTools: string[];
	followUp: boolean;
	status: SubagentPanelRunStatus;
	contextState: SubagentPanelContextState;
	/** 排队位置（仅 queued） */
	queuePosition?: number;
	createdAt: number;
	startedAt?: number;
	endedAt?: number;
	/** 子会话 id（运行中内联 transcript / steer / 回复上级请求） */
	childSessionId?: string;
	/** 子会话文件（回放） */
	sessionFile?: string;
	model?: string;
	tokens?: number;
	exitCode?: number;
	error?: string;
	/** 子智能体最终结论（已按上限截断） */
	content?: string;
	statusText?: string;
	statusPhase?: string;
	currentAction?: string;
	currentTool?: string;
	lastSteerAt?: number;
	supervisorRequest?: SubagentRunData["supervisorRequest"];
	/** 正挂在父会话 gate 上的审批请求 id（审批坞来源胶囊 / 等待审批 join 用） */
	pendingApprovalIds: string[];
}

export interface SubagentDispatchReceipt {
	dispatchId: string;
	runs: SubagentPanelRun[];
}

/** 会话文件里的面板记录：派发条目（custom entry，模型不可见）与结果（custom message 或 entry） */
export const SUBAGENT_DISPATCH_CUSTOM_TYPE = "drone-subagent-dispatch";
export const SUBAGENT_RESULT_CUSTOM_TYPE = "drone-subagent-result";

export interface SubagentDispatchRecord {
	v: 1;
	dispatchId: string;
	runs: SubagentPanelRun[];
}

export interface SubagentResultRecord {
	v: 1;
	run: SubagentPanelRun;
}

/** 终态判定 */
export function isSubagentRunSettled(status: SubagentPanelRunStatus): boolean {
	return status === "done" || status === "error" || status === "aborted";
}

/** 需要用户介入（页签徽标变琥珀） */
export function isSubagentRunAttention(status: SubagentPanelRunStatus): boolean {
	return status === "needs_reply" || status === "waiting_approval";
}

/** 面板运行 → 聊天运行卡数据（SubagentRunData 形状；panel 字段保留全量记录） */
export function subagentRunDataFromPanelRun(run: SubagentPanelRun): SubagentRunData {
	return {
		agent: run.agent,
		sessionId: run.childSessionId,
		task: run.task,
		status: run.status === "error" ? "error" : "done",
		model: run.model,
		tokens: run.tokens,
		exitCode: run.exitCode,
		sessionFile: run.sessionFile,
		statusText: run.statusText,
		statusPhase: run.statusPhase,
		currentAction: run.currentAction,
		currentTool: run.currentTool,
		startedAt: run.startedAt,
		lastSteerAt: run.lastSteerAt,
		supervisorRequest: run.supervisorRequest,
		panel: run,
	};
}

/** 结构校验：custom 记录 details → 面板运行（不符返回 null） */
export function subagentPanelRunFromUnknown(value: unknown): SubagentPanelRun | null {
	const run = value as Partial<SubagentPanelRun> | null | undefined;
	if (
		!run ||
		typeof run.runId !== "string" ||
		typeof run.dispatchId !== "string" ||
		typeof run.agent !== "string" ||
		typeof run.task !== "string" ||
		typeof run.status !== "string"
	)
		return null;
	return {
		...run,
		runId: run.runId,
		dispatchId: run.dispatchId,
		parentSessionId: typeof run.parentSessionId === "string" ? run.parentSessionId : "",
		agent: run.agent,
		source: run.source === "user" || run.source === "project" ? run.source : "builtin",
		task: run.task,
		cwd: typeof run.cwd === "string" ? run.cwd : "",
		requiredTools: Array.isArray(run.requiredTools)
			? run.requiredTools.filter((tool): tool is string => typeof tool === "string")
			: [],
		followUp: run.followUp === true,
		status: run.status as SubagentPanelRunStatus,
		contextState:
			run.contextState === "pending" || run.contextState === "delivered" ? run.contextState : "none",
		createdAt: typeof run.createdAt === "number" ? run.createdAt : 0,
		pendingApprovalIds: Array.isArray(run.pendingApprovalIds)
			? run.pendingApprovalIds.filter((id): id is string => typeof id === "string")
			: [],
	};
}

/** 派发记录 details → 运行列表 */
export function subagentDispatchRecordFromUnknown(value: unknown): SubagentDispatchRecord | null {
	const record = value as Partial<SubagentDispatchRecord> | null | undefined;
	if (!record || typeof record.dispatchId !== "string" || !Array.isArray(record.runs)) return null;
	const runs = record.runs
		.map(subagentPanelRunFromUnknown)
		.filter((run): run is SubagentPanelRun => run !== null);
	return { v: 1, dispatchId: record.dispatchId, runs };
}

export function subagentResultRecordFromUnknown(value: unknown): SubagentResultRecord | null {
	const record = value as Partial<SubagentResultRecord> | null | undefined;
	const run = subagentPanelRunFromUnknown(record?.run);
	return run ? { v: 1, run } : null;
}
