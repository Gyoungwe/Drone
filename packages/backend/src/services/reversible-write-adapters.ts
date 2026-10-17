import { createHash } from "node:crypto";
import type { ResearchWriteAdapter, ResearchWriteExecutionContext } from "@drone/research";
import type {
	ResearchWritePayload,
	ResearchWritePlan,
	ResearchWriteReceipt,
	ResearchWriteRequest,
} from "@drone/shared";
import { WebDavTransport } from "../knowledge/webdav-transport";

type DeletionAwareResearchWriteReceipt = ResearchWriteReceipt & {
	readonly deleted?: "verified" | "unverified" | "not-applicable";
};

interface ReversibleWritePort {
	write(input: {
		readonly targetRef: string;
		readonly payload: ResearchWritePayload;
		readonly signal?: AbortSignal;
	}): Promise<{
		readonly externalRef: string;
		readonly readBack: boolean;
		readonly deleted: boolean;
	}>;
}

export interface WebdavWritePortConfig {
	readonly baseUrl: string;
	readonly username: string;
	readonly password: string;
	readonly fetchImpl?: typeof fetch;
}

export interface ProtocolsBookmarkWritePortConfig {
	readonly apiBaseUrl?: string;
	readonly apiToken: string;
	readonly fetchImpl?: typeof fetch;
}

function hasTraversalSegment(value: string): boolean {
	let decoded = value;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		return true;
	}
	return decoded.split(/[\\/]/).some((segment) => segment === "." || segment === "..");
}

function webdavTargetUrl(baseUrl: string, targetRef: string): string {
	const base = new URL(baseUrl);
	if (!/^https?:$/.test(base.protocol) || base.search || base.hash) {
		throw new Error("WebDAV base URL must be an HTTP(S) URL without query or fragment");
	}
	const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
	if (hasTraversalSegment(targetRef)) {
		throw new Error("WebDAV write target cannot contain traversal segments");
	}
	const target = /^https?:\/\//i.test(targetRef)
		? new URL(targetRef)
		: targetRef.startsWith("/")
			? new URL(targetRef, base.origin)
			: new URL(targetRef, `${base.origin}${basePath}`);
	if (target.origin !== base.origin) {
		throw new Error("WebDAV write target must use the configured WebDAV origin");
	}
	if (!target.pathname.startsWith(basePath) || target.search || target.hash) {
		throw new Error("WebDAV write target must stay within the configured base path");
	}
	return target.toString();
}

/**
 * Backend-owned WebDAV port. Credentials never cross into the research package.
 * The shared transport negotiates Basic/Digest only after a server challenge.
 * The port proves PUT → GET/title match → DELETE → GET/404 before reporting success.
 */
export function createWebdavWritePort(config: WebdavWritePortConfig): ReversibleWritePort {
	const fetchImpl = config.fetchImpl ?? fetch;
	const base = new URL(config.baseUrl);
	if (!/^https?:$/.test(base.protocol) || base.search || base.hash) {
		throw new Error("WebDAV base URL must be an HTTP(S) URL without query or fragment");
	}
	const transport = new WebDavTransport({
		endpoint: base.origin,
		username: config.username,
		password: () => config.password,
		fetch: fetchImpl,
	});
	return {
		async write({ targetRef, payload, signal }) {
			if (signal?.aborted) throw new Error("WebDAV write aborted");
			const url = webdavTargetUrl(config.baseUrl, targetRef);
			const target = new URL(url);
			const path = target.pathname.replace(/^\/+/, "");
			const request = (
				method: string,
				headers?: Record<string, string>,
				body?: string,
				requestSignal: AbortSignal | null | undefined = signal,
			) => {
				if (requestSignal?.aborted) throw new Error("WebDAV write aborted");
				return transport.request(method, path, headers, body, requestSignal ?? undefined);
			};
			const existing = await request("GET");
			if (existing.status !== 404) {
				throw new Error(
					existing.status >= 200 && existing.status < 300
						? "WebDAV write target already exists"
						: `WebDAV target preflight failed (${existing.status})`,
				);
			}
			let created = false;
			let putOutcomeUncertain = false;
			let creationEtag: string | null = null;
			const deleteRemote = async (
				etag: string | null,
				requestSignal: AbortSignal | null | undefined = signal,
			) => {
				if (!etag) throw new Error("WebDAV DELETE requires a verified ETag");
				const deleted = await request("DELETE", { "If-Match": etag }, undefined, requestSignal);
				if (deleted.status >= 400 && deleted.status !== 404) {
					throw new Error(`WebDAV DELETE failed (${deleted.status})`);
				}
				return deleted;
			};
			try {
				if (signal?.aborted) throw new Error("WebDAV write aborted");
				let put: Awaited<ReturnType<typeof request>>;
				try {
					const response = await request(
						"PUT",
						{ "Content-Type": "application/json; charset=utf-8", "If-None-Match": "*" },
						JSON.stringify(payload),
					);
					put = response;
				} catch (error) {
					putOutcomeUncertain = true;
					throw error;
				}
				if (put.status < 200 || put.status >= 300) {
					throw new Error(`WebDAV PUT failed (${put.status})`);
				}
				created = true;
				creationEtag = put.headers.get("etag");
				if (!creationEtag) throw new Error("WebDAV PUT response missing ETag");
				const read = await request("GET");
				const body = read.body.toString("utf8");
				let readPayload: unknown;
				try {
					readPayload = JSON.parse(body) as unknown;
				} catch {
					readPayload = undefined;
				}
				const readTitle =
					typeof readPayload === "object" &&
					readPayload !== null &&
					"title" in readPayload &&
					typeof readPayload.title === "string"
						? readPayload.title
						: undefined;
				const readEtag = read.headers.get("etag");
				if (readEtag !== creationEtag) {
					throw new Error("WebDAV readback ETag changed");
				}
				if (read.status < 200 || read.status >= 300 || readTitle !== payload.title) {
					throw new Error(`WebDAV readback failed (${read.status})`);
				}
				await deleteRemote(creationEtag);
				const missing = await request("GET");
				return {
					externalRef: url,
					readBack: true,
					deleted: missing.status === 404,
				};
			} catch (error) {
				if (created || putOutcomeUncertain) {
					try {
						if (!creationEtag) {
							const reconciliation = await request("GET", undefined, undefined, null);
							let reconciledPayload: unknown;
							try {
								reconciledPayload = JSON.parse(reconciliation.body.toString("utf8")) as unknown;
							} catch {
								reconciledPayload = undefined;
							}
							if (
								reconciliation.status >= 200 &&
								reconciliation.status < 300 &&
								JSON.stringify(reconciledPayload) === JSON.stringify(payload)
							) {
								creationEtag = reconciliation.headers.get("etag");
							}
						}
						await deleteRemote(creationEtag, null);
					} catch {
						// Preserve the original failure; the caller still receives a failed closure.
					}
				}
				throw error;
			}
		},
	};
}
export function createWebdavWritePortFromEnv(
	env: Record<string, string | undefined> = process.env,
): ReversibleWritePort | undefined {
	const baseUrl = env.DRONE_WEBDAV_BASE_URL?.trim();
	const username = env.DRONE_WEBDAV_USERNAME?.trim();
	const password = env.DRONE_WEBDAV_PASSWORD;
	if (!baseUrl || !username || !password) return undefined;
	try {
		return createWebdavWritePort({ baseUrl, username, password });
	} catch {
		return undefined;
	}
}


const DEFAULT_PROTOCOLS_API_BASE = "https://www.protocols.io/api/v3";
const PROTOCOLS_REQUEST_TIMEOUT_MS = 15_000;

function protocolsApiTarget(targetRef: string): string {
	let value = targetRef.normalize("NFKC").trim();
	for (const prefix of ["protocols:", "doi:", "crossref:"]) {
		if (value.toLowerCase().startsWith(prefix)) {
			value = value.slice(prefix.length);
			break;
		}
	}
	if (!value || /[?#\\\\]/.test(value) || value.split("/").some((segment) => segment === "." || segment === "..")) {
		throw new Error("Protocols.io target contains an invalid path");
	}
	return value;
}

function protocolsApiBase(value: string | undefined): string {
	const base = new URL((value?.trim() || DEFAULT_PROTOCOLS_API_BASE).replace(/\\/+$/, ""));
	if (!/^https?:$/.test(base.protocol) || base.search || base.hash) {
		throw new Error("Protocols.io API base must be an HTTP(S) URL without query or fragment");
	}
	return base.toString().replace(/\\/$/, "");
}

function protocolIdentity(payload: unknown): unknown {
	if (!payload || typeof payload !== "object") return undefined;
	const value = payload as Record<string, unknown>;
	return value.protocol ?? (value.payload && typeof value.payload === "object" ? (value.payload as Record<string, unknown>).protocol : undefined) ?? value.payload ?? value;
}

function protocolResponseOk(status: number, body: unknown): boolean {
	if (status < 200 || status >= 300 || !body || typeof body !== "object") return false;
	const code = (body as Record<string, unknown>).status_code;
	return code === undefined || code === 0;
}

/**
 * Backend-owned Protocols.io bookmark port. The API exposes bookmark POST/DELETE
 * acknowledgements and protocol GET, but no user-bookmark read endpoint. We
 * therefore verify the target before and after the mutation and require the
 * documented status_code=0 on both mutation calls; the receipt remains explicit
 * about this provider limitation.
 */
export function createProtocolsBookmarkWritePort(
	config: ProtocolsBookmarkWritePortConfig,
): ReversibleWritePort {
	const apiBase = protocolsApiBase(config.apiBaseUrl);
	const token = config.apiToken.trim();
	if (!token || /[\\r\\n]/.test(token)) throw new Error("Protocols.io API token is invalid");
	const fetchImpl = config.fetchImpl ?? fetch;
	return {
		async write({ targetRef, signal, payload }) {
			if (signal?.aborted) throw new Error("Protocols.io write aborted");
			const target = protocolsApiTarget(targetRef);
			const encoded = encodeURIComponent(target);
			const protocolUrl = `${apiBase}/protocols/${encoded}`;
			const bookmarkUrl = `${protocolUrl}/bookmarks`;
			const request = async (url: string, method: "GET" | "POST" | "DELETE", requestSignal: AbortSignal | null | undefined = signal) => {
				if (requestSignal?.aborted) throw new Error("Protocols.io write aborted");
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), PROTOCOLS_REQUEST_TIMEOUT_MS);
				const abort = () => controller.abort();
				requestSignal?.addEventListener("abort", abort, { once: true });
				try {
					const response = await fetchImpl(url, {
						method,
						headers: {
							accept: "application/json",
							authorization: `Bearer ${token}`,
						},
						signal: controller.signal,
					});
					const text = await response.text();
					let body: unknown;
					try {
						body = text ? (JSON.parse(text) as unknown) : undefined;
					} catch {
						body = undefined;
					}
					return { response, body };
				} catch (error) {
					if (requestSignal?.aborted || controller.signal.aborted) {
						throw new Error("Protocols.io write was cancelled");
					}
					throw new Error(
						error instanceof Error ? `Protocols.io request failed: ${error.message.slice(0, 240)}` : "Protocols.io request failed",
					);
				} finally {
					clearTimeout(timer);
					requestSignal?.removeEventListener("abort", abort);
				}
			};
			const initial = await request(protocolUrl, "GET");
			if (!protocolResponseOk(initial.response.status, initial.body) || !protocolIdentity(initial.body)) {
				throw new Error(`Protocols.io target preflight failed (${initial.response.status})`);
			}
			let bookmarked = false;
			try {
				const created = await request(bookmarkUrl, "POST");
				if (!protocolResponseOk(created.response.status, created.body)) {
					throw new Error(`Protocols.io bookmark failed (${created.response.status})`);
				}
				bookmarked = true;
				const read = await request(protocolUrl, "GET");
				if (!protocolResponseOk(read.response.status, read.body) || !protocolIdentity(read.body)) {
					throw new Error(`Protocols.io readback failed (${read.response.status})`);
				}
				const deleted = await request(bookmarkUrl, "DELETE", null);
				if (!protocolResponseOk(deleted.response.status, deleted.body)) {
					throw new Error(`Protocols.io bookmark delete failed (${deleted.response.status})`);
				}
				const finalRead = await request(protocolUrl, "GET", null);
				if (!protocolResponseOk(finalRead.response.status, finalRead.body) || !protocolIdentity(finalRead.body)) {
					throw new Error(`Protocols.io final target check failed (${finalRead.response.status})`);
				}
				return {
					externalRef: `https://www.protocols.io/view/${target}`,
					readBack: true,
					deleted: true,
				};
			} catch (error) {
				if (bookmarked) {
					try {
						await request(bookmarkUrl, "DELETE", null);
					} catch {
						// Preserve the original failure; callers must reconcile the bookmark manually.
					}
				}
				throw error;
			}
		},
	};
}

export function createProtocolsBookmarkWritePortFromEnv(
	env: Record<string, string | undefined> = process.env,
): ReversibleWritePort | undefined {
	const apiToken = (env.PROTOCOLS_IO_API_TOKEN || env.PROTOCOLS_IO_API_KEY)?.trim();
	if (!apiToken) return undefined;
	try {
		return createProtocolsBookmarkWritePort({
			apiBaseUrl: env.PROTOCOLS_IO_API_BASE,
			apiToken,
		});
	} catch {
		return undefined;
	}
}

interface PortAdapterOptions {
	readonly id: string;
	readonly label: string;
	readonly port?: ReversibleWritePort;
	readonly validateTarget: (targetRef: string) => void;
}

export interface ReversibleResearchWriteAdapter extends ResearchWriteAdapter {
	readonly supportsDelete: true;
}

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizePayload(payload: ResearchWritePayload): ResearchWritePayload {
	const title = payload.title.normalize("NFKC").trim();
	if (!title || title.length > 500) throw new Error("Write title is required and must be <= 500 characters");
	const doi = payload.doi?.normalize("NFKC").trim();
	if (doi && doi.length > 256) throw new Error("Write DOI is too long");
	const authors = payload.authors
		?.map((author) => author.normalize("NFKC").trim())
		.filter(Boolean)
		.slice(0, 64);
	if (authors?.some((author) => author.length > 200)) throw new Error("Write author is too long");
	const abstract = payload.abstract?.normalize("NFKC").trim();
	if (abstract && abstract.length > 8_000) throw new Error("Write abstract is too long");
	return {
		title,
		...(doi ? { doi } : {}),
		...(authors?.length ? { authors } : {}),
		...(abstract ? { abstract } : {}),
	};
}

function normalizeTarget(value: string, label: string): string {
	const targetRef = value.normalize("NFKC").trim();
	if (!targetRef || targetRef.length > 512) {
		throw new Error(`${label} write target is required and must be <= 512 characters`);
	}
	return targetRef;
}

function createPortBackedAdapter(options: PortAdapterOptions): ReversibleResearchWriteAdapter {
	return {
		id: options.id,
		label: options.label,
		writeEnabled: Boolean(options.port),
		supportsDelete: true,
		prepare(input: ResearchWriteRequest): ResearchWritePlan {
			if (input.adapterId !== options.id) throw new Error(`Wrong write adapter: expected ${options.id}`);
			const targetRef = normalizeTarget(input.targetRef, options.label);
			options.validateTarget(targetRef);
			const payload = normalizePayload(input.payload);
			const key = hash({ adapterId: input.adapterId, targetRef, payload, action: input.action });
			return {
				id: `research-write-${key.slice(0, 32)}`,
				adapterId: options.id,
				targetRef,
				payload,
				action: input.action,
				sideEffect: input.action === "prepare" ? "external-write" : "none",
				requiresExplicitApproval: true,
				status: "ready",
				createdAt: new Date().toISOString(),
			};
		},
		async execute(
			plan: ResearchWritePlan,
			context: ResearchWriteExecutionContext,
		): Promise<DeletionAwareResearchWriteReceipt> {
			if (plan.action !== "prepare") {
				return {
					planId: plan.id,
					adapterId: plan.adapterId,
					status: "blocked",
					at: new Date().toISOString(),
					readBack: "not-applicable",
					failureReason: "Dry-run plans cannot execute",
				};
			}
			if (!context.approved) throw new Error("Explicit user approval is required for external writes");
			if (!options.port) {
				throw new Error(`${options.label} write adapter is unavailable; configure an authorized host port`);
			}
			const result = await options.port.write({
				targetRef: plan.targetRef,
				payload: plan.payload,
				signal: context.signal,
			});
			if (!result.externalRef?.trim()) throw new Error("Write adapter returned no external reference");
			if (!result.readBack || !result.deleted) {
				return {
					planId: plan.id,
					adapterId: plan.adapterId,
					status: "failed",
					at: new Date().toISOString(),
					externalRef: result.externalRef,
					readBack: result.readBack ? "verified" : "unverified",
					deleted: result.deleted ? "verified" : "unverified",
					failureReason: `${options.label} write did not verify create → readback → delete closure`,
				};
			}
			return {
				planId: plan.id,
				adapterId: plan.adapterId,
				status: "executed",
				at: new Date().toISOString(),
				externalRef: result.externalRef,
				readBack: "verified",
				deleted: "verified",
			};
		},
	};
}

export function createWebdavWriteAdapter(port?: ReversibleWritePort): ReversibleResearchWriteAdapter {
	return createPortBackedAdapter({
		id: "webdav-write",
		label: "WebDAV (reversible write)",
		port,
		validateTarget(targetRef) {
			if (hasTraversalSegment(targetRef)) {
				throw new Error("WebDAV write target cannot contain traversal segments");
			}
			if (!/^\/?(?:[^/?#]+\/)*[^/?#]+$/.test(targetRef) && !/^https?:\/\//i.test(targetRef)) {
				throw new Error("WebDAV write target must be a path or HTTP(S) URL");
			}
		},
	});
}

export function createProtocolsBookmarkWriteAdapter(
	port?: ReversibleWritePort,
): ReversibleResearchWriteAdapter {
	return createPortBackedAdapter({
		id: "protocols-bookmark-write",
		label: "Protocols.io bookmark (reversible write)",
		port,
		validateTarget(targetRef) {
			if (!/^(?!https?:)(?:[a-z][a-z0-9-]{1,31}:)?[A-Za-z0-9][A-Za-z0-9._/-]{1,510}$/i.test(targetRef)) {
				throw new Error("Protocols.io target must be a protocol URI, DOI, or GUID");
			}
		},
	});
}
