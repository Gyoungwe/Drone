import { createHash } from "node:crypto";

import type {
	MetacognitiveArtifact,
	MetacognitiveArtifactNumber,
	MetacognitiveSnapshot,
} from "./metacognitive-policy";

export type ReviewerSeverity = "low" | "medium" | "high";
export type ReviewerTrigger = "deliverable-write" | "milestone-complete" | "publication-projection";

export interface DeliverableReviewLocation {
	kind: "body" | "paragraph" | "line" | "artifact";
	paragraph?: number;
	line?: number;
	artifactId?: string;
	path?: string;
}

export interface DeliverableReviewFinding {
	id: string;
	code: "untraceable-number" | "figure-code-mismatch" | "citation-without-receipt" | "review-timeout" | "review-budget-exhausted";
	severity: ReviewerSeverity;
	location: DeliverableReviewLocation;
	detail: string;
	suggestion: string;
	handled: boolean;
	independent?: boolean;
	nonIndependentReason?: string;
}

export interface ReviewDeliverableRecord {
	id: string;
	path?: string;
	kind?: string;
	sha256?: string;
	attemptId?: string;
	receiptId?: string;
}

export interface ReviewAttemptRecord {
	id: string;
	artifactIds?: readonly string[];
	startedAt?: string;
	finishedAt?: string;
	/** Latest output hashes keyed by artifact id. */
	outputs?: readonly { artifactId: string; sha256: string }[];
	/** Compatibility shape used by inquiry/compute adapters. */
	artifactSha256?: Readonly<Record<string, string>>;
}

export interface ReviewReadReceipt {
	path: string;
	hash?: string;
	receiptRef?: string;
	text?: string;
	numbers?: readonly MetacognitiveArtifactNumber[];
}

export interface DeliverableReviewSnapshot extends MetacognitiveSnapshot {
	/** Public answer/deliverable body. `answer` is accepted as a compatibility alias. */
	body?: string;
	answer?: string;
	deliverables?: readonly ReviewDeliverableRecord[];
	attempts?: readonly ReviewAttemptRecord[];
	readReceipts?: readonly ReviewReadReceipt[];
	/** Optional explicit citations when the body is not available. */
	citations?: readonly string[];
}

export interface DeliverableReviewResult {
	contentHash: string;
	findings: readonly DeliverableReviewFinding[];
}

export interface ReviewerModelProvider {
	provider: string;
	model?: string;
}

export interface ReviewerProviderSelection {
	provider: string;
	model?: string;
	independent: boolean;
	nonIndependentReason?: string;
}

export interface BackgroundReviewerOptions {
	timeoutMs?: number;
	maxPerSession?: number;
	review?: (snapshot: DeliverableReviewSnapshot) => DeliverableReviewFinding[] | Promise<DeliverableReviewFinding[]>;
	/** Optional model-backed pass; the host selects the provider by provider id. */
	modelReview?: (
		snapshot: DeliverableReviewSnapshot,
		selection: ReviewerProviderSelection,
	) => DeliverableReviewFinding[] | Promise<DeliverableReviewFinding[]>;
	mainProvider?: string;
	providers?: readonly ReviewerModelProvider[];
	getProviders?: () => readonly ReviewerModelProvider[] | Promise<readonly ReviewerModelProvider[]>;
	useModel?: () => boolean | Promise<boolean>;
	onResult?: (sessionId: string, result: DeliverableReviewResult, trigger: ReviewerTrigger) => void | Promise<void>;
	now?: () => number;
}

export interface BackgroundReviewerBridge {
	schedule(request: BackgroundReviewRequest): void;
	getCached?(sessionId: string, snapshot: DeliverableReviewSnapshot): DeliverableReviewResult | undefined;
	getFindings?(sessionId: string): readonly DeliverableReviewFinding[];
	clearSession?(sessionId: string): void;
}

export interface BackgroundReviewRequest {
	sessionId: string;
	snapshot: DeliverableReviewSnapshot;
	trigger: ReviewerTrigger;
	mainProvider?: string;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_PER_SESSION = 32;
const NUMBER = /(?<![\w])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?%?/gi;
const CITATION = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

function bounded(value: unknown, max = 300): string {
	return String(value ?? "").replace(/[\r\n]+/g, " ").slice(0, max);
}

function normalizePath(path: string): string {
	const normalized = path.trim().replaceAll("\\", "/");
	return normalized.endsWith(".md") ? normalized : `${normalized}.md`;
}

function numericValue(token: string): number | null {
	const parsed = Number(token.replace(/%$/, ""));
	return Number.isFinite(parsed) ? parsed : null;
}

function numberMatches(token: string, value: unknown): boolean {
	const parsed = numericValue(token);
	if (parsed == null) return false;
	const candidate = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(candidate)) return false;
	const tolerance = Math.max(1e-9, Math.abs(candidate) * 1e-6);
	return Math.abs(parsed - candidate) <= tolerance;
}

function numberIsTraceable(token: string, artifacts: readonly MetacognitiveArtifact[], receipts: readonly ReviewReadReceipt[]): boolean {
	for (const artifact of artifacts) {
		if (artifact.numbers?.some((item) => numberMatches(token, item.value))) return true;
		if (typeof artifact.text === "string" && artifact.text.match(NUMBER)?.some((value) => numberMatches(token, value))) return true;
	}
	for (const receipt of receipts) {
		if (!receipt.receiptRef && !receipt.hash) continue;
		if (receipt.numbers?.some((item) => numberMatches(token, item.value))) return true;
		if (typeof receipt.text === "string" && receipt.text.match(NUMBER)?.some((value) => numberMatches(token, value))) return true;
	}
	return false;
}

function locationFor(body: string, offset: number, path?: string): DeliverableReviewLocation {
	const before = body.slice(0, offset);
	return {
		kind: "body",
		paragraph: before.split(/\n\s*\n/u).length,
		line: before.split("\n").length,
		...(path ? { path } : {}),
	};
}

function findingId(code: string, location: DeliverableReviewLocation, subject: string): string {
	return createHash("sha256")
		.update(`${code}\0${location.line ?? ""}\0${location.paragraph ?? ""}\0${location.artifactId ?? ""}\0${subject}`)
		.digest("hex")
		.slice(0, 24);
}

function citationPaths(
	body: string,
	explicit: readonly string[] | undefined,
	findings: DeliverableReviewSnapshot["findings"],
): string[] {
	const paths = new Set<string>(explicit ?? []);
	for (const match of body.matchAll(CITATION)) paths.add(normalizePath(match[1] ?? ""));
	for (const finding of findings ?? [])
		for (const path of finding.citationPaths ?? []) paths.add(normalizePath(path));
	return [...paths].filter(Boolean);
}

function latestAttemptFor(deliverable: ReviewDeliverableRecord, attempts: readonly ReviewAttemptRecord[]): ReviewAttemptRecord | undefined {
	const related = attempts.filter(
		(attempt) =>
			(deliverable.attemptId && attempt.id === deliverable.attemptId) ||
			attempt.artifactIds?.includes(deliverable.id),
	);
	return [...related].sort((left, right) => {
		const leftTime = left.finishedAt ?? left.startedAt ?? "";
		const rightTime = right.finishedAt ?? right.startedAt ?? "";
		return leftTime.localeCompare(rightTime);
	})[related.length - 1];
}

function attemptHash(attempt: ReviewAttemptRecord | undefined, artifactId: string): string | undefined {
	const output = attempt?.outputs?.find((item) => item.artifactId === artifactId)?.sha256;
	return output ?? attempt?.artifactSha256?.[artifactId];
}

function isFigure(deliverable: ReviewDeliverableRecord): boolean {
	return /^(figure|image|plot)$/i.test(deliverable.kind ?? "") || /\.(?:png|jpe?g|gif|svg|tiff?|webp)$/i.test(deliverable.path ?? "");
}

function reviewRules(snapshot: DeliverableReviewSnapshot): DeliverableReviewFinding[] {
	if (snapshot.enabled === false) return [];
	const body = snapshot.body ?? snapshot.answer ?? "";
	const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : [];
	const receipts = Array.isArray(snapshot.readReceipts) ? snapshot.readReceipts : [];
	const findings: DeliverableReviewFinding[] = [];
	const add = (finding: Omit<DeliverableReviewFinding, "id" | "handled">, subject: string) =>
		findings.push({ ...finding, id: findingId(finding.code, finding.location, subject), handled: false });

	for (const match of body.matchAll(NUMBER)) {
		const token = match[0];
		const offset = match.index ?? 0;
		if (numberIsTraceable(token, artifacts, receipts)) continue;
		add(
			{
				code: "untraceable-number",
				severity: "high",
				location: locationFor(body, offset),
				detail: `正文数字 ${bounded(token, 80)} 找不到交付物数值或带读回执的来源。`,
				suggestion: "补充对应产物数值或实际读取来源的回执，再保留该数字。",
			},
			token,
		);
	}

	for (const deliverable of Array.isArray(snapshot.deliverables) ? snapshot.deliverables : []) {
		if (!isFigure(deliverable)) continue;
		const location: DeliverableReviewLocation = {
			kind: "artifact",
			artifactId: deliverable.id,
			...(deliverable.path ? { path: deliverable.path } : {}),
		};
		const attempt = latestAttemptFor(deliverable, Array.isArray(snapshot.attempts) ? snapshot.attempts : []);
		if (!attempt) {
			add(
				{
					code: "figure-code-mismatch",
					severity: "high",
					location,
					detail: `图片产物 ${bounded(deliverable.id)} 没有关联 AttemptRecord。`,
					suggestion: "把图片绑定到最近一次产生它的 AttemptRecord，并保留产出哈希。",
				},
				deliverable.id,
			);
			continue;
		}
		const outputHash = attemptHash(attempt, deliverable.id);
		if (!SHA256.test(String(deliverable.sha256 ?? "")) || !SHA256.test(String(outputHash ?? "")) || deliverable.sha256?.toLowerCase() !== outputHash?.toLowerCase())
			add(
				{
					code: "figure-code-mismatch",
					severity: "high",
					location,
					detail: `图片产物 ${bounded(deliverable.id)} 的 sha256 与最近一次 AttemptRecord 产出不一致。`,
					suggestion: "重新核对图片和代码产出的哈希，或重新生成并绑定同一次尝试。",
				},
				deliverable.id,
			);
	}

	const receiptByPath = new Map(receipts.map((receipt) => [normalizePath(receipt.path), receipt]));
	for (const path of citationPaths(body, snapshot.citations, snapshot.findings)) {
		const receipt = receiptByPath.get(path);
		if (receipt?.receiptRef || receipt?.hash) continue;
		const artifact = artifacts.find((item) => normalizePath(item.path) === path && (item as MetacognitiveArtifact & { receiptId?: string }).receiptId);
		if (artifact) continue;
		const offset = body.indexOf(path.replace(/\.md$/i, ""));
		add(
			{
				code: "citation-without-receipt",
				severity: "medium",
				location: locationFor(body, offset >= 0 ? offset : 0, path),
				detail: `引用 ${bounded(path, 240)} 没有对应的读回执。`,
				suggestion: "先读取来源并保留当前内容哈希与回执，再引用该来源。",
			},
			path,
		);
	}
	return findings;
}

export function reviewDeliverable(snapshot: DeliverableReviewSnapshot): DeliverableReviewResult {
	const contentHash = reviewContentHash(snapshot);
	return { contentHash, findings: reviewRules(snapshot) };
}

/** Stable across object property order; evidence changes still invalidate the review. */
function reviewContentHash(snapshot: DeliverableReviewSnapshot): string {
	const stable = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(stable);
		if (value && typeof value === "object")
			return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
		return value;
	};
	return createHash("sha256").update(JSON.stringify(stable(snapshot ?? null))).digest("hex");
}

export function selectReviewerProvider(
	mainProvider: string | undefined,
	providers: readonly ReviewerModelProvider[],
): ReviewerProviderSelection | null {
	const configured = providers.filter((item) => typeof item.provider === "string" && item.provider.trim());
	if (!configured.length) return null;
	const independent = mainProvider ? configured.find((item) => item.provider !== mainProvider) : undefined;
	if (independent) return { provider: independent.provider, model: independent.model, independent: true };
	const fallback = configured[0];
	return {
		provider: fallback?.provider ?? "",
		model: fallback?.model,
		independent: false,
		nonIndependentReason: "非独立审稿：没有配置其他 provider。",
	};
}

export class BackgroundReviewer {
	private readonly timeoutMs: number;
	private readonly maxPerSession: number;
	private readonly review: NonNullable<BackgroundReviewerOptions["review"]>;
	private readonly modelReview?: BackgroundReviewerOptions["modelReview"];
	private readonly mainProvider?: string;
	private readonly providers: readonly ReviewerModelProvider[];
	private readonly getProviders?: BackgroundReviewerOptions["getProviders"];
	private readonly useModel?: BackgroundReviewerOptions["useModel"];
	private readonly onResult?: BackgroundReviewerOptions["onResult"];
	private readonly now: () => number;
	private readonly cache = new Map<string, Map<string, Promise<DeliverableReviewResult>>>();
	private readonly results = new Map<string, Map<string, DeliverableReviewResult>>();
	private readonly counts = new Map<string, number>();
	private readonly emitted = new Map<string, Set<string>>();
	private readonly latest = new Map<string, Map<string, readonly DeliverableReviewFinding[]>>();
	private disposed = false;

	constructor(options: BackgroundReviewerOptions = {}) {
		this.timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		this.maxPerSession = Math.max(1, options.maxPerSession ?? DEFAULT_MAX_PER_SESSION);
		this.review = options.review ?? ((snapshot) => reviewRules(snapshot));
		this.modelReview = options.modelReview;
		this.mainProvider = options.mainProvider;
		this.providers = options.providers ?? [];
		this.getProviders = options.getProviders;
		this.useModel = options.useModel;
		this.onResult = options.onResult;
		this.now = options.now ?? Date.now;
	}

	private timeoutFinding(code: "review-timeout" | "review-budget-exhausted"): DeliverableReviewFinding {
		return {
			id: `${code}-${this.now()}`,
			code,
			severity: "medium",
			location: { kind: "body" },
			detail: code === "review-timeout" ? "后台审稿超过单次时间上限。" : "本会话后台审稿预算已用尽。",
			suggestion: "保留交付物，稍后重新触发审稿或由人工核对。",
			handled: false,
		};
	}

	async reviewOnce(request: BackgroundReviewRequest): Promise<DeliverableReviewResult> {
		const contentHash = reviewContentHash(request.snapshot);
		const sessionCache = this.cache.get(request.sessionId) ?? new Map<string, Promise<DeliverableReviewResult>>();
		this.cache.set(request.sessionId, sessionCache);
		const cached = sessionCache.get(contentHash);
		if (cached) return cached;
		if ((this.counts.get(request.sessionId) ?? 0) >= this.maxPerSession) {
			const result = { contentHash, findings: [this.timeoutFinding("review-budget-exhausted")] };
			const promise = Promise.resolve(result);
			sessionCache.set(contentHash, promise);
			const resultCache = this.results.get(request.sessionId) ?? new Map<string, DeliverableReviewResult>();
			resultCache.set(contentHash, result);
			this.results.set(request.sessionId, resultCache);
			return promise;
		}
		this.counts.set(request.sessionId, (this.counts.get(request.sessionId) ?? 0) + 1);
		const promise = (async () => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const findings = await Promise.race([
					Promise.resolve().then(async () => {
						const ruleFindings = await this.review(request.snapshot);
						if (!this.modelReview || (this.useModel && !(await this.useModel()))) return ruleFindings;
						const providers = this.getProviders ? await this.getProviders() : this.providers;
						const selection = selectReviewerProvider(request.mainProvider ?? this.mainProvider, providers);
						if (!selection) return ruleFindings;
						const modelFindings = await this.modelReview(request.snapshot, selection);
						return selection.independent
							? [...ruleFindings, ...modelFindings]
							: [
									...ruleFindings,
									...modelFindings.map((finding) => ({
										...finding,
										independent: false,
										nonIndependentReason: selection.nonIndependentReason,
									})),
								];
					}),
					new Promise<DeliverableReviewFinding[]>((resolve) => {
						timer = setTimeout(() => resolve([this.timeoutFinding("review-timeout")]), this.timeoutMs);
					}),
				]);
				return { contentHash, findings };
			} catch {
				return { contentHash, findings: [this.timeoutFinding("review-timeout")] };
			} finally {
				if (timer) clearTimeout(timer);
			}
		})();
		sessionCache.set(contentHash, promise);
		void promise.then((result) => {
			if (this.disposed || this.cache.get(request.sessionId) !== sessionCache) return;
			const resultCache = this.results.get(request.sessionId) ?? new Map<string, DeliverableReviewResult>();
			resultCache.set(contentHash, result);
			this.results.set(request.sessionId, resultCache);
			const latest = this.latest.get(request.sessionId) ?? new Map<string, readonly DeliverableReviewFinding[]>();
			const targets = request.snapshot.deliverables?.map((item) => item.id) ?? [];
			for (const target of targets.length ? targets : ["body"]) latest.set(target, result.findings);
			this.latest.set(request.sessionId, latest);
		});
		return promise;
	}

	getCached(sessionId: string, snapshot: DeliverableReviewSnapshot): DeliverableReviewResult | undefined {
		const contentHash = reviewContentHash(snapshot);
		return this.results.get(sessionId)?.get(contentHash);
	}

	schedule(request: BackgroundReviewRequest): void {
		// Defer even the pure rules so the tool/event caller always returns first.
		setTimeout(() => {
			if (this.disposed) return;
			void this.reviewOnce(request).then((result) => {
				if (this.disposed) return;
				const emitted = this.emitted.get(request.sessionId) ?? new Set<string>();
				const key = result.findings[0]?.code === "review-budget-exhausted" ? "budget" : result.contentHash;
				if (emitted.has(key)) return;
				emitted.add(key);
				this.emitted.set(request.sessionId, emitted);
				return this.onResult?.(request.sessionId, result, request.trigger);
			}).catch(() => {});
		}, 0);
	}

	getFindings(sessionId: string): readonly DeliverableReviewFinding[] {
		return [...new Map([...this.latest.get(sessionId)?.values() ?? []].flat().map((finding) => [finding.id, finding])).values()];
	}

	clearSession(sessionId: string): void {
		this.cache.delete(sessionId);
		this.results.delete(sessionId);
		this.counts.delete(sessionId);
		this.emitted.delete(sessionId);
		this.latest.delete(sessionId);
	}

	dispose(): void {
		this.disposed = true;
		this.cache.clear();
		this.results.clear();
		this.counts.clear();
		this.emitted.clear();
		this.latest.clear();
	}
}
