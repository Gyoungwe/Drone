import type { SessionDirectory } from "../session/registry";
import { networkCapabilityHandlers } from "./network-capabilities";
import {
	credentialCapabilityHandlers,
	credentialHeader,
	credentialHeaders,
	type PluginCredentialStore,
} from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import { taskGrantCapabilityHandlers } from "./task-grant-capability";
import type { TaskGrantStore } from "./task-grants";

/** Capabilities bound to one installed plugin source: task authorization, network and its credentials. */
export function sourceCapabilityHandlers(
	host: { taskGrants: TaskGrantStore; sessions: SessionDirectory; credentials: PluginCredentialStore },
	source: PluginRuntimeSource,
) {
	const grants = taskGrantCapabilityHandlers(host.taskGrants, host.sessions, source);
	return {
		// Requesting a grant is declared; any provider may read the allowances a grant gave it.
		...(source.requestsTaskGrant ? grants : { "task.grant.allowances": grants["task.grant.allowances"] }),
		...(source.networkHosts &&
			networkCapabilityHandlers({
				hosts: source.networkHosts,
				reads: source.networkReads ?? [],
				credentials: source.credentials && {
					headers: credentialHeaders(source),
					header: (slot, url) => credentialHeader(host.credentials, source, slot, url),
				},
			})),
		...(source.credentials && credentialCapabilityHandlers(host.credentials, source)),
	};
}
