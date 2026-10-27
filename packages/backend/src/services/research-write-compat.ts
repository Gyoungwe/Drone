import type { ResearchWriteAdapterRegistryPort } from "@drone/shared";

/**
 * No-plugin fallback for the generic host. External research writes belong to
 * an installed research plugin; keeping this registry empty prevents the host
 * from silently reintroducing a domain implementation or credentials.
 */
export function createDefaultResearchWriteRegistry(): ResearchWriteAdapterRegistryPort {
	return {
		descriptors: () => [],
		get: () => undefined,
	};
}
