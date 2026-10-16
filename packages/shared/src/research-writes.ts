/** Explicitly authorized, auditable write-adapter contracts. */
export type ResearchWriteAction = "dry-run" | "prepare";
export type ResearchWritePlanStatus = "ready" | "revoked";
export type ResearchWriteAuditStatus = "prepared" | "executed" | "blocked" | "failed" | "revoked";

/** Bounded metadata only; credentials and opaque source bodies are never accepted. */
export interface ResearchWritePayload {
\treadonly title: string;
\treadonly doi?: string;
\treadonly authors?: readonly string[];
\treadonly abstract?: string;
}

export interface ResearchWriteRequest {
\treadonly adapterId: string;
\treadonly targetRef: string;
\treadonly payload: ResearchWritePayload;
\treadonly action: ResearchWriteAction;
}

export interface ResearchWritePlan {
\treadonly id: string;
\treadonly adapterId: string;
\treadonly targetRef: string;
\treadonly payload: ResearchWritePayload;
\treadonly action: ResearchWriteAction;
\treadonly sideEffect: "none" | "external-write";
\treadonly requiresExplicitApproval: true;
\treadonly status: ResearchWritePlanStatus;
\treadonly createdAt: string;
}

export interface ResearchWriteExecuteRequest {
\treadonly planId: string;
\t/** A fresh user decision; this is never persisted as a standing permission. */
\treadonly approved: boolean;
}

export interface ResearchWriteReceipt {
\treadonly planId: string;
\treadonly adapterId: string;
\treadonly status: "executed" | "failed" | "blocked";
\treadonly at: string;
\treadonly externalRef?: string;
\treadonly readBack: "verified" | "unverified" | "not-applicable";
\treadonly failureReason?: string;
}

export interface ResearchWriteAuditRecord {
\treadonly id: string;
\treadonly planId: string;
\treadonly adapterId: string;
\treadonly targetRef: string;
\treadonly payloadHash: string;
\treadonly status: ResearchWriteAuditStatus;
\treadonly approval: "explicit" | "missing";
\treadonly at: string;
\treadonly externalRef?: string;
\treadonly failureReason?: string;
}

export interface ResearchWriteAdapterDescriptor {
\treadonly id: string;
\treadonly label: string;
\treadonly enabled: boolean;
\treadonly writeEnabled: boolean;
\treadonly requiresExplicitApproval: true;
}
