/**
 * Host-neutral contracts used by the knowledge capability.
 *
 * These declarations intentionally contain no knowledge implementation.  The
 * installable provider owns persistence and review algorithms; hosts only
 * exchange the bounded observations described here.
 */

export type ExperienceStatus = "observed" | "verified";
export type ExperienceOutcome = "success" | "failure" | "blocked" | "unknown";

/** Host-neutral payloads transported by daily discovery and memory-note seams. */
export interface DailyIdea {
	title: string;
	idea: string;
	basis: readonly string[];
	test: string;
	whyOverlooked: string;
}

export interface MemoryNoteInput {
	id: number;
	kind: string;
	title: string;
	body: string;
	sessionId?: string;
	createdAt: number;
	files?: readonly string[];
}

export interface ExperienceArtifact {
	path?: string;
	sha256: string;
	bytes?: number;
}

export interface ExperienceRepair {
	succeeded: boolean;
	summary?: string | null;
	observationId?: string | null;
}

export type WorkflowSpecDiffValue = string | number | boolean | null;
export interface WorkflowSpecDiff {
	path: string;
	before?: WorkflowSpecDiffValue;
	after?: WorkflowSpecDiffValue;
}

export interface ExperienceResourceUse {
	[key: string]: number;
}

export interface ExperienceQcDistribution {
	[key: string]: number | undefined;
	min?: number;
	max?: number;
	mean?: number;
	median?: number;
	p95?: number;
	count?: number;
}

export interface ExperienceQcMetric {
	name: string;
	unit?: string | null;
	value?: number | null;
	count?: number | null;
	distribution?: ExperienceQcDistribution;
	values?: number[];
}

export interface ExperienceProvenance {
	runId?: string | null;
	observationId?: string | null;
	receiptId?: string | null;
	manifestSha256?: string | null;
	artifactHashes?: readonly ExperienceArtifact[];
}

export interface ExperienceObservation {
	id: string;
	outcome: ExperienceOutcome;
	observedAt?: string;
	exitCode?: number | null;
	featureKey?: string;
	repairSucceeded?: boolean;
	failureSignature?: string | null;
	failedStep?: string | null;
	step?: string | null;
	repair?: ExperienceRepair | null;
	workflowSpecDiff?: readonly WorkflowSpecDiff[] | null;
	resourceUse?: ExperienceResourceUse | null;
	qcMetrics?: readonly ExperienceQcMetric[] | null;
	qc?: readonly ExperienceQcMetric[] | null;
	modelSummary?: string | null;
	contractHash?: string | null;
	workflow?: string | null;
	workflowRevision?: string | null;
	scheduler?: string | null;
	schedulerJobId?: string | null;
	artifactRefs?: readonly ExperienceArtifact[] | null;
	provenance?: ExperienceProvenance;
}

export interface TerminalJobExperienceInput {
	jobId: string;
	featureKey?: string;
	summary: string;
	outcome: ExperienceOutcome;
	exitCode?: number | null;
	step?: string | null;
	failureSignature?: string | null;
	repairSucceeded?: boolean;
	failedStep?: string | null;
	repair?: ExperienceRepair | null;
	workflowSpecDiff?: readonly WorkflowSpecDiff[] | null;
	resourceUse?: ExperienceResourceUse | null;
	qcMetrics?: readonly ExperienceQcMetric[] | null;
	qc?: readonly ExperienceQcMetric[] | null;
	modelSummary?: string | null;
	contractHash?: string | null;
	workflow?: string | null;
	workflowRevision?: string | null;
	scheduler?: string | null;
	schedulerJobId?: string | null;
	artifactRefs?: readonly ExperienceArtifact[] | null;
	observationId: string;
	observedAt?: string;
	topicId?: string | null;
	provenance: ExperienceProvenance;
	tags?: readonly string[];
	sourceRefs?: readonly string[];
}

export interface ExperienceInput {
	jobId?: string;
	featureKey?: string;
	summary: string;
	observation?: ExperienceObservation;
	hostObservation?: ExperienceObservation;
	provenance?: ExperienceProvenance;
	topicId?: string | null;
	reason?: string | null;
	tags?: readonly string[];
	sourceRefs?: readonly string[];
	exitCode?: number | null;
	failureSignature?: string | null;
	failedStep?: string | null;
	repairSucceeded?: boolean;
	step?: string | null;
	repair?: ExperienceRepair | null;
	workflowSpecDiff?: readonly WorkflowSpecDiff[] | null;
	resourceUse?: ExperienceResourceUse | null;
	qcMetrics?: readonly ExperienceQcMetric[] | null;
	qc?: readonly ExperienceQcMetric[] | null;
	modelSummary?: string | null;
	contractHash?: string | null;
	workflow?: string | null;
	workflowRevision?: string | null;
	scheduler?: string | null;
	schedulerJobId?: string | null;
	artifactRefs?: readonly ExperienceArtifact[] | null;
	command?: unknown;
	output?: unknown;
	credentials?: unknown;
}

export interface ExperienceRecord {
	id: string;
	version: 1;
	vaultId: string;
	project: string;
	hostId: string;
	jobId: string;
	featureKey: string;
	topicId: string | null;
	summary: string;
	reason: string | null;
	outcome: ExperienceOutcome;
	status: ExperienceStatus;
	observedAt: string;
	observationIds: string[];
	observationCount: number;
	jobIds: string[];
	jobCount: number;
	failureSignature: string | null;
	exitCode: number | null;
	failedStep: string | null;
	repair: ExperienceRepair | null;
	workflowSpecDiff: WorkflowSpecDiff[];
	resourceUse: ExperienceResourceUse;
	qcMetrics: ExperienceQcMetric[];
	modelSummary: string | null;
	modelGenerated: boolean;
	contractHash: string | null;
	workflow: string | null;
	workflowRevision: string | null;
	scheduler: string | null;
	schedulerJobId: string | null;
	artifactRefs: ExperienceArtifact[];
	provenance: ExperienceProvenance;
	tags: string[];
	sourceRefs: string[];
	navigationOnly: true;
	evidenceEligible: false;
	instructionEligible: false;
	createdAt: string;
	updatedAt: string;
}

export interface ExperienceStorePort {
	record(
		input: ExperienceInput,
		expectedRevision?: number,
	): Promise<{ classification: string; record: ExperienceRecord; revision: number }>;
}

export type ReviewerSeverity = "low" | "medium" | "high";
export type ReviewerTrigger = "deliverable-write" | "milestone-complete" | "publication-projection";

export interface DeliverableReviewLocation {
	kind: "body" | "paragraph" | "line" | "artifact";
	paragraph?: number;
	line?: number;
	artifactId?: string;
	path?: string;
}

export interface DeliverableReviewFinding {
	id: string;
	code:
		| "untraceable-number"
		| "figure-code-mismatch"
		| "citation-without-receipt"
		| "review-timeout"
		| "review-budget-exhausted";
	severity: ReviewerSeverity;
	location: DeliverableReviewLocation;
	detail: string;
	suggestion: string;
	handled: boolean;
	independent?: boolean;
	nonIndependentReason?: string;
}

export interface ReviewDeliverableRecord {
	id: string;
	path?: string;
	kind?: string;
	sha256?: string;
	attemptId?: string;
	receiptId?: string;
}

export interface ReviewAttemptRecord {
	id: string;
	artifactIds?: readonly string[];
	startedAt?: string;
	finishedAt?: string;
	outputs?: readonly { artifactId: string; sha256: string }[];
	artifactSha256?: Readonly<Record<string, string>>;
}

export interface ReviewReadReceipt {
	path: string;
	hash?: string;
	receiptRef?: string;
	text?: string;
	numbers?: readonly { value: number | string; tolerance?: number }[];
}

export interface DeliverableReviewSnapshot {
	enabled?: boolean;
	artifacts?: readonly unknown[];
	numbers?: readonly unknown[];
	executed?: unknown;
	methods?: readonly unknown[];
	findings?: readonly unknown[];
	uses?: readonly unknown[];
	diagnostics?: readonly unknown[];
	body?: string;
	answer?: string;
	deliverables?: readonly ReviewDeliverableRecord[];
	attempts?: readonly ReviewAttemptRecord[];
	readReceipts?: readonly ReviewReadReceipt[];
	citations?: readonly string[];
}

export interface ReviewerModelProvider {
	provider: string;
	model?: string;
}

export interface ReviewerProviderSelection {
	provider: string;
	model?: string;
	independent: boolean;
	nonIndependentReason?: string;
}

export interface BackgroundReviewerOptions {
	timeoutMs?: number;
	maxPerSession?: number;
	review?: (
		snapshot: DeliverableReviewSnapshot,
	) => DeliverableReviewFinding[] | Promise<DeliverableReviewFinding[]>;
	modelReview?: (
		snapshot: DeliverableReviewSnapshot,
		selection: ReviewerProviderSelection,
	) => DeliverableReviewFinding[] | Promise<DeliverableReviewFinding[]>;
	mainProvider?: string;
	providers?: readonly ReviewerModelProvider[];
	getProviders?: () => readonly ReviewerModelProvider[] | Promise<readonly ReviewerModelProvider[]>;
	useModel?: () => boolean | Promise<boolean>;
	onResult?: (
		sessionId: string,
		result: { contentHash: string; findings: readonly DeliverableReviewFinding[] },
		trigger: ReviewerTrigger,
	) => void | Promise<void>;
	now?: () => number;
}

export interface BackgroundReviewRequest {
	sessionId: string;
	snapshot: DeliverableReviewSnapshot;
	trigger: ReviewerTrigger;
	mainProvider?: string;
}
