/** Read-only, provenance-carrying connector contracts shared by hosts and the research domain. */
export type ResearchConnectorKind =
	| "literature"
	| "citation"
	| "dataset"
	| "protocol"
	| "institutional"
	| "project-storage";

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
}

export interface ResearchConnectorFailure {
	readonly connectorId: string;
	readonly message: string;
	readonly retryable: boolean;
	readonly at: string;
}

export interface ResearchSearchRequest {
	readonly query: string;
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
