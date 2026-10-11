import type { AnalysisContext } from "./analysis-orchestration";
import { sha256 } from "./contract-hash";

/**
 * Versioned records shared by the research, capability, decision and execution
 * layers.  The fields in this envelope are deliberately small and portable so
 * they can be persisted by JsonStore or embedded in a durable document.
 */
export const RESEARCH_CONTRACT_SCHEMA_VERSION = 1 as const;
export type ResearchContractSchemaVersion = typeof RESEARCH_CONTRACT_SCHEMA_VERSION;

export type ContractParentRef =
	| string
	| {
			readonly kind: string;
			readonly id: string;
			readonly revision?: number;
			readonly contentHash?: string;
	  };

export interface ContractMigration {
	readonly fromSchemaVersion: number;
	readonly toSchemaVersion: number;
	readonly migrationId: string;
	readonly migratedAt: string;
}

export interface VersionedRecord {
	readonly schemaVersion: number;
	readonly revision: number;
	readonly contentHash: string;
	readonly parentRefs: readonly ContractParentRef[];
	readonly migration?: ContractMigration;
}

export type VersionedResearchContract = VersionedRecord;

export type ResearchCaseStatus = "active" | "paused" | "blocked" | "completed" | "archived";

export interface ResearchCase extends VersionedResearchContract {
	/** Original analysis snapshot retained during additive migration. */
	readonly legacyAnalysis?: AnalysisContext;
	readonly kind: "research-case";
	readonly id: string;
	readonly projectId: string;
	readonly question: string;
	readonly assay?: string;
	readonly mode?: "exploratory" | "inferential";
	readonly stage?: string;
	readonly status: ResearchCaseStatus;
	readonly branchOf?: ContractParentRef;
	readonly knowledgeSnapshotRefs: readonly ContractParentRef[];
	readonly capabilityRequestRefs: readonly ContractParentRef[];
	readonly capabilityVersionRefs: readonly ContractParentRef[];
	readonly decisionProposalRefs: readonly ContractParentRef[];
	readonly decisionRefs: readonly ContractParentRef[];
	readonly runAttemptRefs: readonly ContractParentRef[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type KnowledgeReuseLevel =
	| "navigation-only"
	| "evidence-eligible"
	| "validated-capability"
	| "reproduced-capability";

/** A conservative evidence grade attached to a source read receipt. */
export type KnowledgeEvidenceGrade = "navigation" | "contextual" | "primary" | "validated" | "reproduced";

export interface KnowledgeFreshness {
	readonly checkedAt: string;
	readonly expiresAt?: string;
	readonly status?: "fresh" | "stale" | "unknown";
}

export interface KnowledgeSourceReceipt {
	readonly sourceRef: string;
	readonly version?: string;
	readonly summary?: string;
	readonly contentHash: string;
	readonly receiptRef: string;
	readonly readAt: string;
	/** Evidence grade is intentionally separate from reuse level. */
	readonly evidenceGrade?: KnowledgeEvidenceGrade;
	/** Compatibility spelling used by older research notes. */
	readonly evidenceLevel?: KnowledgeEvidenceGrade;
	readonly freshness?: KnowledgeFreshness;
	readonly analysisRefs?: readonly ContractParentRef[];
	readonly checkpointRefs?: readonly ContractParentRef[];
}

export interface KnowledgeSnapshot extends VersionedResearchContract {
	readonly legacyCheckpoint?: unknown;
	readonly kind: "knowledge-snapshot";
	readonly id: string;
	readonly caseRef?: ContractParentRef;
	readonly projectId?: string;
	readonly workspaceId?: string;
	readonly assay?: string;
	readonly environmentFingerprint?: string;
	readonly sources: readonly KnowledgeSourceReceipt[];
	readonly reuseLevel: KnowledgeReuseLevel;
	readonly evidenceGrade?: KnowledgeEvidenceGrade;
	readonly evidenceLevel?: KnowledgeEvidenceGrade;
	readonly freshness?: KnowledgeFreshness;
	readonly methodVersion?: string;
	readonly referenceVersion?: string;
	readonly inputManifestHash?: string;
	readonly analysisRefs?: readonly ContractParentRef[];
	readonly evidenceCheckpointRefs?: readonly ContractParentRef[];
	readonly createdAt: string;
	readonly ingestedAt?: string;
}

export type CapabilityRequestStatus = "open" | "researching" | "resolved" | "blocked" | "cancelled";

/** A capability can be recommended before it is registered or enabled. */
export interface CapabilityAvailability {
	readonly recommendedVersionRef?: ContractParentRef;
	readonly registeredVersionRef?: ContractParentRef;
	readonly enabledVersionRef?: ContractParentRef;
}

export interface CapabilityRequest extends VersionedResearchContract {
	readonly kind: "capability-request";
	readonly id: string;
	readonly caseRef: ContractParentRef;
	readonly assay: string;
	readonly question: string;
	readonly requirements: readonly string[];
	readonly status: CapabilityRequestStatus;
	readonly recommendedVersionRef?: ContractParentRef;
	readonly registeredVersionRef?: ContractParentRef;
	readonly enabledVersionRef?: ContractParentRef;
	readonly gapReason?: "unknown-assay" | "ambiguous-version" | "unregistered" | "environment-not-ready";
	readonly researchPlanRef?: ContractParentRef;
	readonly candidateRefs?: readonly ContractParentRef[];
	readonly validationCapsuleRef?: ContractParentRef;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type CapabilityVersionStatus = "candidate" | "recommended" | "enabled" | "retired";

export interface CapabilityVersion extends VersionedResearchContract {
	readonly kind: "capability-version";
	readonly id: string;
	readonly capabilityId: string;
	readonly version: string;
	readonly status: CapabilityVersionStatus;
	readonly contractHash: string;
	readonly adapterRef?: string;
	readonly workflowRef?: string;
	readonly methodRef?: string;
	readonly readiness?: "unknown" | "ready" | "not-ready";
	readonly validationRefs: readonly ContractParentRef[];
	readonly createdAt: string;
}

export type CapabilityCandidateStatus = "described" | "recommended" | "registered" | "enabled" | "rejected";

/** Candidate adapter/workflow description. It is never executable by itself. */
export interface CapabilityCandidate extends VersionedResearchContract {
	readonly kind: "capability-candidate";
	readonly id: string;
	readonly capabilityId: string;
	readonly version?: string;
	readonly assay: string;
	readonly title: string;
	readonly description: string;
	readonly adapterRef?: string;
	readonly workflowRef?: string;
	readonly status: CapabilityCandidateStatus;
	readonly executable: false;
	readonly sourceRefs: readonly ContractParentRef[];
	readonly validationRefs: readonly ContractParentRef[];
	readonly environmentProbeRef?: ContractParentRef;
	readonly createdAt: string;
}

export interface CapabilityResearchPlan extends VersionedResearchContract {
	readonly kind: "capability-research-plan";
	readonly id: string;
	readonly requestRef: ContractParentRef;
	readonly objective: string;
	readonly questions: readonly string[];
	readonly sourceRefs: readonly ContractParentRef[];
	readonly readOnly: true;
	readonly createdAt: string;
}

export interface CapabilitySourceReceipt extends VersionedResearchContract {
	readonly kind: "capability-source-receipt";
	readonly id: string;
	readonly sourceRef: string;
	/** Hash of the observed source; envelope contentHash remains the receipt hash. */
	readonly sourceHash: string;
	readonly locator?: string;
	readonly observedAt: string;
	readonly readOnly: true;
}

export type EnvironmentReadiness = "unknown" | "ready" | "not-ready";

export interface CapabilityEnvironmentProbe extends VersionedResearchContract {
	readonly kind: "capability-environment-probe";
	readonly id: string;
	readonly capabilityRef: string;
	readonly readiness: EnvironmentReadiness;
	readonly observed: Readonly<Record<string, string | number | boolean | null>>;
	readonly missing: readonly string[];
	readonly fingerprint?: string;
	readonly probedAt: string;
}

export type CapabilityValidationKind = "static" | "fixture" | "scientific";
export type CapabilityValidationStatus = "passed" | "failed" | "blocked" | "not-run";

export interface CapabilityValidationGate extends VersionedResearchContract {
	readonly kind: "capability-validation-gate";
	readonly id: string;
	readonly capabilityRef: string;
	readonly validation: CapabilityValidationKind;
	readonly status: CapabilityValidationStatus;
	readonly detail: string;
	readonly evidenceRefs: readonly ContractParentRef[];
	readonly checkedAt: string;
}

/** Immutable, bounded proof bundle. It is evidence, never an execution grant. */
export interface ValidationEvidenceCapsule extends VersionedResearchContract {
	readonly kind: "validation-evidence-capsule";
	readonly id: string;
	readonly capabilityRef: string;
	readonly gateRefs: readonly ContractParentRef[];
	readonly sourceRefs: readonly ContractParentRef[];
	readonly status: "validated" | "failed" | "incomplete";
	readonly createdAt: string;
}

export interface DecisionFinding {
	readonly id: string;
	readonly text: string;
	readonly parentRefs: readonly ContractParentRef[];
}

export interface DecisionCandidate {
	readonly id: string;
	readonly title: string;
	readonly method?: string;
	readonly expectedBenefit?: string;
	readonly tradeoffs: readonly string[];
	readonly resources: readonly string[];
	readonly risks: readonly string[];
	readonly authorizationActions: readonly string[];
	readonly parentRefs: readonly ContractParentRef[];
}

/** A bounded action shown in a decision card. Authorization is explicit per action. */
export interface DecisionAuthorizationAction {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly risk?: "low" | "high";
	readonly scope?: readonly string[];
}

export interface DecisionAuthorizationScope {
	readonly actions: readonly DecisionAuthorizationAction[];
	readonly writeRoots?: readonly string[];
	readonly hosts?: readonly string[];
	readonly workflows?: readonly string[];
	readonly capabilityVersionRef?: ContractParentRef;
	readonly workflowRef?: ContractParentRef;
}

export interface DecisionQuestion {
	readonly id: string;
	readonly question: string;
	readonly options?: readonly string[];
	readonly type?: "single" | "multi" | "text";
	readonly required?: boolean;
	readonly allowCustomText?: boolean;
	/** A recommendation is optional and is never treated as a submitted answer. */
	readonly recommendation?: string;
}

export type DecisionProposalStatus = "draft" | "pending" | "accepted" | "rejected" | "expired";

export interface DecisionProposal extends VersionedResearchContract {
	readonly legacyProposal?: unknown;
	readonly kind: "decision-proposal";
	readonly id: string;
	readonly caseRef: ContractParentRef;
	readonly contextSnapshot?: ContractParentRef;
	/** Content hashes of moving inputs are retained so an old proposal cannot authorize a new run. */
	readonly capabilityVersionRef?: ContractParentRef;
	readonly workflowRef?: ContractParentRef;
	readonly project?: string;
	readonly goal?: string;
	readonly query?: string;
	readonly summary?: string;
	readonly findings: readonly DecisionFinding[];
	readonly candidates: readonly DecisionCandidate[];
	readonly recommendation?: {
		readonly candidateId: string;
		readonly reason: string;
		readonly parentRefs: readonly ContractParentRef[];
	};
	readonly questions: readonly DecisionQuestion[];
	readonly authorizationScope?: DecisionAuthorizationScope;
	readonly highRiskActions?: readonly DecisionAuthorizationAction[];
	readonly status: DecisionProposalStatus;
	readonly expiresAt?: string;
	readonly createdAt: string;
}

export type DecisionStatus = "accepted" | "rejected" | "revoked" | "superseded";

export interface Decision extends VersionedResearchContract {
	readonly kind: "decision";
	readonly id: string;
	readonly proposalRef: ContractParentRef;
	readonly proposalHash: string;
	/** Alias for the immutable decision content hash, retained for audit projections. */
	readonly decisionHash?: string;
	readonly choice?: string;
	readonly notes?: string;
	readonly authorizationScopeHash?: string;
	readonly status: DecisionStatus;
	readonly decidedAt: string;
}

export type RunAttemptStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "blocked"
	| "cancelled"
	| "unknown"
	| "delivery_failed"
	| "replay-failed";

export interface RunAttempt extends VersionedResearchContract {
	readonly kind: "run-attempt";
	readonly id: string;
	readonly caseRef: ContractParentRef;
	readonly capabilityVersionRef?: ContractParentRef;
	readonly decisionRef?: ContractParentRef;
	readonly status: RunAttemptStatus;
	readonly attempt: number;
	readonly idempotencyKey?: string;
	readonly inputRefs: readonly ContractParentRef[];
	readonly outputRefs: readonly ContractParentRef[];
	readonly errorCode?: string;
	readonly failureSignature?: string;
	readonly startedAt?: string;
	readonly finishedAt?: string;
}

export type AnyResearchContract =
	| ResearchCase
	| KnowledgeSnapshot
	| CapabilityRequest
	| CapabilityVersion
	| CapabilityCandidate
	| CapabilityResearchPlan
	| CapabilitySourceReceipt
	| CapabilityEnvironmentProbe
	| CapabilityValidationGate
	| ValidationEvidenceCapsule
	| DecisionProposal
	| Decision
	| RunAttempt;

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, item]) => [key, canonicalize(item)]),
	);
}

export function canonicalContractJson(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

export function contractContentHash(value: unknown): string {
	return sha256(canonicalContractJson(value));
}

/** Hash a contract without trusting a persisted contentHash field. */
export function computeResearchContractHash<T extends VersionedResearchContract>(value: T): string {
	const {
		contentHash: _contentHash,
		decisionHash: _decisionHash,
		...body
	} = value as T & {
		decisionHash?: unknown;
	};
	return contractContentHash(body);
}

/** Stable hash for the decision payload selected by a user. */
export function decisionChoiceHash(input: {
	readonly proposalHash: string;
	readonly choice?: string;
	readonly choices?: readonly string[];
	readonly customText?: string;
	readonly notes?: string;
}): string {
	return contractContentHash({
		proposalHash: input.proposalHash,
		choice: input.choice,
		choices: input.choices ? [...input.choices] : undefined,
		customText: input.customText,
		notes: input.notes,
	});
}

/** Scope hash deliberately includes moving capability/workflow references. */
export function decisionAuthorizationScopeHash(scope: DecisionAuthorizationScope | undefined): string {
	return contractContentHash(scope ?? { actions: [] });
}

function refHash(ref: ContractParentRef | undefined): string | undefined {
	return typeof ref === "object" && typeof ref.contentHash === "string" ? ref.contentHash : undefined;
}

export interface DecisionProposalFreshness {
	readonly proposalHash?: string;
	readonly contextHash?: string;
	readonly capabilityHash?: string;
	readonly workflowHash?: string;
	readonly now?: string;
}

/** Throws when a proposal no longer describes the context/capability/workflow being authorized. */
export function assertDecisionProposalCurrent(
	proposal: DecisionProposal,
	expected: DecisionProposalFreshness = {},
): void {
	const actualProposalHash = computeResearchContractHash(proposal);
	if (
		proposal.contentHash !== actualProposalHash ||
		(expected.proposalHash && expected.proposalHash !== actualProposalHash)
	)
		throw new Error("Decision proposal is stale; refresh before choosing");
	if (
		proposal.status === "expired" ||
		(proposal.expiresAt && expected.now && proposal.expiresAt <= expected.now)
	)
		throw new Error("Decision proposal has expired; regenerate it from current context");
	const checks: Array<[string | undefined, string | undefined, string]> = [
		[expected.contextHash, refHash(proposal.contextSnapshot), "context"],
		[expected.capabilityHash, refHash(proposal.capabilityVersionRef), "capability"],
		[expected.workflowHash, refHash(proposal.workflowRef), "workflow"],
	];
	for (const [want, actual, label] of checks) {
		if (want && want !== actual)
			throw new Error(`Decision proposal ${label} changed; refresh before choosing`);
	}
}

export function assertResearchContract(value: VersionedResearchContract): void {
	if (value.schemaVersion !== RESEARCH_CONTRACT_SCHEMA_VERSION) throw new Error("Invalid schemaVersion");
	if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("Invalid revision");
	if (!/^[a-f0-9]{64}$/.test(value.contentHash)) throw new Error("Invalid contentHash");
	if (!Array.isArray(value.parentRefs)) throw new Error("Invalid parentRefs");
	if (value.migration) {
		if (
			!Number.isSafeInteger(value.migration.fromSchemaVersion) ||
			value.migration.fromSchemaVersion < 0 ||
			value.migration.fromSchemaVersion > value.migration.toSchemaVersion ||
			value.migration.toSchemaVersion !== RESEARCH_CONTRACT_SCHEMA_VERSION ||
			!value.migration.migrationId.trim() ||
			Number.isNaN(Date.parse(value.migration.migratedAt))
		)
			throw new Error("Invalid migration metadata");
	}
	if (value.contentHash !== computeResearchContractHash(value))
		throw new Error("Contract contentHash mismatch");
}

export interface ContractVersionOptions {
	readonly revision?: number;
	readonly parentRefs?: readonly ContractParentRef[];
	readonly migration?: ContractMigration;
}

function base<T extends Record<string, unknown>>(
	body: T,
	options: ContractVersionOptions = {},
): T & VersionedResearchContract {
	const metadata = {
		schemaVersion: RESEARCH_CONTRACT_SCHEMA_VERSION,
		revision: options.revision ?? 0,
		parentRefs: [...(options.parentRefs ?? [])],
		...(options.migration ? { migration: options.migration } : {}),
	};
	const record = JSON.parse(canonicalContractJson({ ...body, ...metadata })) as T & VersionedResearchContract;
	const result = { ...record, contentHash: contractContentHash(record) };
	assertResearchContract(result);
	return result;
}

export interface ResearchCaseInput {
	readonly legacyAnalysis?: AnalysisContext;
	readonly id: string;
	readonly projectId: string;
	readonly question: string;
	readonly assay?: string;
	readonly mode?: "exploratory" | "inferential";
	readonly stage?: string;
	readonly status?: ResearchCaseStatus;
	readonly parentRefs?: readonly ContractParentRef[];
	readonly branchOf?: ContractParentRef;
	readonly knowledgeSnapshotRefs?: readonly ContractParentRef[];
	readonly capabilityRequestRefs?: readonly ContractParentRef[];
	readonly capabilityVersionRefs?: readonly ContractParentRef[];
	readonly decisionProposalRefs?: readonly ContractParentRef[];
	readonly decisionRefs?: readonly ContractParentRef[];
	readonly runAttemptRefs?: readonly ContractParentRef[];
	readonly createdAt?: string;
	readonly updatedAt?: string;
	readonly revision?: number;
	readonly migration?: ContractMigration;
}

export function createResearchCase(input: ResearchCaseInput): ResearchCase {
	const now = new Date().toISOString();
	return base(
		{
			kind: "research-case" as const,
			...(input.legacyAnalysis ? { legacyAnalysis: input.legacyAnalysis } : {}),
			id: input.id,
			projectId: input.projectId,
			question: input.question,
			status: input.status ?? "active",
			...(input.branchOf ? { branchOf: input.branchOf } : {}),
			knowledgeSnapshotRefs: [...(input.knowledgeSnapshotRefs ?? [])],
			capabilityRequestRefs: [...(input.capabilityRequestRefs ?? [])],
			capabilityVersionRefs: [...(input.capabilityVersionRefs ?? [])],
			decisionProposalRefs: [...(input.decisionProposalRefs ?? [])],
			decisionRefs: [...(input.decisionRefs ?? [])],
			runAttemptRefs: [...(input.runAttemptRefs ?? [])],
			createdAt: input.createdAt ?? now,
			updatedAt: input.updatedAt ?? now,
		},
		input,
	) as ResearchCase;
}

export function createKnowledgeSnapshot(
	input: Omit<KnowledgeSnapshot, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): KnowledgeSnapshot {
	return base({ ...input, kind: "knowledge-snapshot" as const }, input) as KnowledgeSnapshot;
}

export function createCapabilityRequest(
	input: Omit<CapabilityRequest, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): CapabilityRequest {
	return base({ ...input, kind: "capability-request" as const }, input) as CapabilityRequest;
}

export function createCapabilityVersion(
	input: Omit<CapabilityVersion, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): CapabilityVersion {
	return base({ ...input, kind: "capability-version" as const }, input) as CapabilityVersion;
}

export function createCapabilityCandidate(
	input: Omit<CapabilityCandidate, keyof VersionedResearchContract | "kind" | "executable"> &
		ContractVersionOptions,
): CapabilityCandidate {
	return base(
		{ ...input, kind: "capability-candidate" as const, executable: false as const },
		input,
	) as CapabilityCandidate;
}

export function createCapabilityResearchPlan(
	input: Omit<CapabilityResearchPlan, keyof VersionedResearchContract | "kind" | "readOnly"> &
		ContractVersionOptions,
): CapabilityResearchPlan {
	return base(
		{ ...input, kind: "capability-research-plan" as const, readOnly: true as const },
		input,
	) as CapabilityResearchPlan;
}

export function createCapabilitySourceReceipt(
	input: Omit<CapabilitySourceReceipt, keyof VersionedResearchContract | "kind" | "readOnly"> &
		ContractVersionOptions,
): CapabilitySourceReceipt {
	return base(
		{ ...input, kind: "capability-source-receipt" as const, readOnly: true as const },
		input,
	) as CapabilitySourceReceipt;
}

export function createCapabilityEnvironmentProbe(
	input: Omit<CapabilityEnvironmentProbe, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): CapabilityEnvironmentProbe {
	return base(
		{ ...input, kind: "capability-environment-probe" as const },
		input,
	) as CapabilityEnvironmentProbe;
}

export function createCapabilityValidationGate(
	input: Omit<CapabilityValidationGate, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): CapabilityValidationGate {
	return base({ ...input, kind: "capability-validation-gate" as const }, input) as CapabilityValidationGate;
}

export function createValidationEvidenceCapsule(
	input: Omit<ValidationEvidenceCapsule, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): ValidationEvidenceCapsule {
	return base({ ...input, kind: "validation-evidence-capsule" as const }, input) as ValidationEvidenceCapsule;
}

export function createDecisionProposal(
	input: Omit<DecisionProposal, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): DecisionProposal {
	return base({ ...input, kind: "decision-proposal" as const }, input) as DecisionProposal;
}

export function createDecision(
	input: Omit<Decision, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): Decision {
	const result = base({ ...input, kind: "decision" as const }, input) as Decision;
	return { ...result, decisionHash: result.contentHash };
}

export interface DecisionSelection {
	readonly choice?: string;
	readonly choices?: readonly string[];
	readonly customText?: string;
	readonly notes?: string;
	readonly authorizedActionIds?: readonly string[];
	readonly authorizationScopeHash?: string;
}

export interface DecisionFromProposalInput extends DecisionSelection, DecisionProposalFreshness {
	readonly id: string;
	readonly status?: Extract<DecisionStatus, "accepted" | "rejected">;
	readonly decidedAt?: string;
}

/** Convert one current proposal and one explicit user selection into an auditable decision. */
export function createDecisionFromProposal(
	proposal: DecisionProposal,
	input: DecisionFromProposalInput,
): Decision {
	assertDecisionProposalCurrent(proposal, input);
	const scopeHash = decisionAuthorizationScopeHash(proposal.authorizationScope);
	if (input.authorizationScopeHash && input.authorizationScopeHash !== scopeHash)
		throw new Error("Authorization scope changed; refresh before choosing");
	const highRisk = (proposal.highRiskActions ?? proposal.authorizationScope?.actions ?? []).filter(
		(action) => action.risk === "high",
	);
	if (highRisk.length) {
		const authorized = new Set(input.authorizedActionIds ?? []);
		if (highRisk.some((action) => !authorized.has(action.id)))
			throw new Error("High-risk actions require separate authorization");
	}
	const proposalHash = computeResearchContractHash(proposal);
	return createDecision({
		id: input.id,
		proposalRef: {
			kind: proposal.kind,
			id: proposal.id,
			revision: proposal.revision,
			contentHash: proposalHash,
		},
		proposalHash,
		choice: input.choice ?? input.choices?.[0] ?? input.customText,
		notes: input.notes,
		authorizationScopeHash: scopeHash,
		status: input.status ?? "accepted",
		decidedAt: input.decidedAt ?? new Date().toISOString(),
	});
}

/** Re-check an accepted decision immediately before execution. */
export function assertDecisionCurrent(
	decision: Decision,
	proposal: DecisionProposal,
	expected: Omit<DecisionProposalFreshness, "proposalHash"> = {},
): void {
	if (decision.status !== "accepted") throw new Error("Decision is not accepted");
	if (decision.proposalHash !== computeResearchContractHash(proposal))
		throw new Error("Decision proposal changed; authorization is stale");
	assertDecisionProposalCurrent(proposal, { ...expected, proposalHash: decision.proposalHash });
	const scopeHash = decisionAuthorizationScopeHash(proposal.authorizationScope);
	if (decision.authorizationScopeHash !== scopeHash)
		throw new Error("Authorization scope changed; authorization is stale");
}

export function canExecuteDecision(
	decision: Decision,
	proposal: DecisionProposal,
	expected: Omit<DecisionProposalFreshness, "proposalHash"> = {},
): boolean {
	try {
		assertDecisionCurrent(decision, proposal, expected);
		return true;
	} catch {
		return false;
	}
}

export function createRunAttempt(
	input: Omit<RunAttempt, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): RunAttempt {
	if (!Number.isSafeInteger(input.attempt) || input.attempt < 1)
		throw new Error("Run attempt number must be a positive integer");
	if (input.idempotencyKey !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.idempotencyKey))
		throw new Error("Run attempt idempotency key is invalid");
	if (input.startedAt !== undefined && !Number.isNaN(Date.parse(input.startedAt))) {
		if (input.finishedAt !== undefined && Date.parse(input.finishedAt) < Date.parse(input.startedAt))
			throw new Error("Run attempt finishedAt precedes startedAt");
	}
	if (
		["succeeded", "failed", "blocked", "cancelled", "delivery_failed", "replay-failed"].includes(input.status)
	) {
		if (!input.finishedAt) throw new Error("Terminal run attempts require finishedAt");
	}
	return base({ ...input, kind: "run-attempt" as const }, input) as RunAttempt;
}

const runAttemptTransitions: Readonly<Record<RunAttemptStatus, readonly RunAttemptStatus[]>> = {
	queued: ["running", "blocked", "cancelled", "unknown"],
	running: ["succeeded", "failed", "blocked", "cancelled", "unknown", "delivery_failed"],
	succeeded: ["delivery_failed", "replay-failed"],
	failed: ["queued", "replay-failed"],
	blocked: ["queued", "replay-failed"],
	cancelled: ["replay-failed"],
	unknown: ["queued", "blocked", "cancelled", "replay-failed"],
	delivery_failed: ["queued", "replay-failed"],
	"replay-failed": [],
};

/**
 * Advance a durable attempt without silently replaying an uncertain effect.
 * Recovery from `unknown` must explicitly return to `queued`, which creates a
 * new revision and lets the host attach a fresh authorization/receipt.
 */
export function transitionRunAttempt(
	attempt: RunAttempt,
	status: RunAttemptStatus,
	input: {
		readonly now: string;
		readonly startedAt?: string;
		readonly finishedAt?: string;
		readonly errorCode?: string;
		readonly failureSignature?: string;
		readonly outputRefs?: readonly ContractParentRef[];
	},
): RunAttempt {
	assertResearchContract(attempt);
	if (attempt.status !== status && !runAttemptTransitions[attempt.status].includes(status))
		throw new Error(`Invalid run attempt transition: ${attempt.status} -> ${status}`);
	const {
		schemaVersion: _schemaVersion,
		revision: _oldRevision,
		contentHash: _oldContentHash,
		parentRefs: _oldParentRefs,
		migration: _oldMigration,
		status: _oldStatus,
		startedAt: _oldStartedAt,
		finishedAt: _oldFinishedAt,
		errorCode: _oldErrorCode,
		failureSignature: _oldFailureSignature,
		...body
	} = attempt;
	const next = {
		...body,
		status,
		...(input.errorCode ? { errorCode: input.errorCode } : {}),
		...(input.failureSignature ? { failureSignature: input.failureSignature } : {}),
		...(input.startedAt || status === "running" ? { startedAt: input.startedAt ?? input.now } : {}),
		...(input.finishedAt ||
		["succeeded", "failed", "blocked", "cancelled", "delivery_failed", "replay-failed"].includes(status)
			? { finishedAt: input.finishedAt ?? input.now }
			: {}),
		...(input.outputRefs ? { outputRefs: [...input.outputRefs] } : {}),
		parentRefs: [
			{ kind: attempt.kind, id: attempt.id, revision: attempt.revision, contentHash: attempt.contentHash },
		],
		revision: attempt.revision + 1,
	} as Omit<RunAttempt, keyof VersionedResearchContract | "kind"> & ContractVersionOptions;
	return createRunAttempt(next);
}

/**
 * Branching starts from the immutable checkpoint/case reference. Execution,
 * decisions and approvals are intentionally empty on a new branch.
 */
export function forkResearchCase(
	parent: ResearchCase,
	input: { id: string; workspace?: string; now?: string },
): ResearchCase {
	assertResearchContract(parent);
	return createResearchCase({
		id: input.id,
		projectId: parent.projectId,
		question: parent.question,
		parentRefs: [
			{ kind: parent.kind, id: parent.id, revision: parent.revision, contentHash: parent.contentHash },
		],
		branchOf: {
			kind: parent.kind,
			id: parent.id,
			revision: parent.revision,
			contentHash: parent.contentHash,
		},
		createdAt: input.now,
		updatedAt: input.now,
	});
}

function migrateBase(input: Record<string, unknown>, migrationId: string): VersionedResearchContract {
	const schemaVersion = typeof input.schemaVersion === "number" ? input.schemaVersion : 0;
	if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0)
		throw new Error("Invalid legacy schemaVersion");
	if (schemaVersion > RESEARCH_CONTRACT_SCHEMA_VERSION)
		throw new Error(`Unsupported future schemaVersion: ${schemaVersion}`);
	const revision = typeof input.revision === "number" && input.revision >= 0 ? input.revision : 0;
	const parentRefs = Array.isArray(input.parentRefs) ? (input.parentRefs as ContractParentRef[]) : [];
	const migration = input.migration;
	const migratedAt =
		typeof migration === "object" &&
		migration !== null &&
		typeof (migration as { migratedAt?: unknown }).migratedAt === "string"
			? (migration as { migratedAt: string }).migratedAt
			: typeof input.updatedAt === "string"
				? input.updatedAt
				: typeof input.createdAt === "string"
					? input.createdAt
					: "1970-01-01T00:00:00.000Z";
	return {
		schemaVersion: RESEARCH_CONTRACT_SCHEMA_VERSION,
		revision,
		parentRefs,
		migration: {
			fromSchemaVersion: schemaVersion,
			toSchemaVersion: RESEARCH_CONTRACT_SCHEMA_VERSION,
			migrationId,
			migratedAt,
		},
		contentHash: "",
	};
}

/** Add the common envelope to legacy records without mutating the input. */
export function migrateLegacyContract<T extends Record<string, unknown>>(
	input: T,
	migrationId = "research-contracts/v1",
): T & VersionedResearchContract {
	if (input.schemaVersion === RESEARCH_CONTRACT_SCHEMA_VERSION) {
		assertResearchContract(input as T & VersionedResearchContract);
		return { ...input } as T & VersionedResearchContract;
	}
	const metadata = migrateBase(input, migrationId);
	const {
		contentHash: _oldHash,
		schemaVersion: _oldSchema,
		revision: _oldRevision,
		parentRefs: _oldParents,
		migration: _oldMigration,
		...body
	} = input;
	const clean = { ...body, ...metadata };
	const result = { ...clean, contentHash: computeResearchContractHash(clean) } as T &
		VersionedResearchContract;
	assertResearchContract(result);
	return result;
}

export function researchCaseFromAnalysisContext(
	context: AnalysisContext,
	options: { projectId?: string; now?: string } = {},
): ResearchCase {
	const createdAt = context.events[0]?.at ?? options.now ?? "1970-01-01T00:00:00.000Z";
	const updatedAt = context.events.at(-1)?.at ?? createdAt;
	return createResearchCase({
		id: context.id,
		legacyAnalysis: { ...context, events: [...context.events], capabilities: [...context.capabilities] },
		projectId: options.projectId ?? "default",
		question: context.question,
		status: context.status,
		createdAt,
		updatedAt,
		parentRefs: context.branchOf ? [{ kind: "evidence-checkpoint", id: context.branchOf.checkpointId }] : [],
		branchOf: context.branchOf ? { kind: "analysis", id: context.branchOf.analysisId } : undefined,
		migration: {
			fromSchemaVersion: context.version,
			toSchemaVersion: RESEARCH_CONTRACT_SCHEMA_VERSION,
			migrationId: "analysis-context/v1",
			migratedAt: options.now ?? updatedAt,
		},
	});
}

export function runAttemptFromLegacy(
	input: {
		id: string;
		projectId?: string;
		hypothesisIds?: readonly string[];
		artifactIds?: readonly string[];
		outcome?: string;
		startedAt?: string;
		finishedAt?: string;
	},
	caseRef: ContractParentRef,
): RunAttempt {
	const status: RunAttemptStatus =
		input.outcome === "succeeded" && input.finishedAt
			? "succeeded"
			: input.outcome === "failed" && input.finishedAt
				? "failed"
				: input.outcome === "unknown"
					? "unknown"
					: "queued";
	return createRunAttempt({
		id: input.id,
		caseRef,
		status,
		attempt: 1,
		inputRefs: (input.hypothesisIds ?? []).map((id) => ({ kind: "hypothesis", id })),
		outputRefs: (input.artifactIds ?? []).map((id) => ({ kind: "artifact", id })),
		...(input.startedAt ? { startedAt: input.startedAt } : {}),
		...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
	});
}
