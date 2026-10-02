import { mkdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateArtifactLineage, validateFindingReferences } from "./lineage";
import type { ArtifactRecord, AttemptRecord, FindingRecord, InquirySnapshot, QuestionRecord } from "./models";

export interface LedgerCollection<T extends { readonly id: string }> {
	get(id: string): Promise<T | undefined>;
	list(): Promise<readonly T[]>;
	put(record: T): Promise<void>;
}

export interface ArtifactLedger extends LedgerCollection<ArtifactRecord> {}
export interface FindingLedger extends LedgerCollection<FindingRecord> {}
export interface QuestionLedger extends LedgerCollection<QuestionRecord> {}
export interface AttemptLedger extends LedgerCollection<AttemptRecord> {}

/** Host-facing storage boundary. A backend may implement this with SQLite. */
export interface InquiryStorage {
	readonly projectId: string;
	readonly artifacts: ArtifactLedger;
	readonly findings: FindingLedger;
	readonly questions: QuestionLedger;
	readonly attempts: AttemptLedger;
	snapshot(): Promise<InquirySnapshot>;
	close?(): Promise<void>;
}

/** Minimal shape accepted by the package so it does not import backend types. */
export interface InquiryStorageRegistry {
	register(entry: InquiryStorageEntry): unknown;
}

export interface InquiryStorageEntry {
	readonly id: "inquiry-root" | "inquiry-ledger";
	readonly path: string;
	readonly owner: "inquiry" | "inquiry/ledger";
	readonly schema: 1;
	readonly sensitivity: "private";
}

export const INQUIRY_STORAGE_IDS = Object.freeze({
	root: "inquiry-root",
	ledger: "inquiry-ledger",
} as const);

/** Register inquiry's durable root and ledger through a host registry adapter. */
export function registerInquiryStorage(
	registry: InquiryStorageRegistry,
	rootPath: string,
): readonly InquiryStorageEntry[] {
	if (!rootPath.trim()) throw new Error("Inquiry storage root cannot be empty");
	const entries: readonly InquiryStorageEntry[] = [
		{ id: INQUIRY_STORAGE_IDS.root, path: rootPath, owner: "inquiry", schema: 1, sensitivity: "private" },
		{
			id: INQUIRY_STORAGE_IDS.ledger,
			path: `${rootPath.replace(/[\\/]$/, "")}/ledger.sqlite`,
			owner: "inquiry/ledger",
			schema: 1,
			sensitivity: "private",
		},
	];
	for (const entry of entries) registry.register(entry);
	return entries;
}

interface PersistedDocument extends InquirySnapshot {
	readonly revision: number;
}

const queues = new Map<string, Promise<void>>();

const SQLITE_TABLES = ["artifacts", "findings", "questions", "attempts"] as const;
type SqliteLedgerKey = (typeof SQLITE_TABLES)[number];
type LedgerRecord = ArtifactRecord | FindingRecord | QuestionRecord | AttemptRecord;

interface SqliteMetaRow {
	project_id: string;
	schema_version: number;
	revision: number;
	updated_at: string;
}

interface SqlitePayloadRow {
	payload: string;
}

function quotedTable(key: SqliteLedgerKey): string {
	// The key is selected from a fixed tuple above; never interpolate user input.
	return `"${key}"`;
}

function enqueue<T>(path: string, operation: () => Promise<T>): Promise<T> {
	const previous = queues.get(path) ?? Promise.resolve();
	const next = previous.catch(() => {}).then(operation);
	const settled = next.then(
		() => {},
		() => {},
	);
	queues.set(path, settled);
	void settled.then(() => {
		if (queues.get(path) === settled) queues.delete(path);
	});
	return next;
}

function emptyDocument(projectId: string): PersistedDocument {
	return {
		schemaVersion: 1,
		projectId,
		revision: 0,
		updatedAt: new Date(0).toISOString(),
		artifacts: [],
		findings: [],
		questions: [],
		attempts: [],
	};
}

function sortRecords<T extends { readonly id: string }>(records: readonly T[]): T[] {
	return [...records].sort((a, b) => a.id.localeCompare(b.id));
}

function stableDocument(document: PersistedDocument): PersistedDocument {
	return {
		...document,
		artifacts: sortRecords(document.artifacts),
		findings: sortRecords(document.findings),
		questions: sortRecords(document.questions),
		attempts: sortRecords(document.attempts),
	};
}

function parseDocument(raw: string, projectId: string): PersistedDocument {
	const parsed = JSON.parse(raw) as Partial<PersistedDocument>;
	if (
		parsed.schemaVersion !== 1 ||
		parsed.projectId !== projectId ||
		!Array.isArray(parsed.artifacts) ||
		!Array.isArray(parsed.findings) ||
		!Array.isArray(parsed.questions) ||
		!Array.isArray(parsed.attempts)
	) {
		throw new Error("Invalid inquiry ledger document");
	}
	const revision = parsed.revision;
	if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0)
		throw new Error("Invalid inquiry ledger revision");
	return stableDocument(parsed as PersistedDocument);
}

async function readDocument(path: string, projectId: string): Promise<PersistedDocument> {
	try {
		return parseDocument(await readFile(path, "utf8"), projectId);
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
			return emptyDocument(projectId);
		throw error;
	}
}

async function writeDocument(path: string, document: PersistedDocument): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(stableDocument(document), null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => {});
		throw error;
	}
}

class FileLedgerCollection<T extends { readonly id: string }> implements LedgerCollection<T> {
	constructor(
		private readonly owner: FileInquiryStorage,
		private readonly key: "artifacts" | "findings" | "questions" | "attempts",
	) {}

	async get(id: string): Promise<T | undefined> {
		return (await this.list()).find((record) => record.id === id);
	}

	async list(): Promise<readonly T[]> {
		const snapshot = await this.owner.snapshot();
		return sortRecords(snapshot[this.key] as unknown as readonly T[]);
	}

	async put(record: T): Promise<void> {
		await this.owner.update(
			this.key,
			record as unknown as ArtifactRecord | FindingRecord | QuestionRecord | AttemptRecord,
		);
	}
}

/**
 * Small deterministic file adapter used by CLI hosts and tests.  Production
 * hosts may replace it with SQLite while retaining the same InquiryStorage
 * contract. Writes use a same-directory temporary file plus rename and all
 * records are sorted by id before serialization.
 */
export class FileInquiryStorage implements InquiryStorage {
	readonly artifacts: ArtifactLedger;
	readonly findings: FindingLedger;
	readonly questions: QuestionLedger;
	readonly attempts: AttemptLedger;

	constructor(
		readonly projectId: string,
		readonly path: string,
	) {
		if (!projectId.trim()) throw new Error("Inquiry projectId cannot be empty");
		if (!path.trim()) throw new Error("Inquiry ledger path cannot be empty");
		this.artifacts = new FileLedgerCollection<ArtifactRecord>(this, "artifacts");
		this.findings = new FileLedgerCollection<FindingRecord>(this, "findings");
		this.questions = new FileLedgerCollection<QuestionRecord>(this, "questions");
		this.attempts = new FileLedgerCollection<AttemptRecord>(this, "attempts");
	}

	async snapshot(): Promise<InquirySnapshot> {
		return readDocument(this.path, this.projectId);
	}

	async update(
		key: "artifacts" | "findings" | "questions" | "attempts",
		record: ArtifactRecord | FindingRecord | QuestionRecord | AttemptRecord,
	): Promise<void> {
		return enqueue(this.path, async () => {
			const current = await readDocument(this.path, this.projectId);
			if (key === "artifacts") {
				const artifact = record as ArtifactRecord;
				const errors = [
					...(artifact.projectId !== this.projectId ? ["artifact belongs to another project"] : []),
					...validateArtifactLineage(artifact, current.artifacts),
				];
				if (errors.length) throw new Error(`Invalid artifact record: ${errors.join("; ")}`);
			} else if (key === "findings") {
				const finding = record as FindingRecord;
				const errors = validateFindingReferences(finding, current);
				if (errors.length) throw new Error(`Invalid finding record: ${errors.join("; ")}`);
			} else if (key === "questions") {
				if (
					!record ||
					(record as QuestionRecord).schemaVersion !== 1 ||
					(record as QuestionRecord).projectId !== this.projectId
				)
					throw new Error("Invalid question record");
			} else if (
				!record ||
				(record as AttemptRecord).schemaVersion !== 1 ||
				(record as AttemptRecord).projectId !== this.projectId
			) {
				throw new Error("Invalid attempt record");
			}
			const values = [...current[key]] as Array<typeof record>;
			const index = values.findIndex((item) => item.id === record.id);
			if (index >= 0) values[index] = record;
			else values.push(record);
			const next = stableDocument({
				...current,
				revision: current.revision + 1,
				updatedAt: new Date().toISOString(),
				[key]: values,
			});
			await writeDocument(this.path, next);
		});
	}
}

/**
 * Durable SQLite adapter for desktop/CLI hosts.  The domain package only
 * depends on Node's built-in `node:sqlite`; no backend or Electron value is
 * imported.  Each ledger has its own table, with the complete record kept as
 * a JSON payload so schema migrations remain host-controlled and records keep
 * their exact domain shape.
 */
export class SqliteInquiryStorage implements InquiryStorage {
	readonly artifacts: ArtifactLedger;
	readonly findings: FindingLedger;
	readonly questions: QuestionLedger;
	readonly attempts: AttemptLedger;
	private readonly database: DatabaseSync;
	private closed = false;

	constructor(
		readonly projectId: string,
		readonly path: string,
	) {
		if (!projectId.trim()) throw new Error("Inquiry projectId cannot be empty");
		if (!path.trim()) throw new Error("Inquiry SQLite path cannot be empty");
		mkdirSync(dirname(path), { recursive: true });
		this.database = new DatabaseSync(path);
		this.database.exec("PRAGMA busy_timeout = 5000");
		this.database.exec("PRAGMA foreign_keys = ON");
		this.database.exec("PRAGMA journal_mode = WAL");
		this.database.exec("PRAGMA synchronous = FULL");
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS inquiry_meta (
				project_id TEXT PRIMARY KEY NOT NULL,
				schema_version INTEGER NOT NULL CHECK (schema_version = 1),
				revision INTEGER NOT NULL CHECK (revision >= 0),
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS artifacts (
				id TEXT PRIMARY KEY NOT NULL,
				project_id TEXT NOT NULL,
				payload TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS findings (
				id TEXT PRIMARY KEY NOT NULL,
				project_id TEXT NOT NULL,
				payload TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS questions (
				id TEXT PRIMARY KEY NOT NULL,
				project_id TEXT NOT NULL,
				payload TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS attempts (
				id TEXT PRIMARY KEY NOT NULL,
				project_id TEXT NOT NULL,
				payload TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`);
		const meta = this.database
			.prepare("SELECT project_id, schema_version, revision, updated_at FROM inquiry_meta LIMIT 1")
			.get() as SqliteMetaRow | undefined;
		if (meta && meta.project_id !== projectId) {
			this.database.close();
			throw new Error("Inquiry SQLite ledger belongs to another project");
		}
		if (!meta) {
			this.database
				.prepare(
					"INSERT INTO inquiry_meta (project_id, schema_version, revision, updated_at) VALUES (?, 1, 0, ?)",
				)
				.run(projectId, new Date(0).toISOString());
		}
		this.artifacts = new SqliteLedgerCollection<ArtifactRecord>(this, "artifacts");
		this.findings = new SqliteLedgerCollection<FindingRecord>(this, "findings");
		this.questions = new SqliteLedgerCollection<QuestionRecord>(this, "questions");
		this.attempts = new SqliteLedgerCollection<AttemptRecord>(this, "attempts");
	}

	async snapshot(): Promise<InquirySnapshot> {
		return this.snapshotSync();
	}

	private snapshotSync(): InquirySnapshot {
		this.assertOpen();
		const meta = this.database
			.prepare("SELECT project_id, schema_version, revision, updated_at FROM inquiry_meta LIMIT 1")
			.get() as SqliteMetaRow | undefined;
		if (!meta || meta.project_id !== this.projectId || meta.schema_version !== 1)
			throw new Error("Invalid inquiry SQLite metadata");
		const read = <T extends LedgerRecord>(key: SqliteLedgerKey): readonly T[] =>
			(
				this.database
					.prepare(`SELECT payload FROM ${quotedTable(key)} WHERE project_id = ? ORDER BY id ASC`)
					.all(this.projectId) as unknown as SqlitePayloadRow[]
			).map((row) => JSON.parse(row.payload) as T);
		return {
			schemaVersion: 1,
			projectId: this.projectId,
			revision: meta.revision,
			updatedAt: meta.updated_at,
			artifacts: read<ArtifactRecord>("artifacts"),
			findings: read<FindingRecord>("findings"),
			questions: read<QuestionRecord>("questions"),
			attempts: read<AttemptRecord>("attempts"),
		};
	}

	async update(key: SqliteLedgerKey, record: LedgerRecord): Promise<void> {
		return enqueue(this.path, async () => {
			this.assertOpen();
			this.database.exec("BEGIN IMMEDIATE");
			try {
				const current = this.snapshotSync();
				this.validateRecord(key, record, current);
				const updatedAt = new Date().toISOString();
				this.database
					.prepare(
						`INSERT INTO ${quotedTable(key)} (id, project_id, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, payload = excluded.payload, updated_at = excluded.updated_at`,
					)
					.run(record.id, this.projectId, JSON.stringify(record), updatedAt);
				this.database
					.prepare("UPDATE inquiry_meta SET revision = revision + 1, updated_at = ? WHERE project_id = ?")
					.run(updatedAt, this.projectId);
				this.database.exec("COMMIT");
			} catch (error) {
				try {
					this.database.exec("ROLLBACK");
				} catch {
					// Preserve the original validation/SQLite error.
				}
				throw error;
			}
		});
	}

	private validateRecord(key: SqliteLedgerKey, record: LedgerRecord, current: InquirySnapshot): void {
		if (!record.id || record.projectId !== this.projectId || record.schemaVersion !== 1)
			throw new Error(`Invalid ${key.slice(0, -1)} record`);
		if (key === "artifacts") {
			const errors = validateArtifactLineage(record as ArtifactRecord, current.artifacts);
			if (errors.length) throw new Error(`Invalid artifact record: ${errors.join("; ")}`);
		}
		if (key === "findings") {
			const errors = validateFindingReferences(record as FindingRecord, current);
			if (errors.length) throw new Error(`Invalid finding record: ${errors.join("; ")}`);
		}
	}

	private assertOpen(): void {
		if (this.closed) throw new Error("Inquiry SQLite storage is closed");
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.database.close();
	}
}

class SqliteLedgerCollection<T extends { readonly id: string }> implements LedgerCollection<T> {
	constructor(
		private readonly owner: SqliteInquiryStorage,
		private readonly key: SqliteLedgerKey,
	) {}

	async get(id: string): Promise<T | undefined> {
		return (await this.list()).find((record) => record.id === id);
	}

	async list(): Promise<readonly T[]> {
		const snapshot = await this.owner.snapshot();
		return snapshot[this.key] as unknown as readonly T[];
	}

	async put(record: T): Promise<void> {
		await this.owner.update(this.key, record as unknown as LedgerRecord);
	}
}

/** In-memory adapter is useful for host composition tests and deterministic previews. */
export class MemoryInquiryStorage implements InquiryStorage {
	private state: InquirySnapshot;
	readonly artifacts: ArtifactLedger;
	readonly findings: FindingLedger;
	readonly questions: QuestionLedger;
	readonly attempts: AttemptLedger;

	constructor(
		readonly projectId: string,
		initial?: Partial<InquirySnapshot>,
	) {
		if (!projectId.trim()) throw new Error("Inquiry projectId cannot be empty");
		this.state = {
			schemaVersion: 1,
			projectId,
			revision: initial?.revision ?? 0,
			updatedAt: initial?.updatedAt ?? new Date(0).toISOString(),
			artifacts: sortRecords(initial?.artifacts ?? []),
			findings: sortRecords(initial?.findings ?? []),
			questions: sortRecords(initial?.questions ?? []),
			attempts: sortRecords(initial?.attempts ?? []),
		};
		this.artifacts = new MemoryLedgerCollection(this, "artifacts");
		this.findings = new MemoryLedgerCollection(this, "findings");
		this.questions = new MemoryLedgerCollection(this, "questions");
		this.attempts = new MemoryLedgerCollection(this, "attempts");
	}

	async snapshot(): Promise<InquirySnapshot> {
		return structuredClone(this.state);
	}

	async update(
		key: "artifacts" | "findings" | "questions" | "attempts",
		record: ArtifactRecord | FindingRecord | QuestionRecord | AttemptRecord,
	): Promise<void> {
		if (key === "artifacts") {
			const artifact = record as ArtifactRecord;
			const errors = [
				...(artifact.projectId !== this.projectId ? ["artifact belongs to another project"] : []),
				...validateArtifactLineage(artifact, this.state.artifacts),
			];
			if (errors.length) throw new Error(`Invalid artifact record: ${errors.join("; ")}`);
		}
		if (key === "findings") {
			const errors = validateFindingReferences(record as FindingRecord, this.state);
			if (errors.length) throw new Error(`Invalid finding record: ${errors.join("; ")}`);
		}
		const values = [...this.state[key]] as Array<typeof record>;
		const index = values.findIndex((item) => item.id === record.id);
		if (index >= 0) values[index] = record;
		else values.push(record);
		this.state = {
			...this.state,
			revision: this.state.revision + 1,
			updatedAt: new Date().toISOString(),
			[key]: sortRecords(values),
		};
	}
}

class MemoryLedgerCollection<T extends { readonly id: string }> implements LedgerCollection<T> {
	constructor(
		private readonly owner: MemoryInquiryStorage,
		private readonly key: "artifacts" | "findings" | "questions" | "attempts",
	) {}
	async get(id: string): Promise<T | undefined> {
		return (await this.list()).find((record) => record.id === id);
	}
	async list(): Promise<readonly T[]> {
		const snapshot = await this.owner.snapshot();
		return sortRecords(snapshot[this.key] as unknown as readonly T[]);
	}
	async put(record: T): Promise<void> {
		await this.owner.update(
			this.key,
			record as unknown as ArtifactRecord | FindingRecord | QuestionRecord | AttemptRecord,
		);
	}
}
