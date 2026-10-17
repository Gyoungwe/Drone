import { createHash } from "node:crypto";
import type { ResearchWriteAdapter, ResearchWriteExecutionContext } from "@drone/research";
import type {
	ResearchWritePayload,
	ResearchWritePlan,
	ResearchWriteReceipt,
	ResearchWriteRequest,
} from "@drone/shared";

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
		): Promise<ResearchWriteReceipt> {
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
				throw new Error(`${options.label} write did not verify create → readback → delete closure`);
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
			if (!/^\/(?:[^/]+\/)*[^/]+$/.test(targetRef) && !/^https:\/\//i.test(targetRef)) {
				throw new Error("WebDAV write target must be an absolute path or HTTPS URL");
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
			if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{2,511}$/.test(targetRef)) {
				throw new Error("Protocols.io target must be a protocol URI, DOI, or GUID");
			}
		},
	});
}
