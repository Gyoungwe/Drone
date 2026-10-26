import { createDefaultResearchWriteAdapters, ResearchWriteAdapterRegistry } from "@drone/research";
import type { ResearchWriteAdapterRegistryPort } from "@drone/shared";
import {
	createProtocolsBookmarkWriteAdapter,
	createProtocolsBookmarkWritePortFromEnv,
	createWebdavWriteAdapter,
	createWebdavWritePortFromEnv,
} from "./reversible-write-adapters";

/**
 * Compatibility composition for the desktop host.  The backend service only
 * consumes the host-neutral registry contract; native/domain implementations
 * stay behind this composition boundary until their installed plugin loaders
 * provide the same registry.
 */
export function createDefaultResearchWriteRegistry(): ResearchWriteAdapterRegistryPort {
	return new ResearchWriteAdapterRegistry([
		...createDefaultResearchWriteAdapters(),
		createWebdavWriteAdapter(createWebdavWritePortFromEnv()),
		createProtocolsBookmarkWriteAdapter(createProtocolsBookmarkWritePortFromEnv()),
	]);
}
