import type { KnowledgeSnapshot, KnowledgeSourceReceipt } from "./research-contracts";

export type ResearchCaptureApproval = "pending" | "approved" | "rejected" | "revoked";

export interface ResearchCaptureRequest {
	readonly cwd: string;
	readonly relativePath: string;
	readonly scope?: "project" | "workspace";
}

export interface ResearchCaptureRecord {
	readonly id: string;
	readonly cwd: string;
	readonly relativePath: string;
	readonly byteHash: string;
	readonly format: string;
	readonly size: number;
	readonly modifiedAt: string;
	readonly scope: "project" | "workspace";
	readonly approval: ResearchCaptureApproval;
	readonly revision: number;
	readonly snapshotId: string;
	readonly sourceReceipt: KnowledgeSourceReceipt;
	readonly snapshot: KnowledgeSnapshot;
	readonly capturedAt: string;
	readonly approvedAt?: string;
}

export interface ResearchCaptureResult {
	readonly record: ResearchCaptureRecord;
	readonly idempotent: boolean;
}
