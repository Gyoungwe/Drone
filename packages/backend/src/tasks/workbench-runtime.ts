import type { PluginRuntimeClient } from "@gyoungwe/plugin-api/runtime";

export const WORKBENCH_HOST_CONTRACT_VERSION = 1 as const;
export interface WorkbenchHostPort {
	readonly contractVersion: typeof WORKBENCH_HOST_CONTRACT_VERSION;
	readonly client: PluginRuntimeClient;
}

/** No host task engine: only an installed provider can expose operations. */
export function createWorkbenchHostPort(): WorkbenchHostPort {
	return {
		contractVersion: 1,
		client: {
			invoke: async (operation) => {
				throw new Error(`Workbench operation unavailable: ${operation}`);
			},
			subscribe: () => () => {},
		},
	};
}
