import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { HostProfile, RunnerTransport, ShellChannel, WritableByteChannel } from "@drone/compute";
import { ComputeTransportError } from "./compute-operation-lifetime";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface ComputeCredential {
	readonly privateKey?: string | Uint8Array;
	readonly passphrase?: string;
	readonly password?: string;
	readonly agent?: string;
	/** Called only by the host UI. Answers never enter runner requests or logs. */
	readonly keyboardInteractive?: (
		name: string,
		instructions: string,
		prompts: readonly string[],
	) => Promise<readonly string[]>;
}

export interface ComputeCredentialProvider {
	get(host: HostProfile): Promise<ComputeCredential | undefined>;
}

export interface UnknownHostKeyPrompt {
	readonly alias: string;
	readonly host: string;
	readonly port: number;
	readonly algorithm: string;
	readonly fingerprint: string;
	readonly knownHostsPath: string;
}

export interface DefaultComputeExecutorOptions {
	readonly agentDir?: string;
	/** Local runner.py. A production desktop supplies the packaged resource path. */
	readonly runnerPath?: string;
	readonly pythonPath?: string;
	readonly credentials?: ComputeCredentialProvider;
	readonly onUnknownHostKey?: (prompt: UnknownHostKeyPrompt) => Promise<boolean>;
	readonly hostResolver?: (alias: string) => HostProfile | Promise<HostProfile | undefined>;
	readonly runnerRemoteRoot?: string | ((host: HostProfile) => string);
	readonly timeoutMs?: number;
	readonly maxResponseBytes?: number;
	readonly maxUploadBytes?: number;
	readonly maxCollectBytes?: number;
	readonly knownHostsPath?: string;
	readonly userSshConfigPath?: string;
}

export interface CollectingTransport extends RunnerTransport {
	upload(request: {
		readonly source: Uint8Array | string;
		readonly destination: string;
		readonly maxBytes?: number;
	}): Promise<void>;
	download(request: {
		readonly source: string;
		readonly destination?: string;
		readonly maxBytes?: number;
	}): Promise<Uint8Array>;
	openShell(): Promise<ShellChannel>;
}

export class HostConcurrency {
	private active = 0;
	private readonly waiters: Array<() => void> = [];

	async run<T>(operation: () => Promise<T>): Promise<T> {
		if (this.active >= 4) await new Promise<void>((resolveWait) => this.waiters.push(resolveWait));
		this.active += 1;
		try {
			return await operation();
		} finally {
			this.active -= 1;
			this.waiters.shift()?.();
		}
	}
}

export function toBuffer(value: string | Uint8Array): Buffer {
	return typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
}

export async function readUpload(source: Uint8Array | string, getLimit: () => number): Promise<Buffer> {
	const data = typeof source === "string" ? await readFile(source) : Buffer.from(source);
	if (data.byteLength > getLimit()) throw new ComputeTransportError("upload-limit", "Upload exceeds limit");
	return data;
}

export function captureOutput(
	stdout: NodeJS.ReadableStream,
	stderr: NodeJS.ReadableStream,
	accept?: (bytes: number) => boolean,
) {
	const out: Buffer[] = [];
	const err: Buffer[] = [];
	let bytes = 0;
	const take = (target: Buffer[], chunk: Buffer) => {
		bytes += chunk.byteLength;
		if (!accept || accept(bytes)) target.push(Buffer.from(chunk));
	};
	stdout.on("data", (chunk: Buffer) => take(out, chunk));
	stderr.on("data", (chunk: Buffer) => take(err, chunk));
	return () => ({ stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
}

export function runnerScriptPath(options: DefaultComputeExecutorOptions): string {
	if (options.runnerPath) return resolve(options.runnerPath);
	const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string }).resourcesPath;
	if (resourcesPath) {
		const packaged = resolve(resourcesPath, "compute-runner", "runner.py");
		if (existsSync(packaged)) return packaged;
	}
	return resolve(dirname(fileURLToPath(import.meta.url)), "../../resources/compute-runner/runner.py");
}

export function safeRemoteAbsolutePath(value: string): string {
	if (!value || value.includes("\0")) throw new ComputeTransportError("unsafe-path", "Invalid remote path");
	const normalized = value.replaceAll("\\", "/");
	// SFTP interprets a relative path relative to the remote user's home. This
	// is useful for the default ~/.drone root; configured roots must be absolute.
	if (
		!normalized.startsWith("/") &&
		!normalized.startsWith("~/") &&
		normalized !== ".drone" &&
		!normalized.startsWith(".drone/")
	)
		throw new ComputeTransportError(
			"unsafe-path",
			"Runner deployment root must be absolute or home relative",
		);
	if (normalized.split("/").some((part) => part === ".."))
		throw new ComputeTransportError("unsafe-path", "Runner deployment path contains traversal");
	return normalized;
}

export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
	return new Promise<T>((resolvePromise, rejectPromise) => {
		const timer = setTimeout(() => {
			onTimeout();
			rejectPromise(
				new ComputeTransportError("timeout", `Transport operation exceeded ${timeoutMs}ms`, true),
			);
		}, timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolvePromise(value);
			},
			(error) => {
				clearTimeout(timer);
				rejectPromise(error);
			},
		);
	});
}

export function expandHome(value: string): string {
	return value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

export function writable(stream: Writable): WritableByteChannel {
	return {
		write: async (data) => {
			await new Promise<void>((resolveWrite, rejectWrite) => {
				const callback = (error?: Error | null) => (error ? rejectWrite(error) : resolveWrite());
				if (!stream.write(data, callback)) stream.once("drain", () => callback());
			});
		},
		close: async () => {
			stream.end();
		},
	};
}
