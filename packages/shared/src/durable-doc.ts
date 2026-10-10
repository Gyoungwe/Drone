import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** A small, host-owned state document envelope. It is deliberately independent
 * of the transcript format so existing JSONL sessions remain readable. */
export interface DurableDocument<T> {
	kind: string;
	version: number;
	scope?: string;
	updatedAt: string;
	data: T;
}

export interface DurableDocumentMigration<T> {
	readonly kind: string;
	readonly version: number;
	migrate(value: unknown): T;
}

export function makeDurableDocument<T>(
	kind: string,
	version: number,
	data: T,
	options: { scope?: string; updatedAt?: string } = {},
): DurableDocument<T> {
	return {
		kind,
		version,
		...(options.scope ? { scope: options.scope } : {}),
		updatedAt: options.updatedAt ?? new Date().toISOString(),
		data,
	};
}

/** Decode a document and migrate older or legacy flat values in memory. */
export function decodeDurableDocument<T>(value: unknown, migration: DurableDocumentMigration<T>): T {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		if (record.kind === migration.kind && record.version === migration.version && "data" in record)
			return record.data as T;
	}
	return migration.migrate(value);
}

export async function readDurableDocument<T>(
	path: string,
	migration: DurableDocumentMigration<T>,
): Promise<T> {
	return decodeDurableDocument(JSON.parse(await readFile(path, "utf8")), migration);
}

/** Atomic write: a temporary file is renamed only after the complete document is on disk. */
export async function writeDurableDocument<T>(path: string, document: DurableDocument<T>): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(document, null, "\t")}\n`, { encoding: "utf8", flag: "wx" });
	await rename(temporary, path);
}
