import { randomUUID } from "node:crypto";
import type {
	DailyDiscoveryIdea,
	DailyDiscoveryOutcome,
	DailyDiscoveryRadarPaper,
	DailyDiscoveryState,
	ResearchConnectorHit,
	ResearchSearchResponse,
} from "@drone/shared";
import type { DailyIdea, DiscoveryNote } from "@gyoungwe/pi-knowledge/host";
import {
	buildDailyDiscoveryMessage,
	DAILY_DISCOVERY_SYSTEM,
	parseDailyIdeas,
} from "@gyoungwe/pi-knowledge/host";
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
	radar: DailyDiscoveryRadarPaper[];
	/** 最近一次运行的结果说明（界面据此解释「为什么没有新想法」） */
	lastOutcome?: DailyDiscoveryOutcome;
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

const defaultState = (): StoredState => ({ version: 1, enabled: true, lastRunAt: 0, ideas: [], radar: [] });

export interface DailyDiscoveryTopic {
	id: string;
	title: string;
	aliases?: string[];
	entities?: string[];
	sources?: string[];
}

export interface DailyDiscoveryContext {
	bound: boolean;
	fresh: DiscoveryNote[];
	related: DiscoveryNote[];
	topics?: DailyDiscoveryTopic[];
	zoteroSeeds?: string[];
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
	/** Literature radar search; disabled connectors are represented in failures. */
	radarSearch?: (
		query: string,
		connectorIds: readonly string[],
		limit: number,
	) => Promise<ResearchSearchResponse>;
	/** Optional Semantic Scholar recommendation lookup for DOI seeds. */
	radarRecommend?: (seed: string) => Promise<ResearchSearchResponse>;
	/** Capture a radar item through the host research capture flow. */
	captureRadarPaper?: (paper: DailyDiscoveryRadarPaper) => Promise<{ path: string }>;
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
			lastOutcome: state.lastOutcome ?? null,
			ideas: state.ideas.filter((idea) => idea.status !== "dismissed"),
			radar: (state.radar ?? []).filter((paper) => paper.status !== "dismissed"),
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
		if (!context.bound) {
			await this.store.update((draft) => {
				draft.lastOutcome = { kind: "not-bound", at: startedAt };
			});
			return this.getState();
		}
		const radarOutcome = await this.runRadar(context, startedAt);
		if (!context.fresh.length) {
			this.lastError = null;
			await this.store.update((draft) => {
				draft.lastRunAt = startedAt;
				draft.lastOutcome = radarOutcome ?? { kind: "no-new-notes", at: startedAt, since };
			});
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
			draft.lastOutcome = radarOutcome ?? {
				kind: "ran",
				at: startedAt,
				notes: context.fresh.length,
				added: 0,
			};
			const known = new Set(draft.ideas.map((idea) => idea.title.toLowerCase()));
			for (const idea of ideas) {
				if (known.has(idea.title.toLowerCase())) continue;
				draft.ideas.unshift({ ...idea, id: randomUUID(), createdAt: startedAt, status: "new" });
				added++;
			}
			draft.ideas = draft.ideas.slice(0, MAX_STORED_IDEAS);
			if (draft.lastOutcome?.kind === "ran") draft.lastOutcome.added = added;
		});
		if (added) this.options.notify(`每日发现：根据最近更新的笔记提出了 ${added} 条新想法，去知识库查看。`);
		return this.getState();
	}

	private async runRadar(
		context: DailyDiscoveryContext,
		startedAt: number,
	): Promise<Extract<DailyDiscoveryOutcome, { kind: `radar-${string}` }> | null> {
		if (!this.options.radarSearch) return null;
		const topics = (context.topics ?? []).filter((topic) => topic.title.trim());
		if (!topics.length) return { kind: "radar-no-active-topics", at: startedAt };
		const connectorIds = ["openalex", "pubmed", "europe-pmc", "arxiv", "semantic-scholar"] as const;
		const queries: Array<{ topic: DailyDiscoveryTopic; query: string }> = [];
		for (const topic of topics) {
			const terms = [topic.title, ...(topic.aliases ?? []), ...(topic.entities ?? [])]
				.map((value) => value.trim())
				.filter(Boolean);
			const unique = [...new Set(terms)];
			for (const query of unique.slice(0, 2)) queries.push({ topic, query });
		}
		const limitedQueries = queries.slice(0, 12);
		const responses = await Promise.all(
			limitedQueries.map(async ({ topic, query }) => ({
				topic,
				response: await this.options.radarSearch?.(query, connectorIds, 10),
			})),
		);
		const failures = responses.flatMap(({ response }) => response?.failures ?? []);
		if (failures.some((failure) => failure.retryable)) {
			throw new Error("Literature radar connector is temporarily unavailable; retry later");
		}
		const usableResponses = responses.filter(({ response }) => response?.complete);
		if (usableResponses.length === 0 && failures.length > 0)
			return { kind: "radar-connectors-disabled", at: startedAt };
		const byKey = new Map<string, DailyDiscoveryRadarPaper>();
		const existing = await this.store.read();
		for (const paper of existing.radar ?? []) byKey.set(radarKey(paper), paper);
		const recentCutoff = startedAt - FIRST_LOOKBACK_MS;
		for (const { topic, response } of responses) {
			for (const hit of response?.hits ?? []) {
				if (!isRecentHit(hit, recentCutoff)) continue;
				const key = radarHitKey(hit);
				const previous = byKey.get(key);
				const paper = toRadarPaper(hit, topic, startedAt, previous);
				byKey.set(key, mergeRadarPaper(previous, paper));
			}
		}
		for (const seed of (context.zoteroSeeds ?? []).slice(0, 12)) {
			const response = await this.options.radarRecommend?.(seed);
			for (const hit of response?.hits ?? []) {
				if (!isRecentHit(hit, recentCutoff)) continue;
				const key = radarHitKey(hit);
				const previous = byKey.get(key);
				byKey.set(key, mergeRadarPaper(previous, toRadarPaper(hit, undefined, startedAt, previous)));
			}
		}
		const before = new Set((existing.radar ?? []).map(radarKey));
		const ranked = [...byKey.values()].sort(
			(a, b) => radarScore(b) - radarScore(a) || b.discoveredAt - a.discoveredAt,
		);
		const sorted = [
			...ranked.filter((paper) => before.has(radarKey(paper))).slice(0, 40),
			...ranked.filter((paper) => !before.has(radarKey(paper))).slice(0, 10),
		];
		const added = sorted.filter((paper) => !before.has(radarKey(paper)) && paper.status === "new").length;
		await this.store.update((draft) => {
			draft.radar = sorted;
			draft.lastOutcome = {
				kind: added ? "radar-ran" : "radar-no-new-papers",
				at: startedAt,
				...(added ? { added } : {}),
			} as DailyDiscoveryOutcome;
		});
		if (added) this.options.notify(`新文献雷达：发现了 ${added} 篇近期文献，去知识库查看。`);
		return added
			? { kind: "radar-ran", at: startedAt, added }
			: { kind: "radar-no-new-papers", at: startedAt };
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

	async decideRadarPaper(id: string, action: "capture" | "dismiss"): Promise<DailyDiscoveryState> {
		const state = await this.store.read();
		const paper = (state.radar ?? []).find((item) => item.id === id);
		if (!paper) throw new Error("Radar paper not found");
		if (action === "capture") {
			if (!this.options.captureRadarPaper) throw new Error("Radar capture is unavailable");
			await this.options.captureRadarPaper(paper);
		}
		await this.store.update((draft) => {
			const target = (draft.radar ?? []).find((item) => item.id === id);
			if (target) target.status = action === "capture" ? "captured" : "dismissed";
		});
		return this.getState();
	}
}

function normalizeTitle(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

function radarHitKey(hit: ResearchConnectorHit): string {
	if (hit.doi) return `doi:${normalizeDoiValue(hit.doi)}`;
	if (hit.arxivId) return `arxiv:${hit.arxivId.toLocaleLowerCase()}`;
	return `title:${normalizeTitle(hit.title)}`;
}

function radarKey(paper: DailyDiscoveryRadarPaper): string {
	if (paper.doi) return `doi:${normalizeDoiValue(paper.doi)}`;
	if (paper.arxivId) return `arxiv:${paper.arxivId.toLocaleLowerCase()}`;
	return `title:${normalizeTitle(paper.title)}`;
}

function normalizeDoiValue(value: string): string {
	return value
		.trim()
		.toLocaleLowerCase()
		.replace(/^https?:\/\/doi\.org\//u, "")
		.replace(/^doi:\s*/u, "");
}

function isRecentHit(hit: ResearchConnectorHit, cutoff: number): boolean {
	return (
		!hit.publishedAt || Number.isNaN(Date.parse(hit.publishedAt)) || Date.parse(hit.publishedAt) >= cutoff
	);
}

function toRadarPaper(
	hit: ResearchConnectorHit,
	topic: DailyDiscoveryTopic | undefined,
	discoveredAt: number,
	previous?: DailyDiscoveryRadarPaper,
): DailyDiscoveryRadarPaper {
	return {
		id: previous?.id ?? randomUUID(),
		title: hit.title,
		authors: [...(hit.authors ?? [])],
		year: hit.year ?? null,
		doi: hit.doi,
		arxivId: hit.arxivId,
		publishedAt: hit.publishedAt,
		locator: hit.locator,
		sourceConnectors: [hit.id.split(":", 1)[0] ?? hit.sourceType],
		matchedTopicIds: topic ? [topic.id] : [],
		matchedTopicTitles: topic ? [topic.title] : [],
		relatedVaultPaths: topic?.sources ?? [],
		discoveredAt: previous?.discoveredAt ?? discoveredAt,
		status: previous?.status ?? "new",
	};
}

function mergeRadarPaper(
	previous: DailyDiscoveryRadarPaper | undefined,
	next: DailyDiscoveryRadarPaper,
): DailyDiscoveryRadarPaper {
	if (!previous) return next;
	return {
		...previous,
		authors: [...new Set([...previous.authors, ...next.authors])],
		sourceConnectors: [...new Set([...previous.sourceConnectors, ...next.sourceConnectors])],
		matchedTopicIds: [...new Set([...previous.matchedTopicIds, ...next.matchedTopicIds])],
		matchedTopicTitles: [...new Set([...previous.matchedTopicTitles, ...next.matchedTopicTitles])],
		relatedVaultPaths: [...new Set([...previous.relatedVaultPaths, ...next.relatedVaultPaths])],
	};
}

function radarScore(paper: DailyDiscoveryRadarPaper): number {
	return paper.matchedTopicIds.length + (paper.sourceConnectors.includes("semantic-scholar") ? 1 : 0);
}
