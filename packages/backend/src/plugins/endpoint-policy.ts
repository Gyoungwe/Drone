import type { PluginCredentialSlot } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import { sourcePolicyApproved } from "./policy-consent";

export type PluginEndpointConfigurationResult =
	| {
			readonly state: "ready";
			readonly endpoint: string;
			readonly source: "default" | "env";
			/** The credential slot the endpoint rides on. */
			readonly slot: string;
	  }
	| {
			readonly state: "invalid";
			readonly endpoint: null;
			readonly source: "env";
			readonly reason: "invalid_endpoint";
			/** The credential slot the endpoint would have ridden on. */
			readonly slot: string;
	  };

export interface PluginEndpointPolicy {
	readonly configuration?: PluginEndpointConfigurationResult;
	readonly networkHosts: readonly string[];
	readonly credentialHosts: Readonly<Record<string, readonly string[]>>;
	readonly runtimeGrant?: {
		readonly endpoint: string;
		readonly hostPort: string;
		readonly slot: string;
	};
}

/** One request's selection and a composition-owned check against the live environment. */
export interface PluginEndpointAccess {
	readonly policy: PluginEndpointPolicy;
	check(): void;
}

const DEFAULT_ENDPOINT = "http://10.126.126.1:8080";
const DEFAULT_HOST = "10.126.126.1:8080";

export function endpointPolicyError(
	code: "EPLUGINENDPOINTSLOT" | "EPLUGINENDPOINTCHANGED" | "invalid_endpoint",
) {
	return Object.assign(new Error(code), { code });
}

/** Inspect raw syntax before URL normalization can erase an explicit port or unsafe path. */
function parseEndpoint(raw: string): { endpoint: string; hostPort: string } | undefined {
	if (raw.length > 4096 || /[\s\p{Cc}\\@?#*]/u.test(raw)) return undefined;
	const match = /^(https?):\/\/(\[[^\]]+\]|[^:/]+):([0-9]+)\/?$/i.exec(raw);
	if (!match) return undefined;
	const port = Number(match[3]);
	if (port < 1 || port > 65535) return undefined;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		// Parser diagnostics can contain userinfo; invalid configuration has one fixed projection.
		return undefined;
	}
	if (url.hostname.includes("*") || url.origin.length > 4096) return undefined;
	return { endpoint: url.origin, hostPort: `${url.hostname}:${port}` };
}

/**
 * The slot a runtime endpoint may ride on.
 *
 * The package declares the policy in `drone.networkPolicy.runtimeEndpoint`: it names
 * the slot whose secret may travel to the endpoint.  The slot must exist in the
 * package's own credential declarations, it must carry host HTTP authentication — a
 * literal secret header to a user-configured address would leak the secret to a host
 * the package never declared — and it must already declare the host the endpoint
 * replaces.
 *
 * The user must also have approved this package's policy at install time.  The
 * declaration is not the grant: without the approval there is no endpoint to give.
 */
function eligibleSlot(source: PluginRuntimeSource): PluginCredentialSlot | undefined {
	const policy = source.networkPolicy?.runtimeEndpoint;
	if (!policy?.allowed) return undefined;
	if (!source.networkHosts?.includes(DEFAULT_HOST)) return undefined;
	// The user approved this package's policy at install; without that there is
	// no endpoint to grant, whatever the manifest declares.
	if (!sourcePolicyApproved(source)) return undefined;
	return source.credentials?.find(
		(slot) =>
			slot.slot === policy.credentialSlot &&
			slot.authentication === "http-basic-digest" &&
			slot.header === "Authorization" &&
			slot.fields.length === 0 &&
			slot.hosts.includes(DEFAULT_HOST),
	);
}

/** Pure policy: original declarations remain the credential store's identity. */
export function resolvePluginEndpointPolicy(
	source: PluginRuntimeSource,
	rawEndpoint: string | undefined,
): PluginEndpointPolicy {
	const networkHosts = source.networkHosts ?? [];
	const credentialHosts = Object.fromEntries(
		(source.credentials ?? []).map((slot) => [slot.slot, slot.hosts]),
	);
	const declared = { networkHosts, credentialHosts };
	const eligible = eligibleSlot(source);
	if (!eligible) return declared;
	if (rawEndpoint === undefined)
		return {
			...declared,
			configuration: {
				state: "ready",
				endpoint: DEFAULT_ENDPOINT,
				source: "default",
				slot: eligible.slot,
			},
		};
	const parsed = parseEndpoint(rawEndpoint);
	if (!parsed)
		return {
			...declared,
			configuration: {
				state: "invalid",
				endpoint: null,
				source: "env",
				reason: "invalid_endpoint",
				slot: eligible.slot,
			},
		};
	return {
		configuration: {
			state: "ready",
			endpoint: parsed.endpoint,
			source: "env",
			slot: eligible.slot,
		},
		networkHosts: [...new Set([...networkHosts, parsed.hostPort])],
		credentialHosts: {
			...credentialHosts,
			[eligible.slot]: [...new Set([...eligible.hosts, parsed.hostPort])],
		},
		runtimeGrant: { ...parsed, slot: eligible.slot },
	};
}

/**
 * An invalid endpoint disables the slot the policy named, not every slot.
 *
 * The slot comes from the policy's own configuration, so the check follows the
 * declaration instead of a hard-coded name.
 */
export function assertEndpointAvailable(
	policy: PluginEndpointPolicy | undefined,
	slot: string | undefined,
): void {
	if (slot !== undefined && slot === policy?.configuration?.slot && policy.configuration.state === "invalid")
		throw endpointPolicyError("invalid_endpoint");
}

/** The runtime addition is an origin grant for one authenticated slot, never a bare host grant. */
export function runtimeEndpointMatches(
	policy: PluginEndpointPolicy | undefined,
	url: URL,
	slot: string | undefined,
	httpAuth: boolean,
	destinations: readonly string[] | undefined,
): boolean {
	const grant = policy?.runtimeGrant;
	if (!grant) return false;
	return Boolean(
		httpAuth &&
			slot === grant.slot &&
			grant.endpoint === url.origin &&
			destinations?.includes(grant.hostPort),
	);
}
