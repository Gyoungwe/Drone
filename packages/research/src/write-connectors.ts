import { createHash } from "node:crypto";
import type {
\tResearchWriteAdapterDescriptor,
\tResearchWritePayload,
\tResearchWritePlan,
\tResearchWriteReceipt,
\tResearchWriteRequest,
} from "@drone/shared";

export interface ResearchWriteExecutionContext {
\treadonly approved: boolean;
\treadonly signal?: AbortSignal;
}

export interface ResearchWritePort {
\twrite(input: {
\t\treadonly targetRef: string;
\t\treadonly payload: ResearchWritePayload;
\t\treadonly signal?: AbortSignal;
\t}): Promise<{ readonly externalRef: string; readonly readBack?: boolean }>;
}

export interface ResearchWriteAdapter {
\treadonly id: string;
\treadonly label: string;
\treadonly writeEnabled: boolean;
\tprepare(input: ResearchWriteRequest): ResearchWritePlan;
\texecute(plan: ResearchWritePlan, context: ResearchWriteExecutionContext): Promise<ResearchWriteReceipt>;
}

function hash(value: unknown): string {
\treturn createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizePayload(payload: ResearchWritePayload): ResearchWritePayload {
\tconst title = payload.title.normalize("NFKC").trim();
\tif (!title || title.length > 500) throw new Error("Write title is required and must be <= 500 characters");
\tconst doi = payload.doi?.normalize("NFKC").trim();
\tif (doi && doi.length > 256) throw new Error("Write DOI is too long");
\tconst authors = payload.authors
\t\t?.map((author) => author.normalize("NFKC").trim())
\t\t.filter(Boolean)
\t\t.slice(0, 64);
\tif (authors?.some((author) => author.length > 200)) throw new Error("Write author is too long");
\tconst abstract = payload.abstract?.normalize("NFKC").trim();
\tif (abstract && abstract.length > 8_000) throw new Error("Write abstract is too long");
\treturn {
\t\ttitle,
\t\t...(doi ? { doi } : {}),
\t\t...(authors?.length ? { authors } : {}),
\t\t...(abstract ? { abstract } : {}),
\t};
}

/**
 * Zotero-compatible write seam. Preparation is always safe; actual writes require
 * a host supplied port and a fresh explicit approval. The default adapter has no
 * port, so execute fails closed and can only be exercised with a controlled fake.
 */
export function createZoteroWriteAdapter(port?: ResearchWritePort): ResearchWriteAdapter {
\treturn {
\t\tid: "zotero-write",
\t\tlabel: "Zotero (write)",
\t\twriteEnabled: Boolean(port),
\t\tprepare(input) {
\t\t\tif (input.adapterId !== "zotero-write") throw new Error("Wrong write adapter");
\t\t\tconst targetRef = input.targetRef.normalize("NFKC").trim();
\t\t\tif (!targetRef || targetRef.length > 512) throw new Error("Write target is required and must be <= 512 characters");
\t\t\tconst payload = normalizePayload(input.payload);
\t\t\tconst key = hash({ adapterId: input.adapterId, targetRef, payload, action: input.action });
\t\t\treturn {
\t\t\t\tid: `research-write-${key.slice(0, 32)}`,
\t\t\t\tadapterId: "zotero-write",
\t\t\t\ttargetRef,
\t\t\t\tpayload,
\t\t\t\taction: input.action,
\t\t\t\tsideEffect: input.action === "prepare" ? "external-write" : "none",
\t\t\t\trequiresExplicitApproval: true,
\t\t\t\tstatus: "ready",
\t\t\t\tcreatedAt: new Date().toISOString(),
\t\t\t};
\t\t},
\t\tasync execute(plan, context) {
\t\t\tif (plan.action !== "prepare") {
\t\t\t\treturn {
\t\t\t\t\tplanId: plan.id,
\t\t\t\t\tadapterId: plan.adapterId,
\t\t\t\t\tstatus: "blocked",
\t\t\t\t\tat: new Date().toISOString(),
\t\t\t\t\treadBack: "not-applicable",
\t\t\t\t\tfailureReason: "Dry-run plans cannot execute",
\t\t\t\t};
\t\t\t}
\t\t\tif (!context.approved) throw new Error("Explicit user approval is required for external writes");
\t\t\tif (!port) throw new Error("Zotero write adapter is unavailable; configure an authorized host port");
\t\t\tconst result = await port.write({ targetRef: plan.targetRef, payload: plan.payload, signal: context.signal });
\t\t\tif (!result.externalRef?.trim()) throw new Error("Write adapter returned no external reference");
\t\t\treturn {
\t\t\t\tplanId: plan.id,
\t\t\t\tadapterId: plan.adapterId,
\t\t\t\tstatus: "executed",
\t\t\t\tat: new Date().toISOString(),
\t\t\t\texternalRef: result.externalRef,
\t\t\t\treadBack: result.readBack === true ? "verified" : "unverified",
\t\t\t};
\t\t},
\t};
}

export function createDefaultResearchWriteAdapters(): readonly ResearchWriteAdapter[] {
\treturn [createZoteroWriteAdapter()];
}

export class ResearchWriteAdapterRegistry {
\tprivate readonly adapters = new Map<string, ResearchWriteAdapter>();

\tconstructor(adapters: readonly ResearchWriteAdapter[] = createDefaultResearchWriteAdapters()) {
\t\tfor (const adapter of adapters) this.register(adapter);
\t}

\tregister(adapter: ResearchWriteAdapter): void {
\t\tif (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(adapter.id)) throw new Error("Invalid write adapter id");
\t\tif (this.adapters.has(adapter.id)) throw new Error(`Write adapter already registered: ${adapter.id}`);
\t\tthis.adapters.set(adapter.id, adapter);
\t}

\tlist(): readonly ResearchWriteAdapter[] {
\t\treturn [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id));
\t}

\tdescriptors(): readonly ResearchWriteAdapterDescriptor[] {
\t\treturn this.list().map((adapter) => ({
\t\t\tid: adapter.id,
\t\t\tlabel: adapter.label,
\t\t\tenabled: true,
\t\t\twriteEnabled: adapter.writeEnabled,
\t\t\trequiresExplicitApproval: true,
\t\t}));
\t}

\tget(id: string): ResearchWriteAdapter | undefined {
\t\treturn this.adapters.get(id);
\t}
}
