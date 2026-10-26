import type {
	ContractParentRef,
	KnowledgeEvidenceGrade,
	KnowledgeReuseLevel,
	KnowledgeSnapshot,
	KnowledgeSourceReceipt,
} from "./research-contracts";

/** Stable context returned by a knowledge host for a captured research source. */
export interface ResearchKnowledgeContext {
	readonly projectId: string;
	readonly workspaceId: string;
	readonly workspaceRoot?: string;
}

/**
 * Host operations used by the research capture service to create a versioned
 * knowledge snapshot. The domain implementation stays in the installed
 * knowledge package; the service only consumes this shared contract.
 */
export interface ResearchKnowledgeOperations {
	resolveContext(input: { readonly workspaceRoot: string }): ResearchKnowledgeContext;
	ingestSnapshot(input: {
		readonly id: string;
		readonly context: ResearchKnowledgeContext;
		readonly sources: readonly KnowledgeSourceReceipt[];
		readonly approval: "pending" | "approved" | "rejected" | "revoked";
		readonly reuseLevel: KnowledgeReuseLevel;
		readonly evidenceGrade: KnowledgeEvidenceGrade;
		readonly revision: number;
		readonly createdAt: string;
		readonly ingestedAt: string;
		readonly parentRefs?: readonly ContractParentRef[];
	}): KnowledgeSnapshot;
}
