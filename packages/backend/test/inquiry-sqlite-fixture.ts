import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const INQUIRY_SCHEMA_VERSION = 2;
const SQLITE_TABLES = ["artifacts", "findings", "questions", "attempts", "decisions", "reruns"] as const;

/** Seed a v2 SQLite inquiry ledger matching the legacy host DDL for plugin compatibility tests. */
export function seedLegacyInquiryLedger(projectId: string, dbPath: string): void {
	if (!projectId.trim()) throw new Error("Inquiry projectId cannot be empty");
	if (!dbPath.trim()) throw new Error("Inquiry SQLite path cannot be empty");
	mkdirSync(dirname(dbPath), { recursive: true });
	const database = new DatabaseSync(dbPath);
	try {
		database.exec("PRAGMA busy_timeout = 5000");
		database.exec("PRAGMA foreign_keys = ON");
		database.exec("PRAGMA journal_mode = WAL");
		database.exec("PRAGMA synchronous = FULL");
		const tableStatements = SQLITE_TABLES.map(
			(table) => `
			CREATE TABLE IF NOT EXISTS ${table} (
				id TEXT PRIMARY KEY NOT NULL,
				project_id TEXT NOT NULL,
				payload TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);`,
		).join("\n");
		database.exec(`
			CREATE TABLE IF NOT EXISTS inquiry_meta (
				project_id TEXT PRIMARY KEY NOT NULL,
				schema_version INTEGER NOT NULL CHECK (schema_version = ${INQUIRY_SCHEMA_VERSION}),
				revision INTEGER NOT NULL CHECK (revision >= 0),
				updated_at TEXT NOT NULL
			);
			${tableStatements}
		`);
		const meta = database.prepare("SELECT project_id FROM inquiry_meta LIMIT 1").get() as
			| { project_id?: string }
			| undefined;
		if (meta && meta.project_id !== projectId) {
			throw new Error("Inquiry SQLite ledger belongs to another project");
		}
		if (!meta) {
			database
				.prepare(
					"INSERT INTO inquiry_meta (project_id, schema_version, revision, updated_at) VALUES (?, ?, 0, ?)",
				)
				.run(projectId, INQUIRY_SCHEMA_VERSION, new Date(0).toISOString());
		}
	} finally {
		database.close();
	}
}

/** Read persisted question payloads from a v2 SQLite inquiry ledger in read-only mode. */
export function readLegacyInquiryQuestions(dbPath: string, projectId: string): readonly unknown[] {
	const database = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const meta = database.prepare("SELECT project_id, schema_version FROM inquiry_meta LIMIT 1").get() as
			| { project_id?: string; schema_version?: number }
			| undefined;
		if (!meta || meta.project_id !== projectId || meta.schema_version !== INQUIRY_SCHEMA_VERSION)
			throw new Error("Invalid inquiry SQLite metadata");
		const rows = database
			.prepare("SELECT payload FROM questions WHERE project_id = ? ORDER BY id ASC")
			.all(projectId) as unknown as Array<{ payload: string }>;
		return rows.map((row) => JSON.parse(row.payload));
	} finally {
		database.close();
	}
}
