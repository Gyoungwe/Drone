import {
	DRONE_PLUGIN_METADATA,
	dronePluginSource,
	FIRST_PARTY_PACKAGES,
	type HostPluginPackage,
} from "@drone/shared";
import type { KnowledgeWorkerLifecycleSnapshot } from "../knowledge/ui";
import { declaresWorker, type ScannedPackage } from "./installed-package-scan";

/**
 * Derive the host's package rows from the packages that are actually installed.
 *
 * The inventory the host ships is data; what an installed package declares
 * about itself is read from the package. The host names no package here: a
 * catalog entry that is not installed is still listed, as unavailable.
 */
export function deriveHostPluginPackages(
	installed: Map<string, ScannedPackage>,
	workerLifecycles: Map<string, KnowledgeWorkerLifecycleSnapshot> = new Map(),
): HostPluginPackage[] {
	return FIRST_PARTY_PACKAGES.map((entry) => {
		const metadata = DRONE_PLUGIN_METADATA[entry.name];
		const scanned = installed.get(entry.name);
		const manifest = scanned?.manifest;
		const source = scanned?.packageJson ? dronePluginSource(scanned.packageJson, manifest) : undefined;
		const lifecycle = workerLifecycles.get(entry.name);
		return {
			name: entry.name,
			host: entry.host,
			version: scanned?.version ?? metadata?.version ?? "unknown",
			status: scanned ? "available" : "unavailable",
			...(lifecycle
				? {
						currentVersion: lifecycle.currentVersion,
						nextSessionVersion: lifecycle.nextSessionVersion,
						lifecycleState: lifecycle.state,
						...(lifecycle.lastError ? { lastLifecycleError: lifecycle.lastError } : {}),
					}
				: {}),
			description: metadata?.description,
			...(metadata?.packageKind ? { packageKind: metadata.packageKind } : {}),
			...(metadata?.capabilities ? { capabilities: [...metadata.capabilities] } : {}),
			...(metadata?.tools ? { tools: [...metadata.tools] } : {}),
			...(metadata?.permissions ? { permissions: metadata.permissions } : {}),
			source: source ? "drone" : "unknown",
			...(source
				? {
						packageKind: source.packageKind,
						description: source.description,
						capabilities: [...source.capabilities],
						piApiVersion: source.piApiVersion,
						pluginApi: source.pluginApi,
						minHostVersion: source.minHostVersion,
						hosts: [...source.hosts],
						tools: [...source.tools],
						permissions: source.permissions,
						manifestDeclared: Boolean(manifest),
					}
				: {}),
		};
	});
}

/**
 * The worker lifecycle of every installed package that ships a worker.
 *
 * A package declares its worker entrypoint; the host tracks the lifecycle of
 * the ones it sees. The lifecycle event names the worker it belongs to by
 * path, so the host attributes it to the package that owns that path instead
 * of to a package name it would have to know.
 */
export function attributeWorkerLifecycles(
	installed: Map<string, ScannedPackage>,
	snapshot: KnowledgeWorkerLifecycleSnapshot,
): Map<string, KnowledgeWorkerLifecycleSnapshot> {
	const lifecycles = new Map<string, KnowledgeWorkerLifecycleSnapshot>();
	const workers = [...installed.entries()].filter(([, scanned]) => declaresWorker(scanned.manifest));
	if (workers.length === 0) return lifecycles;
	const owner = snapshot.source
		? workers.find(([, scanned]) => snapshot.source?.startsWith(scanned.packageRoot))
		: undefined;
	// Without a path to attribute the event to, an unambiguous single worker
	// still belongs to the package that declared it.
	const attributed = owner ?? (workers.length === 1 ? workers[0] : undefined);
	if (!attributed) return lifecycles;
	lifecycles.set(attributed[0], snapshot);
	return lifecycles;
}
