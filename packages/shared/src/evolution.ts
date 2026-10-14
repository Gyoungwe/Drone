import {
	assertResearchContract,
	type ContractParentRef,
	computeResearchContractHash,
	RESEARCH_CONTRACT_SCHEMA_VERSION,
	type VersionedResearchContract,
} from "./research-contracts";

/**
 * Durable proposal for turning repeated, observed experience into a reusable
 * workflow or knowledge improvement. A proposal is never executable by itself.
 */
export type EvolutionCandidateStatus = "proposed" | "approved" | "rejected" | "superseded" | "revoked";

export interface EvolutionCandidate extends VersionedResearchContract {
	readonly kind: "evolution-candidate";
	readonly id: string;
	readonly projectRef: ContractParentRef;
	readonly runRefs: readonly ContractParentRef[];
	readonly knowledgeSnapshotRefs: readonly ContractParentRef[];
	readonly experienceRefs: readonly ContractParentRef[];
	readonly observationCount: number;
	readonly minimumObservations: number;
	readonly proposal: string;
	readonly status: EvolutionCandidateStatus;
	readonly executionEligible: boolean;
	readonly approvalRef?: ContractParentRef;
	readonly supersedesRef?: ContractParentRef;
	readonly revokedByRef?: ContractParentRef;
	readonly reason?: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type KnowledgeReuseDecisionStatus = "eligible" | "blocked" | "approved" | "rejected" | "revoked";

/**
 * Persisted decision record for consuming a KnowledgeSnapshot in a new run.
 * Approval is explicit and separate from eligibility; only approved records
 * may authorize executable reuse.
 */
export interface KnowledgeReuseDecisionRecord extends VersionedResearchContract {
	readonly kind: "knowledge-reuse-decision";
	readonly id: string;
	readonly projectRef: ContractParentRef;
	readonly runRef: ContractParentRef;
	readonly snapshotRef: ContractParentRef;
	readonly status: KnowledgeReuseDecisionStatus;
	readonly reusable: boolean;
	readonly reasons: readonly string[];
	readonly executionEligible: boolean;
	readonly approvalRef?: ContractParentRef;
	readonly revokedByRef?: ContractParentRef;
	readonly evaluatedAt: string;
}

interface ContractOptions {
	readonly revision?: number;
	readonly parentRefs?: readonly ContractParentRef[];
}

function contract<T extends Record<string, unknown>>(
	body: T,
	options: ContractOptions = {},
): T & VersionedResearchContract {
	const record = {
		...body,
		schemaVersion: RESEARCH_CONTRACT_SCHEMA_VERSION,
		revision: options.revision ?? 0,
		parentRefs: [...(options.parentRefs ?? [])],
	} as unknown as T & VersionedResearchContract;
	const result = { ...record, contentHash: computeResearchContractHash(record) };
	assertResearchContract(result);
	return result;
}

function requireRef(ref: ContractParentRef | undefined, label: string): ContractParentRef {
	if (!ref || (typeof ref === "string" ? !ref.trim() : !ref.id.trim() || !ref.kind.trim()))
		throw new Error(`${label} is required`);
	return ref;
}

function refOf(value: VersionedResearchContract & { kind: string; id: string }): ContractParentRef {
	return { kind: value.kind, id: value.id, revision: value.revision, contentHash: value.contentHash };
}

export function createEvolutionCandidate(input: {
	readonly id: string;
	readonly projectRef: ContractParentRef;
	readonly runRefs: readonly ContractParentRef[];
	readonly knowledgeSnapshotRefs?: readonly ContractParentRef[];
	readonly experienceRefs: readonly ContractParentRef[];
	readonly observationCount: number;
	readonly minimumObservations?: number;
	readonly proposal: string;
	readonly createdAt: string;
}): EvolutionCandidate {
	const minimumObservations = input.minimumObservations ?? 2;
	if (!input.id.trim() || !input.proposal.trim())
		throw new Error("Evolution candidate identity and proposal are required");
	if (!Number.isSafeInteger(input.observationCount) || input.observationCount < minimumObservations)
		throw new Error("Evolution candidate requires repeated observations before approval");
	if (!Number.isSafeInteger(minimumObservations) || minimumObservations < 2)
		throw new Error("Evolution candidate minimum observations must be at least two");
	if (!input.runRefs.length || !input.experienceRefs.length)
		throw new Error("Evolution candidate lineage is required");
	if (input.experienceRefs.length < minimumObservations)
		throw new Error("Evolution candidate experience lineage must cover every required observation");
	return contract({
		kind: "evolution-candidate" as const,
		id: input.id,
		projectRef: requireRef(input.projectRef, "projectRef"),
		runRefs: [...input.runRefs],
		knowledgeSnapshotRefs: [...(input.knowledgeSnapshotRefs ?? [])],
		experienceRefs: [...input.experienceRefs],
		observationCount: input.observationCount,
		minimumObservations,
		proposal: input.proposal,
		status: "proposed" as const,
		executionEligible: false as const,
		createdAt: input.createdAt,
		updatedAt: input.createdAt,
	});
}

/** Human approval is the only transition that makes an evolution executable. */
export function approveEvolutionCandidate(
	candidate: EvolutionCandidate,
	approvalRef: ContractParentRef,
	updatedAt: string,
): EvolutionCandidate {
	if (candidate.status !== "proposed") throw new Error("Only a proposed evolution candidate can be approved");
	if (candidate.observationCount < candidate.minimumObservations)
		throw new Error("Evolution candidate does not meet its repeated-observation gate");
	const approval = requireRef(approvalRef, "approvalRef");
	return contract(
		{
			...candidate,
			status: "approved" as const,
			executionEligible: true as const,
			approvalRef: approval,
			updatedAt,
		},
		{ revision: candidate.revision + 1, parentRefs: [refOf(candidate), approval] },
	);
}

export function supersedeEvolutionCandidate(
	candidate: EvolutionCandidate,
	supersedingRef: ContractParentRef,
	updatedAt: string,
): EvolutionCandidate {
	if (candidate.status === "revoked") throw new Error("A revoked evolution candidate cannot be superseded");
	const superseding = requireRef(supersedingRef, "supersedingRef");
	return contract(
		{
			...candidate,
			status: "superseded" as const,
			executionEligible: false as const,
			supersedesRef: superseding,
			updatedAt,
		},
		{ revision: candidate.revision + 1, parentRefs: [refOf(candidate), superseding] },
	);
}

export function revokeEvolutionCandidate(
	candidate: EvolutionCandidate,
	revokedByRef: ContractParentRef,
	reason: string,
	updatedAt: string,
): EvolutionCandidate {
	if (!reason.trim()) throw new Error("Revocation reason is required");
	const revokedBy = requireRef(revokedByRef, "revokedByRef");
	return contract(
		{
			...candidate,
			status: "revoked" as const,
			executionEligible: false as const,
			revokedByRef: revokedBy,
			reason,
			updatedAt,
		},
		{ revision: candidate.revision + 1, parentRefs: [refOf(candidate), revokedBy] },
	);
}

export function createKnowledgeReuseDecision(input: {
	readonly id: string;
	readonly projectRef: ContractParentRef;
	readonly runRef: ContractParentRef;
	readonly snapshotRef: ContractParentRef;
	readonly reusable: boolean;
	readonly reasons: readonly string[];
	readonly evaluatedAt: string;
}): KnowledgeReuseDecisionRecord {
	return contract({
		kind: "knowledge-reuse-decision" as const,
		id: input.id,
		projectRef: requireRef(input.projectRef, "projectRef"),
		runRef: requireRef(input.runRef, "runRef"),
		snapshotRef: requireRef(input.snapshotRef, "snapshotRef"),
		status: input.reusable ? ("eligible" as const) : ("blocked" as const),
		reusable: input.reusable,
		reasons: [...input.reasons],
		executionEligible: false as const,
		evaluatedAt: input.evaluatedAt,
	});
}

export function approveKnowledgeReuse(
	decision: KnowledgeReuseDecisionRecord,
	approvalRef: ContractParentRef,
	evaluatedAt: string,
): KnowledgeReuseDecisionRecord {
	if (decision.status !== "eligible" || !decision.reusable)
		throw new Error("Only an eligible reuse decision can be approved");
	const approval = requireRef(approvalRef, "approvalRef");
	return contract(
		{
			...decision,
			status: "approved" as const,
			executionEligible: true as const,
			approvalRef: approval,
			evaluatedAt,
		},
		{ revision: decision.revision + 1, parentRefs: [refOf(decision), approval] },
	);
}

export function revokeKnowledgeReuse(
	decision: KnowledgeReuseDecisionRecord,
	revokedByRef: ContractParentRef,
	evaluatedAt: string,
): KnowledgeReuseDecisionRecord {
	const revokedBy = requireRef(revokedByRef, "revokedByRef");
	return contract(
		{
			...decision,
			status: "revoked" as const,
			executionEligible: false as const,
			revokedByRef: revokedBy,
			evaluatedAt,
		},
		{ revision: decision.revision + 1, parentRefs: [refOf(decision), revokedBy] },
	);
}
