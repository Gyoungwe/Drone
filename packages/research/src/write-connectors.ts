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

export interface ResearchWritePort {
	write(input: {
		readonly targetRef: string;
		readonly payload: ResearchWritePayload;
		readonly signal?: AbortSignal;
	}): Promise<{ readonly externalRef: string; readonly readBack?: boolean }>;
}

export interface ResearchWriteAdapter {
	readonly id: string;
	readonly label: string;
	readonly writeEnabled: boolean;
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

/**
 * Zotero-compatible write seam. Preparation is always safe; actual writes require
 * a host supplied port and a fresh explicit approval. The default adapter has no
 * port, so execute fails closed and can only be exercised with a controlled fake.
 */
export function createZoteroWriteAdapter(port?: ResearchWritePort): ResearchWriteAdapter {
	return {
		id: "zotero-write",
		label: "Zotero (write)",
		writeEnabled: Boolean(port),
		prepare(input) {
			if (input.adapterId !== "zotero-write") throw new Error("Wrong write adapter");
			const targetRef = input.targetRef.normalize("NFKC").trim();
			if (!targetRef || targetRef.length > 512)
				throw new Error("Write target is required and must be <= 512 characters");
			const payload = normalizePayload(input.payload);
			const key = hash({ adapterId: input.adapterId, targetRef, payload, action: input.action });
			return {
				id: `research-write-${key.slice(0, 32)}`,
				adapterId: "zotero-write",
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
			if (!port) throw new Error("Zotero write adapter is unavailable; configure an authorized host port");
			const result = await port.write({
				targetRef: plan.targetRef,
				payload: plan.payload,
				signal: context.signal,
			});
			if (!result.externalRef?.trim()) throw new Error("Write adapter returned no external reference");
			return {
				planId: plan.id,
				adapterId: plan.adapterId,
				status: "executed",
				at: new Date().toISOString(),
				externalRef: result.externalRef,
				readBack: result.readBack === true ? "verified" : "unverified",
			};
		},
	};
}

export function createDefaultResearchWriteAdapters(): readonly ResearchWriteAdapter[] {
	return [createZoteroWriteAdapter()];
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
		}));
	}

	get(id: string): ResearchWriteAdapter | undefined {
		return this.adapters.get(id);
	}
}
