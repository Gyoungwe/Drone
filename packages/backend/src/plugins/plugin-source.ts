import type { PluginRuntimeSource } from "./coordinator";

/** Whether two runtime sources are the same installed build with the same declared capabilities. */
export function sameSource(a: PluginRuntimeSource, b: PluginRuntimeSource | undefined): boolean {
	return (
		a.pluginId === b?.pluginId &&
		a.packageRoot === b.packageRoot &&
		a.installationPath === b.installationPath &&
		a.nativeDeclaredPath === b.nativeDeclaredPath &&
		a.entrypoint === b.entrypoint &&
		a.nativeEntrypoint === b.nativeEntrypoint &&
		a.contentHash === b.contentHash &&
		a.deliveryProjection === b.deliveryProjection &&
		JSON.stringify(a.provides) === JSON.stringify(b.provides) &&
		JSON.stringify(a.requires) === JSON.stringify(b.requires) &&
		JSON.stringify(a.consumes) === JSON.stringify(b.consumes) &&
		JSON.stringify(a.recordAdoptions) === JSON.stringify(b.recordAdoptions) &&
		a.requestsStateRead === b.requestsStateRead &&
		a.requestsStateWrite === b.requestsStateWrite &&
		a.requestsBinaryStateRead === b.requestsBinaryStateRead &&
		a.requestsBinaryStateWrite === b.requestsBinaryStateWrite &&
		a.requestsFileRead === b.requestsFileRead &&
		a.requestsFileWrite === b.requestsFileWrite &&
		a.requestsModel === b.requestsModel &&
		a.requestsExecution === b.requestsExecution &&
		a.requestsTaskGrant === b.requestsTaskGrant &&
		a.requestsWorkspaceRead === b.requestsWorkspaceRead &&
		JSON.stringify(a.networkHosts) === JSON.stringify(b.networkHosts) &&
		JSON.stringify(a.networkReads) === JSON.stringify(b.networkReads) &&
		JSON.stringify(a.resources) === JSON.stringify(b.resources)
	);
}
