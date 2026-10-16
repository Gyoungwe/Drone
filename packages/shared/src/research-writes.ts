/** Explicitly authorized, auditable write-adapter contracts. */
export type ResearchWriteAction = "dry-run" | "prepare";
export type ResearchWritePlanStatus = "ready" | "executing" | "revoked";
export type ResearchWriteAuditStatus =
	| "prepared"
	| "executing"
	| "executed"
	| "blocked"
	| "failed"
	| "revoked";

/** Bounded metadata only; credentials and opaque source bodies are never accepted. */
export interface ResearchWritePayload {
	readonly title: string;
	readonly doi?: string;
	readonly authors?: string[];
	readonly abstract?: string;
}

export interface ResearchWriteRequest {
	readonly adapterId: string;
	readonly targetRef: string;
	readonly payload: ResearchWritePayload;
	readonly action: ResearchWriteAction;
}

export interface ResearchWritePlan {
	readonly id: string;
	readonly adapterId: string;
	readonly targetRef: string;
	readonly payload: ResearchWritePayload;
	readonly action: ResearchWriteAction;
	readonly sideEffect: "none" | "external-write";
	readonly requiresExplicitApproval: true;
	readonly status: ResearchWritePlanStatus;
	readonly createdAt: string;
}

export interface ResearchWriteExecuteRequest {
	readonly planId: string;
	/** A fresh user decision; this is never persisted as a standing permission. */
	readonly approved: boolean;
}

export interface ResearchWriteReceipt {
	readonly planId: string;
	readonly adapterId: string;
	readonly status: "executed" | "failed" | "blocked";
	readonly at: string;
	readonly externalRef?: string;
	readonly readBack: "verified" | "unverified" | "not-applicable";
	readonly failureReason?: string;
}

export interface ResearchWriteAuditRecord {
	readonly id: string;
	readonly planId: string;
	readonly adapterId: string;
	readonly targetRef: string;
	readonly payloadHash: string;
	readonly status: ResearchWriteAuditStatus;
	readonly approval: "explicit" | "missing";
	readonly at: string;
	readonly externalRef?: string;
	readonly failureReason?: string;
}

export interface ResearchWriteAdapterDescriptor {
	readonly id: string;
	readonly label: string;
	readonly enabled: boolean;
	readonly writeEnabled: boolean;
	readonly requiresExplicitApproval: true;
}
