import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type DurableDocument, type DurableDocumentMigration, decodeDurableDocument } from "@drone/shared";

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
