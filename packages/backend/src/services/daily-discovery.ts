import { randomUUID } from "node:crypto";
import type { DailyIdea, DiscoveryNote } from "@drone/knowledge/daily-discovery";
import {
	buildDailyDiscoveryMessage,
	DAILY_DISCOVERY_SYSTEM,
	parseDailyIdeas,
} from "@drone/knowledge/daily-discovery-prompt";
import type { DailyDiscoveryIdea, DailyDiscoveryState } from "@drone/shared";
import { JsonStore } from "../json-store";
import { createLogger } from "../log";

const log = createLogger("daily-discovery");
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_LOOKBACK_MS = 7 * DAY_MS;
const MAX_STORED_IDEAS = 30;

interface StoredState {
	version: 1;
	enabled: boolean;
	lastRunAt: number;
	ideas: DailyDiscoveryIdea[];
}

/**
 * 模型回复 → 文本。出错或被中止时抛出（带模型错误信息），没有文本时返回 null；
 * 两种情况本次都不计为已运行，下个整点重试，避免一次网络/凭证故障把当天的发现吞掉。
 */
export function completionText(response: {
	content?: unknown;
	stopReason?: unknown;
	errorMessage?: unknown;
}): string | null {
	if (response.stopReason === "error" || response.stopReason === "aborted") {
		throw new Error(
			String(response.errorMessage || `model call ${String(response.stopReason)}`).slice(0, 300),
		);
	}
	const text = Array.isArray(response.content)
		? response.content
				.map((item) => (item && typeof item === "object" && "text" in item ? String(item.text ?? "") : ""))
				.join("\n")
		: "";
	return text.trim() ? text : null;
}

const defaultState = (): StoredState => ({ version: 1, enabled: true, lastRunAt: 0, ideas: [] });

export interface DailyDiscoveryContext {
	bound: boolean;
	fresh: DiscoveryNote[];
	related: DiscoveryNote[];
}

export interface DailyDiscoveryOptions {
	path: string;
	/** 读知识库：上次运行后更新的笔记 + 相关旧笔记（knowledge ui-service） */
	context(sinceMs: number): Promise<DailyDiscoveryContext>;
	/** 把认可的想法存为 Library/Ideas 笔记 */
	saveIdea(idea: DailyIdea): Promise<{ path: string }>;
	/** 一次模型调用；返回模型原文。没有可用模型时返回 null（本次跳过，不计为已运行） */
	complete(system: string, message: string): Promise<string | null>;
	/** 有新想法时通知界面 */
	notify(text: string): void;
	now?: () => number;
}

/**
 * 每日发现（默认开，每天一次）：上次运行后知识库有更新时，拿新笔记与相关旧笔记做一次新旧对照，
 * 最多保留 3 条有依据、可检验的新想法，放在知识库主页等用户保存或忽略。
 */
export class DailyDiscoveryService {
	private readonly store: JsonStore<StoredState>;
	private timer: ReturnType<typeof setInterval> | null = null;
	private running: Promise<DailyDiscoveryState> | null = null;
	/** 最近一次运行失败的原因（只在内存里，给「现在看看」按钮反馈；成功或跳过后清空） */
	private lastError: string | null = null;
	private readonly now: () => number;

	constructor(private readonly options: DailyDiscoveryOptions) {
		this.store = new JsonStore<StoredState>({
			path: options.path,
			storageId: "agent-daily-discovery",
			defaultValue: defaultState,
		});
		this.now = options.now ?? Date.now;
	}

	/** 启动后一分钟检查一次，之后每小时检查；满 24 小时才真正运行 */
	start(): void {
		if (this.timer) return;
		const tick = () => void this.runIfDue().catch((error) => log.warn("daily discovery failed", error));
		setTimeout(tick, 60_000).unref?.();
		this.timer = setInterval(tick, CHECK_INTERVAL_MS);
		this.timer.unref?.();
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	async getState(): Promise<DailyDiscoveryState> {
		const state = await this.store.read();
		return {
			enabled: state.enabled,
			lastRunAt: state.lastRunAt || null,
			lastError: this.lastError,
			ideas: state.ideas.filter((idea) => idea.status !== "dismissed"),
		};
	}

	async setEnabled(enabled: boolean): Promise<DailyDiscoveryState> {
		await this.store.update((draft) => {
			draft.enabled = enabled === true;
		});
		return this.getState();
	}

	async runIfDue(): Promise<DailyDiscoveryState> {
		const state = await this.store.read();
		if (!state.enabled || this.now() - state.lastRunAt < DAY_MS) return this.getState();
		return this.run();
	}

	/** 立即运行一次（「现在看看」按钮也走这里）；并发调用复用同一次运行 */
	run(): Promise<DailyDiscoveryState> {
		this.running ??= this.runOnce().finally(() => {
			this.running = null;
		});
		return this.running;
	}

	private async runOnce(): Promise<DailyDiscoveryState> {
		const startedAt = this.now();
		const state = await this.store.read();
		const since = state.lastRunAt || startedAt - FIRST_LOOKBACK_MS;
		const context = await this.options.context(since);
		if (!context.bound) return this.getState();
		if (!context.fresh.length) {
			this.lastError = null;
			await this.markRun(startedAt);
			return this.getState();
		}
		let reply: string | null;
		try {
			reply = await this.options.complete(
				DAILY_DISCOVERY_SYSTEM,
				buildDailyDiscoveryMessage(context.fresh, context.related),
			);
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			log.warn("daily discovery model call failed", { error: this.lastError });
			return this.getState();
		}
		if (reply === null) {
			this.lastError = "No usable model is configured";
			return this.getState();
		}
		this.lastError = null;
		const ideas = parseDailyIdeas(
			reply,
			[...context.fresh, ...context.related].map((note) => note.path),
			context.fresh.map((note) => note.path),
		);
		let added = 0;
		await this.store.update((draft) => {
			draft.lastRunAt = startedAt;
			const known = new Set(draft.ideas.map((idea) => idea.title.toLowerCase()));
			for (const idea of ideas) {
				if (known.has(idea.title.toLowerCase())) continue;
				draft.ideas.unshift({ ...idea, id: randomUUID(), createdAt: startedAt, status: "new" });
				added++;
			}
			draft.ideas = draft.ideas.slice(0, MAX_STORED_IDEAS);
		});
		if (added) this.options.notify(`每日发现：根据最近更新的笔记提出了 ${added} 条新想法，去知识库查看。`);
		return this.getState();
	}

	private async markRun(at: number): Promise<void> {
		await this.store.update((draft) => {
			draft.lastRunAt = at;
		});
	}

	async decide(id: string, action: "save" | "dismiss"): Promise<DailyDiscoveryState> {
		const state = await this.store.read();
		const idea = state.ideas.find((item) => item.id === id);
		if (!idea) throw new Error("Idea not found");
		if (action === "save" && idea.status !== "saved") {
			const saved = await this.options.saveIdea(idea);
			await this.store.update((draft) => {
				const target = draft.ideas.find((item) => item.id === id);
				if (target) Object.assign(target, { status: "saved", savedPath: saved.path });
			});
		} else if (action === "dismiss") {
			await this.store.update((draft) => {
				const target = draft.ideas.find((item) => item.id === id);
				if (target) target.status = "dismissed";
			});
		}
		return this.getState();
	}
}
