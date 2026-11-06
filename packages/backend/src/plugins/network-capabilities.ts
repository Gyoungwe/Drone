import { Type } from "typebox";
import { hostText } from "../reply-language";
import type { PluginCapabilityHandler } from "./runtime-capabilities";
import { MAX_FILE_BINARY_BASE64, MAX_FILE_BINARY_BYTES } from "./stable-file-bytes";

/**
 * HTTP on a managed plugin's behalf, limited to the hosts its manifest declares in
 * `permissions.network` (design: docs/superpowers/specs/2026-11-05-task-acceptance-role-design.md, N1).
 * The restricted worker itself has no network; this is its only route out.
 */
const READ_METHODS = ["GET", "HEAD"] as const;
/** POST reads only to an endpoint the manifest lists in `drone.networkReads`. */
const DECLARED_READ_METHODS = [...READ_METHODS, "POST"] as const;
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
const TIMEOUT_MS = 30_000;
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
			/** A `drone.credentials` slot whose saved secret the host adds as a header. */
			credential: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
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
	};
}

function target(
	raw: unknown,
	{ hosts, credentials }: NetworkDeclaration,
): { request: NetworkRequest; url: URL } {
	const request = raw as NetworkRequest;
	const url = new URL(request.url);
	if (url.username || url.password) throw new Error("Network URLs must not carry credentials");
	if (!declaredTarget(url, hosts))
		throw new Error(`Network host is not declared in this package's manifest: ${url.host}`);
	for (const name of Object.keys(request.headers ?? {}))
		if (RESERVED_HEADER.test(name) || credentials?.headers.includes(name.toLowerCase()))
			throw new Error(`Network header is reserved for the host: ${name}`);
	return { request, url };
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

export function networkCapabilityHandlers(
	declaration: NetworkDeclaration,
	fetchImpl: typeof fetch = fetch,
): Record<"network.read" | "network.write", PluginCapabilityHandler> {
	const send = async (request: NetworkRequest, url: URL, signal: AbortSignal) => {
		const body = request.bodyBase64 === undefined ? undefined : Buffer.from(request.bodyBase64, "base64");
		if (request.credential && !declaration.credentials)
			throw new Error(`Credential slot is not declared in this package's manifest: ${request.credential}`);
		const secret = request.credential ? await declaration.credentials?.header(request.credential, url) : {};
		const response = await fetchImpl(url, {
			method: request.method,
			headers: { ...request.headers, ...secret },
			body,
			redirect: "error",
			signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
		});
		const bytes = await readLimited(response);
		const headers: Record<string, string> = {};
		response.headers.forEach((value, name) => {
			headers[name.toLowerCase()] = value;
		});
		return {
			status: response.status,
			headers,
			base64: bytes.toString("base64"),
			bytes: bytes.length,
		};
	};
	return {
		"network.read": {
			effect: "read",
			inputSchema: requestSchema(DECLARED_READ_METHODS),
			resultSchema,
			execute: async (raw, context) => {
				const { request, url } = target(raw, declaration);
				if (request.method === "POST" && !declaration.reads.includes(`${url.host}${url.pathname}`))
					throw new Error(
						`POST is a network write unless drone.networkReads lists ${url.host}${url.pathname}`,
					);
				return send(request, url, context.signal);
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
				const { request, url } = target(raw, declaration);
				return send(request, url, context.signal);
			},
		},
	};
}
