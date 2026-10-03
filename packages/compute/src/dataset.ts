import { createHash } from "node:crypto";
import type {
	ComputeAnalysisPlan,
	ComputeDataDesignContract,
	ComputeDatasetFile,
	ComputeDatasetSource,
	ComputeDatasetVersion,
	ComputePublicDataFetchRecord,
	ComputeSampleColumn,
	ComputeSampleSheet,
} from "@drone/shared";

/** A JSON value accepted by a sample sheet cell. */
export type SampleValue = string | number | boolean | null;
export type SampleRow = Readonly<Record<string, SampleValue | undefined>>;

export interface DatasetVersionInput {
	readonly datasetId: string;
	readonly files: readonly ComputeDatasetFile[];
	readonly source?: ComputeDatasetSource;
	readonly schemaVersion?: number;
	readonly createdAt?: string;
}

export interface ValidationIssue {
	readonly code: string;
	readonly message: string;
	readonly path?: string;
	readonly row?: number;
	readonly column?: string;
	readonly severity: "error" | "warning";
}

export interface SampleSheetValidationResult {
	readonly ok: boolean;
	readonly valid: boolean;
	readonly rowCount: number;
	readonly errors: readonly ValidationIssue[];
	readonly warnings: readonly ValidationIssue[];
}

export interface ConfoundingDesign {
	readonly treatment: string;
	readonly blockingFactors?: readonly string[];
	readonly factors?: readonly string[];
}

export interface ConfoundingFinding {
	readonly code:
		| "confounded"
		| "incomplete-factorial"
		| "missing-factor"
		| "constant-factor"
		| "rank-deficient";
	readonly treatment: string;
	readonly factor: string;
	readonly message: string;
	readonly severity: "error" | "warning";
	readonly treatmentLevels: readonly string[];
	readonly factorLevels: readonly string[];
}

export interface ConfoundingReport {
	readonly ok: boolean;
	readonly findings: readonly ConfoundingFinding[];
	readonly matrixRank: number;
	readonly matrixColumns: number;
}

export interface AnalysisPlanValidationResult {
	readonly ok: boolean;
	readonly valid: boolean;
	readonly errors: readonly ValidationIssue[];
	readonly warnings: readonly ValidationIssue[];
}

export interface PowerEstimateInput {
	readonly effectSize: number;
	readonly alpha?: number;
	readonly targetPower?: number;
	readonly totalSampleSize?: number;
	readonly perGroupSampleSize?: number;
}

export interface PowerEstimate {
	readonly method: "normal-approximation-two-independent-means";
	readonly assumptions: readonly string[];
	readonly alpha: number;
	readonly targetPower: number;
	readonly effectSize: number;
	readonly estimatedPower: number;
	readonly requiredPerGroupSampleSize: number;
	readonly requiredTotalSampleSize: number;
	readonly totalSampleSize?: number;
	readonly minimumDetectableEffect: number;
}

export interface DataDesignInput {
	readonly dataset: ComputeDatasetVersion;
	readonly sampleSheet: ComputeSampleSheet;
	readonly rows: readonly SampleRow[];
	readonly analysisPlan: ComputeAnalysisPlan;
	readonly fetchRecords?: readonly ComputePublicDataFetchRecord[];
}

export interface RecordChangeReview {
	readonly requiresReview: boolean;
	readonly reasons: readonly string[];
	readonly changedFields: readonly string[];
}

export interface ROCrateEntity {
	readonly "@id": string;
	readonly "@type": string | readonly string[];
	readonly [key: string]: unknown;
}

export interface ROCrateManifest {
	readonly "@context": "https://w3id.org/ro/crate/1.1/context";
	readonly "@graph": readonly ROCrateEntity[];
}

export interface ROCrateInput {
	readonly dataset: ComputeDatasetVersion;
	readonly sampleSheet?: ComputeSampleSheet;
	readonly analysisPlan?: ComputeAnalysisPlan;
	readonly fetchRecords?: readonly ComputePublicDataFetchRecord[];
	readonly designContract?: ComputeDataDesignContract;
}

const MAX_ISSUES = 256;
const SHA256 = /^[a-fA-F0-9]{64}$/;

function canonical(value: unknown): string {
	if (value === undefined) throw new Error("Cannot hash undefined values");
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.filter((key) => record[key] !== undefined)
		.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
		.join(",")}}`;
}

function canonicalOptional(value: unknown): string {
	return value === undefined ? "__undefined__" : canonical(value);
}

function sha256(value: unknown): string {
	return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function issue(
	code: string,
	message: string,
	options: Partial<Pick<ValidationIssue, "path" | "row" | "column" | "severity">> = {},
): ValidationIssue {
	return { code, message, severity: options.severity ?? "error", ...options };
}

function safeRelativePath(path: string): boolean {
	if (
		typeof path !== "string" ||
		!path ||
		path.length > 1024 ||
		/^[A-Za-z]:/.test(path) ||
		path.startsWith("/") ||
		path.includes("\\") ||
		[...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
	) {
		return false;
	}
	return !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function validateDatasetFiles(files: readonly ComputeDatasetFile[]): ComputeDatasetFile[] {
	if (!Array.isArray(files) || files.length === 0 || files.length > 1_000_000)
		throw new Error("Dataset must contain 1 to 1,000,000 files");
	const seen = new Set<string>();
	let size = 0;
	const normalized = files.map((file) => {
		if (!file || !safeRelativePath(file.path))
			throw new Error(`Invalid dataset file path: ${file?.path ?? ""}`);
		if (seen.has(file.path)) throw new Error(`Duplicate dataset file path: ${file.path}`);
		seen.add(file.path);
		if (!Number.isSafeInteger(file.bytes) || file.bytes < 0)
			throw new Error(`Invalid byte count for ${file.path}`);
		if (!SHA256.test(file.sha256)) throw new Error(`Invalid SHA-256 for ${file.path}`);
		size += file.bytes;
		if (!Number.isSafeInteger(size)) throw new Error("Dataset size exceeds the supported integer range");
		if (file.mediaType !== undefined && (!file.mediaType.trim() || file.mediaType.length > 256))
			throw new Error("Invalid media type");
		return {
			path: file.path,
			bytes: file.bytes,
			sha256: file.sha256.toLowerCase(),
			...(file.mediaType ? { mediaType: file.mediaType } : {}),
		};
	});
	return normalized.sort((a, b) => compareText(a.path, b.path));
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function datasetContent(
	input: DatasetVersionInput,
	files: readonly ComputeDatasetFile[],
): Record<string, unknown> {
	return {
		schemaVersion: input.schemaVersion ?? 1,
		files,
	};
}

/** Returns the content address for a dataset without using wall-clock state. */
export function datasetVersionHash(input: DatasetVersionInput): string {
	if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.datasetId)) throw new Error("Invalid dataset id");
	if (
		!Number.isInteger(input.schemaVersion ?? 1) ||
		(input.schemaVersion ?? 1) < 1 ||
		(input.schemaVersion ?? 1) > 100
	) {
		throw new Error("Dataset schema version must be a positive integer");
	}
	if (input.source?.kind === "public" && !input.source.uri)
		throw new Error("Public datasets require a source URI");
	if (input.source?.uri) validatePublicUri(input.source.uri);
	return sha256(datasetContent(input, validateDatasetFiles(input.files)));
}

/** Registers an immutable, content-addressed version. The input is never mutated. */
export function registerDatasetVersion(input: DatasetVersionInput): ComputeDatasetVersion {
	const files = validateDatasetFiles(input.files);
	const schemaVersion = input.schemaVersion ?? 1;
	if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.datasetId)) throw new Error("Invalid dataset id");
	if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 100)
		throw new Error("Invalid dataset schema version");
	if (input.createdAt !== undefined && !validTimestamp(input.createdAt))
		throw new Error("Invalid dataset creation timestamp");
	if (input.source?.kind === "public" && !input.source.uri)
		throw new Error("Public datasets require a source URI");
	if (input.source?.uri) validatePublicUri(input.source.uri);
	const contentSha256 = sha256(datasetContent(input, files));
	return {
		datasetId: input.datasetId,
		versionId: `sha256:${contentSha256}`,
		contentSha256,
		schemaVersion,
		files,
		sizeBytes: files.reduce((sum, file) => sum + file.bytes, 0),
		...(input.source ? { source: { ...input.source } } : {}),
		createdAt: input.createdAt ?? "1970-01-01T00:00:00.000Z",
	};
}

export const createDatasetVersion = registerDatasetVersion;

function validTimestamp(value: string): boolean {
	return (
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value))
	);
}

function validatePublicUri(uri: string): void {
	let parsed: URL;
	try {
		parsed = new URL(uri);
	} catch {
		throw new Error(`Invalid public data URI: ${uri}`);
	}
	if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
		throw new Error(`Public data URI must be an unauthenticated http(s) URL: ${uri}`);
	}
}

function cellMissing(value: SampleValue | undefined): boolean {
	return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function valueMatchesType(value: SampleValue, type: ComputeSampleColumn["type"]): boolean {
	if (type === "string") return typeof value === "string";
	if (type === "boolean") return typeof value === "boolean";
	if (type === "integer") return typeof value === "number" && Number.isSafeInteger(value);
	return typeof value === "number" && Number.isFinite(value);
}

/** Validates a sample table against its declared schema without coercion. */
export function validateSampleSheet(
	rows: readonly SampleRow[],
	schema: ComputeSampleSheet,
): SampleSheetValidationResult {
	const errors: ValidationIssue[] = [];
	const warnings: ValidationIssue[] = [];
	const columns = new Map<string, ComputeSampleColumn>();
	for (const column of schema.columns) {
		if (columns.has(column.name))
			errors.push(
				issue("duplicate-column", `Column ${column.name} is declared more than once`, {
					column: column.name,
				}),
			);
		columns.set(column.name, column);
	}
	if (!columns.has(schema.idColumn))
		errors.push(
			issue("missing-id-column", `ID column ${schema.idColumn} is not declared`, { column: schema.idColumn }),
		);
	const ids = new Set<string>();
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index] ?? {};
		for (const [name, value] of Object.entries(row)) {
			if (!columns.has(name))
				warnings.push(
					issue("extra-column", `Column ${name} is not declared by the schema`, {
						row: index,
						column: name,
						severity: "warning",
					}),
				);
			if (warnings.length + errors.length >= MAX_ISSUES) break;
			void value;
		}
		for (const column of columns.values()) {
			const value = row[column.name];
			const required = column.required === true || column.name === schema.idColumn;
			if (cellMissing(value)) {
				if (required)
					errors.push(
						issue("missing-value", `Required value is missing in ${column.name}`, {
							row: index,
							column: column.name,
						}),
					);
				continue;
			}
			if (!valueMatchesType(value as SampleValue, column.type)) {
				errors.push(
					issue("invalid-type", `Value in ${column.name} must be ${column.type}`, {
						row: index,
						column: column.name,
					}),
				);
			}
			if (column.allowedValues && !column.allowedValues.some((allowed) => allowed === value)) {
				errors.push(
					issue("invalid-value", `Value in ${column.name} is outside the allowed values`, {
						row: index,
						column: column.name,
					}),
				);
			}
			if (column.name === schema.idColumn || column.unique) {
				const key = `${column.name}:${String(value)}`;
				if (ids.has(key))
					errors.push(
						issue("duplicate-value", `Value ${String(value)} is duplicated in ${column.name}`, {
							row: index,
							column: column.name,
						}),
					);
				ids.add(key);
			}
			if (errors.length + warnings.length >= MAX_ISSUES) break;
		}
		if (errors.length + warnings.length >= MAX_ISSUES) break;
	}
	return { ok: errors.length === 0, valid: errors.length === 0, rowCount: rows.length, errors, warnings };
}

function levels(rows: readonly SampleRow[], column: string): string[] {
	return [...new Set(rows.map((row) => String(row[column] ?? "")))].filter(Boolean).sort(compareText);
}

function matrixRank(matrix: readonly (readonly number[])[]): number {
	if (matrix.length === 0 || matrix[0]?.length === 0) return 0;
	const values = matrix.map((row) => [...row]);
	const rowCount = values.length;
	const columnCount = values[0]?.length ?? 0;
	let rank = 0;
	for (let column = 0; column < columnCount && rank < rowCount; column += 1) {
		let pivot = rank;
		for (let row = rank + 1; row < rowCount; row += 1) {
			if (Math.abs(values[row]?.[column] ?? 0) > Math.abs(values[pivot]?.[column] ?? 0)) pivot = row;
		}
		if (Math.abs(values[pivot]?.[column] ?? 0) < 1e-10) continue;
		const rankRow = values[rank];
		const pivotRow = values[pivot];
		if (!rankRow || !pivotRow) continue;
		[values[rank], values[pivot]] = [pivotRow, rankRow];
		const normalizedPivotRow = values[rank];
		if (!normalizedPivotRow) continue;
		const pivotValue = normalizedPivotRow[column] ?? 1;
		for (let index = column; index < columnCount; index += 1)
			normalizedPivotRow[index] = (normalizedPivotRow[index] ?? 0) / pivotValue;
		for (let row = 0; row < rowCount; row += 1) {
			if (row === rank) continue;
			const factor = values[row]?.[column] ?? 0;
			const currentRow = values[row];
			if (!currentRow) continue;
			for (let index = column; index < columnCount; index += 1)
				currentRow[index] = (currentRow[index] ?? 0) - factor * (normalizedPivotRow[index] ?? 0);
		}
		rank += 1;
	}
	return rank;
}

function designMatrix(
	rows: readonly SampleRow[],
	variables: readonly string[],
): { matrix: number[][]; columnCount: number } {
	const levelsByVariable = variables.map((variable) => levels(rows, variable));
	const matrix = rows.map((row) => {
		const values: number[] = [1];
		for (let index = 0; index < variables.length; index += 1) {
			const variableLevels = levelsByVariable[index] ?? [];
			const variable = variables[index] ?? "";
			const value = String(row[variable] ?? "");
			for (const level of variableLevels.slice(1)) values.push(value === level ? 1 : 0);
		}
		return values;
	});
	return {
		matrix,
		columnCount:
			1 + levelsByVariable.reduce((sum, variableLevels) => sum + Math.max(0, variableLevels.length - 1), 0),
	};
}

/** Finds treatment/blocking-factor aliasing and missing factorial cells. */
export function checkDesignConfounding(
	rows: readonly SampleRow[],
	design: ConfoundingDesign,
): ConfoundingReport {
	const factors = [...new Set([...(design.blockingFactors ?? []), ...(design.factors ?? [])])].filter(
		(factor) => factor !== design.treatment,
	);
	const treatmentLevels = levels(rows, design.treatment);
	const findings: ConfoundingFinding[] = [];
	if (treatmentLevels.length < 2) {
		findings.push({
			code: "constant-factor",
			treatment: design.treatment,
			factor: design.treatment,
			message: `Treatment ${design.treatment} has fewer than two observed levels`,
			severity: "error",
			treatmentLevels,
			factorLevels: treatmentLevels,
		});
	}
	for (const factor of factors) {
		if (levels(rows, factor).length < 2) {
			findings.push({
				code: "constant-factor",
				treatment: design.treatment,
				factor,
				message: `Design factor ${factor} has fewer than two observed levels`,
				severity: "error",
				treatmentLevels,
				factorLevels: levels(rows, factor),
			});
		}
	}
	for (const factor of factors) {
		const factorLevels = levels(rows, factor);
		if (treatmentLevels.length < 2 || factorLevels.length < 2) continue;
		const treatmentToFactor = new Map<string, Set<string>>();
		const factorToTreatment = new Map<string, Set<string>>();
		for (const row of rows) {
			const treatment = String(row[design.treatment] ?? "");
			const level = String(row[factor] ?? "");
			if (!treatment || !level) continue;
			if (!treatmentToFactor.has(treatment)) treatmentToFactor.set(treatment, new Set());
			if (!factorToTreatment.has(level)) factorToTreatment.set(level, new Set());
			treatmentToFactor.get(treatment)?.add(level);
			factorToTreatment.get(level)?.add(treatment);
		}
		const confounded =
			treatmentLevels.every((level) => (treatmentToFactor.get(level)?.size ?? 0) === 1) &&
			factorLevels.every((level) => (factorToTreatment.get(level)?.size ?? 0) === 1);
		if (confounded) {
			findings.push({
				code: "confounded",
				treatment: design.treatment,
				factor,
				message: `${design.treatment} is perfectly confounded with ${factor}; treatment effects cannot be separated from the block effect`,
				severity: "error",
				treatmentLevels,
				factorLevels,
			});
			continue;
		}
		const observed = new Set(
			rows.map((row) => `${String(row[design.treatment] ?? "")}\u0000${String(row[factor] ?? "")}`),
		);
		if (observed.size < treatmentLevels.length * factorLevels.length) {
			findings.push({
				code: "incomplete-factorial",
				treatment: design.treatment,
				factor,
				message: `${design.treatment} by ${factor} has unobserved combinations`,
				severity: "warning",
				treatmentLevels,
				factorLevels,
			});
		}
	}
	const matrixVariables = [design.treatment, ...factors];
	const encoded = designMatrix(rows, matrixVariables);
	const rank = matrixRank(encoded.matrix);
	if (rank < encoded.columnCount) {
		findings.push({
			code: "rank-deficient",
			treatment: design.treatment,
			factor: factors[0] ?? design.treatment,
			message: `Design matrix is rank deficient (${rank} of ${encoded.columnCount} columns)`,
			severity: "error",
			treatmentLevels,
			factorLevels: factors[0] ? levels(rows, factors[0]) : treatmentLevels,
		});
	}
	return {
		ok: findings.every((finding) => finding.severity !== "error"),
		findings,
		matrixRank: rank,
		matrixColumns: encoded.columnCount,
	};
}

export function checkConfounding(
	rows: readonly SampleRow[],
	treatmentOrDesign: string | ConfoundingDesign,
	factor?: string,
): ConfoundingReport {
	return typeof treatmentOrDesign === "string"
		? checkDesignConfounding(rows, { treatment: treatmentOrDesign, blockingFactors: factor ? [factor] : [] })
		: checkDesignConfounding(rows, treatmentOrDesign);
}

function finiteProbability(value: number | undefined, fallback: number): number {
	return value === undefined ? fallback : value;
}

/** Validates the pre-registered analysis choices without changing them. */
export function validateAnalysisPlan(plan: Partial<ComputeAnalysisPlan>): AnalysisPlanValidationResult {
	const errors: ValidationIssue[] = [];
	const required = ["id", "outcome", "design", "primaryTest"] as const;
	for (const field of required) {
		if (typeof plan[field] !== "string" || plan[field]?.trim() === "")
			errors.push(issue("missing-field", `Analysis plan requires ${field}`, { path: field }));
	}
	if (!Number.isInteger(plan.version) || (plan.version ?? 0) < 1)
		errors.push(
			issue("invalid-version", "Analysis plan version must be a positive integer", { path: "version" }),
		);
	if (plan.design !== undefined && !["two-group", "paired", "factorial", "regression"].includes(plan.design))
		errors.push(issue("invalid-design", "Analysis plan design is not supported", { path: "design" }));
	if (!Number.isFinite(plan.alpha) || (plan.alpha ?? 0) <= 0 || (plan.alpha ?? 0) >= 1)
		errors.push(issue("invalid-alpha", "Alpha must be between 0 and 1", { path: "alpha" }));
	if (!Number.isFinite(plan.targetPower) || (plan.targetPower ?? 0) <= 0 || (plan.targetPower ?? 0) >= 1)
		errors.push(issue("invalid-power", "Target power must be between 0 and 1", { path: "targetPower" }));
	if (!Number.isFinite(plan.effectSize) || (plan.effectSize ?? 0) <= 0)
		errors.push(
			issue("invalid-effect-size", "Effect size must be finite and positive", { path: "effectSize" }),
		);
	if (
		plan.totalSampleSize !== undefined &&
		(!Number.isInteger(plan.totalSampleSize) || plan.totalSampleSize < 2)
	)
		errors.push(
			issue("invalid-sample-size", "Total sample size must be at least 2", { path: "totalSampleSize" }),
		);
	if (
		plan.perGroupSampleSize !== undefined &&
		(!Number.isInteger(plan.perGroupSampleSize) || plan.perGroupSampleSize < 1)
	)
		errors.push(
			issue("invalid-sample-size", "Per-group sample size must be positive", { path: "perGroupSampleSize" }),
		);
	if (plan.totalSampleSize === undefined && plan.perGroupSampleSize === undefined) {
		const warnings = [
			issue(
				"sample-size-not-planned",
				"Analysis plan has no planned sample size; run power planning before submission",
				{
					path: "totalSampleSize",
					severity: "warning",
				},
			),
		];
		return { ok: errors.length === 0, valid: errors.length === 0, errors, warnings };
	}
	return { ok: errors.length === 0, valid: errors.length === 0, errors, warnings: [] };
}

// Acklam's rational approximation is sufficient for deterministic planning;
// this estimate is a planning bound, not a replacement for a domain-specific
// power package.
function normalQuantile(probability: number): number {
	const p = Math.min(1 - 1e-12, Math.max(1e-12, probability));
	const a = [
		-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472,
		2.50662827745924,
	];
	const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
	const c = [
		-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497,
		2.93816398269878,
	];
	const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
	if (p < 0.02425) {
		const q = Math.sqrt(-2 * Math.log(p));
		const numerator =
			((((coefficient(c, 0) * q + coefficient(c, 1)) * q + coefficient(c, 2)) * q + coefficient(c, 3)) * q +
				coefficient(c, 4)) *
				q +
			coefficient(c, 5);
		const denominator =
			((coefficient(d, 0) * q + coefficient(d, 1)) * q + coefficient(d, 2)) * q + coefficient(d, 3) * q + 1;
		return numerator / denominator;
	}
	if (p > 1 - 0.02425) {
		const q = Math.sqrt(-2 * Math.log(1 - p));
		const numerator =
			((((coefficient(c, 0) * q + coefficient(c, 1)) * q + coefficient(c, 2)) * q + coefficient(c, 3)) * q +
				coefficient(c, 4)) *
				q +
			coefficient(c, 5);
		const denominator =
			((coefficient(d, 0) * q + coefficient(d, 1)) * q + coefficient(d, 2)) * q + coefficient(d, 3) * q + 1;
		return -numerator / denominator;
	}
	const q = p - 0.5;
	const r = q * q;
	const numerator =
		(((((coefficient(a, 0) * r + coefficient(a, 1)) * r + coefficient(a, 2)) * r + coefficient(a, 3)) * r +
			coefficient(a, 4)) *
			r +
			coefficient(a, 5)) *
		q;
	const denominator =
		((((coefficient(b, 0) * r + coefficient(b, 1)) * r + coefficient(b, 2)) * r + coefficient(b, 3)) * r +
			coefficient(b, 4)) *
			r +
		1;
	return numerator / denominator;
}

function normalCdf(value: number): number {
	const sign = value < 0 ? -1 : 1;
	const x = Math.abs(value) / Math.sqrt(2);
	const t = 1 / (1 + 0.3275911 * x);
	const polynomial =
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
	const erf = 1 - polynomial * Math.exp(-x * x);
	return 0.5 * (1 + sign * erf);
}

function coefficient(values: readonly number[], index: number): number {
	return values[index] ?? 0;
}

/** Estimates two-sided two-group power or the required balanced sample size. */
export function estimatePower(input: PowerEstimateInput): PowerEstimate {
	const alpha = finiteProbability(input.alpha, 0.05);
	const targetPower = finiteProbability(input.targetPower, 0.8);
	if (!Number.isFinite(input.effectSize) || input.effectSize <= 0)
		throw new Error("Effect size must be positive");
	if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) throw new Error("Alpha must be between 0 and 1");
	if (!Number.isFinite(targetPower) || targetPower <= 0 || targetPower >= 1)
		throw new Error("Target power must be between 0 and 1");
	const requiredPerGroupSampleSize = Math.max(
		1,
		Math.ceil(2 * ((normalQuantile(1 - alpha / 2) + normalQuantile(targetPower)) / input.effectSize) ** 2),
	);
	const requiredTotalSampleSize = requiredPerGroupSampleSize * 2;
	const totalSampleSize =
		input.totalSampleSize ??
		(input.perGroupSampleSize === undefined ? undefined : input.perGroupSampleSize * 2);
	if (
		input.totalSampleSize !== undefined &&
		input.perGroupSampleSize !== undefined &&
		input.totalSampleSize !== input.perGroupSampleSize * 2
	) {
		throw new Error("Total and per-group sample sizes disagree");
	}
	const effectiveTotal = totalSampleSize ?? requiredTotalSampleSize;
	if (!Number.isInteger(effectiveTotal) || effectiveTotal < 2)
		throw new Error("Total sample size must be at least 2");
	const signal = input.effectSize * Math.sqrt(effectiveTotal / 2);
	const critical = normalQuantile(1 - alpha / 2);
	const estimatedPower = Math.min(
		1,
		Math.max(0, normalCdf(-critical - signal) + 1 - normalCdf(critical - signal)),
	);
	const minimumDetectableEffect =
		(normalQuantile(1 - alpha / 2) + normalQuantile(targetPower)) / Math.sqrt(effectiveTotal / 2);
	return {
		method: "normal-approximation-two-independent-means",
		assumptions: [
			"Two independent groups with equal allocation",
			"Continuous outcome with known, common variance",
			"Normal approximation; confirm with a domain-specific test for the final protocol",
		],
		alpha,
		targetPower,
		effectSize: input.effectSize,
		estimatedPower,
		requiredPerGroupSampleSize,
		requiredTotalSampleSize,
		minimumDetectableEffect,
		...(totalSampleSize === undefined ? {} : { totalSampleSize }),
	};
}

export const estimateSampleSize = estimatePower;

export function sampleSheetSchemaHash(schema: ComputeSampleSheet): string {
	return sha256(schema);
}

export function analysisPlanHash(plan: ComputeAnalysisPlan): string {
	return sha256(plan);
}

export interface DataDesignValidationResult {
	readonly ok: boolean;
	readonly errors: readonly ValidationIssue[];
	readonly warnings: readonly ValidationIssue[];
	readonly sampleSheet: SampleSheetValidationResult;
	readonly analysisPlan: AnalysisPlanValidationResult;
}

/** Validates every B7 record before a task contract can be submitted. */
export function validateDataDesign(
	input: DataDesignInput,
	contract: ComputeDataDesignContract,
): DataDesignValidationResult {
	const sampleSheet = validateSampleSheet(input.rows, input.sampleSheet);
	const analysisPlan = validateAnalysisPlan(input.analysisPlan);
	const errors: ValidationIssue[] = [...sampleSheet.errors, ...analysisPlan.errors];
	const warnings: ValidationIssue[] = [...sampleSheet.warnings, ...analysisPlan.warnings];
	if (
		contract.datasetVersion.datasetId !== input.dataset.datasetId ||
		contract.datasetVersion.versionId !== input.dataset.versionId
	) {
		errors.push(
			issue("dataset-reference-mismatch", "The contract does not reference the supplied dataset version", {
				path: "datasetVersion",
			}),
		);
	}
	if (contract.sampleSheetSchemaId !== input.sampleSheet.id)
		errors.push(
			issue(
				"sample-schema-reference-mismatch",
				"The contract does not reference the supplied sample-sheet schema",
				{ path: "sampleSheetSchemaId" },
			),
		);
	if (contract.sampleSheetSha256 !== sampleSheetSchemaHash(input.sampleSheet))
		errors.push(
			issue("sample-schema-hash-mismatch", "The sample-sheet schema changed after contract approval", {
				path: "sampleSheetSha256",
			}),
		);
	if (contract.analysisPlanId !== input.analysisPlan.id)
		errors.push(
			issue(
				"analysis-plan-reference-mismatch",
				"The contract does not reference the supplied analysis plan",
				{ path: "analysisPlanId" },
			),
		);
	if (contract.analysisPlanSha256 !== analysisPlanHash(input.analysisPlan))
		errors.push(
			issue("analysis-plan-hash-mismatch", "The analysis plan changed after contract approval", {
				path: "analysisPlanSha256",
			}),
		);
	if (
		input.analysisPlan.datasetVersion &&
		(input.analysisPlan.datasetVersion.datasetId !== input.dataset.datasetId ||
			input.analysisPlan.datasetVersion.versionId !== input.dataset.versionId)
	)
		errors.push(
			issue(
				"analysis-dataset-reference-mismatch",
				"The analysis plan references a different dataset version",
				{ path: "analysisPlan.datasetVersion" },
			),
		);
	const availableFetchIds = new Set((input.fetchRecords ?? []).map((record) => record.id));
	for (const fetchId of contract.fetchRecordIds ?? []) {
		if (!availableFetchIds.has(fetchId))
			errors.push(
				issue("fetch-reference-mismatch", `The contract references missing fetch record ${fetchId}`, {
					path: `fetchRecordIds.${fetchId}`,
				}),
			);
	}
	for (const record of input.fetchRecords ?? []) {
		try {
			validateFetchRecord(record);
		} catch (error) {
			errors.push(
				issue("invalid-fetch-record", error instanceof Error ? error.message : String(error), {
					path: `fetchRecords.${record.id}`,
				}),
			);
		}
	}
	return { ok: errors.length === 0, errors, warnings, sampleSheet, analysisPlan };
}

export interface AnalysisPlanDeviation {
	readonly ok: boolean;
	readonly deviations: readonly { field: string; planned: unknown; observed: unknown }[];
}

/** Compares observed design values to the pre-registered plan without coercion. */
export function checkAnalysisPlanDeviation(
	planned: Partial<ComputeAnalysisPlan>,
	observed: Partial<ComputeAnalysisPlan>,
): AnalysisPlanDeviation {
	const fields = [
		"outcome",
		"design",
		"primaryTest",
		"alpha",
		"targetPower",
		"effectSize",
		"groups",
		"covariates",
	] as const;
	const deviations = fields.flatMap((field) =>
		canonicalOptional(planned[field]) === canonicalOptional(observed[field])
			? []
			: [{ field, planned: planned[field], observed: observed[field] }],
	);
	return { ok: deviations.length === 0, deviations };
}

/** Marks scientific record changes for explicit human review. */
export function reviewRecordChange(
	previous: Readonly<Record<string, unknown>>,
	next: Readonly<Record<string, unknown>>,
): RecordChangeReview {
	const fields = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort(compareText);
	const changedFields = fields.filter(
		(field) => canonicalOptional(previous[field]) !== canonicalOptional(next[field]),
	);
	const reviewedFields = new Set([
		"id",
		"datasetId",
		"source",
		"versionId",
		"contentSha256",
		"schemaVersion",
		"files",
		"analysisPlanSha256",
		"sampleSheetSha256",
		"effectSize",
		"alpha",
		"targetPower",
		"outcome",
		"design",
		"primaryTest",
		"version",
	]);
	const reasons = changedFields
		.filter((field) => reviewedFields.has(field))
		.map((field) => `Scientific record field ${field} changed`);
	return { requiresReview: reasons.length > 0, reasons, changedFields };
}

export const reviewVersionChange = reviewRecordChange;

function validateFetchRecord(record: ComputePublicDataFetchRecord): void {
	validatePublicUri(record.uri);
	if (!record.source.trim()) throw new Error(`Public data source is required for ${record.id}`);
	if (!validTimestamp(record.fetchedAt)) throw new Error(`Invalid fetch timestamp for ${record.id}`);
	if (!record.termsAccepted) throw new Error(`Terms must be accepted for public data record ${record.id}`);
	if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 || !SHA256.test(record.sha256))
		throw new Error(`Invalid public data fetch checksum for ${record.id}`);
}

export function validatePublicDataFetchRecord(record: ComputePublicDataFetchRecord): true {
	validateFetchRecord(record);
	return true;
}

/** Builds a deterministic RO-Crate 1.1 manifest from B7 records. */
export function buildROCrateManifest(input: ROCrateInput): ROCrateManifest {
	const files = validateDatasetFiles(input.dataset.files);
	if (
		input.dataset.contentSha256 !==
		datasetVersionHash({
			datasetId: input.dataset.datasetId,
			files,
			schemaVersion: input.dataset.schemaVersion,
		})
	) {
		throw new Error("Dataset content hash does not match its files");
	}
	for (const record of input.fetchRecords ?? []) validateFetchRecord(record);
	const fileEntities: ROCrateEntity[] = files.map((file) => ({
		"@id": `./${file.path}`,
		"@type": "File",
		contentSize: file.bytes,
		encodingFormat: file.mediaType,
		sha256: file.sha256,
	}));
	const datasetEntity: ROCrateEntity = {
		"@id": "./",
		"@type": "Dataset",
		identifier: input.dataset.versionId,
		name: input.dataset.datasetId,
		version: input.dataset.versionId,
		conformsTo: { "@id": "https://w3id.org/ro/crate/1.1" },
		hasPart: files.map((file) => ({ "@id": `./${file.path}` })),
	};
	const graph: ROCrateEntity[] = [
		{ "@id": "ro-crate-metadata.json", "@type": "CreativeWork", about: { "@id": "./" } },
		datasetEntity,
		...fileEntities,
	];
	for (const fetch of [...(input.fetchRecords ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
		graph.push({
			"@id": `#fetch-${fetch.id}`,
			"@type": "DataDownload",
			contentUrl: fetch.uri,
			identifier: fetch.accession ?? fetch.id,
			license: fetch.license,
			contentSize: fetch.bytes,
			sha256: fetch.sha256,
			dateDownloaded: fetch.fetchedAt,
		});
	}
	if (input.sampleSheet) {
		graph.push({
			"@id": "#sample-sheet-schema",
			"@type": "CreativeWork",
			identifier: input.sampleSheet.id,
			version: input.sampleSheet.version,
			columns: input.sampleSheet.columns,
		});
	}
	if (input.analysisPlan) {
		graph.push({
			"@id": "#analysis-plan",
			"@type": "CreativeWork",
			identifier: input.analysisPlan.id,
			version: input.analysisPlan.version,
			outcome: input.analysisPlan.outcome,
			primaryTest: input.analysisPlan.primaryTest,
			design: input.analysisPlan.design,
			alpha: input.analysisPlan.alpha,
			targetPower: input.analysisPlan.targetPower,
			effectSize: input.analysisPlan.effectSize,
		});
	}
	if (input.designContract) {
		graph.push({
			"@id": "#design-contract",
			"@type": "CreativeWork",
			datasetVersion: { "@id": input.designContract.datasetVersion.versionId },
			sampleSheetSchemaId: input.designContract.sampleSheetSchemaId,
			sampleSheetSha256: input.designContract.sampleSheetSha256,
			analysisPlanId: input.designContract.analysisPlanId,
			analysisPlanSha256: input.designContract.analysisPlanSha256,
			fetchRecordIds: input.designContract.fetchRecordIds ?? [],
		});
	}
	return { "@context": "https://w3id.org/ro/crate/1.1/context", "@graph": graph };
}

export const exportROCrateManifest = buildROCrateManifest;

/** Serializes the manifest with stable key ordering for reproducible artifacts. */
export function exportROCrate(input: ROCrateInput): string {
	return canonical(buildROCrateManifest(input));
}

export const exportRoCrate = exportROCrate;
