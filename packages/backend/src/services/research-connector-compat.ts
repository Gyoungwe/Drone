import type { ResearchConnectorRegistryPort } from "./research-resource";

/**
 * No-plugin fallback for the generic host. Connector implementations belong
 * to an installed research plugin; keeping this fallback empty prevents the
 * host from silently reintroducing a domain implementation.
 */
export function createDefaultResearchConnectorRegistry(): ResearchConnectorRegistryPort {
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
