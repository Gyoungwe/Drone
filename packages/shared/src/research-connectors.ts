/** Read-only, provenance-carrying connector contracts shared by hosts and the research domain. */
export type ResearchConnectorKind =
	| "literature"
	| "citation"
	| "dataset"
	| "protocol"
	| "institutional"
	| "project-storage";

/** User-visible connector metadata and its persisted search availability. */
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
	/** Optional bibliographic fields used by literature radar and citation UI. */
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
	/** Optional project root used by the project-storage connector. */
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

/** Connector configuration supplied by a host; credentials are never persisted by this contract. */
export interface ResearchZoteroConnectorConfig {
	readonly apiBase?: string;
	readonly apiKey?: string;
	readonly libraryType?: "users" | "groups";
	readonly libraryId?: string;
}

export interface ResearchProtocolsConnectorConfig {
	readonly apiBase?: string;
	readonly apiToken?: string;
}

export interface ResearchSemanticScholarConnectorConfig {
	readonly apiBase?: string;
	readonly apiKey?: string;
}

export interface ResearchInstitutionalConnectorConfig {
	/** Optional resolver that receives a free-text query as `q`. */
	readonly resolverUrl?: string;
	/** Optional EZproxy template. `%s` is replaced with the encoded target URL. */
	readonly ezproxyTemplate?: string;
}

export interface ResearchProjectStorageItem {
	readonly relativePath: string;
	readonly title?: string;
	readonly summary?: string;
	readonly format?: string;
	readonly size?: number;
	readonly modifiedAt?: string;
	readonly contentHash?: string;
}

export interface ResearchProjectStoragePort {
	search(input: {
		readonly cwd: string;
		readonly query: string;
		readonly limit: number;
		readonly signal?: AbortSignal;
	}): Promise<readonly ResearchProjectStorageItem[]>;
}

/** Host-neutral execution context passed to an installed connector. */
export interface ResearchConnectorContext {
	readonly fetchImpl?: typeof fetch;
	readonly signal?: AbortSignal;
	readonly cwd?: string;
	readonly config?: {
		readonly zotero?: ResearchZoteroConnectorConfig;
		readonly protocols?: ResearchProtocolsConnectorConfig;
		readonly semanticScholar?: ResearchSemanticScholarConnectorConfig;
		readonly institutional?: ResearchInstitutionalConnectorConfig;
	};
	readonly projectStorage?: ResearchProjectStoragePort;
}

/** Installed connector contract; implementations remain in optional research packages. */
export interface ResearchConnector {
	readonly id: string;
	readonly kind: ResearchConnectorKind;
	readonly label: string;
	/** Optional host/plugin availability; omitted means enabled. */
	readonly enabled?: boolean;
	search(
		query: string,
		options?: ResearchConnectorContext & { readonly limit?: number },
	): Promise<readonly ResearchConnectorHit[]>;
	/** Optional recommendation lookup for connectors that support seed papers. */
	recommend?(
		seed: string,
		options?: ResearchConnectorContext & { readonly limit?: number },
	): Promise<readonly ResearchConnectorHit[]>;
}
