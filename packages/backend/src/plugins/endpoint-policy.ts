import type { PluginCredentialSlot } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";

export type PluginEndpointConfigurationResult =
	| {
			readonly state: "ready";
			readonly endpoint: string;
			readonly source: "default" | "env";
	  }
	| {
			readonly state: "invalid";
			readonly endpoint: null;
			readonly source: "env";
			readonly reason: "invalid_endpoint";
	  };

export interface PluginEndpointPolicy {
	readonly configuration?: PluginEndpointConfigurationResult;
	readonly networkHosts: readonly string[];
	readonly credentialHosts: Readonly<Record<string, readonly string[]>>;
	readonly runtimeGrant?: { readonly endpoint: string; readonly hostPort: string; readonly slot: "webdav" };
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

/** Only this installed package and complete declared slot may gain a runtime destination. */
function eligibleSlot(source: PluginRuntimeSource): PluginCredentialSlot | undefined {
	if (source.pluginId !== "@gyoungwe/pi-knowledge" || !source.networkHosts?.includes(DEFAULT_HOST))
		return undefined;
	return source.credentials?.find(
		(slot) =>
			slot.slot === "webdav" &&
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
	const webdav = eligibleSlot(source);
	if (!webdav) return declared;
	if (rawEndpoint === undefined)
		return { ...declared, configuration: { state: "ready", endpoint: DEFAULT_ENDPOINT, source: "default" } };
	const parsed = parseEndpoint(rawEndpoint);
	if (!parsed)
		return {
			...declared,
			configuration: { state: "invalid", endpoint: null, source: "env", reason: "invalid_endpoint" },
		};
	return {
		configuration: { state: "ready", endpoint: parsed.endpoint, source: "env" },
		networkHosts: [...new Set([...networkHosts, parsed.hostPort])],
		credentialHosts: {
			...credentialHosts,
			webdav: [...new Set([...webdav.hosts, parsed.hostPort])],
		},
		runtimeGrant: { ...parsed, slot: "webdav" },
	};
}

export function assertEndpointAvailable(
	policy: PluginEndpointPolicy | undefined,
	slot: string | undefined,
): void {
	if (slot === "webdav" && policy?.configuration?.state === "invalid")
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
	return Boolean(
		httpAuth && slot === "webdav" && grant?.endpoint === url.origin && destinations?.includes(grant.hostPort),
	);
}
