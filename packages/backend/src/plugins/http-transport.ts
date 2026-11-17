import { createHash } from "node:crypto";
import type { PluginEndpointAccess } from "./endpoint-policy";
import { HttpAuthChallenges, type HttpAuthSend, validHttpUsername } from "./http-auth";
import { credentialSlot, type PluginCredentialStore } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import { MAX_FILE_BINARY_BYTES } from "./stable-file-bytes";

export type HttpAuthentication = (method: string, send: HttpAuthSend) => Promise<Response>;
// Source handlers are rebuilt per call; the store owns the challenge state's lifetime.
const challengesByStore = new WeakMap<PluginCredentialStore, HttpAuthChallenges>();
const RESPONSE_HEADERS = new Set(["etag", "last-modified", "content-type", "content-length"]);
const TIMEOUT_MS = 30_000;

/** Validate request metadata now; resolve the effective secret only when execution sends it. */
export function authenticatedRequest(
	store: PluginCredentialStore,
	source: PluginRuntimeSource,
	name: string,
	url: URL,
	username?: string,
	endpointAccess?: PluginEndpointAccess,
): HttpAuthentication | undefined {
	const slot = credentialSlot(source, name, url, endpointAccess?.policy, username !== undefined);
	if (!slot.authentication) {
		if (username !== undefined) throw new Error(`Credential ${name} does not use host HTTP authentication`);
		return undefined;
	}
	if (username === undefined) throw new Error(`Credential ${name} requires host HTTP authentication`);
	if (!validHttpUsername(username)) throw new Error("Invalid HTTP authentication username");
	return async (method, send) => {
		endpointAccess?.check();
		const { credential } = await store.resolve(source.pluginId, slot);
		endpointAccess?.check();
		if (!credential) throw new Error(`Credential ${name} is not configured; add it in Drone settings`);
		let challenges = challengesByStore.get(store);
		if (!challenges) {
			challenges = new HttpAuthChallenges();
			challengesByStore.set(store, challenges);
		}
		const hash = createHash("sha256").update(credential.secret).digest("hex");
		const scope = `${source.pluginId}\t${url.origin}\t${name}\t${credential.source}\t${hash}`;
		const checkedSend: HttpAuthSend = (authorization) => {
			endpointAccess?.check();
			return send(authorization);
		};
		try {
			return await challenges.send(
				scope,
				{ method, url },
				{ username, password: credential.secret },
				checkedSend,
			);
		} catch {
			endpointAccess?.check();
			// Network diagnostics may echo host-only Authorization material; callers get a fixed failure.
			throw new Error("Authenticated network request failed");
		}
	};
}

interface HttpRequest {
	readonly method: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly bodyBase64?: string;
}

async function readLimited(response: Response): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let total = 0;
	const reader = response.body?.getReader();
	if (!reader) return Buffer.alloc(0);
	for (let read = await reader.read(); !read.done; read = await reader.read()) {
		total += read.value.byteLength;
		if (total > MAX_FILE_BINARY_BYTES) {
			await reader.cancel();
			throw new Error(`Network response exceeds ${MAX_FILE_BINARY_BYTES} bytes`);
		}
		chunks.push(Buffer.from(read.value));
	}
	return Buffer.concat(chunks);
}

async function responseResult(response: Response, authenticated: boolean) {
	const headers: Record<string, string> = {};
	response.headers.forEach((value, name) => {
		if (!authenticated || RESPONSE_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
	});
	if (authenticated && response.status >= 400) {
		await response.body?.cancel();
		return { status: response.status, headers, base64: "", bytes: 0 };
	}
	const bytes = await readLimited(response);
	return { status: response.status, headers, base64: bytes.toString("base64"), bytes: bytes.length };
}

/** One authorized request, optionally including its single host-managed challenge exchange. */
export async function sendHttp(
	request: HttpRequest,
	url: URL,
	signal: AbortSignal,
	fetchImpl: typeof fetch,
	authenticate?: HttpAuthentication,
	checkEndpoint?: () => void,
) {
	const body = request.bodyBase64 === undefined ? undefined : Buffer.from(request.bodyBase64, "base64");
	const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
	const send: HttpAuthSend = (authorization) => {
		checkEndpoint?.();
		return fetchImpl(url, {
			method: request.method,
			headers: { ...request.headers, ...(authorization === null ? {} : { Authorization: authorization }) },
			body,
			redirect: "error",
			signal: requestSignal,
		});
	};
	const response = authenticate ? await authenticate(request.method, send) : await send(null);
	if (!authenticate) return responseResult(response, false);
	try {
		return await responseResult(response, true);
	} catch {
		// Response streams can also carry server-controlled failure text.
		throw new Error("Authenticated network request failed");
	}
}
