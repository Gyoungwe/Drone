import { createHash } from "node:crypto";
import type {
	ResearchWriteAdapterDescriptor,
	ResearchWritePayload,
	ResearchWritePlan,
	ResearchWriteReceipt,
	ResearchWriteRequest,
} from "@drone/shared";

export interface ResearchWriteExecutionContext {
	readonly approved: boolean;
	readonly signal?: AbortSignal;
}

/**
 * Host ports own authentication and the provider-specific create/read/delete
 * sequence. The research package receives only bounded metadata and the
 * redacted outcome; credentials never cross this seam.
 */
export interface ResearchWritePort {
	write(input: {
		readonly targetRef: string;
		readonly payload: ResearchWritePayload;
		readonly signal?: AbortSignal;
	}): Promise<{
		readonly externalRef: string;
		readonly readBack?: boolean;
		/** True only after the temporary provider object has been deleted and re-read as absent. */
		readonly deleted?: boolean;
	}>;
}

export interface ReversibleResearchWritePort extends ResearchWritePort {
	write(input: {
		readonly targetRef: string;
		readonly payload: ResearchWritePayload;
		readonly signal?: AbortSignal;
	}): Promise<{
		readonly externalRef: string;
		readonly readBack: true;
		readonly deleted: true;
	}>;
}

export interface ResearchWriteAdapter {
	readonly id: string;
	readonly label: string;
	readonly writeEnabled: boolean;
	readonly supportsDelete: boolean;
	prepare(input: ResearchWriteRequest): ResearchWritePlan;
	execute(plan: ResearchWritePlan, context: ResearchWriteExecutionContext): Promise<ResearchWriteReceipt>;
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
	if (!targetRef || targetRef.length > 512) throw new Error(`${label} write target is required and must be <= 512 characters`);
	return targetRef;
}

interface PortAdapterOptions {
	readonly id: string;
	readonly label: string;
	readonly port?: ResearchWritePort;
	readonly supportsDelete: boolean;
	readonly validateTarget?: (targetRef: string) => void;
}

function createPortBackedAdapter(options: PortAdapterOptions): ResearchWriteAdapter {
	return {
		id: options.id,
		label: options.label,
		writeEnabled: Boolean(options.port),
		supportsDelete: options.supportsDelete,
		prepare(input) {
			if (input.adapterId !== options.id) throw new Error(`Wrong write adapter: expected ${options.id}`);
			const targetRef = normalizeTarget(input.targetRef, options.label);
			options.validateTarget?.(targetRef);
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
		async execute(plan, context) {
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
			if (!options.port)
				throw new Error(`${options.label} write adapter is unavailable; configure an authorized host port`);
			const result = await options.port.write({
				targetRef: plan.targetRef,
				payload: plan.payload,
				signal: context.signal,
			});
			if (!result.externalRef?.trim()) throw new Error("Write adapter returned no external reference");
			if (options.supportsDelete && result.deleted !== true)
				throw new Error(`${options.label} write did not verify create → readback → delete closure`);
			return {
				planId: plan.id,
				adapterId: plan.adapterId,
				status: "executed",
				at: new Date().toISOString(),
				externalRef: result.externalRef,
				readBack: result.readBack === true ? "verified" : "unverified",
				...(options.supportsDelete
					? { deleted: result.deleted === true ? "verified" : "unverified" }
					: {}),
			};
		},
	};
}

/**
 * Zotero item writes intentionally remain create/readback only in the product
 * path. The separate local acceptance uses a temporary note and explicit
 * deletion; this adapter never deletes an existing literature item.
 */
export function createZoteroWriteAdapter(port?: ResearchWritePort): ResearchWriteAdapter {
	return createPortBackedAdapter({
		id: "zotero-write",
		label: "Zotero (write)",
		port,
		supportsDelete: false,
	});
}

/** WebDAV note/file writes require a host port that performs PUT → GET → DELETE. */
export function createWebdavWriteAdapter(port?: ReversibleResearchWritePort): ResearchWriteAdapter {
	return createPortBackedAdapter({
		id: "webdav-write",
		label: "WebDAV (reversible write)",
		port,
		supportsDelete: true,
		validateTarget(targetRef) {
			if (!/^\/(?:[^/]+\/)*[^/]+$/.test(targetRef) && !/^https:\/\//i.test(targetRef))
				throw new Error("WebDAV write target must be an absolute path or HTTPS URL");
		},
	});
}

/** Protocols.io bookmark writes use POST bookmark → GET/readback → DELETE bookmark. */
export function createProtocolsBookmarkWriteAdapter(
	port?: ReversibleResearchWritePort,
): ResearchWriteAdapter {
	return createPortBackedAdapter({
		id: "protocols-bookmark-write",
		label: "Protocols.io bookmark (reversible write)",
		port,
		supportsDelete: true,
		validateTarget(targetRef) {
			if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{2,511}$/.test(targetRef))
				throw new Error("Protocols.io target must be a protocol URI, DOI, or GUID");
		},
	});
}

export function createDefaultResearchWriteAdapters(): readonly ResearchWriteAdapter[] {
	return [
		createProtocolsBookmarkWriteAdapter(),
		createWebdavWriteAdapter(),
		createZoteroWriteAdapter(),
	];
}

export class ResearchWriteAdapterRegistry {
	private readonly adapters = new Map<string, ResearchWriteAdapter>();

	constructor(adapters: readonly ResearchWriteAdapter[] = createDefaultResearchWriteAdapters()) {
		for (const adapter of adapters) this.register(adapter);
	}

	register(adapter: ResearchWriteAdapter): void {
		if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(adapter.id)) throw new Error("Invalid write adapter id");
		if (this.adapters.has(adapter.id)) throw new Error(`Write adapter already registered: ${adapter.id}`);
		this.adapters.set(adapter.id, adapter);
	}

	list(): readonly ResearchWriteAdapter[] {
		return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id));
	}

	descriptors(): readonly ResearchWriteAdapterDescriptor[] {
		return this.list().map((adapter) => ({
			id: adapter.id,
			label: adapter.label,
			enabled: true,
			writeEnabled: adapter.writeEnabled,
			requiresExplicitApproval: true,
			supportsDelete: adapter.supportsDelete,
		}));
	}

	get(id: string): ResearchWriteAdapter | undefined {
		return this.adapters.get(id);
	}
}
