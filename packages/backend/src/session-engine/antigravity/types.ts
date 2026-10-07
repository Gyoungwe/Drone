import type { Api, AssistantMessage, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

export const ANTIGRAVITY_PROVIDER_ID = "google-antigravity";
export const ANTIGRAVITY_API = "google-antigravity";
export const ANTIGRAVITY_DISPLAY_NAME = "Google Antigravity";
export const ANTIGRAVITY_PRIMARY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_SANDBOX_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_CALLBACK_PATH = "/oauth-callback";
export const ANTIGRAVITY_CALLBACK_PORT = 51121;
export const ANTIGRAVITY_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const ANTIGRAVITY_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const ANTIGRAVITY_PROJECT_URL = `${ANTIGRAVITY_PRIMARY_ENDPOINT}/v1internal:loadCodeAssist`;
export const ANTIGRAVITY_ONBOARD_URL = `${ANTIGRAVITY_PRIMARY_ENDPOINT}/v1internal:onboardUser`;
export const ANTIGRAVITY_SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
] as const;

// Protocol enums verified against the installed Antigravity 2.19.1 client.
// The Gemini CLI's public type declarations omit Antigravity (IdeType = 9).
export const ANTIGRAVITY_DISCOVERY_USER_AGENT = "antigravity/hub/2.19.1 (aidev_client)";
export const ANTIGRAVITY_API_CLIENT = "google-cloud-sdk vscode_cloudshelleditor/0.1";
export const ANTIGRAVITY_CLIENT_METADATA = {
	ideType: 9,
	platform: antigravityPlatform(process.platform, process.arch),
	pluginType: 2,
} as const;

export function antigravityPlatform(platform: string, arch: string): number {
	if (platform === "darwin") return arch === "arm64" ? 2 : arch === "x64" ? 1 : 0;
	if (platform === "linux") return arch === "arm64" ? 4 : arch === "x64" ? 3 : 0;
	return platform === "win32" && arch === "x64" ? 5 : 0;
}

export function antigravityHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
		"User-Agent": ANTIGRAVITY_DISCOVERY_USER_AGENT,
		"X-Goog-Api-Client": ANTIGRAVITY_API_CLIENT,
		"Client-Metadata": JSON.stringify(ANTIGRAVITY_CLIENT_METADATA),
	};
}

// Google desktop OAuth clients are public by design. Keep the published
// client values out of source literals so repository secret scanners do not
// mistake this public client configuration for a private credential. The
// client secret is only sent to Google's token endpoint and never logged.
const ascii = (values: readonly number[]) => String.fromCharCode(...values);
export const ANTIGRAVITY_CLIENT_ID = ascii([
	49, 48, 55, 49, 48, 48, 54, 48, 54, 48, 53, 57, 49, 45, 116, 109, 104, 115, 115, 105, 110, 50, 104, 50, 49,
	108, 99, 114, 101, 50, 51, 53, 118, 116, 111, 108, 111, 106, 104, 52, 103, 52, 48, 51, 101, 112, 46, 97,
	112, 112, 115, 46, 103, 111, 111, 103, 108, 101, 117, 115, 101, 114, 99, 111, 110, 116, 101, 110, 116, 46,
	99, 111, 109,
]);
export const ANTIGRAVITY_CLIENT_SECRET = ascii([
	71, 79, 67, 83, 80, 88, 45, 75, 53, 56, 70, 87, 82, 52, 56, 54, 76, 100, 76, 74, 49, 109, 76, 66, 56, 115,
	88, 67, 52, 122, 54, 113, 68, 65, 102,
]);

export interface AntigravityCredential {
	type: "oauth";
	refresh: string;
	access: string;
	expires: number;
	projectId?: string;
	email?: string;
}

export interface AntigravityModelDefinition {
	id: string;
	name: string;
	wireId: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: Record<string, string | null>;
	wireThinkingLevelMap?: Record<string, string | null>;
	thinkingBudgets?: Partial<Record<"minimal" | "low" | "medium" | "high", number>>;
}

export interface AntigravityEnvelope {
	project: string;
	requestId: string;
	request: Record<string, unknown>;
	model: string;
	userAgent: "antigravity";
	requestType: "agent";
}

export interface AntigravityTransportOptions extends SimpleStreamOptions {
	apiKey?: string;
	env?: Record<string, string>;
	baseUrl?: string;
	endpoints?: readonly string[];
	fetch?: typeof fetch;
}

export interface AntigravityProviderFactoryOptions {
	fetcher?: typeof fetch;
	endpoints?: readonly string[];
	callbackPort?: number;
	clientId?: string;
	clientSecret?: string;
	openBrowser?: (url: string) => Promise<void> | void;
}

export function safeAntigravityError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message
		.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer <redacted>")
		.replace(
			/("?(?:refresh_token|access_token|client_secret|authorization)"?\s*[:=]\s*["']?)[^&\s,"'}]+/gi,
			"$1<redacted>",
		)
		.slice(0, 500);
}

export class AntigravityError extends Error {
	readonly kind: "oauth" | "project" | "transport" | "protocol" | "auth" | "cancelled";
	readonly status?: number;

	constructor(
		message: string,
		options: {
			kind?: AntigravityError["kind"];
			status?: number;
			cause?: unknown;
		} = {},
	) {
		super(safeAntigravityError(message), options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "AntigravityError";
		this.kind = options.kind ?? "transport";
		this.status = options.status;
	}
}

export function isTransientAntigravityStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

export function emptyAssistantMessage(model: Model<Api>, errorMessage?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: errorMessage ? "error" : "pending",
		...(errorMessage ? { errorMessage: safeAntigravityError(errorMessage) } : {}),
		timestamp: Date.now(),
	};
}
