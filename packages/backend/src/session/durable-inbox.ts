import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 持久化消息队列（借鉴 Pi Durable 的 pi.inbox：durable submissions，按 requestId 去重）。
 *
 * pi 的 followUp/steering 队列只在内存里，进程崩溃即丢。这里把“已受理、尚未进入上下文”的
 * 用户消息写到会话旁的 `<session>.inbox.json`（原子替换），在 queue_update 快照里消失即视为已投递。
 * 重开会话时把仍在队列里的消息恢复出来。
 */
export const INBOX_VERSION = 1 as const;
/** 未显式给 requestId 时，同一文本在该窗口内重复提交视为重发（双击、IPC 重试）。 */
export const IMPLICIT_DEDUP_WINDOW_MS = 10_000;
const DELIVERED_KEEP = 200;

export interface InboxItem {
	requestId: string;
	text: string;
	ts: number;
}

interface InboxState {
	version: typeof INBOX_VERSION;
	queued: InboxItem[];
	/** 最近已投递的 requestId（去重用，保留 200 条） */
	delivered: { requestId: string; ts: number }[];
}

export function inboxPath(sessionFile: string): string {
	return `${sessionFile}.inbox.json`;
}

export function implicitRequestId(text: string): string {
	return `implicit:${createHash("sha256").update(text).digest("hex").slice(0, 24)}`;
}

export class DurableInbox {
	private state: InboxState;
	readonly path: string;
	private readonly now: () => number;

	constructor(path: string, now: () => number = Date.now) {
		this.path = path;
		this.now = now;
		this.state = readInbox(path);
	}

	/** 当前仍在队列里的消息（按受理顺序）。 */
	pending(): InboxItem[] {
		return [...this.state.queued];
	}

	/**
	 * 受理一条消息。重复（同 requestId 已在队列中或最近已投递）返回 false，调用方不应再次投递。
	 * 未提供 requestId 时按文本哈希在短窗口内去重。
	 */
	accept(text: string, requestId?: string, queued = true): boolean {
		const id = requestId ?? implicitRequestId(text);
		const at = this.now();
		const window = requestId ? Number.POSITIVE_INFINITY : IMPLICIT_DEDUP_WINDOW_MS;
		const seen =
			this.state.queued.some((item) => item.requestId === id && at - item.ts < window) ||
			this.state.delivered.some((item) => item.requestId === id && at - item.ts < window);
		if (seen) return false;
		if (queued) this.state.queued.push({ requestId: id, text, ts: at });
		else this.markDelivered(id, at);
		this.save();
		return true;
	}

	/** pi 的 queue_update 快照：快照里已不存在的排队消息视为已进入上下文。 */
	sync(snapshot: readonly string[]): void {
		// pi 按先进先出投递：从最新的排队项往回匹配快照，未匹配上的（最早的）即已投递。
		const remaining = [...snapshot];
		const still: InboxItem[] = [];
		let changed = false;
		for (const item of [...this.state.queued].reverse()) {
			const index = remaining.lastIndexOf(item.text);
			if (index >= 0) {
				remaining.splice(index, 1);
				still.unshift(item);
			} else {
				this.markDelivered(item.requestId, this.now());
				changed = true;
			}
		}
		if (!changed) return;
		this.state.queued = still;
		this.save();
	}

	/** 取出全部待恢复消息并清空队列（恢复方负责重新投递）。 */
	drain(): InboxItem[] {
		const items = this.state.queued;
		if (!items.length) return [];
		this.state.queued = [];
		for (const item of items) this.markDelivered(item.requestId, this.now());
		this.save();
		return items;
	}

	private markDelivered(requestId: string, ts: number): void {
		this.state.delivered = [
			...this.state.delivered.filter((d) => d.requestId !== requestId),
			{ requestId, ts },
		].slice(-DELIVERED_KEEP);
	}

	private save(): void {
		mkdirSync(dirname(this.path), { recursive: true });
		const tmp = `${this.path}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(this.state)}\n`);
		renameSync(tmp, this.path);
	}
}

function readInbox(path: string): InboxState {
	const empty: InboxState = { version: INBOX_VERSION, queued: [], delivered: [] };
	if (!existsSync(path)) return empty;
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<InboxState>;
		if (raw.version !== INBOX_VERSION) return empty;
		return {
			version: INBOX_VERSION,
			queued: Array.isArray(raw.queued)
				? raw.queued.filter((i) => typeof i?.requestId === "string" && typeof i.text === "string")
				: [],
			delivered: Array.isArray(raw.delivered)
				? raw.delivered.filter((d) => typeof d?.requestId === "string")
				: [],
		};
	} catch {
		return empty;
	}
}

const inboxes = new Map<string, DurableInbox>();

/** 每个会话文件一个实例（同一进程内共享）。 */
export function inboxFor(sessionFile: string): DurableInbox {
	let inbox = inboxes.get(sessionFile);
	if (!inbox) {
		inbox = new DurableInbox(inboxPath(sessionFile));
		inboxes.set(sessionFile, inbox);
	}
	return inbox;
}

export function forgetInbox(sessionFile: string): void {
	inboxes.delete(sessionFile);
}

/** 事件观察：queue_update 驱动“已投递”判定。 */
export function observeInbox(
	sessionFile: string | undefined,
	event: { type: string; steering?: readonly string[]; followUp?: readonly string[] },
): void {
	if (!sessionFile || event.type !== "queue_update") return;
	try {
		inboxFor(sessionFile).sync([...(event.steering ?? []), ...(event.followUp ?? [])]);
	} catch {
		// 队列持久化失败不影响会话
	}
}
