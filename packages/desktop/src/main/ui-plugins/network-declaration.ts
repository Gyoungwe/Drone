interface NetworkManifest {
	readonly permissions?: { readonly network?: unknown };
	readonly drone?: { readonly networkReads?: unknown };
}
export interface NetworkDeclaration {
	networkHosts?: readonly string[];
	networkReads?: readonly string[];
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
	return runtime;
}
