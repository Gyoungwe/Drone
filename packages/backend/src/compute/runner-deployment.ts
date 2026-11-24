import { ComputeTransportError, sha256 } from "./compute-operation-lifetime";
import type { CollectingTransport } from "./runner-helpers";

export async function deployRunnerScript(
	transport: Pick<CollectingTransport, "download" | "upload">,
	source: Uint8Array,
	remoteRoot: string,
	maxUploadBytes: number,
): Promise<string> {
	const digest = sha256(source);
	const remote = `${remoteRoot}/runner/${digest}/runner.py`;
	try {
		if (sha256(await transport.download({ source: remote, maxBytes: source.byteLength + 1 })) === digest)
			return remote;
	} catch {
		// Re-uploading is safe because the replacement is verified by readback before use.
	}
	await transport.upload({ source, destination: remote, maxBytes: maxUploadBytes });
	if (sha256(await transport.download({ source: remote, maxBytes: source.byteLength + 1 })) !== digest)
		throw new ComputeTransportError("runner-checksum", "Remote runner checksum verification failed");
	return remote;
}
