/**
 * Host-neutral research composition contracts.
 *
 * This module intentionally has no Drone, Electron, Pi SDK or domain-package
 * dependency. An installed research plugin may expose these operations to a
 * host, while the host remains responsible for authorization, credentials and
 * persistence. The status field is explicit so an unavailable optional plugin
 * cannot be mistaken for an empty, successful registry.
 */
export const RESEARCH_HOST_CONTRACT_VERSION = 1 as const;
export type ResearchHostContractVersion = typeof RESEARCH_HOST_CONTRACT_VERSION;

export type ResearchConnectorKind =
	| "literature"
	| "citation"
	| "dataset"
	| "protocol"
	| "institutional"
	| "project-storage";

export interface ResearchConnectorDescriptor {
	readonly id: string;
	readonly kind: ResearchConnectorKind;
	readonly label: string;
	readonly enabled: boolean;
}

export interface ResearchConnectorSourceReceipt {
	readonly sourceRef: string;
	readonly locator?: string;
	readonly sourceType: ResearchConnectorKind;
	readonly title?: string;
	readonly version?: string;
	readonly license?: string;
	readonly accessedAt: string;
	readonly contentHash: string;
	readonly readOnly: true;
	readonly failureReason?: string;
}

export interface ResearchConnectorHit {
	readonly id: string;
	readonly title: string;
	readonly summary: string;
	readonly locator: string;
	readonly sourceType: ResearchConnectorKind;
	readonly sourceReceipt: ResearchConnectorSourceReceipt;
	readonly authors?: readonly string[];
	readonly year?: number;
	readonly doi?: string;
	readonly publishedAt?: string;
	readonly arxivId?: string;
}

export interface ResearchConnectorFailure {
	readonly connectorId: string;
	readonly message: string;
	readonly retryable: boolean;
	readonly at: string;
}

export interface ResearchSearchRequest {
	readonly query: string;
	readonly cwd?: string;
	readonly connectorIds?: readonly string[];
	readonly limit?: number;
	readonly signal?: AbortSignal;
}

export interface ResearchSearchResponse {
	readonly query: string;
	readonly hits: readonly ResearchConnectorHit[];
	readonly failures: readonly ResearchConnectorFailure[];
	readonly connectors: readonly string[];
	readonly complete: boolean;
}

export interface ResearchConnectorHostContext {
	readonly cwd?: string;
	readonly signal?: AbortSignal;
	/** Host-owned connector configuration; credentials must not be persisted. */
	readonly config?: Readonly<Record<string, unknown>>;
}

export type ResearchHostAvailability = "ready" | "degraded" | "unavailable";

export interface ResearchConnectorHostAdapter {
	readonly contractVersion: ResearchHostContractVersion;
	readonly status: ResearchHostAvailability;
	readonly list: () => readonly ResearchConnectorDescriptor[];
	readonly recommend: (
		seed: string,
		connectorId: string,
		context?: ResearchConnectorHostContext & { readonly limit?: number },
	) => Promise<{
		readonly hits: readonly ResearchConnectorHit[];
		readonly failures: readonly ResearchConnectorFailure[];
	}>;
	readonly search: (
		input: ResearchSearchRequest,
		context?: ResearchConnectorHostContext,
	) => Promise<ResearchSearchResponse>;
}

export interface ResearchConnectorHostLoader {
	readonly contractVersion: ResearchHostContractVersion;
	readonly load: () => ResearchConnectorHostAdapter;
}

export type ResearchWriteAction = "dry-run" | "prepare";
export type ResearchWritePlanStatus = "ready" | "executing" | "revoked";

export interface ResearchWritePayload {
	readonly title: string;
	readonly doi?: string;
	readonly authors?: readonly string[];
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
	readonly plan: ResearchWritePlan;
	readonly approved: boolean;
	readonly signal?: AbortSignal;
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

export interface ResearchWriteAdapterDescriptor {
	readonly id: string;
	readonly label: string;
	readonly enabled: boolean;
	readonly writeEnabled: boolean;
	readonly requiresExplicitApproval: true;
}

export interface ResearchWriteAdapterHostAdapter {
	readonly contractVersion: ResearchHostContractVersion;
	readonly status: ResearchHostAvailability;
	readonly descriptors: () => readonly ResearchWriteAdapterDescriptor[];
	readonly prepare: (input: ResearchWriteRequest) => ResearchWritePlan;
	readonly execute: (input: ResearchWriteExecuteRequest) => Promise<ResearchWriteReceipt>;
}

export interface ResearchWriteAdapterHostLoader {
	readonly contractVersion: ResearchHostContractVersion;
	readonly load: () => ResearchWriteAdapterHostAdapter;
}
