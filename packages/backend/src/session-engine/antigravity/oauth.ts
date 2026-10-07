import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { OAuthCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import {
	ANTIGRAVITY_AUTH_URL,
	ANTIGRAVITY_CALLBACK_PATH,
	ANTIGRAVITY_CALLBACK_PORT,
	ANTIGRAVITY_CLIENT_ID,
	ANTIGRAVITY_CLIENT_METADATA,
	ANTIGRAVITY_CLIENT_SECRET,
	ANTIGRAVITY_ONBOARD_URL,
	ANTIGRAVITY_PRIMARY_ENDPOINT,
	ANTIGRAVITY_PROJECT_URL,
	ANTIGRAVITY_SCOPES,
	ANTIGRAVITY_TOKEN_URL,
	type AntigravityCredential,
	AntigravityError,
	type AntigravityProviderFactoryOptions,
	antigravityHeaders,
	safeAntigravityError,
} from "./types";

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const ONBOARD_TIMEOUT_MS = 30_000;
const ONBOARD_POLL_INTERVAL_MS = 500;
const REFRESH_SKEW_MS = 60_000;
const FREE_TIER_ID = "free-tier";

export interface PkcePair {
	verifier: string;
	challenge: string;
}

export function createPkce(random: () => Buffer = () => randomBytes(32)): PkcePair {
	const verifier = random().toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

export function buildRedirectUri(port = ANTIGRAVITY_CALLBACK_PORT): string {
	return `http://127.0.0.1:${port}${ANTIGRAVITY_CALLBACK_PATH}`;
}

export function buildAuthorizationUrl(input: {
	state: string;
	challenge: string;
	redirectUri: string;
	clientId?: string;
}): string {
	const params = new URLSearchParams({
		client_id: input.clientId ?? ANTIGRAVITY_CLIENT_ID,
		response_type: "code",
		redirect_uri: input.redirectUri,
		scope: ANTIGRAVITY_SCOPES.join(" "),
		state: input.state,
		code_challenge: input.challenge,
		code_challenge_method: "S256",
		access_type: "offline",
		prompt: "consent",
	});
	return `${ANTIGRAVITY_AUTH_URL}?${params.toString()}`;
}

export function parseCallbackInput(input: string): { code?: string; state?: string } {
	const value = input.trim();
	if (!value) return {};
	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
		};
	} catch {
		// Fall through to query-string/raw-code parsing.
	}
	if (value.includes("code=")) {
		const params = new URLSearchParams(value.replace(/^[?#]/, ""));
		return { code: params.get("code") ?? undefined, state: params.get("state") ?? undefined };
	}
	const [code, state] = value.split("#", 2);
	return { code: code || undefined, state: state || undefined };
}

export function isCredentialStale(
	credential: Pick<AntigravityCredential, "expires">,
	now = Date.now(),
): boolean {
	return !Number.isFinite(credential.expires) || now + REFRESH_SKEW_MS >= credential.expires;
}

export async function exchangeAuthorizationCode(input: {
	code: string;
	verifier: string;
	redirectUri: string;
	clientId?: string;
	clientSecret?: string;
	fetcher?: typeof fetch;
	signal?: AbortSignal;
}): Promise<AntigravityCredential> {
	const fetcher = input.fetcher ?? fetch;
	const response = await fetchWithTimeout(
		fetcher,
		ANTIGRAVITY_TOKEN_URL,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: input.clientId ?? ANTIGRAVITY_CLIENT_ID,
				client_secret: input.clientSecret ?? ANTIGRAVITY_CLIENT_SECRET,
				code: input.code,
				code_verifier: input.verifier,
				grant_type: "authorization_code",
				redirect_uri: input.redirectUri,
			}),
		},
		input.signal,
	);
	if (!response.ok) {
		throw new AntigravityError(`Token exchange failed (${response.status})`, {
			kind: "oauth",
			status: response.status,
		});
	}
	const payload = (await response.json()) as Record<string, unknown>;
	const access = typeof payload.access_token === "string" ? payload.access_token : "";
	const refresh = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
	const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 0;
	if (!access || !refresh || expiresIn <= 0) {
		throw new AntigravityError("Google token response is missing a refresh token or expiry", {
			kind: "oauth",
		});
	}
	const email = await fetchUserEmail(access, fetcher, input.signal);
	const projectId = await discoverAntigravityProject(access, fetcher, input.signal);
	return {
		type: "oauth",
		access,
		refresh,
		expires: Date.now() + expiresIn * 1000,
		projectId,
		...(email ? { email } : {}),
	};
}

export async function refreshAntigravityCredential(
	credential: AntigravityCredential,
	input: { fetcher?: typeof fetch; clientId?: string; clientSecret?: string; signal?: AbortSignal } = {},
): Promise<AntigravityCredential> {
	const fetcher = input.fetcher ?? fetch;
	const response = await fetchWithTimeout(
		fetcher,
		ANTIGRAVITY_TOKEN_URL,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: input.clientId ?? ANTIGRAVITY_CLIENT_ID,
				client_secret: input.clientSecret ?? ANTIGRAVITY_CLIENT_SECRET,
				grant_type: "refresh_token",
				refresh_token: credential.refresh,
			}),
		},
		input.signal,
	);
	if (!response.ok) {
		throw new AntigravityError(`Token refresh failed (${response.status})`, {
			kind: "oauth",
			status: response.status,
		});
	}
	const payload = (await response.json()) as Record<string, unknown>;
	const access = typeof payload.access_token === "string" ? payload.access_token : "";
	const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 0;
	if (!access || expiresIn <= 0)
		throw new AntigravityError("Google refresh response is invalid", { kind: "oauth" });
	return {
		...credential,
		access,
		expires: Date.now() + expiresIn * 1000,
		refresh:
			typeof payload.refresh_token === "string" && payload.refresh_token
				? payload.refresh_token
				: credential.refresh,
	};
}

export function createAntigravityOAuth(options: AntigravityProviderFactoryOptions = {}) {
	const fetcher = options.fetcher ?? fetch;
	const clientId = options.clientId ?? ANTIGRAVITY_CLIENT_ID;
	const clientSecret = options.clientSecret ?? ANTIGRAVITY_CLIENT_SECRET;
	return {
		name: "Google Antigravity",
		isSubscription: false,
		loginLabel: "Sign in with Google (Antigravity)",
		login: (interaction: ProviderAuthInteraction): Promise<OAuthCredential> =>
			loginAntigravity(interaction, {
				...options,
				fetcher,
				clientId,
				clientSecret,
			}) as Promise<OAuthCredential>,
		refresh: (credential: OAuthCredential, signal: AbortSignal): Promise<OAuthCredential> =>
			refreshAntigravityCredential(normalizeCredential(credential), {
				fetcher,
				clientId,
				clientSecret,
				signal,
			}) as Promise<OAuthCredential>,
		toAuth: async (credential: OAuthCredential) => {
			const normalized = normalizeCredential(credential);
			return {
				apiKey: normalized.access,
				headers: {
					...(normalized.projectId ? { "x-drone-antigravity-project": normalized.projectId } : {}),
				},
			};
		},
	};
}

export async function loginAntigravity(
	interaction: ProviderAuthInteraction,
	options: AntigravityProviderFactoryOptions & {
		fetcher?: typeof fetch;
		clientId?: string;
		clientSecret?: string;
	} = {},
): Promise<AntigravityCredential> {
	const state = randomUUID();
	const pkce = createPkce();
	const callback = await createCallbackServer(
		options.callbackPort ?? ANTIGRAVITY_CALLBACK_PORT,
		state,
		interaction.signal,
	);
	const redirectUri = buildRedirectUri(callback.port);
	const authUrl = buildAuthorizationUrl({
		state,
		challenge: pkce.challenge,
		redirectUri,
		clientId: options.clientId,
	});
	interaction.notify({
		type: "auth_url",
		url: authUrl,
		instructions: "Complete Google sign-in, then return to Drone.",
	});
	try {
		await options.openBrowser?.(authUrl);
		const callbackResult = await raceCallbackAndManualInput(callback.waitForCode(), interaction, state);
		return await exchangeAuthorizationCode({
			code: callbackResult.code,
			verifier: pkce.verifier,
			redirectUri,
			clientId: options.clientId,
			clientSecret: options.clientSecret,
			fetcher: options.fetcher,
			signal: interaction.signal,
		});
	} finally {
		callback.close();
	}
}

function normalizeCredential(credential: OAuthCredential): AntigravityCredential {
	const value = credential as OAuthCredential & { projectId?: unknown; email?: unknown };
	return {
		type: "oauth",
		access: value.access,
		refresh: value.refresh,
		expires: value.expires,
		...(typeof value.projectId === "string" ? { projectId: value.projectId } : {}),
		...(typeof value.email === "string" ? { email: value.email } : {}),
	};
}

async function fetchUserEmail(
	access: string,
	fetcher: typeof fetch,
	signal?: AbortSignal,
): Promise<string | undefined> {
	try {
		const response = await fetchWithTimeout(
			fetcher,
			"https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
			{ headers: { Authorization: `Bearer ${access}` } },
			signal,
		);
		if (!response.ok) return undefined;
		const payload = (await response.json()) as { email?: unknown };
		return typeof payload.email === "string" ? payload.email : undefined;
	} catch {
		return undefined;
	}
}

export async function discoverAntigravityProject(
	access: string,
	fetcher: typeof fetch = fetch,
	signal?: AbortSignal,
): Promise<string> {
	const headers = antigravityHeaders(access);
	const metadata = { ...ANTIGRAVITY_CLIENT_METADATA };
	let payload = await postJson(fetcher, ANTIGRAVITY_PROJECT_URL, { metadata }, headers, signal);
	let projectId = projectFromPayload(payload);
	if (projectId) return projectId;
	const hasTier =
		payload && typeof payload === "object" && ("currentTier" in payload || "paidTier" in payload);
	if (!hasTier) {
		const onboard = await postJson(
			fetcher,
			ANTIGRAVITY_ONBOARD_URL,
			{ tierId: FREE_TIER_ID, metadata },
			headers,
			signal,
		);
		await waitForOnboard(fetcher, onboard, headers, signal, Date.now() + ONBOARD_TIMEOUT_MS);
		payload = await postJson(fetcher, ANTIGRAVITY_PROJECT_URL, { metadata }, headers, signal);
		projectId = projectFromPayload(payload);
	}
	if (!projectId)
		throw new AntigravityError("Cloud Code Assist did not return a project", { kind: "project" });
	return projectId;
}

function projectFromPayload(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const project = (payload as Record<string, unknown>).cloudaicompanionProject;
	if (typeof project !== "string") return undefined;
	const normalized = project.trim();
	return /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(normalized) ? normalized : undefined;
}

async function waitForOnboard(
	fetcher: typeof fetch,
	initial: unknown,
	headers: Record<string, string>,
	signal?: AbortSignal,
	deadline = Date.now() + ONBOARD_TIMEOUT_MS,
): Promise<void> {
	if (!initial || typeof initial !== "object" || Array.isArray(initial)) return;
	const operation = initial as Record<string, unknown>;
	if (operation.done === true) {
		if (operation.error)
			throw new AntigravityError("Cloud Code Assist onboarding failed", { kind: "project" });
		return;
	}
	const name = typeof operation.name === "string" ? operation.name : "";
	if (!name) return;
	if (signal?.aborted) throw new AntigravityError("Google login cancelled", { kind: "cancelled" });
	const remaining = deadline - Date.now();
	if (remaining <= 0)
		throw new AntigravityError("Cloud Code Assist onboarding timed out", { kind: "project" });
	await delayWithSignal(Math.min(ONBOARD_POLL_INTERVAL_MS, remaining), signal);
	const response = await postJson(
		fetcher,
		`${ANTIGRAVITY_PRIMARY_ENDPOINT}/v1internal/${name}`,
		undefined,
		headers,
		signal,
		"GET",
	);
	await waitForOnboard(fetcher, response, headers, signal, deadline);
}

async function delayWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		const onAbort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(new AntigravityError("Google login cancelled", { kind: "cancelled" }));
		};
		if (signal?.aborted) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function postJson(
	fetcher: typeof fetch,
	url: string,
	body: Record<string, unknown> | undefined,
	headers: Record<string, string>,
	signal?: AbortSignal,
	method: "POST" | "GET" = "POST",
): Promise<unknown> {
	const response = await fetchWithTimeout(
		fetcher,
		url,
		{ method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
		signal,
	);
	if (!response.ok) {
		const codes = await googleErrorCodes(response);
		throw new AntigravityError(`Cloud Code Assist request failed (${response.status})${codes}`, {
			kind: "project",
			status: response.status,
		});
	}
	return response.json();
}

async function googleErrorCodes(response: Response): Promise<string> {
	try {
		const payload = (await response.json()) as {
			error?: { status?: unknown; details?: { reason?: unknown }[] };
		};
		const error = payload?.error;
		const candidates: unknown[] = [error?.status];
		if (Array.isArray(error?.details)) {
			for (const detail of error.details.slice(0, 8)) candidates.push(detail?.reason);
		}
		// Only preserve machine-readable codes. Google messages and metadata can
		// contain account identifiers, project names, or credential values.
		const codes = [
			...new Set(
				candidates.filter(
					(value): value is string => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value),
				),
			),
		];
		return codes.length ? `: ${codes.join(", ")}` : "";
	} catch {
		return "";
	}
}

async function fetchWithTimeout(
	fetcher: typeof fetch,
	url: string,
	init: RequestInit,
	signal?: AbortSignal,
): Promise<Response> {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
	try {
		return await fetcher(url, { ...init, signal: composed });
	} catch (error) {
		if (signal?.aborted)
			throw new AntigravityError("Google login cancelled", { kind: "cancelled", cause: error });
		throw new AntigravityError(`Network request failed: ${safeAntigravityError(error)}`, {
			kind: "oauth",
			cause: error,
		});
	}
}

async function raceCallbackAndManualInput(
	callbackPromise: Promise<{ code: string; state: string }>,
	interaction: ProviderAuthInteraction,
	state: string,
): Promise<{ code: string; state: string }> {
	const manualPromptAbort = new AbortController();
	const manual = interaction.prompt({
		type: "manual_code",
		message:
			"Paste the full Google redirect URL or authorization code (optional if the browser callback succeeds).",
		placeholder: "http://127.0.0.1:.../oauth-callback?code=...&state=...",
		signal: manualPromptAbort.signal,
	});
	const manualResult = manual.then((value) => {
		const parsed = parseCallbackInput(value);
		if (!parsed.code) throw new AntigravityError("No authorization code found", { kind: "oauth" });
		if (parsed.state && parsed.state !== state)
			throw new AntigravityError("OAuth state mismatch", { kind: "oauth" });
		return { code: parsed.code, state: parsed.state ?? state };
	});
	return Promise.race([
		callbackPromise.then((result) => {
			manualPromptAbort.abort();
			return result;
		}),
		manualResult,
	]);
}

async function createCallbackServer(
	port: number,
	state: string,
	signal: AbortSignal,
): Promise<{
	port: number;
	waitForCode: () => Promise<{ code: string; state: string }>;
	close: () => void;
}> {
	const server = await listenWithFallback(port, signal);
	let resolveCode: ((result: { code: string; state: string }) => void) | undefined;
	let rejectCode: ((error: Error) => void) | undefined;
	const callback = new Promise<{ code: string; state: string }>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = reject;
	});
	const timeout = setTimeout(
		() => rejectCode?.(new AntigravityError("OAuth callback timed out", { kind: "oauth" })),
		CALLBACK_TIMEOUT_MS,
	);
	const abort = () => rejectCode?.(new AntigravityError("Google login cancelled", { kind: "cancelled" }));
	signal.addEventListener("abort", abort, { once: true });
	server.on("request", (request, response) =>
		handleCallbackRequest(request, response, state, resolveCode, rejectCode),
	);
	return {
		port: (server.address() as AddressInfo).port,
		waitForCode: () => callback,
		close: () => {
			clearTimeout(timeout);
			signal.removeEventListener("abort", abort);
			server.close();
		},
	};
}

async function listenWithFallback(port: number, signal: AbortSignal): Promise<Server> {
	for (const candidate of [port, 0]) {
		const server = createServer();
		try {
			await new Promise<void>((resolve, reject) => {
				const onError = (error: Error) => {
					server.removeListener("listening", onListening);
					reject(error);
				};
				const onListening = () => {
					server.removeListener("error", onError);
					resolve();
				};
				server.once("error", onError);
				server.once("listening", onListening);
				server.listen(candidate, "127.0.0.1");
			});
			return server;
		} catch (error) {
			server.close();
			if (candidate === 0 || signal.aborted) throw error;
		}
	}
	throw new AntigravityError("Could not start OAuth callback server", { kind: "oauth" });
}

function handleCallbackRequest(
	request: IncomingMessage,
	response: ServerResponse,
	expectedState: string,
	resolve: ((result: { code: string; state: string }) => void) | undefined,
	reject: ((error: Error) => void) | undefined,
): void {
	const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
	if (requestUrl.pathname !== ANTIGRAVITY_CALLBACK_PATH) {
		response.writeHead(404, { "Content-Type": "text/plain" });
		response.end("Not found");
		return;
	}
	const error = requestUrl.searchParams.get("error");
	const state = requestUrl.searchParams.get("state") ?? "";
	if (error && state === expectedState) {
		reject?.(new AntigravityError(`Google authorization failed: ${error}`, { kind: "oauth" }));
		response.writeHead(400, { "Content-Type": "text/html" });
		response.end("<h1>Google authorization failed</h1><p>You may close this window.</p>");
		return;
	}
	const code = requestUrl.searchParams.get("code");
	if (!code || state !== expectedState) {
		response.writeHead(400, { "Content-Type": "text/html" });
		response.end("<h1>Invalid OAuth callback</h1><p>You may close this window.</p>");
		return;
	}
	resolve?.({ code, state });
	response.writeHead(200, { "Content-Type": "text/html" });
	response.end("<h1>Drone sign-in complete</h1><p>You may close this window and return to Drone.</p>");
}
