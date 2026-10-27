import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function existingBytes(path: string): Promise<Buffer | null> {
	try {
		return await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function assertPreimage(path: string, expected: Buffer | null): Promise<void> {
	const current = await existingBytes(path);
	if (expected ? !current?.equals(expected) : current !== null)
		throw new Error(`Summary destination changed before committing: ${path}`);
}

async function atomicBytes(path: string, bytes: Uint8Array, expected: Buffer | null): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, bytes);
		// Optimistic path CAS: recheck after preparation, immediately before rename.
		// Node does not provide an atomic cross-process compare-and-rename operation.
		await assertPreimage(path, expected);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

/** Roll back only bytes written by this delivery; retain concurrent user edits. */
export function createSummaryWriteTransaction() {
	const writes: Array<{ path: string; before: Buffer | null; after: Buffer }> = [];
	return {
		async write(path: string, text: string, expectedBefore?: Buffer | null): Promise<void> {
			const before = expectedBefore === undefined ? await existingBytes(path) : expectedBefore, after = Buffer.from(text);
			await atomicBytes(path, after, before);
			writes.push({ path, before, after });
			if (!(await readFile(path)).equals(after)) throw new Error(`Summary write readback changed: ${path}`);
		},
		async rollback(): Promise<void> {
			const failures: Error[] = [];
			for (const { path, before, after } of writes.toReversed()) {
				try {
					if (before) await atomicBytes(path, before, after);
					else {
						// This adjacent check/unlink is optimistic too; it is not kernel-level CAS.
						await assertPreimage(path, after);
						await unlink(path);
					}
					const restored = await existingBytes(path);
					if (before ? !restored?.equals(before) : restored !== null)
						throw new Error(`Summary rollback readback failed: ${path}`);
				} catch (error) {
					failures.push(new Error(`Partial summary delivery at ${path}`, { cause: error }));
				}
			}
			if (failures.length) throw new AggregateError(failures, `Partial summary delivery: rollback retained changed or unreadable outputs: ${failures.map((failure) => failure.message).join("; ")}`);
		},
	};
}
