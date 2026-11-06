import type { PluginCredentialSlot } from "@drone/backend";

interface NetworkManifest {
	readonly permissions?: { readonly network?: unknown };
	readonly drone?: { readonly networkReads?: unknown; readonly credentials?: unknown };
}
export interface NetworkDeclaration {
	networkHosts?: readonly string[];
	networkReads?: readonly string[];
	credentials?: readonly PluginCredentialSlot[];
}

const text = (value: unknown, pattern: RegExp): value is string =>
	typeof value === "string" && pattern.test(value);

/** `drone.credentials`: slots whose secrets the host adds as a header, only toward declared hosts. */
function credentialSlots(raw: unknown, hosts: readonly string[]): readonly PluginCredentialSlot[] {
	const slots = Array.isArray(raw) ? (raw as Partial<PluginCredentialSlot>[]) : [];
	const valid = slots.every(
		(slot) =>
			text(slot?.slot, /^[a-z][a-z0-9-]{0,63}$/) &&
			text(slot.label?.zh, /\S/) &&
			text(slot.label?.en, /\S/) &&
			Array.isArray(slot.hosts) &&
			slot.hosts.length > 0 &&
			slot.hosts.every((host) => hosts.includes(host)) &&
			text(slot.header, /^[A-Za-z][A-Za-z0-9-]{0,127}$/) &&
			Array.isArray(slot.fields) &&
			slot.fields.every((field) => text(field, /^[A-Za-z][A-Za-z0-9]{0,63}$/)),
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
		({ slot, label, hosts, header, fields }) =>
			({ slot, label, hosts, header, fields }) as PluginCredentialSlot,
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
	return runtime;
}
