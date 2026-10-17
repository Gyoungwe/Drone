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
		: new URL(targetRef.replace(/^\/+/, ""), `${base.origin}${basePath}`);
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
			const request = (method: string, headers?: Record<string, string>, body?: string) =>
				transport.request(method, path, headers, body);
			const existing = await request("GET");
			if (existing.status !== 404) {
				throw new Error(
					existing.status >= 200 && existing.status < 300
						? "WebDAV write target already exists"
						: `WebDAV target preflight failed (${existing.status})`,
				);
			}
			let created = false;
			const deleteRemote = async () => {
				const deleted = await request("DELETE");
				if (deleted.status >= 400 && deleted.status !== 404) {
					throw new Error(`WebDAV DELETE failed (${deleted.status})`);
				}
				return deleted;
			};
			try {
				const put = await request(
					"PUT",
					{ "Content-Type": "application/json; charset=utf-8", "If-None-Match": "*" },
					JSON.stringify(payload),
				);
				if (put.status < 200 || put.status >= 300) {
					throw new Error(`WebDAV PUT failed (${put.status})`);
				}
				created = true;
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
				if (read.status < 200 || read.status >= 300 || readTitle !== payload.title) {
					throw new Error(`WebDAV readback failed (${read.status})`);
				}
				await deleteRemote();
				const missing = await request("GET");
				return {
					externalRef: url,
					readBack: true,
					deleted: missing.status === 404,
				};
			} catch (error) {
				if (created) {
					try {
						await deleteRemote();
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
	return createWebdavWritePort({ baseUrl, username, password });
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
