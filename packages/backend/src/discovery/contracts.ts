import type {
	AttemptRecord,
	FindingRecord,
	QuestionPosterior,
	QuestionPrior,
	QuestionRecord,
} from "@drone/inquiry";
import type { DiscoveryEvaluation, DiscoveryEvaluationMetric, DiscoveryExplorationPlan } from "@drone/shared";

export type {
	DiscoveryKernelExecution as KernelExecution,
	DiscoveryLanguage as KernelLanguage,
	DiscoveryRunner as ControlledKernelRunner,
} from "@gyoungwe/plugin-api";

export interface InquiryDiscoveryPort {
	recordQuestion(record: QuestionRecord): Promise<void>;
	recordAttempt(record: AttemptRecord): Promise<void>;
	recordFinding?(record: FindingRecord): Promise<void>;
}

type CriticChecklist = readonly [
	"confounding",
	"batch-effect",
	"multiple-testing",
	"data-leakage",
	"circular-analysis",
	"overclaiming",
];

export interface CriticRequest {
	readonly findingId: string;
	readonly findingStatement: string;
	readonly artifactIds: readonly string[];
	readonly primaryProviderId: string;
	readonly checklist?: readonly CriticChecklist[number][];
}

export interface CriticProvider {
	readonly providerId: string;
	review(
		input: CriticRequest & {
			readonly role: {
				readonly id: "critic";
				readonly readOnly: true;
				readonly canWrite: false;
				readonly canShell: false;
				readonly canNetwork: false;
				readonly canDelegate: false;
				readonly checklist: CriticChecklist;
			};
		},
	): Promise<
		readonly {
			readonly checklistItem: CriticChecklist[number];
			readonly question: string;
			readonly severity: "high" | "medium" | "low";
			readonly evidenceArtifactIds: readonly string[];
		}[]
	>;
}

export interface DiscoveryLedgerInput {
	readonly projectId: string;
	readonly questionId: string;
	readonly statement: string;
	readonly hypothesisId?: string;
	readonly prior: QuestionPrior;
	readonly posterior?: QuestionPosterior;
	readonly explanations: readonly {
		readonly id: string;
		readonly statement: string;
		readonly kind: "biological" | "technical" | "sampling" | "procedural";
		readonly plausibility: number;
		readonly testIds: readonly string[];
	}[];
	readonly testsPlanned: readonly string[];
	readonly attemptId: string;
	readonly parameters?: Readonly<Record<string, string | number | boolean | null>>;
	readonly artifactIds?: readonly string[];
}

export interface DiscoveryExplorationPlanInput {
	readonly id: string;
	readonly hypothesisId: string;
	readonly prior: QuestionPrior;
	readonly budget: Readonly<DiscoveryExplorationPlan["budget"]>;
	readonly candidates: readonly {
		readonly id: string;
		readonly statement: string;
		readonly surprise: number;
		readonly estimatedCost: number;
		readonly expectedExplanationsExcluded: number;
		readonly credibility: number;
	}[];
}

export interface MultipathPlan {
	readonly id: string;
	readonly findingId: string;
	readonly paths: readonly {
		readonly id: string;
		readonly parameters?: Readonly<Record<string, string | number | boolean | null>>;
		readonly description: string;
	}[];
	readonly intent: "exploratory" | "confirmatory";
	readonly priorRegistered: boolean;
}

export interface MultipathPathExecutionResult {
	readonly outcome: "succeeded" | "failed" | "blocked" | "unknown";
	readonly signature: string;
	readonly summary: string;
	readonly artifactIds?: readonly string[];
	readonly consistentWithReference: boolean;
}

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

type DiscoveryMetricEvaluation = Readonly<Omit<DiscoveryEvaluation["metrics"][number], "caseIds">> & {
	readonly caseIds: readonly string[];
};

export interface DiscoveryEvaluationRun {
	readonly runId: string;
	readonly status: DiscoveryEvaluation["status"];
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly metrics: readonly DiscoveryMetricEvaluation[];
	readonly observations: Readonly<Record<string, DiscoveryEvaluationObservation>>;
	readonly missingData: readonly string[];
	readonly blockedCases: readonly string[];
}
