import type {
	ResearchCaptureRecord,
	ResearchConnector,
	ResearchConnectorContext,
	ResearchConnectorFailure,
	ResearchConnectorHit,
	ResearchKnowledgeOperations,
	ResearchSearchRequest,
	ResearchSearchResponse,
} from "@drone/shared";
import type { JsonStore } from "../json-store";

export interface CaptureLedger {
	version: 1;
	items: ResearchCaptureRecord[];
}

export interface ResearchConnectorSettings {
	version: 1;
	disabled: string[];
}

export interface ResearchResourceServiceOptions {
	readonly store: JsonStore<CaptureLedger>;
	/** Connector registry is supplied by the host composition root or an installed connector package. */
	readonly connectors: ResearchConnectorRegistryPort;
	readonly connectorSettings?: JsonStore<ResearchConnectorSettings>;
	/** Host-owned ports/configuration used by optional connectors; never persisted. */
	readonly connectorContext?: ResearchConnectorContext;
	/** Knowledge host operations used to create a versioned capture snapshot. */
	readonly knowledgeOperations: ResearchKnowledgeOperations;
}

/** Host-neutral registry surface; connector implementations stay outside backend. */
export interface ResearchConnectorRegistryPort {
	list(): readonly ResearchConnector[];
	recommend(
		seed: string,
		connectorId: string,
		context?: ResearchConnectorContext,
		limit?: number,
	): Promise<{ hits: readonly ResearchConnectorHit[]; failures: readonly ResearchConnectorFailure[] }>;
	search(input: ResearchSearchRequest, context?: ResearchConnectorContext): Promise<ResearchSearchResponse>;
}

/** Empty host-owned registry used when no connector plugin is installed. */
export function createUnavailableResearchConnectorRegistry(): ResearchConnectorRegistryPort {
	return {
		list: () => [],
		recommend: async (_seed, connectorId) => ({
			hits: [],
			failures: [
				{
					connectorId,
					message: "Research connector plugin is unavailable",
					retryable: false,
					at: new Date().toISOString(),
				},
			],
		}),
		search: async (input) => ({
			query: input.query,
			hits: [],
			failures: [
				{
					connectorId: input.connectorIds?.[0] ?? "research",
					message: "Research connector plugin is unavailable",
					retryable: false,
					at: new Date().toISOString(),
				},
			],
			connectors: [...(input.connectorIds ?? [])],
			complete: false,
		}),
	};
}

export function emptyCaptureLedger(): CaptureLedger {
	return { version: 1, items: [] };
}

export function emptyResearchConnectorSettings(): ResearchConnectorSettings {
	return { version: 1, disabled: [] };
}
