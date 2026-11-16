import { Type } from "typebox";
import { hostText } from "../reply-language";
import { type HttpAuthentication, sendHttp } from "./http-transport";
import type { PluginCapabilityHandler } from "./runtime-capabilities";
import { MAX_FILE_BINARY_BASE64, MAX_FILE_BINARY_BYTES } from "./stable-file-bytes";

/**
 * HTTP on a managed plugin's behalf, limited to the hosts its manifest declares in
 * `permissions.network` (design: docs/superpowers/specs/2026-11-05-task-acceptance-role-design.md, N1).
 * The restricted worker itself has no network; this is its only route out.
 */
const READ_METHODS = ["GET", "HEAD", "PROPFIND"] as const;
/** POST reads only to an endpoint the manifest lists in `drone.networkReads`. */
const DECLARED_READ_METHODS = [...READ_METHODS, "POST"] as const;
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE", "MKCOL"] as const;
/** Decided by the host or the connection, never by plugin code. */
const RESERVED_HEADER =
	/^(?:host|cookie|connection|keep-alive|transfer-encoding|upgrade|te|trailer|content-length|proxy-.*)$/i;

/**
 * The declared entry a request URL is allowed under, or null when no entry admits it.
 * `declared` is the manifest's `permissions.network` minus `configured-services`, verbatim.
 */
export function declaredTarget(url: URL, declared: readonly string[]): string | null {
	// Exact host, with the port when one is declared: `url.host` is the lowercase hostname plus any
	// non-default port, so "127.0.0.1" alone admits only the default port and never every local
	// service. No subdomains; a free-text entry never equals a host.
	return declared.find((entry) => entry.toLowerCase() === url.host) ?? null;
}

const requestSchema = (methods: readonly string[], extra = {}) =>
	Type.Object(
		{
			...extra,
			method: Type.Union(methods.map((method) => Type.Literal(method))),
			url: Type.String({ minLength: 1, maxLength: 4096 }),
			headers: Type.Optional(Type.Record(Type.String({ maxLength: 128 }), Type.String({ maxLength: 8192 }))),
			bodyBase64: Type.Optional(Type.String({ maxLength: MAX_FILE_BINARY_BASE64 })),
			/** A `drone.credentials` slot whose secret stays with the host. */
			credential: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
			httpAuth: Type.Optional(
				Type.Object(
					{ username: Type.String({ minLength: 1, maxLength: 256 }) },
					{ additionalProperties: false },
				),
			),
		},
		{ additionalProperties: false },
	);
const resultSchema = Type.Object(
	{
		status: Type.Integer({ minimum: 100, maximum: 599 }),
		headers: Type.Record(Type.String(), Type.String()),
		base64: Type.String({ maxLength: MAX_FILE_BINARY_BASE64 }),
		bytes: Type.Integer({ minimum: 0, maximum: MAX_FILE_BINARY_BYTES }),
	},
	{ additionalProperties: false },
);

interface NetworkRequest {
	readonly method: string;
	readonly url: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly bodyBase64?: string;
	readonly summary?: string;
	readonly credential?: string;
	readonly httpAuth?: { readonly username: string };
}
export interface NetworkDeclaration {
	/** Manifest `permissions.network` minus `configured-services`. */
	readonly hosts: readonly string[];
	/** Manifest `drone.networkReads`: "host/path" POST endpoints that only read. */
	readonly reads: readonly string[];
	/** Declared credential slots: their headers are the host's, and `credential` names one to add. */
	readonly credentials?: {
		readonly headers: readonly string[];
		header(slot: string, url: URL): Promise<Record<string, string>>;
		/** Validates slot/auth metadata without resolving its secret until the returned sender runs. */
		authenticate?(slot: string, url: URL, username?: string): HttpAuthentication | undefined;
	};
}

function target(
	raw: unknown,
	{ hosts, credentials }: NetworkDeclaration,
): { request: NetworkRequest; url: URL; authenticate?: HttpAuthentication } {
	const request = raw as NetworkRequest;
	const url = new URL(request.url);
	if (url.username || url.password) throw new Error("Network URLs must not carry credentials");
	if (!declaredTarget(url, hosts))
		throw new Error(`Network host is not declared in this package's manifest: ${url.host}`);
	for (const name of Object.keys(request.headers ?? {}))
		if (RESERVED_HEADER.test(name) || credentials?.headers.includes(name.toLowerCase()))
			throw new Error(`Network header is reserved for the host: ${name}`);
	if (request.credential && !credentials)
		throw new Error(`Credential slot is not declared in this package's manifest: ${request.credential}`);
	if (request.httpAuth && !request.credential)
		throw new Error("HTTP authentication requires a credential slot");
	const authenticate = request.credential
		? credentials?.authenticate?.(request.credential, url, request.httpAuth?.username)
		: undefined;
	if (request.httpAuth && !authenticate)
		throw new Error(`Credential ${request.credential} does not use host HTTP authentication`);
	if (request.method === "PROPFIND") {
		const depth = Object.entries(request.headers ?? {}).filter(([name]) => name.toLowerCase() === "depth");
		if (depth.length !== 1 || depth[0]?.[1] !== "0") throw new Error("PROPFIND requires Depth: 0");
	}
	return { request, url, authenticate };
}

export function networkCapabilityHandlers(
	declaration: NetworkDeclaration,
	fetchImpl: typeof fetch = fetch,
): Record<"network.read" | "network.write", PluginCapabilityHandler> {
	const send = async ({ request, url, authenticate }: ReturnType<typeof target>, signal: AbortSignal) => {
		const secret =
			request.credential && !authenticate
				? await declaration.credentials?.header(request.credential, url)
				: {};
		return sendHttp(
			{ ...request, headers: { ...request.headers, ...secret } },
			url,
			signal,
			fetchImpl,
			authenticate,
		);
	};
	return {
		"network.read": {
			effect: "read",
			inputSchema: requestSchema(DECLARED_READ_METHODS),
			resultSchema,
			execute: async (raw, context) => {
				const validated = target(raw, declaration);
				const { request, url } = validated;
				if (request.method === "POST" && !declaration.reads.includes(`${url.host}${url.pathname}`))
					throw new Error(
						`POST is a network write unless drone.networkReads lists ${url.host}${url.pathname}`,
					);
				return send(validated, context.signal);
			},
		},
		"network.write": {
			effect: "write",
			// A write the user already approved inside the current task authorization does not ask again.
			approval: "allowance",
			// Its own host dialog is the user's decision, so a read-declared tool may ask for it.
			readCallable: true,
			inputSchema: requestSchema(WRITE_METHODS, {
				/** The plugin's description of the write, shown labelled as such beside the host's facts. */
				summary: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
				allowance: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
			}),
			resultSchema,
			approvalDetail: (raw) => {
				const { request, url } = target(raw, declaration);
				const facts = `${hostText("网络写入", "Network write")}: ${request.method} ${url.host}${url.pathname}${
					request.credential
						? `\n${hostText("使用已保存凭据", "Uses saved credential")}: ${request.credential}`
						: ""
				}`;
				return request.summary
					? `${facts}\n${hostText("插件说明", "Plugin description")}: ${request.summary}`
					: facts;
			},
			execute: async (raw, context) => {
				return send(target(raw, declaration), context.signal);
			},
		},
	};
}
