import type { CapabilityId } from "./capabilities";
import type { CausalEnvelope } from "./causality";

/** Durable analysis stages. Capability loading follows the current stage. */
export const ANALYSIS_STAGES = Object.freeze([
	"intake",
	"design",
	"readiness",
	"execution",
	"review",
	"delivery",
	"completed",
] as const);
export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

export type AnalysisMode = "exploratory" | "inferential";
export type AnalysisStatus = "active" | "paused" | "blocked" | "completed";
export type AnalysisGateSeverity = "pause" | "block";
export type AnalysisGateCode =
	| "unsupported-assay"
	| "scientific-ambiguity"
	| "missing-data"
	| "missing-biological-replicates"
	| "reference-mismatch"
	| "unsupported-method"
	| "compute-authorization-required"
	| "destructive-operation-requires-review"
	| "publication-requires-review";

export interface AnalysisGate {
	readonly code: AnalysisGateCode;
	readonly severity: AnalysisGateSeverity;
	readonly message: string;
	readonly evidenceKey: string;
}

/** Host-supplied adapter assessment; scientific fields belong to the adapter. */
export interface AnalysisReadinessInput {
	readonly mode: AnalysisMode;
	readonly assay: string;
	readonly assessment: AnalysisReadiness;
	readonly computeAuthorized: boolean;
	readonly destructiveOperation?: boolean;
	readonly publicationRequested?: boolean;
}

export interface AnalysisIdentity {
	readonly id: string;
	readonly version: string;
}

/** Exact artifact revision and its parent revisions, never just a mutable path. */
export interface AnalysisArtifactVersion {
	readonly artifactId: string;
	readonly versionId: string;
	readonly path: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly role: "input" | "output" | "review";
	readonly accessLevel?: "public" | "restricted" | "private";
	readonly parentVersionIds: readonly string[];
	readonly producedByJobId?: string;
}

export interface AnalysisProvenance {
	readonly adapter: AnalysisIdentity;
	readonly workflow: AnalysisIdentity;
	readonly method: AnalysisIdentity;
	readonly specSha256: string;
	readonly adapterSnapshotSha256?: string;
	readonly toolContractSha256?: string;
	readonly executionContext?: AnalysisExecutionContext;
	readonly artifacts: readonly AnalysisArtifactVersion[];
	readonly lineage?: CausalEnvelope;
	readonly reproducibility: {
		readonly status: "not-assessed" | "recorded" | "verified" | "failed";
		readonly detail: string;
		/** A pinned environment/checkpoint can be supplied by a future executor receipt. */
		readonly environmentFingerprint?: string;
		readonly checkpointId?: string;
	};
}

/** Host-observed execution identity; missing fields remain unknown rather than inferred. */
export interface AnalysisExecutionContext {
	readonly schemaVersion: 1;
	readonly revision: string;
	readonly observedAt: string;
	readonly source: "runner" | "host" | "replay";
	readonly values: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AnalysisReadiness {
	readonly ok: boolean;
	readonly inferentialClaimsAllowed: boolean;
	readonly gates: readonly AnalysisGate[];
	readonly warnings: readonly string[];
}

export interface AnalysisReview {
	readonly approved: boolean;
	readonly detail: string;
	readonly limitations: readonly string[];
	readonly reportPath?: string;
	readonly checks?: readonly AnalysisReviewCheck[];
	readonly modelStatus?: "approved" | "rejected" | "unavailable";
}

export interface AnalysisReviewCheck {
	readonly id: string;
	readonly passed: boolean;
	readonly detail: string;
}

export interface AnalysisEvent {
	readonly type:
		| "created"
		| "design-recorded"
		| "readiness-assessed"
		| "execution-approved"
		| "execution-finished"
		| "review-finished"
		| "delivered"
		| "paused"
		| "resumed";
	readonly at: string;
	readonly detail?: string;
}

export interface AnalysisContext {
	readonly version: 1;
	readonly id: string;
	readonly question: string;
	readonly branchOf?: {
		readonly analysisId: string;
		readonly checkpointId: string;
		readonly workspace: string;
	};
	readonly assay: string;
	readonly mode: AnalysisMode;
	readonly stage: AnalysisStage;
	readonly status: AnalysisStatus;
	readonly capabilities: readonly CapabilityId[];
	readonly readiness: AnalysisReadiness | null;
	readonly review?: AnalysisReview;
	readonly adapter?: AnalysisIdentity;
	readonly provenance?: AnalysisProvenance;
	readonly publicationRequested: boolean;
	readonly events: readonly AnalysisEvent[];
}

export interface AnalysisOrchestratorOptions {
	readonly now?: () => string;
}

const STAGE_CAPABILITIES: Readonly<Record<AnalysisStage, readonly CapabilityId[]>> = {
	intake: ["analysis", "files"],
	design: ["analysis", "planning", "files"],
	readiness: ["analysis", "files", "coding"],
	execution: ["analysis", "files", "coding"],
	review: ["analysis", "visualization", "literature"],
	delivery: ["analysis", "visualization", "writing", "literature"],
	completed: ["writing", "visualization"],
};

function safeText(value: string, label: string, max = 512): string {
	const text = value.normalize("NFKC").replace(/\s+/g, " ").trim();
	if (!text || text.length > max) throw new Error(`${label} must be a non-empty bounded string`);
	return text;
}

function safeId(value: string): string {
	const id = safeText(value, "Analysis id", 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) throw new Error("Analysis id contains unsafe characters");
	return id;
}

function makeEvent(type: AnalysisEvent["type"], now: () => string, detail?: string): AnalysisEvent {
	return { type, at: now(), ...(detail ? { detail } : {}) };
}

function withStage(context: AnalysisContext, stage: AnalysisStage): AnalysisContext {
	return { ...context, stage, capabilities: [...STAGE_CAPABILITIES[stage]] };
}

function makeGate(
	code: AnalysisGateCode,
	severity: AnalysisGateSeverity,
	message: string,
	evidenceKey: string,
): AnalysisGate {
	return { code, severity, message, evidenceKey };
}

/**
 * Scientific readiness is separate from compute authorization. A run may be
 * technically executable while still being unsuitable for inferential claims.
 */
export function assessAnalysisReadiness(input: AnalysisReadinessInput): AnalysisReadiness {
	const gates: AnalysisGate[] = [];
	const warnings: string[] = [];
	if (input.mode !== "inferential" && input.mode !== "exploratory") throw new Error("Unknown analysis mode");
	const assessment = input.assessment;
	gates.push(...assessment.gates);
	warnings.push(...assessment.warnings);
	if (!assessment.ok && gates.length === 0)
		gates.push(makeGate("missing-data", "block", "Adapter assessment failed without evidence", "assessment"));
	if (!input.computeAuthorized)
		gates.push(
			makeGate(
				"compute-authorization-required",
				"pause",
				"Compute execution is outside the approved task scope.",
				"computeAuthorized",
			),
		);
	if (input.destructiveOperation)
		gates.push(
			makeGate(
				"destructive-operation-requires-review",
				"pause",
				"A destructive or overwrite operation requires human review.",
				"destructiveOperation",
			),
		);
	// Publication is checked at delivery, after a concrete result is available.
	return {
		ok: gates.length === 0,
		inferentialClaimsAllowed: assessment.inferentialClaimsAllowed && gates.length === 0,
		gates,
		warnings,
	};
}

/** Pure transitions over host-owned snapshots; never expose these inputs as approval tools.
 * Readiness is a screening gate, not proof of statistical validity or adequate power.
 * Persistence, authorization, design-matrix checks and observed receipts belong to the host.
 */
export class AnalysisOrchestrator {
	private readonly now: () => string;

	constructor(options: AnalysisOrchestratorOptions = {}) {
		this.now = options.now ?? (() => new Date().toISOString());
	}

	create(input: {
		id: string;
		question: string;
		assay: string;
		mode: AnalysisMode;
		adapter?: AnalysisIdentity;
	}): AnalysisContext {
		return {
			version: 1,
			...(input.adapter ? { adapter: input.adapter } : {}),
			id: safeId(input.id),
			question: safeText(input.question, "Analysis question"),
			assay: safeText(input.assay, "Assay"),
			mode: input.mode,
			stage: "intake",
			status: "active",
			capabilities: [...STAGE_CAPABILITIES.intake],
			readiness: null,
			publicationRequested: false,
			events: [makeEvent("created", this.now)],
		};
	}

	assessReadiness(context: AnalysisContext, input: AnalysisReadinessInput): AnalysisContext {
		if (context.stage !== "design" && context.stage !== "readiness")
			throw new Error("Analysis must be in design or readiness stage before readiness assessment");
		if (context.status === "completed") throw new Error("Completed analysis cannot be changed");
		if (input.mode !== context.mode || input.assay !== context.assay)
			throw new Error("Readiness cannot silently change the analysis mode or assay; create a revised plan");
		const readiness = assessAnalysisReadiness(input);
		const status = readiness.ok
			? "active"
			: readiness.gates.some((item) => item.severity === "block")
				? "blocked"
				: "paused";
		const next = withStage(
			{
				...context,
				readiness,
				status,
				publicationRequested: input.publicationRequested === true,
				events: [...context.events],
			},
			"readiness",
		);
		return {
			...next,
			events: [...next.events, makeEvent("readiness-assessed", this.now, readiness.ok ? "ready" : "gated")],
		};
	}

	recordDesign(context: AnalysisContext, detail = "design-recorded"): AnalysisContext {
		if (context.stage !== "intake") throw new Error("Analysis design can only start from intake");
		const next = withStage({ ...context, status: "active", events: [...context.events] }, "design");
		return { ...next, events: [...next.events, makeEvent("design-recorded", this.now, detail)] };
	}

	approveExecution(context: AnalysisContext): AnalysisContext {
		if (context.stage !== "readiness" || !context.readiness)
			throw new Error("Analysis must be assessed for readiness before execution approval");
		if (context.status !== "active" || !context.readiness.ok)
			throw new Error("Analysis readiness gate is closed");
		const next = withStage({ ...context, status: "active", events: [...context.events] }, "execution");
		return { ...next, events: [...next.events, makeEvent("execution-approved", this.now)] };
	}

	recordExecution(context: AnalysisContext, result: { ok: boolean; detail?: string }): AnalysisContext {
		if (context.stage !== "execution" || context.status !== "active")
			throw new Error("Analysis is not in execution stage");
		if (!result.ok)
			return {
				...context,
				status: "blocked",
				events: [...context.events, makeEvent("execution-finished", this.now, result.detail ?? "failed")],
			};
		const next = withStage({ ...context, status: "active", events: [...context.events] }, "review");
		return {
			...next,
			events: [...next.events, makeEvent("execution-finished", this.now, result.detail ?? "succeeded")],
		};
	}

	finishReview(
		context: AnalysisContext,
		input: {
			outputsVerified: boolean;
			detail?: string;
			review?: AnalysisReview;
			provenance?: AnalysisProvenance;
		},
	): AnalysisContext {
		if (context.stage !== "review" || context.status !== "active")
			throw new Error("Analysis is not in review stage");
		if (!input.outputsVerified || input.review?.approved === false)
			return {
				...context,
				status: "paused",
				...(input.review ? { review: input.review } : {}),
				...(input.provenance ? { provenance: input.provenance } : {}),
				events: [
					...context.events,
					makeEvent("review-finished", this.now, input.detail ?? "outputs-unverified"),
				],
			};
		const next = withStage({ ...context, status: "active", events: [...context.events] }, "delivery");
		return {
			...next,
			...(input.review ? { review: input.review } : {}),
			...(input.provenance ? { provenance: input.provenance } : {}),
			events: [...next.events, makeEvent("review-finished", this.now, input.detail ?? "verified")],
		};
	}

	complete(
		context: AnalysisContext,
		input: { publicationApproved?: boolean; detail?: string } = {},
	): AnalysisContext {
		if (context.stage !== "delivery" || context.status !== "active")
			throw new Error("Analysis must pass result review before delivery");
		if (context.publicationRequested && input.publicationApproved !== true)
			return {
				...context,
				status: "paused",
				events: [...context.events, makeEvent("paused", this.now, "publication-requires-review")],
			};
		const next = withStage({ ...context, status: "completed", events: [...context.events] }, "completed");
		return {
			...next,
			events: [...next.events, makeEvent("delivered", this.now, input.detail ?? "delivered")],
		};
	}

	resume(context: AnalysisContext): AnalysisContext {
		if (context.status !== "paused") throw new Error("Only a paused analysis can be resumed");
		if (context.stage === "readiness")
			throw new Error("Reassess readiness with resolved evidence before resuming");
		return { ...context, status: "active", events: [...context.events, makeEvent("resumed", this.now)] };
	}
}

export function capabilitiesForAnalysisStage(stage: AnalysisStage): readonly CapabilityId[] {
	return [...STAGE_CAPABILITIES[stage]];
}

/** Adapter payload for the existing capability_load tool. */
export function capabilityLoadRequest(context: Pick<AnalysisContext, "stage" | "assay" | "question">): {
	readonly capabilities: readonly CapabilityId[];
	readonly task: string;
} {
	return {
		capabilities: capabilitiesForAnalysisStage(context.stage),
		task: `${context.assay} ${context.stage} stage: ${context.question}`.slice(0, 1000),
	};
}
