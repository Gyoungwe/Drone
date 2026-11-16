import { createHash, randomBytes } from "node:crypto";

export interface HttpCredential {
	readonly username: string;
	readonly password: string;
}

/** One challenged request attempt: the caller sends it and returns the Response. */
export type HttpAuthSend = (authorization: string | null) => Promise<Response>;

interface HttpRequest {
	method: string;
	url: URL;
}

interface DigestChallenge {
	realm: string;
	nonce: string;
	algorithm: "MD5" | "MD5-SESS";
	qop: "auth" | null;
	opaque: string | null;
}

interface ScopeState {
	scheme: DigestChallenge | "basic" | null;
	nonceCounts: Map<string, number>;
}

interface AuthenticationChallenge {
	scheme: string;
	parameters: string[];
}

export function validHttpUsername(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[:\p{Cc}]/u.test(value);
}

function digestHash(value: string): string {
	return createHash("md5").update(value, "utf8").digest("hex");
}

function challengeParts(value: string): string[] | null {
	const parts: string[] = [];
	let part = "";
	let quoted = false;
	let escaped = false;
	for (const character of value) {
		if (escaped) {
			part += character;
			escaped = false;
		} else if (character === "\\" && quoted) {
			escaped = true;
		} else if (character === '"') {
			quoted = !quoted;
			part += character;
		} else if (character === "," && !quoted) {
			parts.push(part);
			part = "";
		} else {
			part += character;
		}
	}
	if (quoted) return null;
	parts.push(part);
	return parts;
}

function authenticationChallenges(value: string | null): AuthenticationChallenge[] {
	if (value === null) return [];
	const parts = challengeParts(value);
	if (!parts) return [];
	const challenges: AuthenticationChallenge[] = [];
	let current: AuthenticationChallenge | undefined;
	for (const part of parts) {
		const match = part.trim().match(/^([a-z][a-z0-9-]*)(?:\s+([^=\s].*))?$/i);
		if (match?.[1]) {
			current = { scheme: match[1].toLowerCase(), parameters: [] };
			challenges.push(current);
			if (match[2]) current.parameters.push(match[2]);
		} else current?.parameters.push(part);
	}
	return challenges;
}

function parseDigestChallenge(parameters: readonly string[]): DigestChallenge | null {
	const attributes: Record<string, string> = {};
	for (const item of parameters) {
		const separator = item.indexOf("=");
		if (separator < 1) continue;
		const key = item.slice(0, separator).trim().toLowerCase();
		let itemValue = item.slice(separator + 1).trim();
		if (itemValue.startsWith('"') && itemValue.endsWith('"')) itemValue = itemValue.slice(1, -1);
		attributes[key] = itemValue;
	}
	const { realm, nonce, qop } = attributes;
	const algorithm = (attributes.algorithm ?? "MD5").toUpperCase();
	if (!realm || !nonce || (algorithm !== "MD5" && algorithm !== "MD5-SESS")) return null;
	if (qop !== undefined && !qop.split(",").some((item) => item.trim().toLowerCase() === "auth")) return null;
	return {
		realm,
		nonce,
		algorithm,
		qop: qop === undefined ? null : "auth",
		opaque: attributes.opaque ?? null,
	};
}

function quoteDigest(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function digestAuthorization(
	challenge: DigestChallenge,
	nonceCounts: Map<string, number>,
	{ method, url }: HttpRequest,
	{ username, password }: HttpCredential,
): string {
	const uri = `${url.pathname}${url.search}`;
	const count = (nonceCounts.get(challenge.nonce) ?? 0) + 1;
	nonceCounts.set(challenge.nonce, count);
	const nonceCount = count.toString(16).padStart(8, "0");
	const cnonce = randomBytes(16).toString("hex");
	let ha1 = digestHash(`${username}:${challenge.realm}:${password}`);
	if (challenge.algorithm === "MD5-SESS") ha1 = digestHash(`${ha1}:${challenge.nonce}:${cnonce}`);
	const ha2 = digestHash(`${method}:${uri}`);
	const response = challenge.qop
		? digestHash(`${ha1}:${challenge.nonce}:${nonceCount}:${cnonce}:${challenge.qop}:${ha2}`)
		: digestHash(`${ha1}:${challenge.nonce}:${ha2}`);
	const parts = [
		`username=${quoteDigest(username)}`,
		`realm=${quoteDigest(challenge.realm)}`,
		`nonce=${quoteDigest(challenge.nonce)}`,
		`uri=${quoteDigest(uri)}`,
		`response=${quoteDigest(response)}`,
		`algorithm=${challenge.algorithm}`,
	];
	if (challenge.qop) parts.push(`qop=${challenge.qop}`, `nc=${nonceCount}`);
	if (challenge.qop || challenge.algorithm === "MD5-SESS") parts.push(`cnonce=${quoteDigest(cnonce)}`);
	if (challenge.opaque) parts.push(`opaque=${quoteDigest(challenge.opaque)}`);
	return `Digest ${parts.join(", ")}`;
}

function authorization(state: ScopeState, request: HttpRequest, credential: HttpCredential): string | null {
	if (state.scheme === null) return null;
	if (state.scheme === "basic")
		return `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`;
	return digestAuthorization(state.scheme, state.nonceCounts, request, credential);
}

export class HttpAuthChallenges {
	private readonly scopes = new Map<string, ScopeState>();

	/** Scope is an opaque caller-built key covering source, origin, slot and credential selection. */
	async send(
		scope: string,
		request: HttpRequest,
		credential: HttpCredential,
		send: HttpAuthSend,
	): Promise<Response> {
		if (!validHttpUsername(credential.username)) throw new Error("Invalid HTTP authentication username");
		const state: ScopeState = this.scopes.get(scope) ?? { scheme: null, nonceCounts: new Map() };
		this.scopes.set(scope, state);
		const basicTried = state.scheme === "basic";
		let response = await send(authorization(state, request, credential));
		if (response.status !== 401) return response;
		const challenges = authenticationChallenges(response.headers.get("www-authenticate"));
		await response.body?.cancel();
		const challenge = challenges
			.filter((item) => item.scheme === "digest")
			.map((item) => parseDigestChallenge(item.parameters))
			.find((item) => item !== null);
		if (challenge) state.scheme = challenge;
		else if (challenges.some((item) => item.scheme === "basic") && !basicTried) state.scheme = "basic";
		else return response;
		// One challenge exchange belongs to this request; a second rejection must never loop.
		response = await send(authorization(state, request, credential));
		if (response.status === 401) await response.body?.cancel();
		return response;
	}

	/** Drop matching scope state when a slot or effective credential changes. */
	invalidate(prefix: string): void {
		for (const scope of this.scopes.keys()) {
			if (scope.startsWith(prefix)) this.scopes.delete(scope);
		}
	}
}
