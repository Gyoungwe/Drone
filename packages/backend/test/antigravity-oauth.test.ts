import { describe, expect, it, vi } from "vitest";
import {
	buildAuthorizationUrl,
	buildRedirectUri,
	createPkce,
	discoverAntigravityProject,
	exchangeAuthorizationCode,
	isCredentialStale,
	loginAntigravity,
	parseCallbackInput,
	refreshAntigravityCredential,
} from "../src/session-engine/antigravity/oauth";
import { antigravityPlatform, safeAntigravityError } from "../src/session-engine/antigravity/types";

describe("Antigravity OAuth helpers", () => {
	it.each([
		["darwin", "x64", 1],
		["darwin", "arm64", 2],
		["linux", "x64", 3],
		["linux", "arm64", 4],
		["win32", "x64", 5],
		["win32", "arm64", 0],
		["unknown", "unknown", 0],
	])("maps %s/%s to the native platform enum", (platform, arch, expected) => {
		expect(antigravityPlatform(String(platform), String(arch))).toBe(expected);
	});

	it("builds a PKCE authorization URL and parses callback input", () => {
		const pkce = createPkce(() => Buffer.from("fixed-verifier"));
		const url = buildAuthorizationUrl({
			state: "state-1",
			challenge: pkce.challenge,
			redirectUri: buildRedirectUri(51234),
		});
		const parsed = new URL(url);
		expect(parsed.searchParams.get("state")).toBe("state-1");
		expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
		expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:51234/oauth-callback");
		expect(parseCallbackInput("http://127.0.0.1:51234/oauth-callback?code=abc&state=state-1")).toEqual({
			code: "abc",
			state: "state-1",
		});
		expect(parseCallbackInput("code=abc&state=state-1")).toEqual({ code: "abc", state: "state-1" });
	});

	it("uses a refresh safety window", () => {
		expect(isCredentialStale({ expires: Date.now() + 30_000 })).toBe(true);
		expect(isCredentialStale({ expires: Date.now() + 300_000 })).toBe(false);
	});

	it("refreshes a credential without logging or changing the refresh token", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600 }), { status: 200 }),
			);
		const credential = await refreshAntigravityCredential(
			{ type: "oauth", access: "old-access", refresh: "refresh-secret", expires: 0, projectId: "project-1" },
			{ fetcher },
		);
		expect(credential.access).toBe("new-access");
		expect(credential.refresh).toBe("refresh-secret");
		expect(credential.projectId).toBe("project-1");
		expect(JSON.stringify(fetcher.mock.calls[0]?.[1])).not.toContain("old-access");
	});

	it("exchanges a code and persists the discovered project metadata", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 }),
					{
						status: 200,
					},
				),
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ email: "user@example.com" }), { status: 200 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ cloudaicompanionProject: "project-1" }), { status: 200 }),
			);
		const credential = await exchangeAuthorizationCode({
			code: "code-1",
			verifier: "verifier-1",
			redirectUri: buildRedirectUri(),
			fetcher,
		});
		expect(credential).toMatchObject({
			type: "oauth",
			access: "access-1",
			refresh: "refresh-1",
			projectId: "project-1",
			email: "user@example.com",
		});
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it("discovers an existing Cloud Code Assist project", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(JSON.stringify({ cloudaicompanionProject: "project-123" }), { status: 200 }),
			);
		expect(await discoverAntigravityProject("access-secret", fetcher)).toBe("project-123");
		expect(fetcher).toHaveBeenCalledTimes(1);
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url).toContain("v1internal:loadCodeAssist");
		expect(init?.headers).toMatchObject({
			"User-Agent": "antigravity/hub/2.19.1 (aidev_client)",
			"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
			"Client-Metadata": expect.stringContaining('"ideType":9'),
		});
		const metadata = {
			ideType: 9,
			platform: antigravityPlatform(process.platform, process.arch),
			pluginType: 2,
		};
		expect(JSON.parse(String(init?.body))).toEqual({ metadata });
		expect(JSON.parse(new Headers(init?.headers).get("Client-Metadata") ?? "null")).toEqual(
			JSON.parse(String(init?.body)).metadata,
		);
	});

	it("rejects unsafe project identifiers instead of interpolating them into requests", async () => {
		const fetcher = vi.fn<typeof fetch>().mockImplementation(
			async () =>
				new Response(JSON.stringify({ cloudaicompanionProject: "https://attacker.invalid" }), {
					status: 200,
				}),
		);
		await expect(discoverAntigravityProject("access-secret", fetcher)).rejects.toMatchObject({
			kind: "project",
		});
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it("redacts bearer and token-shaped fields from provider errors", () => {
		const safe = safeAntigravityError(
			'Bearer secret access_token="access-secret" refresh_token=refresh-secret client_secret: "client-secret"',
		);
		expect(safe).not.toContain("refresh-secret");
		expect(safe).not.toContain("client-secret");
		expect(safe).not.toContain("access-secret");
		expect(safe).toContain("<redacted>");
	});

	it("keeps Google error reason codes without exposing the response message or metadata", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						status: "PERMISSION_DENIED",
						message: "private-account@example.com Bearer access-secret",
						details: [
							{
								"@type": "type.googleapis.com/google.rpc.ErrorInfo",
								reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
								metadata: { token: "access-secret" },
							},
						],
					},
				}),
				{ status: 403 },
			),
		);
		await expect(discoverAntigravityProject("access-secret", fetcher)).rejects.toMatchObject({
			status: 403,
			kind: "project",
			message: "Cloud Code Assist request failed (403): PERMISSION_DENIED, ACCESS_TOKEN_SCOPE_INSUFFICIENT",
		});
	});

	it("completes browser callback login without exposing the refresh token to request headers", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ email: "user@example.com" }), { status: 200 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ cloudaicompanionProject: "project" }), { status: 200 }),
			);
		const notifications: unknown[] = [];
		const abortController = new AbortController();
		const credentialPromise = loginAntigravity(
			{
				signal: abortController.signal,
				notify: (event) => notifications.push(event),
				prompt: ({ signal }) =>
					new Promise<string>((_resolve, reject) =>
						signal?.addEventListener("abort", () => reject(new Error("prompt cancelled")), { once: true }),
					),
			},
			{
				callbackPort: 0,
				fetcher,
				openBrowser: async (url) => {
					const auth = new URL(url);
					const redirect = new URL(auth.searchParams.get("redirect_uri")!);
					redirect.searchParams.set("code", "browser-code");
					redirect.searchParams.set("state", auth.searchParams.get("state")!);
					await fetch(redirect);
				},
			},
		);
		const credential = await credentialPromise;
		expect(credential).toMatchObject({ access: "access", refresh: "refresh", projectId: "project" });
		expect(notifications).toHaveLength(1);
	});
});
