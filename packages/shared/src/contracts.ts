import type { AnalysisContext } from "./analysis-orchestration";
import {
	type ContractParentRef,
	createDecisionProposal,
	createKnowledgeSnapshot,
	type DecisionProposal,
	type KnowledgeSnapshot,
	type ResearchCase,
	researchCaseFromAnalysisContext,
} from "./research-contracts";

export * from "./research-contracts";

/** The legacy proposal shape is structural to keep shared free of a tasks dependency. */
export interface LegacyPlanProposal {
	readonly version?: number;
	readonly project?: string;
	readonly goal?: string;
	readonly query?: string;
	readonly summary?: string;
	readonly findings?: readonly {
		readonly text: string;
		readonly citations?: readonly {
			readonly path?: string;
			readonly hash?: string;
			readonly receiptRef?: string;
		}[];
	}[];
	readonly candidates?: readonly {
		readonly id: string;
		readonly title: string;
		readonly method?: string;
		readonly resources?: string;
		readonly risks?: readonly string[];
	}[];
	readonly recommendation?: { readonly candidateId: string; readonly reason: string };
	readonly questions?: readonly {
		readonly id: string;
		readonly question: string;
		readonly options?: readonly string[];
	}[];
	readonly approval?: "draft" | "pending" | "approved" | "rejected";
	readonly contractHash?: string;
	readonly previousContractHash?: string | null;
}

/** The checkpoint fields needed for migration, without importing backend services into shared. */
export interface LegacyEvidenceCheckpoint {
	readonly schemaVersion?: number;
	readonly id: string;
	readonly analysis: Pick<AnalysisContext, "id" | "question" | "assay">;
	readonly files: readonly {
		readonly kind: string;
		readonly artifact: {
			readonly path: string;
			readonly sha256: string;
			readonly versionId?: string;
		};
	}[];
	readonly environmentFingerprint?: string;
	readonly createdAt: string;
}

function parent(kind: string, id: string, contentHash?: string): ContractParentRef {
	return { kind, id, ...(contentHash ? { contentHash } : {}) };
}

/** Migrate the durable analysis snapshot into the shared research-case contract. */
export function migrateAnalysisContext(context: AnalysisContext): ResearchCase {
	return researchCaseFromAnalysisContext(context);
}

/** Alias retained for callers that name migrations after their destination type. */
export const researchCaseFromLegacyAnalysisContext = migrateAnalysisContext;
export const migrateAnalysisContextToResearchCase = migrateAnalysisContext;

/** Migrate a task proposal into a decision proposal without granting approval. */
export function migratePlanProposal(
	input: LegacyPlanProposal,
	now = "1970-01-01T00:00:00.000Z",
): DecisionProposal {
	const caseId = input.project?.trim() || "default";
	const findings = (input.findings ?? []).map((finding, index) => ({
		id: `finding-${index + 1}`,
		text: finding.text,
		parentRefs: (finding.citations ?? []).map((citation) =>
			parent("source", citation.path ?? citation.receiptRef ?? `finding-${index + 1}`, citation.hash),
		),
	}));
	const candidates = (input.candidates ?? []).map((candidate) => ({
		id: candidate.id,
		title: candidate.title,
		...(candidate.method ? { method: candidate.method } : {}),
		expectedBenefit: input.goal,
		tradeoffs: [],
		resources: candidate.resources ? [candidate.resources] : [],
		risks: [...(candidate.risks ?? [])],
		authorizationActions: [],
		parentRefs: [],
	}));
	const recommendation = input.recommendation
		? {
				candidateId: input.recommendation.candidateId,
				reason: input.recommendation.reason,
				parentRefs: input.contractHash ? [parent("plan-proposal", caseId, input.contractHash)] : [],
			}
		: undefined;
	const status =
		input.approval === "approved"
			? "accepted"
			: input.approval === "rejected"
				? "rejected"
				: input.approval === "draft"
					? "draft"
					: "pending";
	return createDecisionProposal({
		legacyProposal: { ...input },
		id: input.contractHash ? `proposal-${input.contractHash.slice(0, 16)}` : `proposal-${caseId}`,
		caseRef: parent("research-case", caseId),
		project: input.project,
		goal: input.goal,
		query: input.query,
		summary: input.summary,
		contextSnapshot: input.previousContractHash
			? parent(
					"decision-proposal",
					`previous-${input.previousContractHash.slice(0, 16)}`,
					input.previousContractHash,
				)
			: undefined,
		findings,
		candidates,
		recommendation,
		questions: (input.questions ?? []).map((question) => ({
			id: question.id,
			question: question.question,
			...(question.options ? { options: [...question.options] } : {}),
		})),
		status,
		createdAt: now,
		parentRefs: input.previousContractHash ? [input.previousContractHash] : [],
		migration: {
			fromSchemaVersion: input.version ?? 0,
			toSchemaVersion: 1,
			migrationId: "plan-proposal/v1",
			migratedAt: now,
		},
	});
}

export const decisionProposalFromPlanProposal = migratePlanProposal;
export const migratePlanProposalToDecisionProposal = migratePlanProposal;

/** Migrate an evidence checkpoint into a source receipt snapshot. */
export function migrateEvidenceCheckpoint(
	checkpoint: LegacyEvidenceCheckpoint,
	caseRef?: ContractParentRef,
): KnowledgeSnapshot {
	const resolvedCaseRef = caseRef ?? parent("research-case", checkpoint.analysis.id);
	return createKnowledgeSnapshot({
		legacyCheckpoint: {
			...checkpoint,
			analysis: { ...checkpoint.analysis },
			files: checkpoint.files.map((file) => ({ ...file, artifact: { ...file.artifact } })),
		},
		id: checkpoint.id,
		caseRef: resolvedCaseRef,
		sources: checkpoint.files.map((file) => ({
			sourceRef: file.artifact.path,
			version: file.artifact.versionId,
			contentHash: file.artifact.sha256,
			receiptRef: `evidence:${checkpoint.id}:${file.artifact.path}`,
			readAt: checkpoint.createdAt,
		})),
		reuseLevel: "evidence-eligible",
		environmentFingerprint: checkpoint.environmentFingerprint,
		inputManifestHash: checkpoint.id,
		createdAt: checkpoint.createdAt,
		parentRefs: [parent("evidence-checkpoint", checkpoint.id), resolvedCaseRef],
		migration: {
			fromSchemaVersion: checkpoint.schemaVersion ?? 0,
			toSchemaVersion: 1,
			migrationId: "evidence-checkpoint/v1",
			migratedAt: checkpoint.createdAt,
		},
	});
}

export const knowledgeSnapshotFromEvidenceCheckpoint = migrateEvidenceCheckpoint;
export const migrateEvidenceCheckpointToKnowledgeSnapshot = migrateEvidenceCheckpoint;
