import { capabilityReference, parseCapabilityReference } from "./capability-discovery";
import type { EvolutionCandidate } from "./evolution";
import {
	assertResearchContract,
	type CapabilityValidationGate,
	type CapabilityVersion,
	type ContractParentRef,
	computeResearchContractHash,
	createCapabilityVersion,
	RESEARCH_CONTRACT_SCHEMA_VERSION,
	type VersionedResearchContract,
} from "./research-contracts";
import {
	assertResearchStatus,
	type ResearchCapabilityState,
	type ResearchClaimState,
	type ResearchEvidenceState,
	type ResearchFreshnessState,
	type ResearchReuseLevel,
	type ResearchValidationScope,
} from "./research-status";

/** One user-facing row for an exact capabilityId@version. */
export interface CapabilityMatrixEntry extends VersionedResearchContract {
	readonly kind: "capability-matrix-entry";
	readonly id: string;
	readonly capabilityId: string;
	readonly version: string;
	readonly capabilityRef: string;
	readonly inputRange: {
		readonly assays: readonly string[];
		readonly formats: readonly string[];
		readonly sampleCount?: { readonly min?: number; readonly max?: number };
		readonly references: readonly string[];
	};
	readonly validationGates: readonly ContractParentRef[];
	readonly applicability: {
		readonly assays: readonly string[];
		readonly dataScopes: readonly string[];
		readonly references: readonly string[];
		readonly methods: readonly string[];
	};
	readonly evidenceRefs: readonly ContractParentRef[];
	readonly invalidationConditions: readonly string[];
	readonly status: ResearchCapabilityState;
	readonly evidenceState: ResearchEvidenceState;
	readonly validationScope: ResearchValidationScope;
	readonly freshness: ResearchFreshnessState;
	readonly updatedAt: string;
}

export interface CapabilityMatrixInput
	extends Omit<CapabilityMatrixEntry, keyof VersionedResearchContract | "kind" | "capabilityRef"> {
	readonly parentRefs?: readonly ContractParentRef[];
	readonly revision?: number;
}

function contract<T extends Record<string, unknown>>(
	body: T,
	options: { readonly revision?: number; readonly parentRefs?: readonly ContractParentRef[] } = {},
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

const ref = (
	value: VersionedResearchContract & { readonly kind: string; readonly id: string },
): ContractParentRef => ({
	kind: value.kind,
	id: value.id,
	revision: value.revision,
	contentHash: value.contentHash,
});

function requireText(value: string, label: string): string {
	if (!value.trim()) throw new Error(`${label} is required`);
	return value;
}

function requireFiniteRange(range: CapabilityMatrixEntry["inputRange"]["sampleCount"]): void {
	if (!range) return;
	if (range.min !== undefined && (!Number.isSafeInteger(range.min) || range.min < 0))
		throw new Error("inputRange.sampleCount.min must be a non-negative integer");
	if (range.max !== undefined && (!Number.isSafeInteger(range.max) || range.max < 0))
		throw new Error("inputRange.sampleCount.max must be a non-negative integer");
	if (range.min !== undefined && range.max !== undefined && range.min > range.max)
		throw new Error("inputRange.sampleCount.min cannot exceed max");
}

export function createCapabilityMatrixEntry(input: CapabilityMatrixInput): CapabilityMatrixEntry {
	const capabilityRef = capabilityReference({ capabilityId: input.capabilityId, version: input.version });
	parseCapabilityReference(capabilityRef);
	requireText(input.id, "Capability matrix entry id");
	requireText(input.updatedAt, "Capability matrix updatedAt");
	requireFiniteRange(input.inputRange.sampleCount);
	return contract(
		{
			kind: "capability-matrix-entry" as const,
			id: input.id,
			capabilityId: input.capabilityId,
			version: input.version,
			capabilityRef,
			inputRange: {
				assays: [...input.inputRange.assays],
				formats: [...input.inputRange.formats],
				...(input.inputRange.sampleCount ? { sampleCount: { ...input.inputRange.sampleCount } } : {}),
				references: [...input.inputRange.references],
			},
			validationGates: [...input.validationGates],
			applicability: {
				assays: [...input.applicability.assays],
				dataScopes: [...input.applicability.dataScopes],
				references: [...input.applicability.references],
				methods: [...input.applicability.methods],
			},
			evidenceRefs: [...input.evidenceRefs],
			invalidationConditions: [...input.invalidationConditions],
			status: input.status,
			evidenceState: input.evidenceState,
			validationScope: input.validationScope,
			freshness: input.freshness,
			updatedAt: input.updatedAt,
		},
		input,
	);
}

export function capabilityMatrixKey(entry: Pick<CapabilityMatrixEntry, "capabilityId" | "version">): string {
	return capabilityReference(entry);
}

/** Resolve one exact matrix row. Bare ids and duplicates fail closed. */
export function resolveCapabilityMatrixEntry(
	entries: readonly CapabilityMatrixEntry[],
	requested: string,
): CapabilityMatrixEntry {
	const parsed = parseCapabilityReference(requested);
	const matches = entries.filter(
		(entry) => entry.capabilityId === parsed.capabilityId && entry.version === parsed.version,
	);
	if (matches.length !== 1)
		throw new Error(
			matches.length
				? `Capability matrix reference is ambiguous: ${requested}`
				: `Capability matrix entry is not registered: ${requested}`,
		);
	return matches[0] as CapabilityMatrixEntry;
}

export interface CrossObjectEvidenceInput {
	readonly id: string;
	readonly capabilityRef: string;
	readonly researchCaseRef: ContractParentRef;
	readonly runAttemptRef: ContractParentRef;
	readonly artifactRefs: readonly ContractParentRef[];
	readonly knowledgeRefs: readonly ContractParentRef[];
	readonly experienceRefs: readonly ContractParentRef[];
	readonly validationGates: readonly CapabilityValidationGate[];
	readonly runStatus: "succeeded" | "failed" | "blocked" | "unknown";
	readonly reproducibilityCount?: number;
	readonly realData?: boolean;
	readonly scientificReviewRef?: ContractParentRef;
	readonly capabilityState?: ResearchCapabilityState;
	readonly freshness?: ResearchFreshnessState;
	readonly createdAt: string;
}

export interface ValidationPromotionRecord extends VersionedResearchContract {
	readonly kind: "validation-promotion-record";
	readonly id: string;
	readonly capabilityRef: string;
	readonly researchCaseRef: ContractParentRef;
	readonly runAttemptRef: ContractParentRef;
	readonly artifactRefs: readonly ContractParentRef[];
	readonly knowledgeRefs: readonly ContractParentRef[];
	readonly experienceRefs: readonly ContractParentRef[];
	readonly gateRefs: readonly ContractParentRef[];
	readonly evidenceState: ResearchEvidenceState;
	readonly claimState: ResearchClaimState;
	readonly capabilityState: ResearchCapabilityState;
	readonly reuseLevel: ResearchReuseLevel;
	readonly validationScope: ResearchValidationScope;
	readonly freshness: ResearchFreshnessState;
	readonly scientificallyVerified: boolean;
	readonly scientificReviewRef?: ContractParentRef;
	readonly createdAt: string;
}

function deriveCrossObjectStatus(
	input: CrossObjectEvidenceInput,
): Omit<
	ValidationPromotionRecord,
	| "kind"
	| "id"
	| "capabilityRef"
	| "researchCaseRef"
	| "runAttemptRef"
	| "artifactRefs"
	| "knowledgeRefs"
	| "experienceRefs"
	| "gateRefs"
	| "scientificReviewRef"
	| "createdAt"
	| keyof VersionedResearchContract
> {
	const failedGate = input.validationGates.some(
		(gate) => gate.status === "failed" || gate.status === "blocked",
	);
	const completeLineage =
		input.artifactRefs.length > 0 && input.knowledgeRefs.length > 0 && input.experienceRefs.length > 0;
	const realData = input.realData === true;
	const scientific = Boolean(input.scientificReviewRef) && realData;
	const allPassed =
		input.validationGates.length > 0 && input.validationGates.every((gate) => gate.status === "passed");
	let evidenceState: ResearchEvidenceState = "observed";
	if (input.runStatus !== "succeeded" || failedGate || !completeLineage) evidenceState = "blocked";
	else if (scientific) evidenceState = "verified";
	else if (realData && (input.reproducibilityCount ?? 0) >= 2) evidenceState = "reproduced";
	const freshness = input.freshness ?? "fresh";
	const validationScope: ResearchValidationScope = scientific
		? "scientific-review"
		: realData
			? "real-data"
			: allPassed
				? "integration"
				: "fixture";
	const claimState: ResearchClaimState = scientific
		? "supported"
		: evidenceState === "blocked"
			? "unsupported"
			: "inferred";
	const green = (evidenceState === "verified" || evidenceState === "reproduced") && freshness === "fresh";
	const reuseLevel: ResearchReuseLevel = green
		? evidenceState === "reproduced"
			? "reproduced-capability"
			: "validated-capability"
		: evidenceState === "observed"
			? "evidence-eligible"
			: "navigation-only";
	const capabilityState = input.capabilityState ?? (green ? "registered" : "candidate");
	const scientificallyVerified = scientific && evidenceState === "verified";
	assertResearchStatus({
		evidenceState,
		claimState,
		capabilityState,
		reuseLevel,
		validationScope,
		freshness,
		scientificallyVerified,
	});
	return {
		evidenceState,
		claimState,
		capabilityState,
		reuseLevel,
		validationScope,
		freshness,
		scientificallyVerified,
	};
}

/** Promote only when all five lineage classes are present; fixture evidence never becomes science. */
export function createValidationPromotionRecord(input: CrossObjectEvidenceInput): ValidationPromotionRecord {
	parseCapabilityReference(input.capabilityRef);
	if (!input.id.trim()) throw new Error("Validation promotion id is required");
	if (
		input.artifactRefs.length === 0 ||
		input.knowledgeRefs.length === 0 ||
		input.experienceRefs.length === 0
	)
		throw new Error("ResearchCase, RunAttempt, Artifact, Knowledge and Experience lineage are all required");
	const status = deriveCrossObjectStatus(input);
	return contract({
		kind: "validation-promotion-record" as const,
		id: input.id,
		capabilityRef: input.capabilityRef,
		researchCaseRef: input.researchCaseRef,
		runAttemptRef: input.runAttemptRef,
		artifactRefs: [...input.artifactRefs],
		knowledgeRefs: [...input.knowledgeRefs],
		experienceRefs: [...input.experienceRefs],
		gateRefs: input.validationGates.map(ref),
		...status,
		...(input.scientificReviewRef ? { scientificReviewRef: input.scientificReviewRef } : {}),
		createdAt: input.createdAt,
	});
}

export interface CapabilityVersionComparison {
	readonly left: string;
	readonly right: string;
	readonly sameCapability: boolean;
	readonly sameContract: boolean;
	readonly sameWorkflow: boolean;
	readonly sameMethod: boolean;
	readonly validationDelta: number;
	readonly recommended: string;
}

export function materializeApprovedEvolutionCandidate(input: {
	readonly candidate: EvolutionCandidate;
	readonly capabilityId: string;
	readonly version: string;
	readonly contractHash: string;
	readonly validationRefs: readonly ContractParentRef[];
	readonly workflowRef?: string;
	readonly methodRef?: string;
	readonly adapterRef?: string;
	readonly createdAt: string;
}): CapabilityVersion {
	const candidate = input.candidate;
	if (candidate.status !== "approved" || !candidate.executionEligible || !candidate.approvalRef)
		throw new Error("Only explicitly approved evolution candidates can materialize a capability version");
	parseCapabilityReference(`${input.capabilityId}@${input.version}`);
	if (!/^[a-f0-9]{64}$/.test(input.contractHash)) throw new Error("Capability contractHash must be sha256");
	return createCapabilityVersion({
		id: `${input.capabilityId}@${input.version}`,
		capabilityId: input.capabilityId,
		version: input.version,
		status: "recommended",
		contractHash: input.contractHash,
		...(input.adapterRef ? { adapterRef: input.adapterRef } : {}),
		...(input.workflowRef ? { workflowRef: input.workflowRef } : {}),
		...(input.methodRef ? { methodRef: input.methodRef } : {}),
		readiness: "unknown",
		validationRefs: [...input.validationRefs, ref(candidate), candidate.approvalRef],
		createdAt: input.createdAt,
		parentRefs: [ref(candidate), candidate.approvalRef],
	});
}

export function retireCapabilityVersion(
	version: CapabilityVersion,
	input: { readonly reason: string; readonly byRef: ContractParentRef; readonly retiredAt: string },
): CapabilityVersion {
	if (!input.reason.trim()) throw new Error("Capability retirement reason is required");
	if (Number.isNaN(Date.parse(input.retiredAt)))
		throw new Error("Capability retirement timestamp is invalid");
	return createCapabilityVersion({
		...version,
		status: "retired",
		readiness: "not-ready",
		parentRefs: [ref(version), input.byRef],
		revision: version.revision + 1,
	});
}

export function compareCapabilityVersions(
	left: CapabilityVersion,
	right: CapabilityVersion,
): CapabilityVersionComparison {
	return {
		left: `${left.capabilityId}@${left.version}`,
		right: `${right.capabilityId}@${right.version}`,
		sameCapability: left.capabilityId === right.capabilityId,
		sameContract: left.contractHash === right.contractHash,
		sameWorkflow: left.workflowRef === right.workflowRef,
		sameMethod: left.methodRef === right.methodRef,
		validationDelta: right.validationRefs.length - left.validationRefs.length,
		recommended:
			right.status === "enabled" && left.status !== "enabled"
				? "right"
				: left.status === "enabled" && right.status !== "enabled"
					? "left"
					: right.revision > left.revision
						? "right"
						: "left",
	};
}

export function projectCapabilityMatrixEntry(entry: CapabilityMatrixEntry): {
	readonly capabilityRef: string;
	readonly status: ResearchCapabilityState;
	readonly evidence: ResearchEvidenceState;
	readonly scope: ResearchValidationScope;
	readonly freshness: ResearchFreshnessState;
	readonly canReuse: boolean;
	readonly invalidationConditions: readonly string[];
} {
	return {
		capabilityRef: entry.capabilityRef,
		status: entry.status,
		evidence: entry.evidenceState,
		scope: entry.validationScope,
		freshness: entry.freshness,
		canReuse:
			(entry.evidenceState === "verified" || entry.evidenceState === "reproduced") &&
			entry.freshness === "fresh" &&
			entry.status !== "retired",
		invalidationConditions: [...entry.invalidationConditions],
	};
}
