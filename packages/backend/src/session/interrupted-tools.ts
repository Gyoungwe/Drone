import type { ToolReplayPolicy } from "@drone/shared";
import { intentJournalPath, readIntentRecords, type StartedTool, summarizeIntents } from "./intent-journal";

/**
 * 重开会话时的“中断工具”修复（借鉴 Pi Durable：reopen 时 running → pending，
 * safe 重跑，unsafe 报告“可能已部分执行”）。
 *
 * pi 的会话 JSONL 在进程被杀时停在带 toolCall 的 assistant 消息上，没有对应 toolResult。
 * 这里对照意图侧车文件，为每个悬空调用补一条 isError 的 toolResult，使转录合法，
 * 并把可安全重跑的调用交给只读恢复流程。
 */

interface ToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	arguments?: unknown;
}
interface MessageLike {
	role?: string;
	content?: unknown;
	toolCallId?: string;
}
interface EntryLike {
	type: string;
	message?: MessageLike;
}

export interface SessionManagerLike {
	getSessionFile(): string | undefined;
	getBranch(): EntryLike[];
	appendMessage(message: never): string;
}

export interface InterruptedToolCall {
	toolCallId: string;
	toolName: string;
	/** started = 意图日志里有 start 记录；false = 进程在工具开始前就退出了 */
	started: boolean;
	replay: ToolReplayPolicy;
	args?: unknown;
	argsHash?: string;
	partialOutput?: string;
	startedAt?: number;
}

const PARTIAL_OUTPUT_MAX = 8000;

/** 找出当前分支最后一条 assistant 消息里没有 toolResult 的工具调用。 */
export function findDanglingToolCalls(branch: EntryLike[]): ToolCallBlock[] {
	let lastAssistant = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		const message = entry?.type === "message" ? entry.message : undefined;
		if (message?.role === "assistant") {
			lastAssistant = i;
			break;
		}
		if (message?.role === "user") return [];
	}
	if (lastAssistant < 0) return [];
	const content = branch[lastAssistant]?.message?.content;
	const calls = Array.isArray(content)
		? (content as ToolCallBlock[]).filter(
				(block) => block?.type === "toolCall" && typeof block.id === "string",
			)
		: [];
	if (!calls.length) return [];
	const answered = new Set(
		branch
			.slice(lastAssistant + 1)
			.map((entry) => entry.message)
			.filter((m) => m?.role === "toolResult" && typeof m.toolCallId === "string")
			.map((m) => m?.toolCallId as string),
	);
	return calls.filter((call) => !answered.has(call.id));
}

export function classifyInterrupted(
	calls: ToolCallBlock[],
	intents: Map<string, StartedTool>,
	replayPolicy: (toolName: string) => ToolReplayPolicy,
): InterruptedToolCall[] {
	return calls.map((call) => {
		const intent = intents.get(call.id);
		const replay = intent?.start.replay ?? replayPolicy(call.name);
		return {
			toolCallId: call.id,
			toolName: call.name,
			started: !!intent,
			replay,
			...(replay === "safe" ? { args: intent?.start.args ?? call.arguments } : {}),
			...(intent ? { argsHash: intent.start.argsHash, startedAt: intent.start.ts } : {}),
			...(intent?.partialOutput ? { partialOutput: intent.partialOutput } : {}),
		};
	});
}

export function interruptedResultText(call: InterruptedToolCall): string {
	const head = !call.started
		? `[Drone] 工具 ${call.toolName} 在进程退出前尚未开始执行，没有产生任何效果。\nTool ${call.toolName} was not started before the process exited.`
		: call.replay === "safe"
			? `[Drone] 工具 ${call.toolName} 在上次进程退出时被中断。它声明为可安全重跑，恢复时会原样重新执行。\nTool ${call.toolName} was interrupted; it is replay-safe and will be re-run.`
			: `[Drone] 工具 ${call.toolName} 在上次进程退出时被中断，可能已经部分执行。不要直接重试：先核对它的效果（文件、导入、下载、写入）是否已经发生。\nTool ${call.toolName} was interrupted and may have partially run.`;
	if (!call.partialOutput) return head;
	const tail =
		call.partialOutput.length > PARTIAL_OUTPUT_MAX
			? `…${call.partialOutput.slice(-PARTIAL_OUTPUT_MAX)}`
			: call.partialOutput;
	return `${head}\n\n中断前已输出的部分 / partial output before the interruption:\n${tail}`;
}

/**
 * 为悬空调用补写 toolResult（写入会话文件），返回补写的调用。
 * 必须在 createAgentSession 之前用同一文件的 SessionManager 调用，新会话才会读到修复后的转录。
 */
export function repairInterruptedToolCalls(
	manager: SessionManagerLike,
	replayPolicy: (toolName: string) => ToolReplayPolicy,
	now: () => number = Date.now,
): InterruptedToolCall[] {
	const file = manager.getSessionFile();
	const dangling = findDanglingToolCalls(manager.getBranch());
	if (!dangling.length) return [];
	const intents = file ? summarizeIntents(readIntentRecords(intentJournalPath(file))) : new Map();
	const interrupted = classifyInterrupted(dangling, intents, replayPolicy);
	for (const call of interrupted) {
		manager.appendMessage({
			role: "toolResult",
			toolCallId: call.toolCallId,
			toolName: call.toolName,
			content: [{ type: "text", text: interruptedResultText(call) }],
			details: {
				droneInterrupted: {
					version: 1,
					started: call.started,
					replay: call.replay,
					...(call.argsHash ? { argsHash: call.argsHash } : {}),
				},
			},
			isError: true,
			timestamp: now(),
		} as never);
	}
	return interrupted;
}

/** 自动重跑只针对最近发生的中断，避免打开很久以前的旧会话时意外触发一轮模型调用。 */
export const AUTO_RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

export function shouldAutoResume(calls: InterruptedToolCall[], now = Date.now()): boolean {
	return calls.some(
		(call) => call.started && call.replay === "safe" && (call.startedAt ?? 0) > now - AUTO_RESUME_WINDOW_MS,
	);
}
