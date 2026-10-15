import { spawn } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ArtifactManifest,
	HostCapability,
	HostProfile,
	JobRecord,
	JobSpec,
	RemoteJobStatus,
	RunnerCommand,
	RunnerTransport,
	ShellChannel,
	TransportExecRequest,
	TransportExecResult,
	WritableByteChannel,
} from "@drone/compute";
import { RunnerClient as ProtocolClient, validateArtifactManifest } from "@drone/compute";
import { type Channel, Client, type ConnectConfig, type Prompt, type SFTPWrapper } from "ssh2";
import type {
	ComputeCollectOptions,
	ComputeExecutor,
	ComputeLogsResult,
	ComputeStatusResult,
	ComputeTerminalSession,
} from "../services/compute";

const MIN_RUNNER_VERSION = "1.0.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_COLLECT_BYTES = 500 * 1024 * 1024;
const DEFAULT_REMOTE_ROOT = ".drone";
const SAFE_HOST_KEY_ALGORITHMS = new Set([
	"ssh-ed25519",
	"ecdsa-sha2-nistp256",
	"ecdsa-sha2-nistp384",
	"ecdsa-sha2-nistp521",
	"rsa-sha2-256",
	"rsa-sha2-512",
]);

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

interface CollectingTransport extends RunnerTransport {
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

class ComputeTransportError extends Error {
	readonly code: string;
	readonly retryable: boolean;

	constructor(code: string, message: string, retryable = false) {
		super(message);
		this.name = "ComputeTransportError";
		this.code = code;
		this.retryable = retryable;
	}
}

class HostConcurrency {
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

function toBuffer(value: string | Uint8Array | undefined): Buffer {
	if (value === undefined) return Buffer.alloc(0);
	return typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function runnerScriptPath(options: DefaultComputeExecutorOptions): string {
	if (options.runnerPath) return resolve(options.runnerPath);
	const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string }).resourcesPath;
	if (resourcesPath) {
		const packaged = resolve(resourcesPath, "compute-runner", "runner.py");
		if (existsSync(packaged)) return packaged;
	}
	return resolve(dirname(fileURLToPath(import.meta.url)), "../../resources/compute-runner/runner.py");
}

function safeRelativePath(value: string): string {
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

function safeRemoteAbsolutePath(value: string): string {
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

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
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

function resolveInside(root: string, child: string): string {
	const resolvedRoot = resolve(root);
	const resolvedChild = resolve(resolvedRoot, child);
	const rel = relative(resolvedRoot, resolvedChild);
	if (rel === "" || rel.startsWith("../") || rel === ".." || isAbsolute(rel))
		throw new ComputeTransportError("unsafe-path", `Path escapes work directory: ${child}`);
	return resolvedChild;
}

function sshKeyAlgorithm(key: Buffer): string {
	if (key.byteLength < 4) return "unknown";
	const size = key.readUInt32BE(0);
	if (size <= 0 || size > key.byteLength - 4) return "unknown";
	return key.subarray(4, 4 + size).toString("ascii");
}

function hostFingerprint(key: Buffer): string {
	return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/u, "")}`;
}

function expandHome(value: string): string {
	return value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

interface SshConfigValues {
	hostName?: string;
	user?: string;
	port?: number;
	identityFile?: string;
	proxyJump?: string[];
}

function globMatches(pattern: string, value: string): boolean {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/gu, "\\$&")
		.replaceAll("*", ".*")
		.replaceAll("?", ".");
	return new RegExp(`^${escaped}$`, "u").test(value);
}

async function readSshConfig(path: string, alias: string): Promise<SshConfigValues> {
	let raw: string;
	try {
		raw = await readFile(expandHome(path), "utf8");
	} catch {
		return {};
	}
	const result: SshConfigValues = {};
	let active = false;
	for (const line of raw.split(/\r?\n/u)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const match = /^([^\s]+)\s+(.*?)\s*$/u.exec(trimmed);
		if (!match) continue;
		const key = match[1];
		const value = match[2];
		if (!key || value === undefined) continue;
		const normalizedKey = key.toLowerCase();
		if (normalizedKey === "host") {
			active = value.split(/\s+/u).some((pattern) => !pattern.startsWith("!") && globMatches(pattern, alias));
			continue;
		}
		if (!active) continue;
		switch (normalizedKey) {
			case "hostname":
				if (!result.hostName) result.hostName = value;
				break;
			case "user":
				if (!result.user) result.user = value;
				break;
			case "port":
				if (!result.port && /^\d+$/u.test(value)) result.port = Number(value);
				break;
			case "identityfile":
				if (!result.identityFile) result.identityFile = expandHome(value.replace(/^"|"$/gu, ""));
				break;
			case "proxyjump":
				if (!result.proxyJump && value !== "none")
					result.proxyJump = value
						.split(",")
						.map((entry) => entry.trim())
						.filter(Boolean);
				break;
		}
	}
	return result;
}

interface KnownHostRecord {
	readonly hosts: readonly string[];
	readonly algorithm: string;
	readonly key: string;
	readonly marker?: string;
}

async function readKnownHosts(path: string): Promise<KnownHostRecord[]> {
	let raw: string;
	try {
		raw = await readFile(expandHome(path), "utf8");
	} catch {
		return [];
	}
	const records: KnownHostRecord[] = [];
	for (const line of raw.split(/\r?\n/u)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continueprivate connectionPromise?: Promise<Client>;
	private disposed = false;
	private readonly policy: HostKeyPolicy;

	constructor(
		private readonly host: HostProfile,
		private readonly options: DefaultComputeExecutorOptions,
		agentDir: string,
		remoteRunnerPath: string,
		private readonly runnerRoot: string,
	) {
		this.runnerPath = remoteRunnerPath;
		this.policy = new HostKeyPolicy(options, agentDir);
	}

	private async effective(profile: HostProfile): Promise<EffectiveHost> {
		const config = await readSshConfig(
			this.options.userSshConfigPath ?? join(homedir(), ".ssh", "config"),
			profile.alias,
		);
		const merged = {
			...profile,
			...(profile.host === profile.alias && config.hostName ? { host: config.hostName } : {}),
			...(profile.port === undefined && config.port ? { port: config.port } : {}),
			...(profile.username === undefined && config.user ? { username: config.user } : {}),
		};
		const identityFile = profile.identityFile ?? config.identityFile;
		if (identityFile) {
			const expanded = resolve(expandHome(identityFile));
			const sshRoot = resolve(join(homedir(), ".ssh"));
			const rel = relative(sshRoot, expanded);
			if (rel.startsWith("../") || isAbsolute(rel))
				throw new ComputeTransportError("unsafe-key-path", "IdentityFile must be inside ~/.ssh");
			return {
				profile: merged,
				identityFile: expanded,
				jumpHosts: profile.jumpHosts ?? config.proxyJump ?? [],
			};
		}
		return { profile: merged, jumpHosts: profile.jumpHosts ?? config.proxyJump ?? [] };
	}

	private async profileFor(alias: string): Promise<HostProfile> {
		const resolved = await this.options.hostResolver?.(alias);
		if (resolved) return resolved;
		const config = await readSshConfig(
			this.options.userSshConfigPath ?? join(homedir(), ".ssh", "config"),
			alias,
		);
		return {
			alias,
			host: config.hostName ?? alias,
			...(config.port ? { port: config.port } : {}),
			...(config.user ? { username: config.user } : {}),
			...(config.identityFile ? { identityFile: config.identityFile } : {}),
			...(config.proxyJump ? { jumpHosts: config.proxyJump } : {}),
		};
	}

	private async connectClient(profile: HostProfile, socket?: NodeJS.ReadableStream): Promise<Client> {
		const effective = await this.effective(profile);
		const credential = await this.options.credentials?.get(effective.profile);
		const config: ConnectConfig = {
			host: effective.profile.host,
			port: effective.profile.port ?? 22,
			username: effective.profile.username,
			readyTimeout: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			keepaliveInterval: 15_000,
			keepaliveCountMax: 3,
			tryKeyboard: Boolean(credential?.keyboardInteractive),
			agentForward: false,
			...(socket ? { sock: socket as any } : {}),
			...(effective.identityFile ? { privateKey: await readFile(effective.identityFile) } : {}),
			...(credential?.privateKey
				? {
						privateKey:
							typeof credential.privateKey === "string"
								? credential.privateKey
								: Buffer.from(credential.privateKey),
					}
				: {}),
			...(credential?.passphrase ? { passphrase: credential.passphrase } : {}),
			...(credential?.password ? { password: credential.password } : {}),
			...(credential?.agent ? { agent: credential.agent } : {}),
			hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
				void this.policy.verify(effective.profile, key).then(verify, () => verify(false));
			},
		};
		const client = new Client();
		return await new Promise<Client>((resolveClient, rejectClient) => {
			let settled = false;
			const fail = (error: Error) => {
				if (!settled) {
					settled = true;
					rejectClient(error);
				}
			};
			client.once("ready", () => {
				if (!settled) {
					settled = true;
					resolveClient(client);
				}
			});
			client.once("error", fail);
			client.connect(config);
			const keyboardInteractive = credential?.keyboardInteractive;
			if (keyboardInteractive)
				client.on(
					"keyboard-interactive",
					(name: string, instructions: string, _lang: string, prompts: Prompt[], finish) => {
						void keyboardInteractive(
							name,
							instructions,
							prompts.map((prompt) => prompt.prompt),
						).then(
							(answer) => finish(answer.map(String)),
							() => finish([]),
						);
					},
				);
		});
	}

	private async connect(): Promise<Client> {
		if (this.disposed) throw new ComputeTransportError("disposed", "SSH transport is disposed");
		const current = this.clients.at(-1);
		if (current) return current;
		if (this.connectionPromise) return this.connectionPromise;
		this.connectionPromise = (async () => {
			const effective = await this.effective(this.host);
			const chain = [...effective.jumpHosts, this.host.alias];
			let socket: NodeJS.ReadableStream | undefined;
			for (let index = 0; index < chain.length; index += 1) {
				const alias = chain[index];
				if (!alias) throw new ComputeTransportError("invalid-jump", "SSH jump chain contains an empty alias");
				const profile = await this.profileFor(alias);
				const client = await this.connectClient(profile, socket);
				this.clients.push(client);
				client.once("close", () => this.resetConnection(client));
				if (index < chain.length - 1) {
					const nextAlias = chain[index + 1];
					if (!nextAlias)
						throw new ComputeTransportError("invalid-jump", "SSH jump chain contains an empty alias");
					const next = await this.effective(await this.profileFor(nextAlias));
					socket = await new Promise<NodeJS.ReadableStream>((resolveSocket, rejectSocket) =>
						client.forwardOut("127.0.0.1", 0, next.profile.host, next.profile.port ?? 22, (error, channel) =>
							error ? rejectSocket(error) : resolveSocket(channel),
						),
					);
				}
			}
			const connected = this.clients.at(-1);
			if (!connected)
				throw new ComputeTransportError("connect-failed", "SSH connection did not produce a client", true);
			return connected;
		})().catch((error) => {
			this.connectionPromise = undefined;
			for (const client of this.clients.splice(0)) client.end();
			throw error;
		});
		return this.connectionPromise;
	}

	private resetConnection(_client: Client): void {
		// A final-hop disconnect invalidates every forwarded socket in the chain.
		// Drop all clients so the next operation establishes a fresh chain.
		for (const client of this.clients) {
			if (client !== _client) client.end();
		}
		this.clients = [];
		this.connectionPromise = undefined;
	}

	async runRunner(
		command: RunnerCommand,
		input: string,
		timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	): Promise<TransportExecResult> {
		return await this.exec({
			argv: ["env", `DRONE_REMOTE_ROOT=${this.runnerRoot}`, "python3", this.runnerPath, command],
			stdin: input,
			timeoutMs,
		});
	}

	async exec(request: TransportExecRequest): Promise<TransportExecResult> {
		const client = await this.connect();
		const command = request.argv.map(shellQuote).join(" ");
		return await withTimeout(
			new Promise<TransportExecResult>((resolveResult, rejectResult) => {
				let finished = false;
				const fail = (error: Error) => {
					if (!finished) {
						finished = true;
						rejectResult(error);
					}
				};
				client.exec(command, (error, channel) => {
					if (error) return fail(error);
					const stdout: Buffer[] = [];
					const stderr: Buffer[] = [];
					let size = 0;
					const take = (target: Buffer[], chunk: Buffer) => {
						size += chunk.byteLength;
						if (size > (this.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)) {
							channel.destroy();
							fail(new ComputeTransportError("output-limit", "SSH response exceeds limit"));
						} else target.push(Buffer.from(chunk));
					};
					channel.on("data", (chunk: Buffer) => take(stdout, chunk));
					channel.stderr.on("data", (chunk: Buffer) => take(stderr, chunk));
					channel.once("error", fail);
					channel.once("close", (code: number | undefined) => {
						if (!finished) {
							finished = true;
							resolveResult({
								exitCode: code ?? 0,
								stdout: Buffer.concat(stdout),
								stderr: Buffer.concat(stderr),
							});
						}
					});
					channel.end(request.stdin === undefined ? undefined : toBuffer(request.stdin));
				});
			}),
			request.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			() => client.end(),
		);
	}

	private async sftp(): Promise<SFTPWrapper> {
		const client = await this.connect();
		return await new Promise<SFTPWrapper>((resolveSftp, rejectSftp) =>
			client.sftp((error, value) => (error ? rejectSftp(error) : resolveSftp(value))),
		);
	}

	private async mkdirp(sftp: SFTPWrapper, path: string): Promise<void> {
		const parts = path.replaceAll("\\", "/").split("/");
		let current = path.startsWith("/") ? "/" : "";
		for (const part of parts) {
			if (!part) continue;
			current = current ? `${current}/${part}` : part;
			await new Promise<void>((resolveMkdir, rejectMkdir) => {
				sftp.mkdir(current, (error) => {
					if (!error) return resolveMkdir();
					sftp.stat(current, (statError) => (statError ? rejectMkdir(error) : resolveMkdir()));
				});
			});
		}
	}

	async upload(request: {
		source: Uint8Array | string;
		destination: string;
		maxBytes?: number;
	}): Promise<void> {
		const destination = safeRemoteAbsolutePath(request.destination);
		const data =
			typeof request.source === "string" ? await readFile(request.source) : Buffer.from(request.source);
		if (data.byteLength > (request.maxBytes ?? this.options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES))
			throw new ComputeTransportError("upload-limit", "Upload exceeds limit");
		const sftp = await this.sftp();
		await this.mkdirp(sftp, dirname(destination));
		await new Promise<void>((resolveWrite, rejectWrite) => {
			const stream = sftp.createWriteStream(destination, { mode: 0o700 });
			stream.once("error", rejectWrite);
			stream.once("close", () => resolveWrite());
			stream.end(data);
		});
	}

	async download(request: { source: string; destination?: string; maxBytes?: number }): Promiseifest, {
			maxTotalBytes: maxBytes,
			expected: options?.expected?.map((path) => ({ path })),
		});
		if (!validation.valid) throw new ComputeTransportError("invalid-manifest", validation.errors.join("; "));
		if (options) {
			const targetRoot = resolve(options.targetDir);
			await mkdir(targetRoot, { recursive: true });
			for (const entry of value.manifest.entries) {
				const path = safeRelativePath(entry.path);
				const root = this.remoteRoot(host);
				const source =
					transport instanceof LocalRunnerTransport
						? path
						: `${root}/runs/${job.remoteId ?? job.jobId}/outputs/${path}`.replace(/\/+/gu, "/");
				const data = await transport.download({ source, maxBytes: entry.bytes ?? entry.size ?? maxBytes });
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
				await writeFile(target, data, { flag: "wx", mode: 0o600 }).catch(
					async (error: NodeJS.ErrnoException) => {
						if (error.code !== "EEXIST") throw error;
						await writeFile(target, data, { mode: 0o600 });
					},
				);
			}
		}
		return { manifest: value.manifest };
	}

	async listWorkflowModules() {
		return [] as const;
	}

	async openTerminal(
		host: HostProfile,
		input: { cwd?: string; mode?: "shell" | "command" },
	): Promise<ComputeTerminalSession> {
		const channel = await (await this.transport(host)).openShell();
		const handlers = new Set<(text: string) => void>();
		const id = randomUUID();
		let closed = false;
		const consume = async (stream: AsyncIterable<Uint8Array>) => {
			const decoder = new TextDecoder();
			try {
				for await (const chunk of stream) {
					const text = decoder.decode(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk), {
						stream: true,
					});
					for (const handler of handlers) handler(text);
				}
				const tail = decoder.decode();
				if (tail) for (const handler of handlers) handler(tail);
			} catch {
				/* closed terminal */
			}
		};
		void Promise.all([consume(channel.stdout), consume(channel.stderr)]);
		if (input.cwd) await channel.stdin.write(`cd ${shellQuote(input.cwd)}\n`);
		return {
			id,
			hostAlias: host.alias,
			cwd: input.cwd ?? ".",
			mode: input.mode ?? "shell",
			write: async (value) => {
				if (!closed) await channel.stdin.write(value);
			},
			close: async () => {
				if (!closed) {
					closed = true;
					await channel.close();
				}
			},
			onOutput: (handler) => {
				handlers.add(handler);
				return () => handlers.delete(handler);
			},
		};
	}

	async dispose(): Promise<void> {
		for (const transport of this.transports.values()) await transport.close?.();
		this.transports.clear();
	}
}

export function createDefaultComputeExecutor(options: DefaultComputeExecutorOptions = {}): ComputeExecutor {
	return new DefaultComputeExecutor(options);
}
