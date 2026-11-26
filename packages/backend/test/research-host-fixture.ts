import type {
	ResearchConnector,
	ResearchWriteAdapterPort,
	ResearchWriteAdapterRegistryPort,
} from "@drone/shared";
import type { ResearchConnectorRegistryPort } from "../src/services/research-resource-options";

/**
 * Minimal installed-plugin doubles. The host services under test own the
 * enable/disable, approval, reservation and audit gates; these doubles only
 * stand in for whatever connector or write plugin the user installed.
 */
export function fixtureConnectorRegistry(
	connectors: readonly ResearchConnector[],
): ResearchConnectorRegistryPort {
	return {
		list: () => connectors,
		recommend: async () => ({ hits: [], failures: [] }),
		search: async (input) => {
			const ids = input.connectorIds ?? connectors.map((connector) => connector.id);
			const selected = connectors.filter((connector) => ids.includes(connector.id));
			const hits = (await Promise.all(selected.map((connector) => connector.search(input.query)))).flat();
			return { query: input.query, hits, failures: [], connectors: [...ids], complete: true };
		},
	};
}

export function fixtureWriteRegistry(
	adapters: readonly ResearchWriteAdapterPort[],
): ResearchWriteAdapterRegistryPort {
	return {
		descriptors: () =>
			adapters.map((adapter) => ({
				id: adapter.id,
				label: adapter.label,
				enabled: true,
				writeEnabled: adapter.writeEnabled,
				requiresExplicitApproval: true as const,
			})),
		get: (id) => adapters.find((adapter) => adapter.id === id),
	};
}
