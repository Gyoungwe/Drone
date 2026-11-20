import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { type ArtifactManifest, isJobState, type JobRecord, type RunnerClient } from "@drone/compute";
import type { ComputeStatusResult } from "../services/compute";

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

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new ComputeTransportError("aborted", "Compute operation was aborted");
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

function runnerRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function validatedCleanup(value: unknown, jobId: string, fallbackMethod?: "direct" | "slurm") {
	const evidence = runnerRecord(value);
	if (
		(evidence.state === "confirmed" ||
			evidence.state === "unknown" ||
			evidence.state === "failed" ||
			evidence.state === "unsupported") &&
		evidence.jobId === jobId &&
		(evidence.method === "direct" || evidence.method === "slurm") &&
		typeof evidence.observedAt === "string"
	) {
		return { state: evidence.state, jobId, method: evidence.method, observedAt: evidence.observedAt };
	}
	const method = fallbackMethod ?? (evidence.method === "slurm" ? "slurm" : "direct");
	return { state: "unknown", jobId, method };
}

export async function statusWithEvidence(client: RunnerClient, job: JobRecord): Promise<ComputeStatusResult> {
	const jobId = job.remoteId ?? job.jobId;
	const value = await client.status(jobId);
	return {
		status: value.state ?? "unknown",
		remoteId: value.remoteId ?? job.remoteId,
		...(value.pid ? { pid: value.pid } : {}),
		...(value.message ? { error: value.message } : {}),
		...("cleanup" in value ? { cleanup: validatedCleanup(value.cleanup, jobId) } : {}),
	};
}

export async function cancelWithEvidence(client: RunnerClient, job: JobRecord): Promise<ComputeStatusResult> {
	const jobId = job.remoteId ?? job.jobId;
	const { capabilities } = await client.negotiate();
	// RunnerClient's normalized capabilities omit cleanupEvidence; inspect the wire advertisement.
	const advertised = runnerRecord(await client.execute("capabilities"));
	const method = capabilities.scheduler === "slurm" ? "slurm" : "direct";
	const value = runnerRecord(await cancelWithRetry(client, jobId));
	return {
		status: isJobState(value.state) ? value.state : "unknown",
		remoteId: typeof value.remoteId === "string" ? value.remoteId : job.remoteId,
		cleanup:
			advertised.cleanupEvidence === 1
				? validatedCleanup(value.cleanup, jobId, method)
				: { state: "unsupported", jobId, method },
	};
}

type DownloadArtifact = (path: string, maxBytes: number) => Promise<Uint8Array>;

export class ComputeOperationLifetime {
	private readonly controller = new AbortController();
	private readonly writes = new Set<Promise<void>>();

	assertActive(signal?: AbortSignal): void {
		if (this.controller.signal.aborted)
			throw new ComputeTransportError("executor-disposed", "Compute executor is disposed");
		throwIfAborted(signal);
	}

	async write(
		callerSignal: AbortSignal | undefined,
		entries: ArtifactManifest["entries"],
		targetDir: string,
		maxBytes: number,
		download: DownloadArtifact,
	): Promise<void> {
		this.assertActive(callerSignal);
		const lifetimeSignal = this.controller.signal;
		const signal = callerSignal ? AbortSignal.any([callerSignal, lifetimeSignal]) : lifetimeSignal;
		const write = writeCollectedArtifacts(entries, targetDir, maxBytes, download, signal);
		this.writes.add(write);
		try {
			await write;
		} finally {
			this.writes.delete(write);
		}
	}

	async dispose(): Promise<void> {
		this.controller.abort();
		// Collect reports write failures to its caller; disposal must still drain every write.
		await Promise.allSettled(this.writes);
	}
}

async function writeCollectedArtifacts(
	entries: ArtifactManifest["entries"],
	targetDir: string,
	maxBytes: number,
	download: DownloadArtifact,
	signal: AbortSignal,
): Promise<void> {
	const targetRoot = resolve(targetDir);
	await mkdir(targetRoot, { recursive: true });
	for (const entry of entries) {
		throwIfAborted(signal);
		const path = safeRelativePath(entry.path);
		const bytes = await download(path, entry.bytes ?? entry.size ?? maxBytes);
		if (entry.symlink)
			throw new ComputeTransportError("unsafe-artifact", `Symlink artifact is not allowed: ${path}`);
		if (entry.bytes !== undefined && bytes.byteLength !== entry.bytes)
			throw new ComputeTransportError("artifact-size", `Artifact size mismatch: ${path}`);
		if (entry.sha256 && sha256(bytes) !== entry.sha256.toLowerCase())
			throw new ComputeTransportError("artifact-checksum", `Artifact checksum mismatch: ${path}`);
		await publishArtifact(targetRoot, path, bytes, signal);
	}
}

async function publishArtifact(root: string, path: string, bytes: Uint8Array, signal: AbortSignal) {
	const target = resolveInside(root, path);
	await mkdir(dirname(target), { recursive: true });
	const temporary = `${target}.drone-partial-${randomUUID()}`;
	const file = await open(temporary, "wx", 0o600);
	try {
		await file.writeFile(bytes).finally(() => file.close());
		const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
		});
		if (existing?.isSymbolicLink())
			throw new ComputeTransportError("unsafe-artifact", `Destination is a symlink: ${path}`);
		throwIfAborted(signal);
		await rename(temporary, target);
	} catch (error) {
		await unlink(temporary);
		throw error;
	}
}
