import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolReplayPolicy } from "@drone/shared";

/**
 * 工具意图日志（借鉴 Pi Durable 的 “effect sandwich”）。
 *
 * 在工具真正执行之前，把“开始执行”这一意图同步写入并 fsync 到会话旁的
 * `<session>.intents.jsonl` 侧车文件；执行结束再追加一条 end 记录。进程在中途被杀时，
 * 下一个进程能据此知道哪些工具调用“已开始、未拿到结果”，再按重放策略处理。
 *
 * 不改写 pi 自己的会话 JSONL：侧车文件可以随时删除，旧会话没有侧车也照常打开。
 */
export const INTENT_JOURNAL_VERSION = 1 as const;
/** safe 工具保留原始参数用于重跑；超出上限只留哈希。 */
const MAX_ARGS_BYTES = 16 * 1024;

export interface ToolStartRecord {
	v: typeof INTENT_JOURNAL_VERSION;
	kind: "start";
	toolCallId: string;
	toolName: string;
	argsHash: string;
	replay: ToolReplayPolicy;
	/** 仅 safe 工具且大小在上限内时保存，用于重开后原样重跑 */
	args?: unknown;
	ts: number;
}

export interface ToolEndRecord {
	v: typeof INTENT_JOURNAL_VERSION;
	kind: "end";
	toolCallId: string;
	isError: boolean;
	ts: number;
}

export interface ToolOutputRecord {
	v: typeof INTENT_JOURNAL_VERSION;
	kind: "output";
	toolCallId: string;
	/** 截至此刻的累计部分输出（尾部截断） */
	text: string;
	ts: number;
}

export type IntentRecord = ToolStartRecord | ToolEndRecord | ToolOutputRecord;

export function intentJournalPath(sessionFile: string): string {
	return `${sessionFile}.intents.jsonl`;
}

/** 稳定序列化（键排序）后取 sha256，参数顺序不同但内容相同的调用得到同一哈希。 */
export function hashArgs(args: unknown): string {
	return createHash("sha256").update(stableStringify(args)).digest("hex").slice(0, 32);
}

export function stableStringify(value: unknown): string {
	if (value === undefined) return "null";
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined && typeof v !== "function")
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export class ToolIntentJournal {
	readonly path: string;
	private readonly now: () => number;

	// 不用参数属性：保持可被 node --experimental-strip-types 直接加载（崩溃注入测试）。
	constructor(path: string, now: () => number = Date.now) {
		this.path = path;
		this.now = now;
	}

	/** 同步追加并 fsync：返回时记录已落盘，之后工具才会执行。 */
	private append(record: IntentRecord, sync: boolean): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const fd = openSync(this.path, "a");
		try {
			writeSync(fd, `${JSON.stringify(record)}\n`);
			if (sync) fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	}

	start(input: {
		toolCallId: string;
		toolName: string;
		args: unknown;
		replay: ToolReplayPolicy;
	}): ToolStartRecord {
		const record: ToolStartRecord = {
			v: INTENT_JOURNAL_VERSION,
			kind: "start",
			toolCallId: input.toolCallId,
			toolName: input.toolName,
			argsHash: hashArgs(input.args),
			replay: input.replay,
			ts: this.now(),
		};
		if (input.replay === "safe") {
			const raw = stableStringify(input.args);
			if (Buffer.byteLength(raw) <= MAX_ARGS_BYTES) record.args = input.args;
		}
		this.append(record, true);
		return record;
	}

	end(toolCallId: string, isError: boolean): void {
		this.append({ v: INTENT_JOURNAL_VERSION, kind: "end", toolCallId, isError, ts: this.now() }, false);
	}

	output(toolCallId: string, text: string): void {
		this.append({ v: INTENT_JOURNAL_VERSION, kind: "output", toolCallId, text, ts: this.now() }, true);
	}
}

/** 读取侧车文件；容忍被截断的最后一行（崩溃时可能只写了一半）。 */
export function readIntentRecords(path: string): IntentRecord[] {
	if (!existsSync(path)) return [];
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return [];
	}
	const records: IntentRecord[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line) as IntentRecord;
			if (parsed?.v === INTENT_JOURNAL_VERSION && typeof parsed.toolCallId === "string") records.push(parsed);
		} catch {
			// torn tail
		}
	}
	return records;
}

export interface StartedTool {
	start: ToolStartRecord;
	ended: boolean;
	/** 最近一次刷盘的部分输出 */
	partialOutput?: string;
}

/** 按 toolCallId 汇总：每个已开始的调用、是否收到 end、最后一次部分输出。 */
export function summarizeIntents(records: IntentRecord[]): Map<string, StartedTool> {
	const calls = new Map<string, StartedTool>();
	for (const record of records) {
		if (record.kind === "start") calls.set(record.toolCallId, { start: record, ended: false });
		const call = calls.get(record.toolCallId);
		if (!call) continue;
		if (record.kind === "end") call.ended = true;
		if (record.kind === "output") call.partialOutput = record.text;
	}
	return calls;
}

interface ToolEventLike {
	type: string;
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	isError?: boolean;
}

/**
 * 会话事件观察器：tool_execution_start 在 pi 的 agent loop 里先于参数准备与执行被 await 发出，
 * 所以在这里同步落盘即可保证“意图先于效果”。写盘失败不能打断会话，只报告。
 */
export function createIntentObserver(
	journal: ToolIntentJournal,
	replayPolicy: (toolName: string) => ToolReplayPolicy,
	onError: (error: unknown) => void = () => {},
): (event: ToolEventLike) => void {
	return (event) => {
		try {
			if (event.type === "tool_execution_start" && event.toolCallId && event.toolName)
				journal.start({
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
					replay: replayPolicy(event.toolName),
				});
			else if (event.type === "tool_execution_end" && event.toolCallId)
				journal.end(event.toolCallId, event.isError === true);
		} catch (error) {
			onError(error);
		}
	};
}
