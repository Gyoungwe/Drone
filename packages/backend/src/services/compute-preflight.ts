import { createHash } from "node:crypto";
import type {
	ComputeAuthorization,
	ConfoundingDesign,
	DataDesignInput,
	JobSpec,
	SampleRow,
	ValidationIssue,
} from "@drone/compute";
import { checkDesignConfounding, validateDataDesign } from "@drone/compute";
import { computeContractHash } from "@drone/compute/authorization";
import type {
	ComputeAnalysisPlan,
	ComputeDataDesignContract,
	ComputeDatasetVersion,
	ComputePublicDataFetchRecord,
	ComputeSampleSheet,
} from "@drone/shared";

/** Data/design records supplied by a host immediately before a compute submit. */
export interface ComputeDataDesignSubmission {
	readonly dataset: ComputeDatasetVersion;
	readonly sampleSheet: ComputeSampleSheet;
	readonly rows: readonly SampleRow[];
	readonly analysisPlan: ComputeAnalysisPlan;
	readonly fetchRecords?: readonly ComputePublicDataFetchRecord[];
	readonly contract: ComputeDataDesignContract;
	/** Optional treatment/blocking declaration used for design-matrix checks. */
	readonly confounding?: ConfoundingDesign;
}

/** Structural extension kept at the backend boundary so legacy JobSpec callers remain valid. */
export interface ComputePreflightJobSpec extends JobSpec {
	readonly dataDesign?: ComputeDataDesignSubmission;
	readonly authorization?: ComputeAuthorization;
	/** Full task contract hash, when the task host supplied one. */
	readonly contractHash?: string;
}

export interface ComputeProposalQuestion {
	readonly id: string;
	readonly path?: string;
	readonly question: string;
	readonly reason: string;
	readonly severity: "warning" | "error";
}

export interface ComputePreflightResult {
	readonly ok: boolean;
	readonly designPresent: boolean;
	readonly errors: readonly ValidationIssue[];
	readonly warnings: readonly ValidationIssue[];
	readonly questions: readonly ComputeProposalQuestion[];
	readonly authorizationContractHash?: string;
	readonly designContractHash?: string;
}

/** A rejected preflight carries actionable proposal questions to the task host. */
export class ComputePreflightError extends Error {
	readonly code = "compute_preflight_blocked" as const;
	readonly result: ComputePreflightResult;
	readonly issues: readonly ValidationIssue[];
	readonly questions: readonly ComputeProposalQuestion[];

	constructor(result: ComputePreflightResult) {
		super(
			result.questions.length > 0
				? `Compute preflight requires a proposal decision: ${result.questions.map((question) => question.question).join("; ")}`
				: "Compute preflight failed",
		);
		this.name = "ComputePreflightError";
		this.result = result;
		this.issues = [...result.errors, ...result.warnings];
		this.questions = result.questions;
	}
}

function canonical(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
	const row = value as Record<string, unknown>;
	return `{${Object.keys(row)
		.sort()
		.filter((key) => row[key] !== undefined)
		.map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
		.join(",")}}`;
}

function hashDesignContract(contract: ComputeDataDesignContract): string {
	return createHash("sha256").update(canonical(contract), "utf8").digest("hex");
}

function issueQuestions(issues: readonly ValidationIssue[], start = 0): ComputeProposalQuestion[] {
	return issues.map((item, index) => ({
		id: `compute-design-${start + index + 1}`,
		...(item.path ? { path: item.path } : {}),
		question: item.message,
		reason: item.code,
		severity: item.severity,
	}));
}

function authWithoutHash(auth: ComputeAuthorization): Omit<ComputeAuthorization, "contractHash"> {
	const { contractHash: _ignored, ...unsigned } = auth;
	return unsigned;
}

/**
 * Validate a design-bearing submission immediately before a host side effect.
 * This function is pure: it does not register a job, write a file, fetch data,
 * or alter a plan. Callers may surface `questions` as proposal findings.
 */
export function preflightComputeSubmission(spec: ComputePreflightJobSpec): ComputePreflightResult {
	const design = spec.dataDesign;
	const authorization = spec.authorization;
	if (!design && !authorization?.dataDesign) {
		return { ok: true, designPresent: false, errors: [], warnings: [], questions: [] };
	}
	const errors: ValidationIssue[] = [];
	const warnings: ValidationIssue[] = [];
	const questions: ComputeProposalQuestion[] = [];
	if (!design) {
		const item: ValidationIssue = {
			code: "missing-data-design",
			message: "The approved task contains a data-design contract but the submission omitted its records",
			path: "dataDesign",
			severity: "error",
		};
		errors.push(item);
		questions.push(...issueQuestions([item]));
		return { ok: false, designPresent: true, errors, warnings, questions };
	}
	if (!authorization) {
		const item: ValidationIssue = {
			code: "authorization-missing",
			message: "A data-design submission must be bound to an approved task authorization",
			path: "authorization",
			severity: "error",
		};
		errors.push(item);
	}
	try {
		const checked = validateDataDesign(design as DataDesignInput, design.contract);
		errors.push(...checked.errors);
		warnings.push(...checked.warnings);
	} catch (error) {
		errors.push({
			code: "invalid-data-design",
			message: error instanceof Error ? error.message : String(error),
			path: "dataDesign",
			severity: "error",
		});
	}
	if (design.confounding) {
		try {
			const report = checkDesignConfounding(design.rows, design.confounding);
			for (const finding of report.findings) {
				const item: ValidationIssue = {
					code: `design-${finding.code}`,
					message: finding.message,
					path: `design.${finding.factor}`,
					severity: finding.severity,
				};
				(finding.severity === "error" ? errors : warnings).push(item);
			}
		} catch (error) {
			errors.push({
				code: "invalid-confounding-design",
				message: error instanceof Error ? error.message : String(error),
				path: "dataDesign.confounding",
				severity: "error",
			});
		}
	}
	if (authorization) {
		if (!authorization.approved) {
			const item: ValidationIssue = {
				code: "authorization-not-approved",
				message: "Compute authorization is not approved for this data-design contract",
				path: "authorization.approved",
				severity: "error",
			};
			errors.push(item);
		}
		const expectedDesign = authorization.dataDesign;
		if (!expectedDesign) {
			const item: ValidationIssue = {
				code: "authorization-design-missing",
				message: "A design-bearing submission must bind its data-design contract into authorization",
				path: "authorization.dataDesign",
				severity: "error",
			};
			errors.push(item);
		} else if (canonical(expectedDesign) !== canonical(design.contract)) {
			const item: ValidationIssue = {
				code: "authorization-design-mismatch",
				message: "The submitted data-design contract differs from the approved authorization",
				path: "authorization.dataDesign",
				severity: "error",
			};
			errors.push(item);
		}
		if (
			!authorization.contractHash ||
			computeContractHash(authWithoutHash(authorization)) !== authorization.contractHash
		) {
			const item: ValidationIssue = {
				code: "authorization-contract-hash-invalid",
				message: "The authorization hash does not cover the submitted immutable data-design contract",
				path: "authorization.contractHash",
				severity: "error",
			};
			errors.push(item);
		}
	}
	const designContractHash = hashDesignContract(design.contract);
	questions.push(...issueQuestions(errors));
	questions.push(...issueQuestions(warnings, questions.length));
	return {
		ok: errors.length === 0,
		designPresent: true,
		errors,
		warnings,
		questions,
		...(authorization?.contractHash ? { authorizationContractHash: authorization.contractHash } : {}),
		designContractHash,
	};
}

export function assertComputePreflight(spec: ComputePreflightJobSpec): ComputePreflightResult {
	const result = preflightComputeSubmission(spec);
	if (!result.ok) throw new ComputePreflightError(result);
	return result;
}
