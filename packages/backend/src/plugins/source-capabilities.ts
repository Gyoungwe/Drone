import type { SessionDirectory } from "../session/registry";
import { endpointConfigCapabilityHandlers } from "./endpoint-config-capabilities";
import { endpointPolicyError, resolvePluginEndpointPolicy } from "./endpoint-policy";
import { authenticatedRequest } from "./http-transport";
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
	const declaredPolicy = resolvePluginEndpointPolicy(source, undefined);
	const endpointPolicy = () => {
		const raw = process.env.DRONE_WEBDAV_ENDPOINT;
		return {
			policy: resolvePluginEndpointPolicy(source, raw),
			check: () => {
				if (process.env.DRONE_WEBDAV_ENDPOINT !== raw) throw endpointPolicyError("EPLUGINENDPOINTCHANGED");
			},
		};
	};
	return {
		// Requesting a grant is declared; any provider may read the allowances a grant gave it.
		...(source.requestsTaskGrant ? grants : { "task.grant.allowances": grants["task.grant.allowances"] }),
		...(source.networkHosts &&
			networkCapabilityHandlers({
				hosts: declaredPolicy.networkHosts,
				...(declaredPolicy.configuration ? { endpointPolicy } : {}),
				reads: source.networkReads ?? [],
				credentials: source.credentials && {
					headers: credentialHeaders(source),
					header: (slot, url, access) =>
						credentialHeader(host.credentials, source, slot, url, access?.policy),
					authenticate: (slot, url, username, access) =>
						authenticatedRequest(host.credentials, source, slot, url, username, access),
				},
			})),
		...(source.credentials && credentialCapabilityHandlers(host.credentials, source)),
		...(declaredPolicy.configuration && endpointConfigCapabilityHandlers(endpointPolicy)),
	};
}
