/** Renderer-safe structural projection of the Inquiry provenance ledger. */
export type InquiryReproducibilityStatus = "reproducible" | "partial" | "not-reproducible";
export interface InquiryRunProvenance {
	readonly containerDigests?: readonly string[];
	readonly workflow?: string;
	readonly modules?: readonly string[];
	readonly commandSummary?: string;
	readonly environment?: Readonly<Record<string, string>>;
}
export interface InquiryArtifactRecord {
	readonly id: string;
	readonly schemaVersion: 1;
	readonly projectId: string;
	readonly location: "local" | "remote";
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly source: { readonly kind: string; readonly id: string; readonly version?: string };
	readonly purpose: "input" | "draft" | "intermediate" | "deliverable" | "evidence";
	readonly status: "valid" | "superseded" | "cleanup-candidate" | "archived";
	readonly parentIds: readonly string[];
	readonly runId?: string;
	readonly sessionId?: string;
	readonly turn?: number;
	readonly runProvenance?: InquiryRunProvenance;
	readonly createdAt: string;
	readonly updatedAt: string;
}
export interface InquiryAttemptRecord {
	readonly id: string;
	readonly schemaVersion: 1;
	readonly projectId: string;
	readonly hypothesisIds: readonly string[];
	readonly codeFingerprint?: string;
	readonly parameters: Readonly<Record<string, string | number | boolean | null>>;
	readonly artifactIds: readonly string[];
	readonly resultSummary?: string;
	readonly sessionId?: string;
	readonly turn?: number;
	readonly runProvenance?: InquiryRunProvenance;
	readonly outcome: "running" | "succeeded" | "failed" | "blocked" | "unknown";
	readonly enteredReport: boolean;
	readonly startedAt: string;
	readonly finishedAt?: string;
}
export interface InquiryArtifactProvenance {
	readonly artifact: InquiryArtifactRecord;
	readonly parentChain: readonly InquiryArtifactRecord[];
	readonly parentChainTruncated: boolean;
	readonly attempts: readonly InquiryAttemptRecord[];
	readonly runProvenance?: InquiryRunProvenance;
	readonly sourceSessionId?: string;
	readonly sourceTurn?: number;
	readonly reproducibility: InquiryReproducibilityStatus;
	readonly rerun?: InquiryArtifactRerunRecord | InquiryArtifactRerunResult;
}
export interface InquiryArtifactRerunRecord {
	readonly id: string;
	readonly schemaVersion: 1;
	readonly projectId: string;
	readonly sourceArtifactId: string;
	readonly jobId: string;
	readonly status: "submitted" | "running" | "reproduced" | "superseded" | "failed";
	readonly previousSha256: string;
	readonly resultArtifactId?: string;
	readonly sha256?: string;
	readonly difference?: string;
	readonly error?: string;
	readonly submittedAt: string;
	readonly updatedAt: string;
}
export interface InquiryArtifactRerunResult {
	readonly status: "submitted" | "running" | "reproduced" | "superseded" | "failed";
	readonly jobId: string;
	readonly previousArtifactId: string;
	readonly previousSha256: string;
	readonly artifactId?: string;
	readonly sha256?: string;
	readonly difference?: string;
	readonly error?: string;
}
