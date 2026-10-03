import { randomUUID } from "node:crypto";
import { assertValid, boundedInteger, finiteNonNegative, isoDate, nonEmptyText, safeId } from "./validation";

export interface EvaluationCase {
	readonly id: string;
	readonly expectedFindingIds: readonly string[];
	readonly observedFindingIds: readonly string[];
	readonly verificationTimeMs?: number;
}
export interface EvaluationMetric {
	readonly name:
		| "bixbench"
		| "bixbench-regression"
		| "rediscovery-rate"
		| "inconsistency-rejection-rate"
		| "inconsistency-interception-rate"
		| "confounding-detection-rate"
		| "confounder-detection-rate"
		| "clue-hit-rate"
		| "verification-time-ms"
		| "repeated-failure-count";
	readonly value: number;
	readonly denominator?: number;
	readonly measuredAt: string;
	readonly baseline?: number;
}
export function rate(numerator: number, denominator: number): number {
	if (
		!Number.isFinite(numerator) ||
		!Number.isFinite(denominator) ||
		numerator < 0 ||
		denominator <= 0 ||
		numerator > denominator
	)
		throw new Error("invalid rate inputs");
	return numerator / denominator;
}
export function evaluateRediscovery(
	cases: readonly EvaluationCase[],
	now = new Date().toISOString(),
): EvaluationMetric {
	const hits = cases.filter((item) =>
		item.expectedFindingIds.every((id) => item.observedFindingIds.includes(id)),
	).length;
	return {
		name: "rediscovery-rate",
		value: cases.length ? rate(hits, cases.length) : 0,
		denominator: cases.length,
		measuredAt: now,
	};
}
export function evaluateConfoundingDetection(
	cases: readonly EvaluationCase[],
	now = new Date().toISOString(),
): EvaluationMetric {
	const hits = cases.filter((item) =>
		item.expectedFindingIds.some((id) => item.observedFindingIds.includes(id)),
	).length;
	return {
		name: "confounding-detection-rate",
		value: cases.length ? rate(hits, cases.length) : 0,
		denominator: cases.length,
		measuredAt: now,
	};
}
export function evaluateInconsistencyRejection(
	rejected: number,
	total: number,
	now = new Date().toISOString(),
): EvaluationMetric {
	return {
		name: "inconsistency-rejection-rate",
		value: total ? rate(rejected, total) : 0,
		denominator: total,
		measuredAt: now,
	};
}
export function evaluateClueHitRate(
	hit: number,
	total: number,
	now = new Date().toISOString(),
): EvaluationMetric {
	return { name: "clue-hit-rate", value: total ? rate(hit, total) : 0, denominator: total, measuredAt: now };
}
export function evaluateVerificationTime(
	cases: readonly EvaluationCase[],
	now = new Date().toISOString(),
): EvaluationMetric {
	const values = cases
		.map((item) => item.verificationTimeMs)
		.filter((value): value is number => value !== undefined && Number.isFinite(value) && value >= 0);
	return {
		name: "verification-time-ms",
		value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
		denominator: values.length,
		measuredAt: now,
	};
}
export function evaluationBaselines(): readonly EvaluationMetric[] {
	return [
		"bixbench",
		"rediscovery-rate",
		"inconsistency-rejection-rate",
		"confounding-detection-rate",
		"clue-hit-rate",
		"verification-time-ms",
		"repeated-failure-count",
	].map((name) => ({ name: name as EvaluationMetric["name"], value: 0, measuredAt: "baseline-not-run" }));
}

export type EvaluationMetricName =
	| "bixbench-regression"
	| "rediscovery-rate"
	| "inconsistency-rejection-rate"
	| "inconsistency-interception-rate"
	| "confounder-detection-rate"
	| "verification-time-ms"
	| "clue-hit-rate"
	| "repeated-failure-count";
export interface EvaluationItem {
	readonly id: string;
	readonly metric: EvaluationMetricName;
	readonly datasetId: string;
	readonly datasetRevision: string;
	readonly datasetStatus: "fixture" | "external" | "missing";
	readonly description: string;
}
export interface EvaluationResult {
	readonly status: "complete" | "needs-data" | "blocked";
	readonly metrics: readonly {
		readonly id: string;
		readonly metric: EvaluationMetricName;
		readonly value: number;
		readonly passed: boolean;
	}[];
	readonly missingData: readonly string[];
	readonly blockedCases: readonly string[];
}
export function metricDescription(metric: EvaluationMetricName | DiscoveryEvaluationMetric): string {
	return metric === "repeated-failure-count"
		? "count of repeated failure signatures"
		: metric.replaceAll("-", " ");
}

export const DISCOVERY_EVALUATION_METRICS = [
	"bixbench-regression",
	"rediscovery-rate",
	"inconsistency-interception-rate",
	"confounder-detection-rate",
	"clue-hit-rate",
	"verification-time-ms",
	"repeated-failure-count",
] as const;
export type DiscoveryEvaluationMetric = (typeof DISCOVERY_EVALUATION_METRICS)[number];
export interface DiscoveryEvaluationCase {
	readonly id: string;
	readonly metric: DiscoveryEvaluationMetric;
	readonly datasetId: string;
	readonly datasetRevision: string;
	readonly datasetStatus: "fixture" | "external" | "missing";
	readonly description: string;
}
export interface DiscoveryEvaluationObservation {
	readonly value: number;
	readonly passed?: boolean;
	readonly verificationTimeMs?: number;
	readonly evidence?: readonly string[];
}
export interface DiscoveryBaselineRecord {
	readonly id?: string;
	readonly metric: DiscoveryEvaluationMetric;
	readonly datasetId: string;
	readonly datasetRevision: string;
	readonly value: number;
	readonly unit: "ratio" | "milliseconds" | "count" | "score";
	readonly runId: string;
	readonly recordedAt: string;
	readonly source: "fixture" | "external";
}
export interface DiscoveryBaselineStore {
	put(record: DiscoveryBaselineRecord): Promise<void>;
	get(
		metric: DiscoveryEvaluationMetric,
		datasetId: string,
		revision: string,
	): Promise<DiscoveryBaselineRecord | undefined>;
	list(): Promise<readonly DiscoveryBaselineRecord[]>;
}
export type Baseline = DiscoveryBaselineRecord;
export class MemoryBaselineStore implements DiscoveryBaselineStore {
	private readonly records = new Map<string, DiscoveryBaselineRecord>();
	private key(metric: DiscoveryEvaluationMetric, datasetId: string, revision: string): string {
		return `${metric}:${datasetId}:${revision}`;
	}
	async put(record: DiscoveryBaselineRecord): Promise<void> {
		validateBaseline(record);
		this.records.set(this.key(record.metric, record.datasetId, record.datasetRevision), record);
	}
	async get(
		metric: DiscoveryEvaluationMetric,
		datasetId: string,
		revision: string,
	): Promise<DiscoveryBaselineRecord | undefined> {
		return this.records.get(this.key(metric, datasetId, revision));
	}
	async list(): Promise<readonly DiscoveryBaselineRecord[]> {
		return [...this.records.values()];
	}
}
export function createBaseline(
	input: Omit<DiscoveryBaselineRecord, "recordedAt"> & { readonly recordedAt?: string },
): DiscoveryBaselineRecord {
	const result = { ...input, recordedAt: input.recordedAt ?? new Date().toISOString() };
	validateBaseline(result);
	return result;
}
function validateBaseline(item: DiscoveryBaselineRecord): void {
	assertValid(
		(DISCOVERY_EVALUATION_METRICS as readonly string[]).includes(item.metric),
		"baseline metric is invalid",
	);
	assertValid(safeId(item.datasetId), "baseline dataset id is invalid");
	assertValid(nonEmptyText(item.datasetRevision, 256), "baseline revision is invalid");
	assertValid(finiteNonNegative(item.value), "baseline value is invalid");
	const expectedUnit = item.metric.endsWith("rate")
		? "ratio"
		: item.metric === "verification-time-ms"
			? "milliseconds"
			: item.metric === "repeated-failure-count"
				? "count"
				: "score";
	assertValid(item.unit === expectedUnit, "baseline unit does not match metric");
	assertValid(safeId(item.runId), "baseline run id is invalid");
	assertValid(isoDate(item.recordedAt), "baseline timestamp is invalid");
	assertValid(item.source === "fixture" || item.source === "external", "baseline source is invalid");
}
export interface DiscoveryMetricEvaluation {
	readonly metric: DiscoveryEvaluationMetric;
	readonly value: number;
	readonly baseline?: number;
	readonly delta?: number;
	readonly passed: boolean;
	readonly baselineAvailable: boolean;
	readonly caseIds: readonly string[];
}
export interface DiscoveryEvaluationRun {
	readonly runId: string;
	readonly status: "complete" | "needs-data" | "blocked";
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly metrics: readonly DiscoveryMetricEvaluation[];
	readonly observations: Readonly<Record<string, DiscoveryEvaluationObservation>>;
	readonly missingData: readonly string[];
	readonly blockedCases: readonly string[];
}
async function legacy(
	items: readonly EvaluationItem[],
	evaluator: (item: EvaluationItem) => Promise<{ readonly value: number }>,
): Promise<EvaluationResult> {
	const metrics: { id: string; metric: EvaluationMetricName; value: number; passed: boolean }[] = [];
	const missingData: string[] = [];
	const blockedCases: string[] = [];
	for (const item of items) {
		if (item.datasetStatus === "missing") {
			missingData.push(item.id);
			continue;
		}
		try {
			const result = await evaluator(item);
			if (!finiteNonNegative(result.value)) throw new Error("invalid evaluation value");
			metrics.push({ id: item.id, metric: item.metric, value: result.value, passed: true });
		} catch {
			blockedCases.push(item.id);
		}
	}
	return {
		status: blockedCases.length ? "blocked" : missingData.length ? "needs-data" : "complete",
		metrics,
		missingData,
		blockedCases,
	};
}
export async function runEvaluation(
	items: readonly EvaluationItem[],
	evaluator: (
		item: EvaluationItem,
	) => Promise<{ readonly value: number; readonly verificationTimeMs?: number }>,
	store?: MemoryBaselineStore,
): Promise<EvaluationResult>;
export async function runEvaluation(
	cases: readonly DiscoveryEvaluationCase[],
	evaluator: (item: DiscoveryEvaluationCase) => Promise<DiscoveryEvaluationObservation>,
	store: DiscoveryBaselineStore,
	options?: { readonly timeoutMs?: number; readonly runId?: string },
): Promise<DiscoveryEvaluationRun>;
export async function runEvaluation(
	items: readonly any[],
	evaluator: (item: any) => Promise<any>,
	store?: any,
	options: { readonly timeoutMs?: number; readonly runId?: string } = {},
): Promise<any> {
	if (!items.length) throw new Error("evaluation requires at least one case");
	if ("expectedFindingIds" in items[0]) return legacy(items as EvaluationItem[], evaluator);
	assertValid(store && typeof store.get === "function", "baseline store is required");
	const cases = items as DiscoveryEvaluationCase[];
	assertValid(
		new Set(cases.map((item) => item.id)).size === cases.length,
		"evaluation case ids must be unique",
	);
	for (const item of cases) {
		assertValid(safeId(item.id), "evaluation case id is invalid");
		assertValid(
			(DISCOVERY_EVALUATION_METRICS as readonly string[]).includes(item.metric),
			"evaluation metric is invalid",
		);
		assertValid(safeId(item.datasetId), "evaluation dataset id is invalid");
		assertValid(nonEmptyText(item.datasetRevision, 256), "evaluation dataset revision is invalid");
		assertValid(
			item.datasetStatus === "fixture" ||
				item.datasetStatus === "external" ||
				item.datasetStatus === "missing",
			"evaluation dataset status is invalid",
		);
		assertValid(nonEmptyText(item.description, 20_000), "evaluation description is invalid");
	}
	const timeoutMs = options.timeoutMs ?? 60_000;
	assertValid(boundedInteger(timeoutMs, 1, 86_400_000), "evaluation timeout is invalid");
	const runId = options.runId ?? `evaluation-${randomUUID()}`;
	const startedAt = new Date().toISOString();
	const observations: Record<string, DiscoveryEvaluationObservation> = {};
	const blockedCases: string[] = [];
	const missingData = cases.filter((item) => item.datasetStatus === "missing").map((item) => item.id);
	for (const item of cases) {
		if (item.datasetStatus === "missing") continue;
		try {
			const result = await Promise.race([
				evaluator(item),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("evaluation-timeout")), timeoutMs),
				),
			]);
			assertValid(finiteNonNegative(result.value), "evaluation value is invalid");
			if (item.metric.endsWith("rate") || item.metric === "bixbench-regression")
				assertValid(result.value <= 1, "ratio/score must be between zero and one");
			if (item.metric === "repeated-failure-count")
				assertValid(Number.isSafeInteger(result.value), "failure count must be an integer");
			observations[item.id] = result;
		} catch {
			blockedCases.push(item.id);
		}
	}
	const metrics: DiscoveryMetricEvaluation[] = [];
	for (const metric of DISCOVERY_EVALUATION_METRICS) {
		const selected = cases.filter((item) => item.metric === metric && observations[item.id]);
		if (!selected.length) continue;
		const values = selected.map(
			(item) => observations[item.id]?.verificationTimeMs ?? observations[item.id]?.value ?? 0,
		);
		const value =
			metric === "verification-time-ms"
				? median(values)
				: metric === "repeated-failure-count"
					? values.reduce((sum, item) => sum + item, 0)
					: values.reduce((sum, item) => sum + item, 0) / values.length;
		const first = selected[0] as DiscoveryEvaluationCase;
		const baseline = await store.get(metric, first.datasetId, first.datasetRevision);
		const lower = metric === "verification-time-ms" || metric === "repeated-failure-count";
		metrics.push({
			metric,
			value,
			...(baseline ? { baseline: baseline.value, delta: value - baseline.value } : {}),
			passed: baseline ? (lower ? value <= baseline.value : value >= baseline.value) : false,
			baselineAvailable: Boolean(baseline),
			caseIds: selected.map((item) => item.id),
		});
	}
	return {
		runId,
		status: blockedCases.length
			? "blocked"
			: missingData.length || metrics.some((item) => !item.baselineAvailable)
				? "needs-data"
				: "complete",
		startedAt,
		finishedAt: new Date().toISOString(),
		metrics,
		observations,
		missingData,
		blockedCases,
	};
}
function median(values: readonly number[]): number {
	const ordered = [...values].sort((a, b) => a - b);
	const middle = Math.floor(ordered.length / 2);
	return ordered.length % 2
		? (ordered[middle] ?? 0)
		: ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}
