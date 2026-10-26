import { createHash } from "node:crypto";
import { stableJson } from "@drone/compute";
import type { AnalysisContext } from "@drone/shared";

export const ANALYSIS_PREPARE_EVIDENCE_TOOL = "analysis_prepare_evidence" as const;
export const EVIDENCE_VALIDATE_MANIFEST_TOOL = "evidence_validate_manifest" as const;

export interface ReadOnlyPluginTool {
	execute(input: unknown): Promise<unknown> | unknown;
}

export interface AnalysisEvidencePluginManifest {
	readonly tools: readonly string[];
}

/**
 * Host-facing slice of the plugin composition. The host receives tools from
 * the installed Pi package loader; it never imports the analysis/evidence
 * implementation or lets a plugin choose a host path.
 */
export interface AnalysisEvidencePluginHost {
	readonly manifest: AnalysisEvidencePluginManifest;
	readonly tools: Readonly<
		Partial<
			Record<
				typeof ANALYSIS_PREPARE_EVIDENCE_TOOL | typeof EVIDENCE_VALIDATE_MANIFEST_TOOL,
				ReadOnlyPluginTool
			>
		>
	>;
}

export interface AnalysisEvidencePreparationInput {
	readonly analysis: AnalysisContext;
	/** Host-owned content-addressed manifest. Plugin code cannot replace it. */
	readonly manifest: unknown;
	readonly request?: unknown;
}

export type AnalysisEvidenceReceiptStatus = "ready" | "unavailable" | "invalid";

export interface AnalysisEvidenceReceipt {
	readonly schemaVersion: 1;
	readonly status: AnalysisEvidenceReceiptStatus;
	readonly analysisId: string;
	readonly execution: "host-required";
	readonly tool: typeof ANALYSIS_PREPARE_EVIDENCE_TOOL;
	readonly validator: typeof EVIDENCE_VALIDATE_MANIFEST_TOOL;
	readonly manifestSha256?: string;
	readonly plan?: unknown;
	readonly validation?: unknown;
	readonly reason?: string;
	/** Digest covers all fields above except this field. */
	readonly receiptSha256: string;
}

function digest(value: unknown): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

function details(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const record = value as Record<string, unknown>;
	return Object.hasOwn(record, "details") ? record.details : value;
}

function declared(manifest: AnalysisEvidencePluginManifest, name: string): boolean {
	return manifest.tools.includes(name);
}

function baseReceipt(
	input: Pick<AnalysisEvidenceReceipt, "status" | "analysisId" | "reason"> &
		Partial<Pick<AnalysisEvidenceReceipt, "plan" | "validation" | "manifestSha256">>,
): AnalysisEvidenceReceipt {
	const body = {
		schemaVersion: 1 as const,
		status: input.status,
		analysisId: input.analysisId,
		execution: "host-required" as const,
		tool: ANALYSIS_PREPARE_EVIDENCE_TOOL,
		validator: EVIDENCE_VALIDATE_MANIFEST_TOOL,
		...(input.manifestSha256 ? { manifestSha256: input.manifestSha256 } : {}),
		...(input.plan !== undefined ? { plan: input.plan } : {}),
		...(input.validation !== undefined ? { validation: input.validation } : {}),
		...(input.reason ? { reason: input.reason } : {}),
	};
	return { ...body, receiptSha256: digest(body) };
}

function invalidReason(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return "Plugin returned a non-object evidence plan";
	const plan = value as Record<string, unknown>;
	if (plan.execution !== "host-required") return "Evidence plan must declare execution=host-required";
	return undefined;
}

/**
 * Compose the two read-only native plugin tools into a deterministic receipt.
 * Missing declarations are an explicit unavailable state; they are not
 * replaced with host-side scientific logic or a fabricated successful plan.
 */
export async function prepareAnalysisEvidence(
	host: AnalysisEvidencePluginHost | undefined,
	input: AnalysisEvidencePreparationInput,
): Promise<AnalysisEvidenceReceipt> {
	if (!host) {
		return baseReceipt({
			status: "unavailable",
			analysisId: input.analysis.id,
			reason: "Analysis/evidence plugin host is unavailable",
		});
	}
	if (!declared(host.manifest, ANALYSIS_PREPARE_EVIDENCE_TOOL)) {
		return baseReceipt({
			status: "unavailable",
			analysisId: input.analysis.id,
			reason: `${ANALYSIS_PREPARE_EVIDENCE_TOOL} is not declared by the plugin manifest`,
		});
	}
	if (!declared(host.manifest, EVIDENCE_VALIDATE_MANIFEST_TOOL)) {
		return baseReceipt({
			status: "unavailable",
			analysisId: input.analysis.id,
			reason: `${EVIDENCE_VALIDATE_MANIFEST_TOOL} is not declared by the plugin manifest`,
		});
	}
	const prepare = host.tools[ANALYSIS_PREPARE_EVIDENCE_TOOL];
	const validate = host.tools[EVIDENCE_VALIDATE_MANIFEST_TOOL];
	if (!prepare || !validate) {
		return baseReceipt({
			status: "unavailable",
			analysisId: input.analysis.id,
			reason: "Declared analysis/evidence tool is not loaded",
		});
	}

	let plan: unknown;
	try {
		plan = details(
			await prepare.execute({
				analysis: input.analysis,
				manifest: input.manifest,
				...(input.request !== undefined ? { request: input.request } : {}),
			}),
		);
	} catch (error) {
		return baseReceipt({
			status: "invalid",
			analysisId: input.analysis.id,
			reason: `Evidence preparation failed: ${String(error).slice(0, 300)}`,
		});
	}
	const planError = invalidReason(plan);
	if (planError)
		return baseReceipt({ status: "invalid", analysisId: input.analysis.id, plan, reason: planError });

	let validation: unknown;
	try {
		validation = details(await validate.execute({ manifest: input.manifest }));
	} catch (error) {
		return baseReceipt({
			status: "invalid",
			analysisId: input.analysis.id,
			plan,
			manifestSha256: digest(input.manifest),
			reason: `Evidence manifest validation failed: ${String(error).slice(0, 300)}`,
		});
	}
	if (
		!validation ||
		typeof validation !== "object" ||
		Array.isArray(validation) ||
		(validation as { valid?: unknown }).valid !== true
	) {
		return baseReceipt({
			status: "invalid",
			analysisId: input.analysis.id,
			plan,
			validation,
			manifestSha256: digest(input.manifest),
			reason: "Evidence manifest validator did not return valid=true",
		});
	}
	return baseReceipt({
		status: "ready",
		analysisId: input.analysis.id,
		plan,
		validation,
		manifestSha256: digest(input.manifest),
	});
}
