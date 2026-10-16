import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { ingestKnowledgeSnapshot, resolveKnowledgeContext } from "@drone/knowledge";
import { ResearchConnectorRegistry } from "@drone/research";
import {
	contractContentHash,
	createKnowledgeSnapshot,
	type KnowledgeSnapshot,
	type KnowledgeSourceReceipt,
	type ResearchCaptureRecord,
	type ResearchCaptureRequest,
	type ResearchCaptureResult,
	type ResearchSearchRequest,
	type ResearchSearchResponse,
} from "@drone/shared";
import type { JsonStore } from "../json-store";

interface CaptureLedger {
	version: 1;
	items: ResearchCaptureRecord[];
}

export interface ResearchResourceServiceOptions {
	readonly store: JsonStore<CaptureLedger>;
	readonly connectors?: ResearchConnectorRegistry;
}

const TEXT_EXTENSIONS = new Set([
	".txt",
	".md",
	".markdown",
	".csv",
	".tsv",
	".json",
	".yaml",
	".yml",
	".xml",
	".fa",
	".fasta",
	".fastq",
	".fq",
	".bed",
	".gff",
	".gtf",
	".log",
]);

function isoNow(): string {
	return new Date().toISOString();
}

function hashBytes(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function formatFor(path: string): string {
	const ext = extname(path).toLowerCase();
	if (ext === ".pdf") return "pdf";
	if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".tif", ".tiff"].includes(ext)) return "image";
	if (TEXT_EXTENSIONS.has(ext)) return ext.slice(1) || "text";
	return ext.slice(1) || "binary";
}

function projectKey(cwd: string, relativePath: string, byteHash: string): string {
	return contractContentHash({ cwd: resolve(cwd), relativePath, byteHash });
}

function captureId(key: string): string {
	return `research-capture-${key.slice(0, 24)}`;
}

function safeRelativePath(value: string): string {
	if (!value.trim() || isAbsolute(value)) throw new Error("Capture path must be project-relative");
	const normalized = value.replaceAll("\\", "/");
	if (normalized.split("/").some((segment) => segment === ".."))
		throw new Error("Capture path escapes project root");
	return normalized.replace(/^\.\//, "");
}

async function resolveProjectFile(
	cwd: string,
	relativePath: string,
): Promise<{ absolute: string; root: string; relativePath: string }> {
	if (!isAbsolute(cwd)) throw new Error("Capture cwd must be absolute");
	const safePath = safeRelativePath(relativePath);
	const root = await realpath(cwd);
	const candidate = resolve(root, safePath);
	const absolute = await realpath(candidate);
	const rel = relative(root, absolute);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
		throw new Error("Capture path escapes project root");
	const info = await stat(absolute);
	if (!info.isFile()) throw new Error("Only regular files can be captured");
	return { absolute, root, relativePath: rel.split(sep).join("/") };
}

function parentRef(snapshot: KnowledgeSnapshot) {
	return {
		kind: snapshot.kind,
		id: snapshot.id,
		revision: snapshot.revision,
		contentHash: snapshot.contentHash,
	};
}

function withApproval(snapshot: KnowledgeSnapshot, approval: "approved" | "revoked"): KnowledgeSnapshot {
	const { schemaVersion: _schemaVersion, contentHash: _contentHash, kind: _kind, ...body } = snapshot;
	return createKnowledgeSnapshot({
		...body,
		approval,
		revision: snapshot.revision + 1,
		parentRefs: [...snapshot.parentRefs, parentRef(snapshot)],
	});
}

/** Host-side seam for safe project capture and provenance-aware connector search. */
export class ResearchResourceService {
	private readonly connectors: ResearchConnectorRegistry;

	constructor(private readonly options: ResearchResourceServiceOptions) {
		this.connectors = options.connectors ?? new ResearchConnectorRegistry();
	}

	/** Named seam used by host adapters; capture remains the short internal alias. */
	captureResearchResource(input: ResearchCaptureRequest): Promise<ResearchCaptureResult> {
		return this.capture(input);
	}

	async capture(input: ResearchCaptureRequest): Promise<ResearchCaptureResult> {
		const file = await resolveProjectFile(input.cwd, input.relativePath);
		const bytes = await readFile(file.absolute);
		const info = await stat(file.absolute);
		const byteHash = hashBytes(bytes);
		const key = projectKey(file.root, file.relativePath, byteHash);
		const id = captureId(key);
		const existing = (await this.options.store.read()).items.find((item) => item.id === id);
		if (existing) return { record: existing, idempotent: true };
		const previous = (await this.options.store.read()).items
			.filter((item) => item.cwd === file.root && item.relativePath === file.relativePath)
			.sort((a, b) => b.revision - a.revision)[0];
		const capturedAt = isoNow();
		const sourceReceipt: KnowledgeSourceReceipt = {
			sourceRef: `project-file:${contractContentHash({ cwd: file.root, path: file.relativePath }).slice(0, 24)}`,
			relativePath: file.relativePath,
			sourceType: "project-file",
			locator: file.relativePath,
			contentHash: byteHash,
			receiptRef: id,
			readAt: capturedAt,
			accessedAt: capturedAt,
			evidenceGrade: "contextual",
			freshness: { checkedAt: capturedAt },
		};
		const snapshot = ingestKnowledgeSnapshot({
			id: `knowledge-${key.slice(0, 24)}`,
			context: resolveKnowledgeContext({ workspaceRoot: file.root }),
			sources: [sourceReceipt],
			approval: "pending",
			reuseLevel: "navigation-only",
			evidenceGrade: "contextual",
			revision: (previous?.revision ?? -1) + 1,
			createdAt: capturedAt,
			ingestedAt: capturedAt,
			...(previous ? { parentRefs: [parentRef(previous.snapshot)] } : {}),
		});
		const record: ResearchCaptureRecord = {
			id,
			cwd: file.root,
			relativePath: file.relativePath,
			byteHash,
			format: formatFor(file.relativePath),
			size: info.size,
			modifiedAt: info.mtime.toISOString(),
			scope: input.scope ?? "project",
			approval: "pending",
			revision: snapshot.revision,
			snapshotId: snapshot.id,
			sourceReceipt,
			snapshot,
			capturedAt,
		};
		await this.options.store.update((state) => {
			state.version = 1;
			state.items.push(record);
		});
		return { record, idempotent: false };
	}

	async approve(id: string): Promise<ResearchCaptureRecord> {
		return this.updateApproval(id, "approved");
	}

	async revoke(id: string): Promise<ResearchCaptureRecord> {
		return this.updateApproval(id, "revoked");
	}

	private async updateApproval(id: string, approval: "approved" | "revoked"): Promise<ResearchCaptureRecord> {
		let updated: ResearchCaptureRecord | undefined;
		await this.options.store.update((state) => {
			const index = state.items.findIndex((item) => item.id === id);
			if (index < 0) throw new Error(`Research capture not found: ${id}`);
			const current = state.items[index];
			if (!current) throw new Error(`Research capture not found: ${id}`);
			if (current.approval === approval) {
				updated = current;
				return;
			}
			const snapshot = withApproval(current.snapshot, approval);
			const next: ResearchCaptureRecord = {
				...current,
				approval,
				revision: snapshot.revision,
				snapshot,
				...(approval === "approved" ? { approvedAt: isoNow() } : {}),
			};
			updated = next;
			state.items[index] = next;
		});
		if (!updated) throw new Error(`Research capture not found: ${id}`);
		return updated;
	}

	async list(cwd?: string): Promise<readonly ResearchCaptureRecord[]> {
		const items = (await this.options.store.read()).items;
		const root = cwd ? await realpath(cwd).catch(() => resolve(cwd)) : undefined;
		return items.filter((item) => !root || root === item.cwd).map((item) => structuredClone(item));
	}

	search(input: ResearchSearchRequest): Promise<ResearchSearchResponse> {
		return this.connectors.search(input);
	}
}

export function emptyCaptureLedger(): CaptureLedger {
	return { version: 1, items: [] };
}

export type { CaptureLedger };
