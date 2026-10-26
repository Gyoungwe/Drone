import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ResearchConnector, ResearchConnectorContext } from "@drone/research";
import {
	contractContentHash,
	createKnowledgeSnapshot,
	type KnowledgeSnapshot,
	type KnowledgeSourceReceipt,
	type ResearchCaptureRecord,
	type ResearchCaptureRequest,
	type ResearchCaptureResult,
	type ResearchConnectorDescriptor,
	type ResearchConnectorFailure,
	type ResearchConnectorHit,
	type ResearchKnowledgeOperations,
	type ResearchSearchRequest,
	type ResearchSearchResponse,
} from "@drone/shared";
import type { JsonStore } from "../json-store";

interface CaptureLedger {
	version: 1;
	items: ResearchCaptureRecord[];
}

export interface ResearchConnectorSettings {
	version: 1;
	disabled: string[];
}

export interface ResearchResourceServiceOptions {
	readonly store: JsonStore<CaptureLedger>;
	/** Connector registry is supplied by the host composition root or an installed connector package. */
	readonly connectors: ResearchConnectorRegistryPort;
	readonly connectorSettings?: JsonStore<ResearchConnectorSettings>;
	/** Host-owned ports/configuration used by optional connectors; never persisted. */
	readonly connectorContext?: ResearchConnectorContext;
	/** Knowledge host operations used to create a versioned capture snapshot. */
	readonly knowledgeOperations: ResearchKnowledgeOperations;
}

/** Host-neutral registry surface; connector implementations stay outside backend. */
export interface ResearchConnectorRegistryPort {
	list(): readonly ResearchConnector[];
	recommend(
		seed: string,
		connectorId: string,
		context?: ResearchConnectorContext,
		limit?: number,
	): Promise<{ hits: readonly ResearchConnectorHit[]; failures: readonly ResearchConnectorFailure[] }>;
	search(input: ResearchSearchRequest, context?: ResearchConnectorContext): Promise<ResearchSearchResponse>;
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
	".fna",
	".faa",
	".ffn",
	".frn",
	".fas",
	".fastq",
	".fq",
	".bed",
	".bedgraph",
	".gff",
	".gff3",
	".gtf",
	".vcf",
	".sam",
	".aln",
	".clustal",
	".clw",
	".sto",
	".stk",
	".stockholm",
	".phy",
	".phylip",
	".afa",
	".msa",
	".mfa",
	".nwk",
	".newick",
	".tree",
	".treefile",
	".tre",
	".contree",
	".log",
]);

function isoNow(): string {
	return new Date().toISOString();
}

function hashBytes(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function formatFor(path: string): string {
	const filename = path.replaceAll("\\", "/").split("/").pop() ?? path;
	const lower = filename.toLowerCase();
	const compression = [".gz", ".bgz", ".bz2", ".xz"].find((suffix) => lower.endsWith(suffix));
	const logicalName = compression ? lower.slice(0, -compression.length) : lower;
	const ext = extname(logicalName);
	if (ext === ".pdf") return "pdf";
	if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".tif", ".tiff"].includes(ext)) return "image";
	if (TEXT_EXTENSIONS.has(ext)) return ext.slice(1) || "text";
	if (compression && ext) return ext.slice(1);
	return ext.slice(1) || (compression ? compression.slice(1) : "binary");
}

function projectKey(
	cwd: string,
	relativePath: string,
	byteHash: string,
	scope: "project" | "workspace",
): string {
	return contractContentHash({ cwd: resolve(cwd), relativePath, byteHash, scope });
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
	private readonly connectors: ResearchConnectorRegistryPort;
	private readonly disabledConnectors = new Set<string>();

	constructor(private readonly options: ResearchResourceServiceOptions) {
		this.connectors = options.connectors;
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
		const scope = input.scope ?? "project";
		const key = projectKey(file.root, file.relativePath, byteHash, scope);
		const id = captureId(key);
		const ledger = await this.options.store.read();
		const existing = ledger.items.find((item) => item.id === id);
		const existingExpiry = existing?.sourceReceipt.freshness?.expiresAt;
		const existingExpired = Boolean(existingExpiry && Date.parse(existingExpiry) <= Date.now());
		if (existing && !existingExpired) return { record: existing, idempotent: true };
		const previous = ledger.items
			.filter(
				(item) => item.cwd === file.root && item.relativePath === file.relativePath && item.scope === scope,
			)
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
			freshness: {
				checkedAt: capturedAt,
				...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
			},
		};
		const snapshot = this.options.knowledgeOperations.ingestSnapshot({
			id: `knowledge-${key.slice(0, 24)}`,
			context: this.options.knowledgeOperations.resolveContext({ workspaceRoot: file.root }),
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
			scope,
			approval: "pending",
			revision: snapshot.revision,
			snapshotId: snapshot.id,
			sourceReceipt,
			snapshot,
			capturedAt,
		};
		await this.options.store.update((state) => {
			state.version = 1;
			const index = state.items.findIndex((item) => item.id === record.id);
			if (index >= 0) state.items[index] = record;
			else state.items.push(record);
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

	/** Read DOI seeds recently added to the configured Zotero library for radar recommendations. */
	async recentZoteroSeeds(sinceMs: number): Promise<readonly string[]> {
		const config = this.options.connectorContext?.config?.zotero;
		if (!config?.libraryId) return [];
		const libraryType = config.libraryType === "groups" ? "groups" : "users";
		const apiBase = (config.apiBase || "https://api.zotero.org").replace(/\/$/u, "");
		const url = `${apiBase}/${libraryType}/${encodeURIComponent(config.libraryId)}/items?sort=dateAdded&direction=desc&limit=50&format=json`;
		const response = await (this.options.connectorContext?.fetchImpl ?? fetch)(url, {
			headers: {
				accept: "application/json",
				"Zotero-API-Version": "3",
				...(config.apiKey ? { "Zotero-API-Key": config.apiKey } : {}),
			},
		});
		if (!response.ok) throw new Error(`Zotero HTTP ${response.status}`);
		const items = (await response.json()) as unknown;
		if (!Array.isArray(items)) return [];
		return items.flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			const data = "data" in item && item.data && typeof item.data === "object" ? item.data : item;
			const added =
				"dateAdded" in item ? String(item.dateAdded ?? "") : String((data as any).dateAdded ?? "");
			const doi = String((data as any).DOI ?? "").trim();
			return doi && Date.parse(added) >= sinceMs ? [doi] : [];
		});
	}

	search(input: ResearchSearchRequest): Promise<ResearchSearchResponse> {
		return this.searchEnabled(input);
	}

	async listConnectors(): Promise<readonly ResearchConnectorDescriptor[]> {
		const disabled = await this.readDisabledConnectors();
		return this.connectors.list().map((connector) => this.describe(connector, disabled));
	}

	/** Read-only recommendation seam used by the daily literature radar. */
	async recommend(seed: string): Promise<ResearchSearchResponse> {
		const descriptors = await this.listConnectors();
		const connector = descriptors.find((item) => item.id === "semantic-scholar");
		if (!connector?.enabled) {
			return {
				query: seed,
				hits: [],
				failures: connector
					? [
							{
								connectorId: connector.id,
								message: "Research connector is disabled",
								retryable: false,
								at: isoNow(),
							},
						]
					: [],
				connectors: ["semantic-scholar"],
				complete: true,
			};
		}
		const result = await this.connectors.recommend(
			seed,
			"semantic-scholar",
			this.options.connectorContext,
			10,
		);
		return {
			query: seed,
			hits: result.hits,
			failures: result.failures,
			connectors: ["semantic-scholar"],
			complete: result.failures.length === 0,
		};
	}

	async setConnectorEnabled(id: string, enabled: boolean): Promise<ResearchConnectorDescriptor> {
		const connector = this.connectors.list().find((item) => item.id === id);
		if (!connector) throw new Error(`Research connector not found: ${id}`);
		const store = this.options.connectorSettings;
		if (store) {
			await store.update((state) => {
				state.version = 1;
				const disabled = new Set(Array.isArray(state.disabled) ? state.disabled : []);
				if (enabled) disabled.delete(id);
				else disabled.add(id);
				state.disabled = [...disabled].sort();
			});
		} else if (enabled) {
			this.disabledConnectors.delete(id);
		} else {
			this.disabledConnectors.add(id);
		}
		return this.describe(connector, await this.readDisabledConnectors());
	}

	private describe(connector: ResearchConnector, disabled: ReadonlySet<string>): ResearchConnectorDescriptor {
		return {
			id: connector.id,
			kind: connector.kind,
			label: connector.label,
			enabled: !disabled.has(connector.id),
		};
	}

	private async readDisabledConnectors(): Promise<Set<string>> {
		const store = this.options.connectorSettings;
		if (!store) return new Set(this.disabledConnectors);
		const state = await store.read();
		return new Set(Array.isArray(state.disabled) ? state.disabled : []);
	}

	private async searchEnabled(input: ResearchSearchRequest): Promise<ResearchSearchResponse> {
		const descriptors = await this.listConnectors();
		const byId = new Map(descriptors.map((connector) => [connector.id, connector]));
		const requested =
			input.connectorIds === undefined
				? descriptors.filter((connector) => connector.enabled).map((connector) => connector.id)
				: [...input.connectorIds];
		const disabled = requested.filter((id) => byId.get(id)?.enabled === false);
		const searchable = requested.filter((id) => byId.get(id)?.enabled !== false);
		const result = await this.connectors.search(
			{ ...input, connectorIds: searchable },
			{ ...this.options.connectorContext, cwd: input.cwd ?? this.options.connectorContext?.cwd },
		);
		const disabledFailures: ResearchConnectorFailure[] = disabled.map((connectorId) => ({
			connectorId,
			message: "Research connector is disabled",
			retryable: false,
			at: isoNow(),
		}));
		return {
			...result,
			connectors: requested,
			failures: [...result.failures, ...disabledFailures],
			complete: result.complete && disabledFailures.length === 0,
		};
	}
}

export function emptyCaptureLedger(): CaptureLedger {
	return { version: 1, items: [] };
}

export function emptyResearchConnectorSettings(): ResearchConnectorSettings {
	return { version: 1, disabled: [] };
}

export type { CaptureLedger };
