import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { link, lstat, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { PluginBinaryStateReadResult, PluginBinaryStateWriteInput } from "../runtime.js";
export const MAX_BINARY_BYTES = 4 * 1024 * 1024;
export const MAX_BINARY_BASE64 = 4 * Math.ceil(MAX_BINARY_BYTES / 3);
/** Functions originate only in a trusted Node adapter; no JSON grants paths or caller authority. */
export interface BinaryStateReadAccess {
	resolvePath(relativePath: string): Promise<string>;
	checkRoot(): Promise<void>;
}
export interface BinaryStateWriteAccess extends BinaryStateReadAccess {
	checkWrite(): Promise<void>;
	assertReserved(canonicalDirectory: string): void;
	conflictError(): Error;
	cleanupFailed(error: unknown): void;
}
export interface BinaryStateWriteOptions {
	readonly signal: AbortSignal;
	serialize<T>(operation: () => Promise<T>): Promise<T>;
	/** Resolved inside the adapter's current mutation/caller scope, never retained across callers. */
	prepare(): BinaryStateWriteAccess;
}
function sameFile(left: Stats, right: Stats): boolean {
	return (
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.size === right.size &&
		left.mtimeMs === right.mtimeMs &&
		left.ctimeMs === right.ctimeMs
	);
}
async function binarySnapshot(path: string, access: BinaryStateReadAccess) {
	const filePath = await access.resolvePath(path);
	const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const before = await file.stat();
		if (!before.isFile()) throw new Error("Binary state requires a regular file");
		if (before.size > MAX_BINARY_BYTES) throw new Error("Binary state exceeds the 4 MiB limit");
		const bytes = Buffer.alloc(before.size + 1);
		let offset = 0;
		while (offset < bytes.length) {
			const result = await file.read(bytes, offset, bytes.length - offset, offset);
			if (!result.bytesRead) break;
			offset += result.bytesRead;
		}
		const after = await file.stat(),
			current = await lstat(await access.resolvePath(path));
		if (!sameFile(before, after) || !sameFile(after, current) || offset !== before.size)
			throw new Error("Binary state changed during read");
		const value = bytes.subarray(0, offset);
		return {
			kind: "value" as const,
			base64: value.toString("base64"),
			version: createHash("sha256").update(value).digest("hex"),
		};
	} finally {
		await file.close();
	}
}
export async function readBinaryStateFile(
	path: string,
	access: BinaryStateReadAccess,
): Promise<PluginBinaryStateReadResult> {
	try {
		return await binarySnapshot(path, access);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		await access.checkRoot();
		return { kind: "missing", version: null };
	}
}
export function writeBinaryStateFile(
	input: Omit<PluginBinaryStateWriteInput, "root">,
	options: BinaryStateWriteOptions,
): Promise<PluginBinaryStateReadResult> {
	// Input is plugin JSON: bound before decoding and reject Buffer's permissive noncanonical forms.
	if (input.base64.length > MAX_BINARY_BASE64) throw new Error("Binary state exceeds the 4 MiB limit");
	const bytes = Buffer.from(input.base64, "base64");
	if (bytes.length > MAX_BINARY_BYTES || bytes.toString("base64") !== input.base64)
		throw new Error("Binary state requires canonical base64 within 4 MiB");
	return options.serialize(async () => {
		const access = options.prepare();
		const parentRelative = dirname(input.path) === "." ? "" : dirname(input.path);
		const parent = await access.resolvePath(parentRelative),
			identity = await lstat(parent);
		if (!identity.isDirectory()) throw new Error("Binary state parent must be an existing directory");
		const target = join(parent, basename(input.path));
		const check = async () => {
			await access.checkWrite();
			const actualParent = await access.resolvePath(parentRelative),
				currentParent = await lstat(actualParent);
			if (actualParent !== parent || currentParent.dev !== identity.dev || currentParent.ino !== identity.ino)
				throw new Error("Binary state parent changed after authorization");
			access.assertReserved(parent);
			if ((await readBinaryStateFile(input.path, access)).version !== input.expectedVersion)
				throw access.conflictError();
			for (const path of input.assertAbsent) {
				const absentParent = dirname(path) === "." ? "" : dirname(path);
				const directory = await access.resolvePath(absentParent);
				try {
					await lstat(join(directory, basename(path)));
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
					throw error;
				}
				throw new Error(`Binary write requires an absent sidecar: ${path}`);
			}
			options.signal.throwIfAborted();
		};
		await check();
		const temporary = join(parent, `.${basename(target)}.${randomUUID()}.tmp`);
		let committed = false;
		let temporaryIdentity: Stats | undefined;
		let outcome: { ok: true; result: PluginBinaryStateReadResult } | { ok: false; error: unknown };
		try {
			const file = await open(
				temporary,
				constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
				0o600,
			);
			const [written] = await Promise.allSettled([
				(async () => {
					temporaryIdentity = await file.stat();
					await file.writeFile(bytes);
				})(),
			]);
			const [closed] = await Promise.allSettled([file.close()]);
			if (closed.status === "rejected") {
				access.cleanupFailed(closed.reason);
				throw new AggregateError(
					written.status === "rejected" ? [written.reason, closed.reason] : [closed.reason],
					"Binary temporary file could not be closed",
				);
			}
			if (written.status === "rejected") {
				if (!temporaryIdentity) access.cleanupFailed(written.reason);
				throw written.reason;
			}
			await check();
			if (input.expectedVersion === null) await link(temporary, target);
			else await rename(temporary, target);
			committed = true;
			// Finalization only reads this accepted operation's own target, even after cancellation.
			const result = await binarySnapshot(input.path, access);
			if (result.version !== createHash("sha256").update(bytes).digest("hex"))
				throw new Error("Binary state changed after atomic replacement");
			options.signal.throwIfAborted();
			outcome = { ok: true, result };
		} catch (error) {
			outcome = { ok: false, error };
		}
		try {
			if (temporaryIdentity) {
				const currentParent = await lstat(parent);
				if (
					currentParent.dev !== identity.dev ||
					currentParent.ino !== identity.ino ||
					!currentParent.isDirectory()
				)
					throw new Error("Binary temporary parent changed; explicit cleanup recovery is required");
				let current: Stats | undefined;
				try {
					current = await lstat(temporary);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				if (current) {
					if (
						!current.isFile() ||
						current.dev !== temporaryIdentity.dev ||
						current.ino !== temporaryIdentity.ino
					)
						throw new Error("Binary temporary ownership changed; explicit cleanup recovery is required");
					await rm(temporary);
				}
			}
		} catch (error) {
			access.cleanupFailed(error);
			outcome = {
				ok: false,
				error: new AggregateError(
					outcome.ok ? [error] : [outcome.error, error],
					"Binary temporary cleanup failed; writer lease retained",
				),
			};
		}
		if (outcome.ok) return outcome.result;
		if (committed) {
			const error = new Error(
				"Binary write may have committed; a fresh approved caller must reconcile the stored SHA-256",
				{ cause: outcome.error },
			);
			Object.assign(error, { code: "EBINARYWRITEOUTCOMEUNKNOWN" });
			throw error;
		}
		throw outcome.error;
	});
}
