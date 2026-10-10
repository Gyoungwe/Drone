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
