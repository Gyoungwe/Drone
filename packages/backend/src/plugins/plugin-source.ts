import { isDeepStrictEqual } from "node:util";
import type {
	PluginRecordAdoptions,
	PluginServiceProvision,
	PluginServiceRequirement,
	PluginServiceRole,
} from "@gyoungwe/plugin-api/runtime";
import type { PluginNetworkPolicy } from "./network-policy";
import type { PluginCredentialSlot } from "./plugin-credentials";

export interface PluginP5Optins {
	readonly bytes?: "staged-output";
	readonly exportBundle?: "request";
	readonly batch?: "request";
	readonly rerun?: "request";
	readonly critic?: "request";
	readonly delivery?: "request";
}

export interface PluginRuntimeSource {
	readonly pluginId: string;
	readonly packageRoot: string;
	readonly installationPath?: string;
	readonly nativeDeclaredPath?: string;
	readonly entrypoint: string;
	readonly nativeEntrypoint?: string;
	readonly contentHash?: string;
	readonly deliveryProjection?: "required";
	readonly p5?: PluginP5Optins;
	readonly provides?: Readonly<Record<string, PluginServiceProvision>>;
	readonly requires?: Readonly<Record<string, PluginServiceRequirement>>;
	readonly consumes?: Readonly<Record<string, PluginServiceRole>>;
	readonly recordAdoptions?: PluginRecordAdoptions;
	readonly requestsStateRead?: boolean;
	readonly requestsStateWrite?: boolean;
	readonly requestsBinaryStateRead?: boolean;
	readonly requestsBinaryStateWrite?: boolean;
	readonly requestsFileRead?: boolean;
	readonly requestsFileWrite?: boolean;
	readonly requestsModel?: boolean;
	readonly requestsExecution?: boolean;
	/** Manifest `drone.taskGrants: "request"`: may ask the host for a task authorization. */
	readonly requestsTaskGrant?: boolean;
	/** Manifest `drone.workspaceRead: "session"`: reads under the session's current read permissions. */
	readonly requestsWorkspaceRead?: boolean;
	/** Manifest `permissions.network` minus `configured-services`: the only hosts `network.*` may reach. */
	readonly networkHosts?: readonly string[];
	/** Manifest `drone.networkReads`: "host/path" POST endpoints that only read, so `network.read` may send them. */
	readonly networkReads?: readonly string[];
	/** Manifest `drone.credentials`: secrets the host keeps and adds to `network.*` requests. */
	readonly credentials?: readonly PluginCredentialSlot[];
	/**
	 * Manifest `drone.networkPolicy`: what the user may be asked to approve at install.
	 *
	 * A runtime endpoint is a *user-configured* destination, so it is not the same
	 * thing as the declared `networkHosts`. The policy says whether the package may
	 * be granted one at all, and which credential slot's secret may ride along.
	 */
	readonly networkPolicy?: PluginNetworkPolicy;
	readonly resources?: Readonly<Record<string, string>>;
}

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
		isDeepStrictEqual(a.p5 ?? {}, b.p5 ?? {}) &&
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
		JSON.stringify(a.credentials) === JSON.stringify(b.credentials) &&
		JSON.stringify(a.resources) === JSON.stringify(b.resources)
	);
}
