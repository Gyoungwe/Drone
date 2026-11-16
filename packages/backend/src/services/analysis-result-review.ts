import type { AnalysisContext, AnalysisReviewCheck } from "@drone/shared";

export interface AnalysisReviewArtifact {
	readonly path: string;
	readonly bytes?: number;
	readonly sha256?: string;
	readonly text?: string;
}

export interface AnalysisReviewRequest {
	readonly context: AnalysisContext;
	readonly jobId: string;
	readonly workflow: unknown;
	readonly artifacts: readonly AnalysisReviewArtifact[];
	readonly limitations: readonly string[];
	readonly checks: readonly AnalysisReviewCheck[];
	readonly reviewInstructions: string;
}

export interface AnalysisReviewDecision {
	readonly approved: boolean;
	readonly detail: string;
	readonly reportMarkdown: string;
}

export type AnalysisResultReviewer = (request: AnalysisReviewRequest) => Promise<AnalysisReviewDecision>;
