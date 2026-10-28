import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { PluginFileBinaryReadResult } from "@gyoungwe/plugin-api/runtime";

export const MAX_FILE_BINARY_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_BINARY_BASE64 = 11184812;

type Version = PluginFileBinaryReadResult["version"];
function version(stat: Stats): Version {
	return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}
function same(left: Version, right: Version): boolean {
	return (
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.size === right.size &&
		left.mtimeMs === right.mtimeMs &&
		left.ctimeMs === right.ctimeMs
	);
}

/** Resolve rechecks the actual approved root/path on every boundary, never a caller-selected OS path. */
export async function readStableFileBytes(
	resolve: () => Promise<string>,
	signal: AbortSignal,
): Promise<PluginFileBinaryReadResult> {
	signal.throwIfAborted();
	const path = await resolve();
	const before = await lstat(path);
	if (!before.isFile()) throw new Error("Plugin binary read requires a regular file");
	if (before.size > MAX_FILE_BINARY_BYTES) throw new Error("Plugin binary read exceeds the 8 MiB limit");
	signal.throwIfAborted();
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const opened = await file.stat();
		if (!same(before, opened)) throw new Error("Plugin file changed before binary read");
		const buffer = Buffer.alloc(before.size + 1);
		let offset = 0;
		while (offset < buffer.length) {
			signal.throwIfAborted();
			const { bytesRead } = await file.read(buffer, offset, Math.min(65536, buffer.length - offset), offset);
			signal.throwIfAborted();
			if (!bytesRead) break;
			offset += bytesRead;
		}
		const after = await file.stat();
		const currentPath = await resolve();
		const current = await lstat(currentPath);
		if (currentPath !== path || !same(opened, after) || !same(after, current) || offset !== before.size)
			throw new Error("Plugin file changed during binary read");
		signal.throwIfAborted();
		const bytes = buffer.subarray(0, offset);
		return {
			base64: bytes.toString("base64"),
			sha256: createHash("sha256").update(bytes).digest("hex"),
			bytes: offset,
			version: version(after),
		};
	} finally {
		await file.close();
	}
}
