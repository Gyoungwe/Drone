import type { PluginCredentialSlot, PluginNetworkPolicy } from "@drone/backend";

interface NetworkManifest {
	readonly permissions?: { readonly network?: unknown };
	readonly drone?: {
		readonly networkReads?: unknown;
		readonly credentials?: unknown;
		readonly networkPolicy?: unknown;
	};
}
export interface NetworkDeclaration {
	networkHosts?: readonly string[];
	networkReads?: readonly string[];
	credentials?: readonly PluginCredentialSlot[];
	networkPolicy?: PluginNetworkPolicy;
}

const text = (value: unknown, pattern: RegExp): value is string =>
	typeof value === "string" && pattern.test(value);

/**
 * Keys that look like a credential grant but are not one.
 *
 * A slot may declare the custody *kind* only; the host owns the map from a kind to
 * a secret it already keeps.  A key that names a source of a secret would let a
 * package point the host at a variable in its environment, so it is refused
 * rather than ignored — an ignored grant-looking key reads as a working one.
 *
 * Every other unknown key is tolerated: a manifest written for a newer host must
 * still load here, and the decoder keeps only the keys it knows.
 */
const REFUSED_SLOT_KEYS = new Set(["custodySource", "secretSource", "envVar"]);

/** `drone.credentials`: slots whose secrets the host adds as a header, only toward declared hosts. */
function credentialSlots(raw: unknown, hosts: readonly string[]): readonly PluginCredentialSlot[] {
	const slots = Array.isArray(raw) ? (raw as Partial<PluginCredentialSlot>[]) : [];
	const valid = slots.every(
		(slot) =>
			!Object.keys(slot ?? {}).some((key) => REFUSED_SLOT_KEYS.has(key)) &&
			text(slot?.slot, /^[a-z][a-z0-9-]{0,63}$/) &&
			text(slot.label?.zh, /\S/) &&
			text(slot.label?.en, /\S/) &&
			Array.isArray(slot.hosts) &&
			slot.hosts.length > 0 &&
			slot.hosts.every((host) => hosts.includes(host)) &&
			text(slot.header, /^[A-Za-z][A-Za-z0-9-]{0,127}$/) &&
			Array.isArray(slot.fields) &&
			slot.fields.every((field) => text(field, /^[A-Za-z][A-Za-z0-9]{0,63}$/)) &&
			(slot.authentication === undefined ||
				(slot.authentication === "http-basic-digest" &&
					slot.header.toLowerCase() === "authorization" &&
					slot.fields.length === 0)) &&
			(slot.custody === undefined || slot.custody === "user" || slot.custody === "host-environment"),
	);
	if (
		!Array.isArray(raw) ||
		!raw.length ||
		!valid ||
		new Set(slots.map((slot) => slot.slot)).size !== slots.length
	)
		throw new Error(
			"drone.credentials must list unique slots with a label, declared network hosts, a header and fields",
		);
	return slots.map(
		({ slot, label, hosts, header, fields, authentication, custody }) =>
			({
				slot,
				label,
				hosts,
				header,
				fields,
				...(authentication ? { authentication } : {}),
				...(custody ? { custody } : {}),
			}) as PluginCredentialSlot,
	);
}

/** Manifest network declarations a managed runtime source carries: `permissions.network` hosts and `drone.networkReads`. */
export function networkDeclaration(manifest: NetworkManifest): NetworkDeclaration {
	const runtime: NetworkDeclaration = {};
	const network = manifest.permissions?.network;
	if (Array.isArray(network)) {
		const hosts = network.filter(
			(entry: unknown): entry is string => typeof entry === "string" && entry !== "configured-services",
		);
		if (hosts.length) runtime.networkHosts = hosts;
	}
	const reads = manifest.drone?.networkReads;
	if (reads !== undefined) {
		const hosts = runtime.networkHosts ?? [];
		// "host[:port]/path": a POST endpoint that only reads, on a declared host.
		if (
			!Array.isArray(reads) ||
			reads.some(
				(entry: unknown) =>
					typeof entry !== "string" ||
					!/^[^/\s]+\/[^\s?#]*$/.test(entry) ||
					!hosts.includes(entry.slice(0, entry.indexOf("/"))),
			)
		)
			throw new Error("drone.networkReads must list host/path endpoints on declared network hosts");
		runtime.networkReads = reads;
	}
	if (manifest.drone?.credentials !== undefined)
		runtime.credentials = credentialSlots(manifest.drone.credentials, runtime.networkHosts ?? []);
	if (manifest.drone?.networkPolicy !== undefined)
		runtime.networkPolicy = networkPolicy(manifest.drone.networkPolicy, runtime.credentials ?? []);
	return runtime;
}

/**
 * `drone.networkPolicy`: what the package may ask the user to approve at install.
 *
 * The named slot must exist in `drone.credentials` — a policy that names a slot
 * the package never declared is a manifest mistake, not a policy.
 */
function networkPolicy(raw: unknown, credentials: readonly PluginCredentialSlot[]): PluginNetworkPolicy {
	const value = raw as { runtimeEndpoint?: { allowed?: unknown; credentialSlot?: unknown } };
	const endpoint = value?.runtimeEndpoint;
	if (endpoint === undefined || typeof endpoint !== "object")
		throw new Error("drone.networkPolicy must declare runtimeEndpoint");
	if (endpoint.allowed !== true) throw new Error("drone.networkPolicy.runtimeEndpoint.allowed must be true");
	if (!text(endpoint.credentialSlot, /^[a-z][a-z0-9-]{0,63}$/))
		throw new Error("drone.networkPolicy.runtimeEndpoint.credentialSlot must be a slot name");
	if (!credentials.some((slot) => slot.slot === endpoint.credentialSlot))
		throw new Error(
			`drone.networkPolicy.runtimeEndpoint.credentialSlot must name a declared credential slot: ${endpoint.credentialSlot}`,
		);
	return { runtimeEndpoint: { allowed: true, credentialSlot: endpoint.credentialSlot } };
}
