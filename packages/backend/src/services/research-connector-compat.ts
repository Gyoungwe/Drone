import { createDefaultResearchConnectors, ResearchConnectorRegistry } from "@drone/research";
import type { ResearchConnectorRegistryPort } from "./research-resource";

/**
 * Compatibility composition for the desktop host. Connector implementations
 * stay behind this boundary while installed connector plugins adopt the same
 * host-neutral registry contract.
 */
export function createDefaultResearchConnectorRegistry(): ResearchConnectorRegistryPort {
	return new ResearchConnectorRegistry(createDefaultResearchConnectors());
}
