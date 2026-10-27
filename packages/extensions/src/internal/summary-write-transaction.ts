import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function existingBytes(path: string): Promise<Buffer | null> {
	try {
		return await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function atomicBytes(path: string, bytes: Uint8Array): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporary, bytes);
	await rename(temporary, path);
}

/** Roll back only bytes written by this delivery; retain concurrent user edits. */
export function createSummaryWriteTransaction() {
	const writes: Array<{ path: string; before: Buffer | null; after: Buffer }> = [];
	return {
		async write(path: string, text: string, expectedBefore?: Buffer | null): Promise<void> {
			const before = await existingBytes(path), after = Buffer.from(text);
			if (expectedBefore !== undefined && (expectedBefore ? !before?.equals(expectedBefore) : before !== null))
				throw new Error(`Summary destination changed before writing: ${path}`);
			await atomicBytes(path, after);
			writes.push({ path, before, after });
			if (!(await readFile(path)).equals(after)) throw new Error(`Summary write readback changed: ${path}`);
		},
		async rollback(): Promise<void> {
			const failures: Error[] = [];
			for (const { path, before, after } of writes.toReversed()) {
				try {
					const current = await existingBytes(path);
					if (!current?.equals(after)) throw new Error(`Concurrent edit retained: ${path}`);
					if (before) await atomicBytes(path, before);
					else await rm(path);
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
