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
		if (!trimmed || trimmed.startsWith("#")) continue;
		const fields = trimmed.split(/\s+/u);
		const offset = fields[0]?.startsWith("@") ? 1 : 0;
		if (fields.length < offset + 3) continue;
		const [hosts, algorithm, key] = fields.slice(offset, offset + 3);
		if (hosts && algorithm && key)
			records.push({ hosts: hosts.split(","), algorithm, key, ...(offset ? { marker: fields[0] } : {}) });
	}
	return records;
}

function hashedHostMatches(token: string, host: string): boolean {
	const match = /^\|1\|([^|]+)\|([^|]+)$/u.exec(token);
	if (!match) return false;
	try {
		const saltText = match[1];
		const expectedText = match[2];
		if (!saltText || !expectedText) return false;
		const salt = Buffer.from(saltText, "base64");
		const expected = Buffer.from(expectedText, "base64");
		const actual = createHmac("sha1", salt).update(host).digest();
		return actual.byteLength === expected.byteLength && actual.equals(expected);
	} catch {
		return false;
	}
}

function knownHostMatches(token: string, host: string, port: number): boolean {
	if (token.startsWith("|1|")) return hashedHostMatches(token, host);
	return globMatches(token, host) || token === `[${host}]:${port}` || (port === 22 && token === host);
}

class HostKeyPolicy {
	private writeLock: Promise<void> = Promise.resolve();
	constructor(
		private readonly options: DefaultComputeExecutorOptions,
		private readonly agentDir: string,
	) {}

	private get dronePath(): string {
		return expandHome(this.options.knownHostsPath ?? join(this.agentDir, "compute", "known_hosts"));
	}

	async verify(host: HostProfile, key: Buffer): Promise<boolean> {
		const algorithm = sshKeyAlgorithm(key);
		if (!SAFE_HOST_KEY_ALGORITHMS.has(algorithm))
			throw new ComputeTransportError(
				"host-key-algorithm",
				`Host key algorithm is not allowed: ${algorithm}`,
			);
		const encoded = key.toString("base64");
		const actual = hostFingerprint(key);
		if (host.hostKeyFingerprint && host.hostKeyFingerprint !== actual)
			throw new ComputeTransportError("host-key-changed", `Host key fingerprint changed for ${host.alias}`);
		const port = host.port ?? 22;
		const names = [host.host, host.alias];
		const records = [
			...(await readKnownHosts(join(homedir(), ".ssh", "known_hosts"))),
			...(await readKnownHosts(this.dronePath)),
		];
		const matches = records.filter((record) =>
			record.hosts.some((token) => names.some((name) => knownHostMatches(token, name, port))),
		);
		if (matches.some((record) => record.marker === "@revoked" && record.key === encoded))
			throw new ComputeTransportError("host-key-revoked", `Host key is revoked for ${host.alias}`);
		if (matches.length) {
			if (matches.some((record) => record.key === encoded)) return true;
			throw new ComputeTransportError("host-key-changed", `Host key changed for ${host.alias}`);
		}
		if (!this.options.onUnknownHostKey)
			throw new ComputeTransportError("unknown-host-key", `Unknown host key for ${host.alias}`);
		if (
			!(await this.options.onUnknownHostKey({
				alias: host.alias,
				host: host.host,
				port,
				algorithm,
				fingerprint: actual,
				knownHostsPath: this.dronePath,
			}))
		)
			throw new ComputeTransportError(
				"unknown-host-key-rejected",
				`Host key was not accepted for ${host.alias}`,
			);
		await this.persist(host, port, algorithm, encoded);
		return true;
	}

	private async persist(host: HostProfile, port: number, algorithm: string, encoded: string): Promise<void> {
		this.writeLock = this.writeLock.then(async () => {
			const path = this.dronePath;
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			let existing = "";
			try {
				existing = await readFile(path, "utf8");
			} catch {
				/* first pin */
			}
			const marker = port === 22 ? host.host : `[${host.host}]:${port}`;
			if (
				!existing.split(/\r?\n/u).some((line) => line.split(/\s+/u)[0] === marker && line.includes(encoded))
			)
				await writeFile(
					path,
					`${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${marker} ${algorithm} ${encoded}\n`,
					{ mode: 0o600 },
				);
		});
		await this.writeLock;
	}
}

function writable(stream: NodeJS.WritableStream): WritableByteChannel {
	return {
		write: async (data) => {
			await new Promise<void>((resolveWrite, rejectWrite) => {
				const callback = (error?: Error | null) => (error ? rejectWrite(error) : resolveWrite());
				const writableStream = stream as NodeJS.WritableStream & {
					write(chunk: Uint8Array | string, callback?: (error?: Error | null) => void): boolean;
				};
				const accepted = writableStream.write(data, callback);
				if (!accepted) stream.once("drain", () => callback());
			});
		},
		close: async () => {
			stream.end();
		},
	};
}

async function* emptyBytes(): AsyncIterable<Uint8Array> {
	// Keeps terminal consumers uniform when an SSH shell has no stderr stream.
}

class LocalRunnerTransport implements CollectingTransport {
	readonly runnerPath: string;
	private readonly jobs = new Map<string, { workDir: string }>();
	private disposed = false;

	constructor(
		private readonly script: string,
		private readonly python: string,
		private readonly timeoutMs: number,
		private readonly maxResponseBytes: number,
		private readonly maxUploadBytes: number,
		private readonly remoteRoot: string,
	) {
		this.runnerPath = script;
	}

	async runRunner(
		command: RunnerCommand,
		input: string,
		timeoutMs = this.timeoutMs,
	): Promise<TransportExecResult> {
		if (this.disposed) throw new ComputeTransportError("disposed", "Local runner transport is disposed");
		return await this.spawnProcess([this.script, command], input, timeoutMs);
	}

	async exec(request: TransportExecRequest): Promise<TransportExecResult> {
		const [script, command] = request.argv;
		if (!script || !command)
			throw new ComputeTransportError("invalid-command", "Runner command is incomplete");
		return await this.spawnProcess([script, command], request.stdin, request.timeoutMs ?? this.timeoutMs);
	}

	private async spawnProcess(
		args: readonly string[],
		input: string | Uint8Array | undefined,
		timeoutMs: number,
	): Promise<TransportExecResult> {
		const child = spawn(this.python, args, {
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
			env: { ...process.env, DRONE_REMOTE_ROOT: this.remoteRoot },
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let total = 0;
		let limitError: Error | undefined;
		const take = (target: Buffer[], chunk: Buffer) => {
			if (limitError) return;
			total += chunk.byteLength;
			if (total > this.maxResponseBytes) {
				limitError = new ComputeTransportError("output-limit", "Runner output exceeds the response limit");
				child.kill("SIGKILL");
				return;
			}
			target.push(Buffer.from(chunk));
		};
		child.stdout.on("data", (chunk: Buffer) => take(stdout, chunk));
		child.stderr.on("data", (chunk: Buffer) => take(stderr, Buffer.from(chunk)));
		child.stdin.end(input === undefined ? undefined : toBuffer(input));
		return await withTimeout(
			new Promise<TransportExecResult>((resolveResult, rejectResult) => {
				child.once("error", rejectResult);
				child.once("close", (code, signal) => {
					if (limitError) return rejectResult(limitError);
					if (signal)
						return rejectResult(
							new ComputeTransportError("process-signal", `Runner terminated by ${signal}`, true),
						);
					resolveResult({
						exitCode: code ?? 1,
						stdout: Buffer.concat(stdout),
						stderr: Buffer.concat(stderr),
					});
				});
			}),
			timeoutMs,
			() => child.kill("SIGKILL"),
		);
	}

	async upload(request: {
		source: Uint8Array | string;
		destination: string;
		maxBytes?: number;
	}): Promise<void> {
		const destination = resolve(request.destination);
		const data =
			typeof request.source === "string" ? await readFile(request.source) : Buffer.from(request.source);
		if (data.byteLength > (request.maxBytes ?? this.maxUploadBytes))
			throw new ComputeTransportError("upload-limit", "Upload exceeds limit");
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, data, { mode: 0o600 });
	}

	async download(request: { source: string; destination?: string; maxBytes?: number }): Promise<Uint8Array> {
		const path = safeRelativePath(request.source);
		for (const { workDir } of this.jobs.values()) {
			const candidate = resolveInside(workDir, path);
			try {
				const info = await lstat(candidate);
				if (!info.isFile() || info.isSymbolicLink())
					throw new ComputeTransportError("unsafe-artifact", `Artifact is not a regular file: ${path}`);
				if (request.maxBytes !== undefined && info.size > request.maxBytes)
					throw new ComputeTransportError("download-limit", "Download exceeds limit");
				const data = await readFile(candidate);
				if (request.destination) await writeFile(resolve(request.destination), data);
				return data;
			} catch (error) {
				if (error instanceof ComputeTransportError) throw error;
			}
		}
		throw new ComputeTransportError("not-found", `Runner artifact not found: ${path}`);
	}

	async openShell(): Promise<ShellChannel> {
		const child = spawn(process.env.SHELL ?? "/bin/sh", [], {
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
		});
		return {
			stdin: writable(child.stdin),
			stdout: child.stdout as unknown as AsyncIterable<Uint8Array>,
			stderr: child.stderr as unknown as AsyncIterable<Uint8Array>,
			close: async () => {
				if (!child.killed) child.kill();
			},
		};
	}

	remember(spec: JobSpec): void {
		// runner.py owns the durable run location. Keep the same root it receives
		// through the environment instead of trusting the caller's workDir field.
		this.jobs.set(spec.jobId, { workDir: resolve(this.remoteRoot, "runs", spec.jobId, "outputs") });
	}
	async close(): Promise<void> {
		this.disposed = true;
	}
}

interface EffectiveHost {
	readonly profile: HostProfile;
	readonly identityFile?: string;
	readonly jumpHosts: readonly string[];
}

class Ssh2RunnerTransport implements CollectingTransport {
	readonly runnerPath: string;
	private clients: Client[] = [];
	private connectionPromise?: Promise<Client>;
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

	async download(request: { source: string; destination?: string; maxBytes?: number }): Promise<Uint8Array> {
		const source = safeRemoteAbsolutePath(request.source);
		const sftp = await this.sftp();
		const data = await new Promise<Buffer>((resolveData, rejectData) => {
			const chunks: Buffer[] = [];
			let size = 0;
			const stream = sftp.createReadStream(source);
			stream.on("data", (chunk: Buffer) => {
				size += chunk.byteLength;
				if (request.maxBytes !== undefined && size > request.maxBytes)
					stream.destroy(new ComputeTransportError("download-limit", "Download exceeds limit"));
				else chunks.push(Buffer.from(chunk));
			});
			stream.once("error", rejectData);
			stream.once("end", () => resolveData(Buffer.concat(chunks)));
		});
		if (request.destination) await writeFile(resolve(request.destination), data);
		return data;
	}

	async openShell(): Promise<ShellChannel> {
		const client = await this.connect();
		const channel = await new Promise<Channel>((resolveChannel, rejectChannel) =>
			client.shell((error, value) => (error ? rejectChannel(error) : resolveChannel(value))),
		);
		const stderr = (channel as Channel & { stderr?: AsyncIterable<Uint8Array> }).stderr ?? emptyBytes();
		return {
			stdin: writable(channel),
			stdout: channel as unknown as AsyncIterable<Uint8Array>,
			stderr,
			close: async () => channel.close(),
		};
	}

	async close(): Promise<void> {
		this.disposed = true;
		this.connectionPromise = undefined;
		for (const client of this.clients.splice(0).reverse()) client.end();
	}
}

/**
 * OpenSSH is deliberately a separate fallback. It is useful for ProxyCommand,
 * GSSAPI and certificate configurations that ssh2 cannot represent. BatchMode
 * and strict host checking make this path non-interactive by construction.
 */
class OpenSshRunnerTransport implements CollectingTransport {
	readonly runnerPath: string;
	private disposed = false;
	private checkedHostKey = false;
	private readonly policy: HostKeyPolicy;

	constructor(
		private readonly host: HostProfile,
		private readonly options: DefaultComputeExecutorOptions,
		private readonly agentDir: string,
		remoteRunnerPath: string,
		private readonly runnerRoot: string,
	) {
		this.runnerPath = remoteRunnerPath;
		this.policy = new HostKeyPolicy(options, agentDir);
	}

	private sshArgs(): string[] {
		const userHost = `${this.host.username ? `${this.host.username}@` : ""}${this.host.host}`;
		const userKnownHosts = join(homedir(), ".ssh", "known_hosts");
		const droneKnownHosts = this.options.knownHostsPath ?? join(this.agentDir, "compute", "known_hosts");
		const args = [
			"-o",
			"BatchMode=yes",
			"-o",
			"StrictHostKeyChecking=yes",
			"-o",
			`UserKnownHostsFile=${userKnownHosts},${droneKnownHosts}`,
			"-o",
			"ForwardAgent=no",
		];
		if (this.host.port) args.push("-p", String(this.host.port));
		if (this.host.identityFile) {
			const identity = resolve(expandHome(this.host.identityFile));
			const rel = relative(resolve(join(homedir(), ".ssh")), identity);
			if (rel.startsWith("../") || isAbsolute(rel))
				throw new ComputeTransportError("unsafe-key-path", "IdentityFile must be inside ~/.ssh");
			args.push("-i", identity);
		}
		if (this.host.jumpHosts?.length) args.push("-J", this.host.jumpHosts.join(","));
		args.push(userHost);
		return args;
	}

	private async run(
		argv: readonly string[],
		input: Uint8Array | string | undefined,
		timeoutMs: number,
	): Promise<TransportExecResult> {
		if (this.disposed) throw new ComputeTransportError("disposed", "OpenSSH transport is disposed");
		await this.ensureHostKey();
		const child = spawn("ssh", argv, { stdio: ["pipe", "pipe", "pipe"], shell: false });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let total = 0;
		let limitError: Error | undefined;
		const take = (target: Buffer[], chunk: Buffer) => {
			total += chunk.byteLength;
			if (total > (this.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)) {
				limitError = new ComputeTransportError("output-limit", "OpenSSH response exceeds limit");
				child.kill("SIGKILL");
			} else target.push(Buffer.from(chunk));
		};
		child.stdout.on("data", (chunk: Buffer) => take(stdout, chunk));
		child.stderr.on("data", (chunk: Buffer) => take(stderr, Buffer.from(chunk)));
		child.stdin.end(input === undefined ? undefined : toBuffer(input));
		return await withTimeout(
			new Promise<TransportExecResult>((resolveResult, rejectResult) => {
				child.once("error", rejectResult);
				child.once("close", (code, signal) => {
					if (limitError) return rejectResult(limitError);
					if (signal)
						return rejectResult(
							new ComputeTransportError("process-signal", `OpenSSH terminated by ${signal}`, true),
						);
					resolveResult({
						exitCode: code ?? 1,
						stdout: Buffer.concat(stdout),
						stderr: Buffer.concat(stderr),
					});
				});
			}),
			timeoutMs,
			() => child.kill("SIGKILL"),
		);
	}

	private async ensureHostKey(): Promise<void> {
		if (this.checkedHostKey) return;
		const args = ["-p", String(this.host.port ?? 22), "-T", "5", this.host.host];
		const scan = spawn("ssh-keyscan", args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		scan.stdout.on("data", (chunk: Buffer) => out.push(Buffer.from(chunk)));
		scan.stderr.on("data", (chunk: Buffer) => err.push(Buffer.from(chunk)));
		const result = await withTimeout(
			new Promise<{ code: number | null }>((resolveScan, rejectScan) => {
				scan.once("error", rejectScan);
				scan.once("close", (code) => resolveScan({ code }));
			}),
			this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			() => scan.kill("SIGKILL"),
		);
		if (result.code !== 0 || out.length === 0)
			throw new ComputeTransportError(
				"host-key-scan",
				Buffer.concat(err).toString("utf8") || "ssh-keyscan failed",
				true,
			);
		const line = Buffer.concat(out)
			.toString("utf8")
			.split(/\r?\n/u)
			.map((value) => value.trim())
			.find((value) => value && !value.startsWith("#"));
		const fields = line?.split(/\s+/u);
		if (!fields || fields.length < 3)
			throw new ComputeTransportError("host-key-scan", "ssh-keyscan returned no host key");
		const encodedKey = fields[2];
		if (!encodedKey)
			throw new ComputeTransportError("host-key-scan", "ssh-keyscan returned an empty host key");
		const key = Buffer.from(encodedKey, "base64");
		await this.policy.verify(this.host, key);
		this.checkedHostKey = true;
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
		const command = request.argv.map(shellQuote).join(" ");
		return await this.run(
			[...this.sshArgs(), command],
			request.stdin,
			request.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
	}

	async upload(request: {
		source: Uint8Array | string;
		destination: string;
		maxBytes?: number;
	}): Promise<void> {
		const destination = safeRemoteAbsolutePath(request.destination);
		const data =
			typeof request.source === "string" ? await readFile(request.source) : Buffer.from(request.source);
		const maxBytes = request.maxBytes ?? this.options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
		if (data.byteLength > maxBytes) throw new ComputeTransportError("upload-limit", "Upload exceeds limit");
		const command = `mkdir -p -- ${shellQuote(dirname(destination))} && base64 -d > ${shellQuote(destination)}`;
		const encoded = data.toString("base64");
		const result = await this.run(
			[...this.sshArgs(), command],
			encoded,
			this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
		if (result.exitCode !== 0)
			throw new ComputeTransportError(
				"upload-failed",
				Buffer.from(result.stderr).toString("utf8") || "OpenSSH upload failed",
				true,
			);
	}

	async download(request: { source: string; destination?: string; maxBytes?: number }): Promise<Uint8Array> {
		const source = safeRemoteAbsolutePath(request.source);
		const result = await this.run(
			[...this.sshArgs(), `cat -- ${shellQuote(source)}`],
			undefined,
			this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
		if (result.exitCode !== 0)
			throw new ComputeTransportError(
				"download-failed",
				Buffer.from(result.stderr).toString("utf8") || "OpenSSH download failed",
				true,
			);
		const output = Buffer.from(result.stdout);
		if (request.maxBytes !== undefined && output.byteLength > request.maxBytes)
			throw new ComputeTransportError("download-limit", "Download exceeds limit");
		if (request.destination) await writeFile(resolve(request.destination), output);
		return output;
	}

	async openShell(): Promise<ShellChannel> {
		const child = spawn("ssh", this.sshArgs(), { stdio: ["pipe", "pipe", "pipe"], shell: false });
		return {
			stdin: writable(child.stdin),
			stdout: child.stdout as unknown as AsyncIterable<Uint8Array>,
			stderr: child.stderr as unknown as AsyncIterable<Uint8Array>,
			close: async () => {
				if (!child.killed) child.kill();
			},
		};
	}

	async close(): Promise<void> {
		this.disposed = true;
	}
}

export class DefaultComputeExecutor implements ComputeExecutor {
	private readonly transports = new Map<string, CollectingTransport>();
	private readonly transportPromises = new Map<string, Promise<CollectingTransport>>();
	private readonly concurrency = new Map<string, HostConcurrency>();
	private readonly agentDir: string;

	constructor(private readonly options: DefaultComputeExecutorOptions = {}) {
		this.agentDir = expandHome(options.agentDir ?? join(homedir(), ".pi", "agent"));
	}

	private remoteRoot(host: HostProfile): string {
		const configured =
			typeof this.options.runnerRemoteRoot === "function"
				? this.options.runnerRemoteRoot(host)
				: this.options.runnerRemoteRoot;
		const extra = host as HostProfile & { readonly runnerRemoteRoot?: string };
		return safeRemoteAbsolutePath(configured ?? extra.runnerRemoteRoot ?? DEFAULT_REMOTE_ROOT);
	}

	private async deployRunner(host: HostProfile, transport: CollectingTransport): Promise<string> {
		const script = runnerScriptPath(this.options);
		await access(script, fsConstants.R_OK);
		const source = await readFile(script);
		const digest = sha256(source);
		const remote = `${this.remoteRoot(host)}/runner/${digest}/runner.py`;
		try {
			if (sha256(await transport.download({ source: remote, maxBytes: source.byteLength + 1 })) === digest)
				return remote;
		} catch {
			/* missing or stale runner */
		}
		await transport.upload({
			source,
			destination: remote,
			maxBytes: this.options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
		});
		if (sha256(await transport.download({ source: remote, maxBytes: source.byteLength + 1 })) !== digest)
			throw new ComputeTransportError("runner-checksum", "Remote runner checksum verification failed");
		return remote;
	}

	private async transport(host: HostProfile): Promise<CollectingTransport> {
		const existing = this.transports.get(host.alias);
		if (existing) return existing;
		const pending = this.transportPromises.get(host.alias);
		if (pending) return pending;
		const creation = this.createTransport(host);
		this.transportPromises.set(host.alias, creation);
		try {
			return await creation;
		} finally {
			this.transportPromises.delete(host.alias);
		}
	}

	private async createTransport(host: HostProfile): Promise<CollectingTransport> {
		if (host.host === "local" || host.alias === "local") {
			const configuredRoot =
				typeof this.options.runnerRemoteRoot === "function"
					? this.options.runnerRemoteRoot(host)
					: this.options.runnerRemoteRoot;
			const localRoot = expandHome(
				configuredRoot ?? process.env.DRONE_REMOTE_ROOT ?? join(homedir(), ".drone"),
			);
			const local = new LocalRunnerTransport(
				runnerScriptPath(this.options),
				this.options.pythonPath ?? "python3",
				this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
				this.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
				this.options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
				localRoot,
			);
			this.transports.set(host.alias, local);
			return local;
		}
		const provisional =
			host.transport === "openssh"
				? new OpenSshRunnerTransport(
						host,
						this.options,
						this.agentDir,
						`${DEFAULT_REMOTE_ROOT}/runner/pending/runner.py`,
						this.remoteRoot(host),
					)
				: new Ssh2RunnerTransport(
						host,
						this.options,
						this.agentDir,
						`${DEFAULT_REMOTE_ROOT}/runner/pending/runner.py`,
						this.remoteRoot(host),
					);
		const deployed = await this.deployRunner(host, provisional);
		await provisional.close();
		const ssh =
			host.transport === "openssh"
				? new OpenSshRunnerTransport(host, this.options, this.agentDir, deployed, this.remoteRoot(host))
				: new Ssh2RunnerTransport(host, this.options, this.agentDir, deployed, this.remoteRoot(host));
		this.transports.set(host.alias, ssh);
		return ssh;
	}

	private async limited<T>(host: HostProfile, operation: () => Promise<T>): Promise<T> {
		let limiter = this.concurrency.get(host.alias);
		if (!limiter) {
			limiter = new HostConcurrency();
			this.concurrency.set(host.alias, limiter);
		}
		return await limiter.run(operation);
	}

	private async client(
		host: HostProfile,
	): Promise<{ transport: CollectingTransport; client: ProtocolClient }> {
		const transport = await this.transport(host);
		return {
			transport,
			client: new ProtocolClient(transport, {
				runnerPath: transport.runnerPath ?? "drone-runner",
				minRunnerVersion: MIN_RUNNER_VERSION,
				timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			}),
		};
	}

	async probeHost(host: HostProfile): Promise<HostCapability> {
		return await this.limited(host, async () => {
			const { client } = await this.client(host);
			const negotiation = await client.negotiate();
			return {
				alias: host.alias,
				runnerVersion: negotiation.version.runnerVersion,
				protocolVersion: negotiation.version.protocolVersion,
				scheduler: negotiation.capabilities.scheduler,
				containerRuntime: negotiation.capabilities.containerRuntime,
				nextflowVersion: negotiation.capabilities.nextflowVersion,
				maxCollectBytes: negotiation.capabilities.maxCollectBytes,
				probedAt: Date.now(),
			};
		});
	}

	async submit(
		spec: JobSpec,
		host: HostProfile,
	): Promise<{ remoteId?: string; status?: JobRecord["status"] }> {
		return await this.limited(host, async () => {
			const { client, transport } = await this.client(host);
			if (transport instanceof LocalRunnerTransport) transport.remember(spec);
			await client.negotiate();
			await client.prepare(spec);
			const started = (await client.start(spec)) as { status?: JobRecord["status"]; remoteId?: string };
			return { remoteId: started.remoteId ?? spec.jobId, status: started.status ?? "queued" };
		});
	}

	async status(job: JobRecord, host: HostProfile): Promise<ComputeStatusResult> {
		return await this.limited(host, async () => {
			const { client } = await this.client(host);
			const value = (await client.status(job.remoteId ?? job.jobId)) as RemoteJobStatus;
			return {
				status: value.state ?? "unknown",
				remoteId: value.remoteId ?? job.remoteId,
				...(value.pid ? { pid: value.pid } : {}),
				...(value.message ? { error: value.message } : {}),
			};
		});
	}

	async logs(job: JobRecord, host: HostProfile, cursor?: string): Promise<ComputeLogsResult> {
		return await this.limited(host, async () => {
			const { client } = await this.client(host);
			const value = (await client.logs(job.remoteId ?? job.jobId, cursor)) as {
				events?: ComputeLogsResult["events"];
				cursor?: string;
			};
			return { events: value.events ?? [], cursor: value.cursor };
		});
	}

	async cancel(job: JobRecord, host: HostProfile): Promise<ComputeStatusResult> {
		return await this.limited(host, async () => {
			const { client } = await this.client(host);
			const value = (await client.cancel(job.remoteId ?? job.jobId)) as {
				status?: JobRecord["status"];
				remoteId?: string;
			};
			return { status: value.status ?? "cancelled", remoteId: value.remoteId ?? job.remoteId };
		});
	}

	async collect(
		job: JobRecord,
		host: HostProfile,
		options?: ComputeCollectOptions,
	): Promise<{ manifest: ArtifactManifest }> {
		const { client, transport } = await this.client(host);
		const maxBytes = options?.maxBytes ?? this.options.maxCollectBytes ?? DEFAULT_MAX_COLLECT_BYTES;
		const expected = options?.expected?.map((path) => ({ path }));
		const value = (await this.limited(host, () =>
			client.execute(
				"collect",
				{ maxBytes, ...(expected ? { manifest: expected } : {}) },
				job.remoteId ?? job.jobId,
			),
		)) as { manifest?: ArtifactManifest };
		if (value.manifest?.version !== 1)
			throw new ComputeTransportError("invalid-manifest", "Runner returned no v1 artifact manifest");
		const seen = new Set<string>();
		let manifestBytes = 0;
		for (const entry of value.manifest.entries) {
			const path = safeRelativePath(entry.path);
			if (seen.has(path))
				throw new ComputeTransportError("invalid-manifest", `Duplicate artifact path: ${path}`);
			seen.add(path);
			if (entry.kind && entry.kind !== "file")
				throw new ComputeTransportError("unsafe-artifact", `Non-file artifact is not allowed: ${path}`);
			if (entry.symlink)
				throw new ComputeTransportError("unsafe-artifact", `Symlink artifact is not allowed: ${path}`);
			if (entry.bytes !== undefined && entry.size !== undefined && entry.bytes !== entry.size)
				throw new ComputeTransportError("invalid-manifest", `Artifact size fields disagree: ${path}`);
			manifestBytes += entry.bytes ?? entry.size ?? 0;
		}
		if (value.manifest.totalBytes !== undefined && value.manifest.totalBytes !== manifestBytes)
			throw new ComputeTransportError("invalid-manifest", "Manifest totalBytes does not match entries");
		const validation = validateArtifactManifest(value.manifest, {
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
