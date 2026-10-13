import { isUserAbortError } from "./errors";

/**
 * 运行中间态（P14，对应报告第 11 节）：11 态状态机 + 由 transcript 快照推导当前态 + 各态的文案规则。
 *
 * Idle → Optimistic → HostInit → Thinking ⇄ Planning → Running ⇄ AwaitingInput → Streaming → Delivered → Idle
 * Running / Thinking → Stopped → Idle；Running → Error → Running
 */
export const RUN_STATES = [
	"Idle",
	"Optimistic",
	"HostInit",
	"Thinking",
	"Planning",
	"Running",
	"AwaitingInput",
	"Streaming",
	"Delivered",
	"Stopped",
	"Error",
] as const;
export type RunState = (typeof RUN_STATES)[number];

const NEXT: Record<RunState, readonly RunState[]> = {
	Idle: ["Optimistic"],
	Optimistic: ["HostInit", "Stopped", "Error"],
	HostInit: ["Thinking", "Running", "Streaming", "Stopped", "Error"],
	Thinking: ["Planning", "Running", "Streaming", "Stopped", "Error"],
	Planning: ["Thinking", "Running", "Streaming", "Stopped", "Error"],
	Running: ["AwaitingInput", "Streaming", "Thinking", "Planning", "Stopped", "Error"],
	AwaitingInput: ["Running", "Stopped"],
	Streaming: ["Running", "Thinking", "Delivered", "Idle", "Stopped", "Error"],
	Delivered: ["Idle"],
	Stopped: ["Idle"],
	Error: ["Running", "Idle"],
};

export function canTransition(from: RunState, to: RunState): boolean {
	return from === to || NEXT[from].includes(to);
}

/** 非法转移抛错（开发期尽早暴露）；调用方在 UI 里可用 canTransition 软处理。 */
export function transition(from: RunState, to: RunState): RunState {
	if (!canTransition(from, to)) throw new Error(`illegal run-state transition ${from} → ${to}`);
	return to;
}

export interface RunSnapshot {
	/** 已发送、尚未收到 agent_start */
	pendingSend: boolean;
	agentActive: boolean;
	/** agent_start 后是否已收到首个模型事件 */
	firstEventSeen: boolean;
	thinking: boolean;
	/** 正在输出正文 */
	streamingText: boolean;
	runningTools: number;
	/** 本回合 todo 是否刚更新（计划条显示中且无工具在跑） */
	planning: boolean;
	pendingAsks: number;
	stopped: boolean;
	error: boolean;
	delivered: boolean;
}

/** 由快照推导当前态（优先级：等待输入 > 错误 > 停止 > …）。 */
export function deriveRunState(s: RunSnapshot): RunState {
	if (s.pendingAsks > 0 && s.agentActive) return "AwaitingInput";
	if (s.error) return "Error";
	if (s.stopped) return "Stopped";
	if (!s.agentActive) {
		if (s.pendingSend) return "Optimistic";
		return s.delivered ? "Delivered" : "Idle";
	}
	if (!s.firstEventSeen) return "HostInit";
	if (s.runningTools > 0) return "Running";
	if (s.streamingText) return "Streaming";
	if (s.thinking) return "Thinking";
	if (s.planning) return "Planning";
	return "Thinking";
}

/** 思考计时：进行中「思考中 Ns」，结束定格「深度思考 X.Xs」。 */
export function thinkingLabel(startedAt: number, endedAt: number | null, now: number, zh: boolean): string {
	if (endedAt == null) {
		const s = Math.max(0, Math.floor((now - startedAt) / 1000));
		return zh ? `思考中 ${s}s` : `Thinking ${s}s`;
	}
	const s = Math.max(0, (endedAt - startedAt) / 1000).toFixed(1);
	return zh ? `深度思考 ${s}s` : `Thought for ${s}s`;
}

export interface PlanItem {
	content: string;
	status: "pending" | "in_progress" | "completed" | string;
}

/** 计划条：「下一步：X n/N」，全部完成「全部步骤已完成 N/N」；没有计划返回 null。 */
export function planBarLabel(items: readonly PlanItem[], zh: boolean): string | null {
	if (!items.length) return null;
	const done = items.filter((i) => i.status === "completed").length;
	const total = items.length;
	if (done === total) return zh ? `全部步骤已完成 ${total}/${total}` : `All steps done ${total}/${total}`;
	const next = items.find((i) => i.status === "in_progress") ?? items.find((i) => i.status !== "completed");
	return zh
		? `下一步：${next?.content ?? ""} ${done + 1}/${total}`
		: `Next: ${next?.content ?? ""} ${done + 1}/${total}`;
}

const VERBS: Record<string, [string, string]> = {
	read: ["读取", "Read"],
	write: ["写入", "Write"],
	edit: ["编辑", "Edit"],
	bash: ["运行", "Run"],
	powershell: ["运行", "Run"],
	grep: ["搜索", "Search"],
	find: ["查找", "Find"],
	ls: ["列出", "List"],
	webfetch: ["抓取", "Fetch"],
	web_search: ["搜索", "Search"],
	subagent: ["派发", "Dispatch"],
	deliver_files: ["交付", "Deliver"],
	memory_save: ["记住", "Remember"],
};

function objectOf(args: Record<string, unknown>): string {
	for (const k of ["path", "file_path", "filePath", "pattern", "url", "query", "command", "agent"]) {
		const v = args[k];
		if (typeof v === "string" && v.trim()) {
			const s = v.trim();
			const short = k.toLowerCase().includes("path") ? (s.split(/[\\/]/).pop() ?? s) : s;
			return short.length > 48 ? `${short.slice(0, 47)}…` : short;
		}
	}
	return "";
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

/** 步骤行：动词 +「对象」+ 耗时。 */
export function stepLabel(
	tool: { name: string; args: Record<string, unknown>; durationMs?: number },
	zh: boolean,
): string {
	const verb = VERBS[tool.name]?.[zh ? 0 : 1] ?? tool.name;
	const obj = objectOf(tool.args);
	const dur = tool.durationMs != null ? ` · ${formatDuration(tool.durationMs)}` : "";
	return `${verb}${obj ? (zh ? `「${obj}」` : ` “${obj}”`) : ""}${dur}`;
}

/** 步骤组头：进行中「正在运行 N 个步骤」，结束折叠为「N 个步骤」。 */
export function stepGroupHeader(count: number, running: boolean, zh: boolean): string {
	if (zh) return running ? `正在运行 ${count} 个步骤` : `${count} 个步骤`;
	return running
		? `Running ${count} step${count === 1 ? "" : "s"}`
		: `${count} step${count === 1 ? "" : "s"}`;
}

/** 窗口标题 `(n)` 前缀；n=0 去掉前缀。幂等。 */
export function attentionTitle(base: string, count: number): string {
	const clean = base.replace(/^\(\d+\)\s*/, "");
	return count > 0 ? `(${count}) ${clean}` : clean;
}

/** 写文件类工具结束后自动在右栏打开的目标路径（Streaming 态）。 */
export function writtenPath(toolName: string, args: unknown): string | null {
	if (!["write", "edit", "multi_edit", "notebook_edit"].includes(toolName)) return null;
	const a = (args ?? {}) as Record<string, unknown>;
	const p = a.path ?? a.file_path ?? a.filePath;
	return typeof p === "string" && p.trim() ? p : null;
}

/** 侧栏「进行中」分组：运行中 / 等待输入的会话排在顶部，其余保持原顺序。 */
export function groupRunningFirst<T>(
	items: readonly T[],
	isRunning: (item: T) => boolean,
): { running: T[]; rest: T[] } {
	const running: T[] = [];
	const rest: T[] = [];
	for (const item of items) (isRunning(item) ? running : rest).push(item);
	return { running, rest };
}

/** Optimistic：客户端在发送前生成的两个 id，随 prompt 一起发出并由回执原样带回，用于对账。 */
export interface PromptIds {
	clientMessageId: string;
	assistantMessageId: string;
}

function uuid(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	if (c?.randomUUID) return c.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function newPromptIds(): PromptIds {
	return { clientMessageId: `u-${uuid()}`, assistantMessageId: `a-${uuid()}` };
}

/** 回执是否与本次发送的 id 一致（旧后端不回 id 时视为一致，保持兼容）。 */
export function receiptMatches(
	receipt: { clientMessageId?: string; assistantMessageId?: string } | null | undefined,
	ids: PromptIds,
): boolean {
	if (!receipt || receipt.clientMessageId === undefined) return true;
	return (
		receipt.clientMessageId === ids.clientMessageId && receipt.assistantMessageId === ids.assistantMessageId
	);
}

/** Stopped：一轮是否被用户停止（SDK 用 stopReason=aborted，或 error + 中止文案）。 */
export function isStoppedTurn(stopReason: unknown, errorMessage: unknown): boolean {
	if (stopReason === "aborted") return true;
	return stopReason === "error" && typeof errorMessage === "string" && isUserAbortError(errorMessage);
}
