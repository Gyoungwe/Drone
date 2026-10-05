/**
 * Durable research-state models.  These records intentionally contain
 * references and summaries, never source contents or credentials.
 */

export const INQUIRY_SCHEMA_VERSION = 2 as const;
export const LEGACY_INQUIRY_SCHEMA_VERSION = 1 as const;
export type InquirySchemaVersion = typeof LEGACY_INQUIRY_SCHEMA_VERSION | typeof INQUIRY_SCHEMA_VERSION;

export type ArtifactLocation = "local" | "remote";
export type ArtifactPurpose = "input" | "draft" | "intermediate" | "deliverable" | "evidence";
export type ArtifactStatus = "valid" | "superseded" | "cleanup-candidate" | "archived" | "pending-review";

/** Bounded run metadata used for provenance display and reproducibility checks. */
export interface RunProvenanceSummary {
	readonly containerDigests?: readonly string[];
	readonly workflow?: string;
	readonly modules?: readonly string[];
	readonly commandSummary?: string;
	readonly environment?: Readonly<Record<string, string>>;
}

export interface ArtifactSource {
	readonly kind: "task" | "run" | "input" | "tool" | "workflow" | "manual";
	readonly id: string;
	readonly version?: string;
}

export interface ArtifactRecord {
	readonly id: string;
	readonly schemaVersion: InquirySchemaVersion;
	readonly projectId: string;
	readonly location: ArtifactLocation;
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly source: ArtifactSource;
	readonly purpose: ArtifactPurpose;
	readonly status: ArtifactStatus;
	/** Parent artifacts form the immutable lineage graph. */
	readonly parentIds: readonly string[];
	/** Revocations still awaiting an explicit human review. */
	readonly pendingReviewDecisionIds?: readonly string[];
	readonly reviews?: readonly ArtifactReview[];
	readonly runId?: string;
	readonly sessionId?: string;
	readonly turn?: number;
	readonly runProvenance?: RunProvenanceSummary;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** Explicit human acknowledgement of one revoked decision's artifact impact. */
export interface ArtifactReview {
	readonly decisionId: string;
	readonly confirmedBy: "user";
	readonly confirmedAt: string;
	readonly reason: string;
}

export type FindingLabel = "exploratory" | "confirmatory";
export type FindingReviewStatus = "unreviewed" | "reviewed" | "rejected";
export type RobustnessGrade = "robust" | "sensitive" | "unstable" | "unknown";

export interface FindingValue {
	readonly metric: string;
	readonly value: number | string | boolean;
	readonly unit?: string;
	readonly confidenceInterval?: readonly [number, number];
}

export interface FindingRobustness {
	readonly attemptCount: number;
	readonly consistentCount: number;
	readonly grade: RobustnessGrade;
}

export interface FindingRecord {
	readonly id: string;
	readonly schemaVersion: InquirySchemaVersion;
	readonly projectId: string;
	readonly statement: string;
	readonly values: readonly FindingValue[];
	readonly conditions: readonly string[];
	readonly artifactIds: readonly string[];
	readonly codeFingerprint?: string;
	readonly label: FindingLabel;
	readonly robustness: FindingRobustness;
	readonly hypothesisIds: readonly string[];
	readonly reviewStatus: FindingReviewStatus;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type QuestionKind = "question" | "hypothesis" | "anomaly";
export type QuestionStatus = "open" | "supported" | "refuted" | "deferred";
export type QuestionProposer = "user" | "agent";
export type PriorDirection = "positive" | "negative" | "none" | "unknown";

export interface QuestionPrior {
	readonly direction: PriorDirection;
	readonly magnitude?: number;
	readonly confidence?: number;
	readonly recordedAt: string;
}

export interface QuestionPosterior {
	readonly direction?: PriorDirection;
	readonly magnitude?: number;
	readonly confidence?: number;
	readonly recordedAt: string;
}

export interface QuestionRecord {
	readonly id: string;
	readonly schemaVersion: InquirySchemaVersion;
	readonly projectId: string;
	readonly kind: QuestionKind;
	readonly statement: string;
	readonly prior?: QuestionPrior;
	readonly posterior?: QuestionPosterior;
	readonly surprise?: number;
	readonly competingExplanations: readonly string[];
	readonly testsDone: readonly string[];
	readonly testsPlanned: readonly string[];
	readonly status: QuestionStatus;
	readonly proposer: QuestionProposer;
	readonly priority: number;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type AttemptOutcome = "running" | "succeeded" | "failed" | "blocked" | "unknown";

export interface AttemptRecord {
	readonly id: string;
	readonly schemaVersion: InquirySchemaVersion;
	readonly projectId: string;
	readonly hypothesisIds: readonly string[];
	readonly codeFingerprint?: string;
	readonly parameters: Readonly<Record<string, string | number | boolean | null>>;
	readonly artifactIds: readonly string[];
	readonly resultSummary?: string;
	readonly sessionId?: string;
	readonly turn?: number;
	readonly runProvenance?: RunProvenanceSummary;
	readonly outcome: AttemptOutcome;
	readonly enteredReport: boolean;
	readonly startedAt: string;
	readonly finishedAt?: string;
}

export type DecisionKind =
	| "task-authorization"
	| "workflow-repair"
	| "subagent-dispatch"
	| "compute-submit"
	| "zotero-write"
	| "rebind";
export type DecisionStatus = "active" | "revoked";

/** A durable, user-visible record of a decision the agent made on the user's behalf. */
export interface DecisionRecord {
	readonly id: string;
	readonly schemaVersion: typeof INQUIRY_SCHEMA_VERSION;
	readonly projectId: string;
	readonly kind: DecisionKind;
	readonly summary: string;
	/** Stable references such as contract hashes, repair records or tool call ids. */
	readonly basis: readonly string[];
	readonly affectedArtifactIds: readonly string[];
	readonly status: DecisionStatus;
	readonly revokedAt?: string;
	readonly revokeReason?: string;
	readonly createdAt: string;
}

export interface InquirySnapshot {
	readonly schemaVersion: InquirySchemaVersion;
	readonly projectId: string;
	readonly revision: number;
	readonly updatedAt: string;
	readonly artifacts: readonly ArtifactRecord[];
	readonly findings: readonly FindingRecord[];
	readonly questions: readonly QuestionRecord[];
	readonly attempts: readonly AttemptRecord[];
	readonly decisions: readonly DecisionRecord[];
	/** Durable one-click rerun state; absent in pre-rerun ledgers. */
	readonly reruns?: readonly ArtifactRerunRecord[];
}

export type InquiryRecord = ArtifactRecord | FindingRecord | QuestionRecord | AttemptRecord | DecisionRecord | ArtifactRerunRecord;

export type ReproducibilityStatus = "reproducible" | "partial" | "not-reproducible";

export interface ArtifactProvenance {
	readonly artifact: ArtifactRecord;
	readonly parentChain: readonly ArtifactRecord[];
	readonly parentChainTruncated: boolean;
	readonly attempts: readonly AttemptRecord[];
	readonly runProvenance?: RunProvenanceSummary;
	readonly sourceSessionId?: string;
	readonly sourceTurn?: number;
	readonly reproducibility: ReproducibilityStatus;
	readonly rerun?: ArtifactRerunRecord;
}

export type ArtifactRerunStatus = "submitted" | "running" | "reproduced" | "superseded" | "failed";

export interface ArtifactRerunRecord {
	readonly id: string;
	readonly schemaVersion: InquirySchemaVersion;
	readonly projectId: string;
	readonly sourceArtifactId: string;
	readonly artifact: ArtifactRecord;
	readonly jobId: string;
	readonly status: ArtifactRerunStatus;
	readonly previousSha256: string;
	readonly resultArtifactId?: string;
	readonly sha256?: string;
	readonly difference?: string;
	readonly error?: string;
	readonly submittedAt: string;
	readonly updatedAt: string;
}

export interface ArtifactRerunResult {
	readonly status: ArtifactRerunStatus;
	readonly jobId: string;
	readonly previousArtifactId: string;
	readonly previousSha256: string;
	readonly artifactId?: string;
	readonly sha256?: string;
	readonly difference?: string;
	readonly error?: string;
}
