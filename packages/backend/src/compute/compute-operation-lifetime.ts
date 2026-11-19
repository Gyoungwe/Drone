import { createHash } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ArtifactManifest, RunnerClient } from "@drone/compute";

export class ComputeTransportError extends Error {
	readonly code: string;
	readonly retryable: boolean;

	constructor(code: string, message: string, retryable = false) {
		super(message);
		this.name = "ComputeTransportError";
		this.code = code;
		this.retryable = retryable;
	}
}

export function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

export function safeRelativePath(value: string): string {
	if (!value || value.includes("\0"))
		throw new ComputeTransportError("unsafe-path", "Empty or NUL path is not allowed");
	const normalized = value.replaceAll("\\", "/");
	if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized))
		throw new ComputeTransportError("unsafe-path", `Absolute path is not allowed: ${value}`);
	const parts = normalized.split("/");
	if (parts.some((part) => part.length === 0 || part === "." || part === ".."))
		throw new ComputeTransportError("unsafe-path", `Traversal path is not allowed: ${value}`);
	return parts.join("/");
}

export function resolveInside(root: string, child: string): string {
	const resolvedRoot = resolve(root);
	const resolvedChild = resolve(resolvedRoot, child);
	const rel = relative(resolvedRoot, resolvedChild);
	if (rel === "" || rel.startsWith("../") || rel === ".." || isAbsolute(rel))
		throw new ComputeTransportError("unsafe-path", `Path escapes work directory: ${child}`);
	return resolvedChild;
}

export async function cancelWithRetry(client: RunnerClient, remoteId: string): Promise<unknown> {
	// Right after start the runner may not see the worker process yet (slow on Windows) and
	// answers a retryable "cancel-unknown"; honour that flag with a few short retries.
	for (let attempt = 0; ; attempt++) {
		try {
			return await client.cancel(remoteId);
		} catch (error) {
			const retryable =
				(error as { code?: unknown; retryable?: unknown })?.code === "cancel-unknown" &&
				(error as { retryable?: unknown }).retryable === true;
			if (!retryable || attempt >= 4) throw error;
			await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
		}
	}
}

export async function writeCollectedArtifacts(
	entries: ArtifactManifest["entries"],
	targetDir: string,
	maxBytes: number,
	download: (path: string, maxBytes: number) => Promise<Uint8Array>,
): Promise<void> {
	const targetRoot = resolve(targetDir);
	await mkdir(targetRoot, { recursive: true });
	for (const entry of entries) {
		const path = safeRelativePath(entry.path);
		const data = await download(path, entry.bytes ?? entry.size ?? maxBytes);
		if (entry.symlink)
			throw new ComputeTransportError("unsafe-artifact", `Symlink artifact is not allowed: ${path}`);
		if (entry.bytes !== undefined && data.byteLength !== entry.bytes)
			throw new ComputeTransportError("artifact-size", `Artifact size mismatch: ${path}`);
		if (entry.sha256 && sha256(data) !== entry.sha256.toLowerCase())
			throw new ComputeTransportError("artifact-checksum", `Artifact checksum mismatch: ${path}`);
		const target = resolveInside(targetRoot, path);
		await mkdir(dirname(target), { recursive: true });
		const existing = await lstat(target).catch(() => undefined);
		if (existing?.isSymbolicLink())
			throw new ComputeTransportError("unsafe-artifact", `Destination is a symlink: ${path}`);
		await writeFile(target, data, { flag: "wx", mode: 0o600 }).catch(async (error: NodeJS.ErrnoException) => {
			if (error.code !== "EEXIST") throw error;
			await writeFile(target, data, { mode: 0o600 });
		});
	}
}
