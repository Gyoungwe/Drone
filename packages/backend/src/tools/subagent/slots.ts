import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** One application ceiling shared by generic native agents and knowledge specialists. */
const MAX_ACTIVE = 3,
	MAX_QUEUED = 32;
interface Waiter {
	key: string;
	limit: number;
	signal?: AbortSignal;
	resolve: () => void;
	reject: (e: Error) => void;
	abort: () => void;
}
let active = 0;
const byProject = new Map<string, number>(),
	queue: Waiter[] = [];
/** 本项目并发上限（.pi/research-workspace.json maxConcurrentSubagents ∈ 1–3，缺省 3）；面板「运行槽」展示同源 */
export async function nativeSubagentProjectLimit(cwd: string): Promise<number> {
	try {
		const config = JSON.parse(await readFile(join(cwd, ".pi/research-workspace.json"), "utf8"));
		return [1, 2, 3].includes(config.maxConcurrentSubagents) ? config.maxConcurrentSubagents : 3;
	} catch {
		return 3;
	}
}
function drain() {
	for (let i = 0; i < queue.length && active < MAX_ACTIVE; ) {
		const item = queue[i];
		if (!item) break;
		if ((byProject.get(item.key) || 0) >= item.limit) {
			i++;
			continue;
		}
		queue.splice(i, 1);
		item.signal?.removeEventListener("abort", item.abort);
		active++;
		byProject.set(item.key, (byProject.get(item.key) || 0) + 1);
		item.resolve();
	}
}
/** Waits for a slot like withNativeSubagentSlot; the returned release is idempotent. */
export async function acquireNativeSubagentSlot(
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<() => void> {
	signal?.throwIfAborted();
	const key = resolve(cwd),
		limit = await nativeSubagentProjectLimit(cwd);
	signal?.throwIfAborted();
	if (queue.length >= MAX_QUEUED) throw new Error("Native subagent queue is full");
	await new Promise<void>((resolveSlot, reject) => {
		const item: Waiter = {
			key,
			limit,
			signal,
			resolve: resolveSlot,
			reject,
			abort: () => {
				const at = queue.indexOf(item);
				if (at >= 0) {
					queue.splice(at, 1);
					reject(new Error("Native subagent cancelled while queued"));
					drain();
				}
			},
		};
		queue.push(item);
		signal?.addEventListener("abort", item.abort, { once: true });
		drain();
	});
	let released = false;
	return () => {
		if (released) return;
		released = true;
		active--;
		const count = (byProject.get(key) || 1) - 1;
		if (count) byProject.set(key, count);
		else byProject.delete(key);
		drain();
	};
}
export async function withNativeSubagentSlot<T>(
	cwd: string,
	signal: AbortSignal | undefined,
	work: () => Promise<T>,
): Promise<T> {
	const release = await acquireNativeSubagentSlot(cwd, signal);
	try {
		signal?.throwIfAborted();
		return await work();
	} finally {
		release();
	}
}
