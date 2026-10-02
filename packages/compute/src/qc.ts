import type { MultiqcFinding, MultiqcSummary, QcGateResult } from "./types";

export type QcOperator = "gte" | "lte" | "eq" | "exists";

export interface QcRule {
	id: string;
	metric: string;
	operator: QcOperator;
	value?: number | string | boolean;
	severity?: "warning" | "error";
	message?: string;
}

function numberOrString(value: unknown): number | string | boolean | null {
	if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
	return null;
}

function flattenMetrics(
	value: unknown,
	prefix = "",
	result: Record<string, number | string | boolean> = {},
): Record<string, number | string | boolean> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return result;
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const path = prefix ? `${prefix}.${key}` : key;
		const scalar = numberOrString(child);
		if (scalar !== null) result[path] = scalar;
		else flattenMetrics(child, path, result);
	}
	return result;
}

/** Parse MultiQC's report_general_stats_data and common raw-data layouts. */
export function parseMultiqcReport(input: unknown): MultiqcSummary {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("MultiQC report must be a JSON object");
	const report = input as Record<string, unknown>;
	const general = report.report_general_stats_data ?? report.general_stats ?? report.generalStats;
	const metrics = flattenMetrics(general);
	metrics.sampleCount =
		general && typeof general === "object" && !Array.isArray(general)
			? Object.keys(general as Record<string, unknown>).length
			: 0;
	const raw = report.report_saved_raw_data ?? report.raw_data ?? report;
	const sampleNames = new Set<string>();
	if (general && typeof general === "object" && !Array.isArray(general)) {
		for (const sample of Object.keys(general as Record<string, unknown>)) sampleNames.add(sample);
	}
	const modules = Array.isArray(report.modules)
		? report.modules.filter((module): module is string => typeof module === "string")
		: Object.keys(
				report.report_general_stats_data && typeof report.report_general_stats_data === "object"
					? (report.report_general_stats_data as object)
					: {},
			);
	return { sampleCount: sampleNames.size, modules, metrics, raw };
}

/** Parse the bounded tab-separated multiqc_general_stats.txt representation. */
export function parseMultiqcReportText(text: string, maxBytes = 2 * 1024 * 1024): MultiqcSummary {
	if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("MultiQC report exceeds the bounded size");
	const lines = text.split(/\r?\n/).filter((line) => line.length > 0 && !line.startsWith("#"));
	const header = lines.shift()?.split("\t");
	if (!header?.length || header.length < 2) throw new Error("MultiQC TSV header is missing");
	const metrics: Record<string, number | string | boolean> = {};
	const samples = new Set<string>();
	const modules = new Set<string>();
	for (const line of lines) {
		const cells = line.split("\t");
		const sample = cells[0];
		if (!sample) continue;
		samples.add(sample);
		for (let index = 1; index < header.length; index += 1) {
			const key = header[index];
			const cell = cells[index];
			if (!key || cell === undefined || cell === "") continue;
			const numeric = Number(cell);
			metrics[`${sample}.${key}`] = Number.isFinite(numeric) && cell.trim() !== "" ? numeric : cell;
			const module = key.split("_")[0];
			if (module) modules.add(module);
		}
	}
	metrics.sampleCount = samples.size;
	return { sampleCount: samples.size, modules: [...modules], metrics, raw: text };
}

function resolveMetric(summary: MultiqcSummary, path: string): number | string | boolean | undefined {
	if (path === "sampleCount") return summary.sampleCount;
	if (path in summary.metrics) return summary.metrics[path];
	const suffix = Object.entries(summary.metrics).find(
		([key]) => key.endsWith(`.${path}`) || key.endsWith(`_${path}`),
	);
	return suffix?.[1];
}

function passes(operator: QcOperator, observed: unknown, expected: unknown): boolean {
	if (operator === "exists") return observed !== undefined && observed !== null;
	if (observed === undefined || observed === null) return false;
	if (operator === "eq") return observed === expected;
	if (typeof observed !== "number" || typeof expected !== "number") return false;
	return operator === "gte" ? observed >= expected : observed <= expected;
}

export function evaluateMultiqc(summary: MultiqcSummary, rules: readonly QcRule[]): QcGateResult {
	const findings: MultiqcFinding[] = [];
	for (const rule of rules) {
		const observed = resolveMetric(summary, rule.metric);
		if (passes(rule.operator, observed, rule.value)) continue;
		findings.push({
			ruleId: rule.id,
			metric: rule.metric,
			value: observed === undefined ? null : observed,
			threshold: rule.value === undefined ? null : rule.value,
			severity: rule.severity ?? "error",
			message: rule.message ?? `${rule.metric} did not satisfy ${rule.operator}`,
		});
	}
	return {
		status: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
		findings,
		reviewed: false,
		qcVerified: false,
		scientificallyVerified: false,
		qualifiedBy: "deterministic-thresholds",
	};
}

export function evaluateMultiqcJson(input: unknown, rules: readonly QcRule[]): QcGateResult {
	try {
		return evaluateMultiqc(parseMultiqcReport(input), rules);
	} catch {
		return {
			status: "unknown",
			findings: [],
			reviewed: false,
			qcVerified: false,
			scientificallyVerified: false,
			qualifiedBy: "parse-error",
		};
	}
}

export function evaluateMultiqcText(text: string, rules: readonly QcRule[]): QcGateResult {
	try {
		return evaluateMultiqc(parseMultiqcReportText(text), rules);
	} catch {
		return {
			status: "unknown",
			findings: [],
			reviewed: false,
			qcVerified: false,
			scientificallyVerified: false,
			qualifiedBy: "parse-error",
		};
	}
}

export const DEFAULT_RNASEQ_QC_RULES: readonly QcRule[] = [
	{
		id: "fastqc-samples",
		metric: "sampleCount",
		operator: "gte",
		value: 1,
		severity: "error",
		message: "MultiQC must contain at least one sample",
	},
	{
		id: "fastqc-total-sequences",
		metric: "total_sequences",
		operator: "exists",
		severity: "error",
		message: "FastQC total sequence count is required",
	},
];
