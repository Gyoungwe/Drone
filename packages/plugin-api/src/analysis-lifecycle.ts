import type {
	AnalysisContext,
	AnalysisGateCode,
	AnalysisIdentity,
	AnalysisMode,
	AnalysisReviewCheck,
} from "./index.js";

export const ANALYSIS_LIFECYCLE_CONTRACT_VERSION = 1 as const;
export type AnalysisLifecycleStage =
	| "intake"
	| "design"
	| "readiness"
	| "execution"
	| "review"
	| "delivery"
	| "completed";
export type AnalysisLifecycleStatus = "active" | "paused" | "blocked" | "completed";
export type AnalysisLifecycleCapability =
	| "knowledge"
	| "research"
	| "analysis"
	| "literature"
	| "writing"
	| "planning"
	| "coding"
	| "web"
	| "files"
	| "visualization"
	| "external";
export type AnalysisLifecycleGateCode =
	| AnalysisGateCode
	| "unsupported-assay"
	| "compute-authorization-required"
	| "destructive-operation-requires-review"
	| "publication-requires-review";
export interface AnalysisLifecycleGate {
	readonly code: AnalysisLifecycleGateCode;
	readonly severity: "pause" | "block";
	readonly message: string;
	readonly evidenceKey: string;
}
export interface AnalysisLifecycleReadiness {
	readonly ok: boolean;
	readonly inferentialClaimsAllowed: boolean;
	readonly gates: readonly AnalysisLifecycleGate[];
	readonly warnings: readonly string[];
}
export interface AnalysisLifecycleReadinessInput {
	readonly mode: AnalysisMode;
	readonly assay: string;
	readonly assessment: AnalysisLifecycleReadiness;
	readonly computeAuthorized: boolean;
	readonly destructiveOperation?: boolean;
	readonly publicationRequested?: boolean;
}
export interface AnalysisLifecycleLineage {
	readonly schemaVersion: 1;
	readonly eventId: string;
	readonly causationId?: string;
	readonly runAttemptId?: string;
}
export interface AnalysisLifecycleArtifactVersion {
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
export interface AnalysisLifecycleExecutionContext {
	readonly schemaVersion: 1;
	readonly revision: string;
	readonly observedAt: string;
	readonly source: "runner" | "host" | "replay";
	readonly values: Readonly<Record<string, string | number | boolean | null>>;
}
export interface AnalysisLifecycleProvenance {
	readonly adapter: AnalysisIdentity;
	readonly workflow: AnalysisIdentity;
	readonly method: AnalysisIdentity;
	readonly specSha256: string;
	readonly adapterSnapshotSha256?: string;
	readonly toolContractSha256?: string;
	readonly executionContext?: AnalysisLifecycleExecutionContext;
	readonly artifacts: readonly AnalysisLifecycleArtifactVersion[];
	readonly lineage?: AnalysisLifecycleLineage;
	readonly reproducibility: {
		readonly status: "not-assessed" | "recorded" | "verified" | "failed";
		readonly detail: string;
		readonly environmentFingerprint?: string;
		readonly checkpointId?: string;
	};
}
export interface AnalysisLifecycleReview {
	readonly approved: boolean;
	readonly detail: string;
	readonly limitations: readonly string[];
	readonly reportPath?: string;
	readonly checks?: readonly AnalysisReviewCheck[];
	readonly modelStatus?: "approved" | "rejected" | "unavailable";
}
export interface AnalysisLifecycleEvent {
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
export interface AnalysisLifecycleContext extends AnalysisContext {
	readonly branchOf?: {
		readonly analysisId: string;
		readonly checkpointId: string;
		readonly workspace: string;
	};
	readonly stage: AnalysisLifecycleStage;
	readonly status: AnalysisLifecycleStatus;
	readonly capabilities: readonly AnalysisLifecycleCapability[];
	readonly readiness: AnalysisLifecycleReadiness | null;
	readonly review?: AnalysisLifecycleReview;
	readonly provenance?: AnalysisLifecycleProvenance;
	readonly publicationRequested: boolean;
	readonly events: readonly AnalysisLifecycleEvent[];
}
export interface AnalysisLifecycleComputeBinding {
	readonly jobId: string;
	readonly specSha256: string;
	readonly adapter: AnalysisIdentity;
	readonly workflow: AnalysisIdentity;
	readonly method: AnalysisIdentity;
	readonly adapterSnapshotSha256: string;
	readonly toolContractSha256: string;
	readonly executionContext?: AnalysisLifecycleExecutionContext;
	readonly requiredOutputs: readonly string[];
	readonly inputs: readonly AnalysisLifecycleArtifactVersion[];
	readonly lineage?: AnalysisLifecycleLineage;
}
export interface AnalysisLifecycleLedger {
	readonly version: 1;
	readonly runs: Readonly<Record<string, AnalysisLifecycleContext>>;
	readonly bindings?: Readonly<Record<string, AnalysisLifecycleComputeBinding>>;
}
export interface AnalysisLifecycleCreateInput {
	readonly id: string;
	readonly question: string;
	readonly assay: string;
	readonly mode: AnalysisMode;
	readonly adapter?: AnalysisIdentity;
}
export interface AnalysisLifecycleReviewInput {
	readonly outputsVerified: boolean;
	readonly detail?: string;
	readonly review?: AnalysisLifecycleReview;
	readonly provenance?: AnalysisLifecycleProvenance;
}
export type AnalysisLifecycleCommand =
	| { readonly type: "create"; readonly input: AnalysisLifecycleCreateInput }
	| {
			readonly type: "fork-checkpoint";
			readonly snapshot: AnalysisLifecycleContext;
			readonly branch: { readonly id: string; readonly checkpointId: string; readonly workspace: string };
	  }
	| { readonly type: "record-design"; readonly id: string; readonly detail?: string }
	| {
			readonly type: "assess-readiness";
			readonly id: string;
			readonly input: AnalysisLifecycleReadinessInput;
			readonly binding?: AnalysisLifecycleComputeBinding;
	  }
	| { readonly type: "approve-execution"; readonly id: string }
	| {
			readonly type: "record-execution";
			readonly id: string;
			readonly result: { readonly ok: boolean; readonly detail?: string };
	  }
	| { readonly type: "finish-review"; readonly id: string; readonly input: AnalysisLifecycleReviewInput }
	| {
			readonly type: "complete";
			readonly id: string;
			readonly input?: { readonly publicationApproved?: boolean; readonly detail?: string };
	  }
	| { readonly type: "resume"; readonly id: string };
export interface AnalysisLifecycleClock {
	readonly at: string;
}
export interface AnalysisLifecycleResult {
	readonly record: AnalysisLifecycleLedger;
	readonly events: readonly AnalysisLifecycleEvent[];
}
export interface AnalysisLifecyclePort {
	readonly contractVersion: typeof ANALYSIS_LIFECYCLE_CONTRACT_VERSION;
	empty(): AnalysisLifecycleLedger;
	get(record: AnalysisLifecycleLedger, id: string): AnalysisLifecycleContext | undefined;
	list(record: AnalysisLifecycleLedger): readonly AnalysisLifecycleContext[];
	getComputeBinding(record: AnalysisLifecycleLedger, id: string): AnalysisLifecycleComputeBinding | undefined;
	assessReadiness(input: AnalysisLifecycleReadinessInput): AnalysisLifecycleReadiness;
	capabilitiesForStage(stage: AnalysisLifecycleStage): readonly AnalysisLifecycleCapability[];
	capabilityLoadRequest(context: Pick<AnalysisLifecycleContext, "stage" | "assay" | "question">): {
		readonly capabilities: readonly AnalysisLifecycleCapability[];
		readonly task: string;
	};
	apply(
		record: AnalysisLifecycleLedger,
		command: AnalysisLifecycleCommand,
		clock: AnalysisLifecycleClock,
	): AnalysisLifecycleResult;
}
export interface AnalysisLifecycleHostLoader {
	readonly contractVersion: typeof ANALYSIS_LIFECYCLE_CONTRACT_VERSION;
	load(): AnalysisLifecyclePort;
}

export { assertAnalysisLifecycleResult } from "./analysis-lifecycle-validation.js";
