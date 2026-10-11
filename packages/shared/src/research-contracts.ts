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

export interface KnowledgeSourceReceipt {
	readonly sourceRef: string;
	readonly version?: string;
	readonly summary?: string;
	readonly contentHash: string;
	readonly receiptRef: string;
	readonly readAt: string;
}

export interface KnowledgeSnapshot extends VersionedResearchContract {
	readonly legacyCheckpoint?: unknown;
	readonly kind: "knowledge-snapshot";
	readonly id: string;
	readonly caseRef?: ContractParentRef;
	readonly environmentFingerprint?: string;
	readonly sources: readonly KnowledgeSourceReceipt[];
	readonly reuseLevel: KnowledgeReuseLevel;
	readonly freshness?: { readonly checkedAt: string; readonly expiresAt?: string };
	readonly methodVersion?: string;
	readonly referenceVersion?: string;
	readonly inputManifestHash?: string;
	readonly createdAt: string;
}

export type CapabilityRequestStatus = "open" | "researching" | "resolved" | "blocked" | "cancelled";

export interface CapabilityRequest extends VersionedResearchContract {
	readonly kind: "capability-request";
	readonly id: string;
	readonly caseRef: ContractParentRef;
	readonly assay: string;
	readonly question: string;
	readonly requirements: readonly string[];
	readonly status: CapabilityRequestStatus;
	readonly recommendedVersionRef?: ContractParentRef;
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

export interface DecisionQuestion {
	readonly id: string;
	readonly question: string;
	readonly options?: readonly string[];
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
	const { contentHash: _contentHash, ...body } = value;
	return contractContentHash(body);
}

export function assertResearchContract(value: VersionedResearchContract): void {
	if (value.schemaVersion !== RESEARCH_CONTRACT_SCHEMA_VERSION) throw new Error("Invalid schemaVersion");
	if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("Invalid revision");
	if (!/^[a-f0-9]{64}$/.test(value.contentHash)) throw new Error("Invalid contentHash");
	if (!Array.isArray(value.parentRefs)) throw new Error("Invalid parentRefs");
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

export function createDecisionProposal(
	input: Omit<DecisionProposal, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): DecisionProposal {
	return base({ ...input, kind: "decision-proposal" as const }, input) as DecisionProposal;
}

export function createDecision(
	input: Omit<Decision, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): Decision {
	return base({ ...input, kind: "decision" as const }, input) as Decision;
}

export function createRunAttempt(
	input: Omit<RunAttempt, keyof VersionedResearchContract | "kind"> & ContractVersionOptions,
): RunAttempt {
	return base({ ...input, kind: "run-attempt" as const }, input) as RunAttempt;
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
	const revision = typeof input.revision === "number" && input.revision >= 0 ? input.revision : 0;
	const parentRefs = Array.isArray(input.parentRefs) ? (input.parentRefs as ContractParentRef[]) : [];
	return {
		schemaVersion: RESEARCH_CONTRACT_SCHEMA_VERSION,
		revision,
		parentRefs,
		migration: {
			fromSchemaVersion: schemaVersion,
			toSchemaVersion: RESEARCH_CONTRACT_SCHEMA_VERSION,
			migrationId,
			migratedAt: new Date().toISOString(),
		},
		contentHash: "",
	};
}

/** Add the common envelope to legacy records without mutating the input. */
export function migrateLegacyContract<T extends Record<string, unknown>>(
	input: T,
	migrationId = "research-contracts/v1",
): T & VersionedResearchContract {
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
		input.outcome === "succeeded"
			? "succeeded"
			: input.outcome === "failed"
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
