import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
	HostProfile,
	JobSpec,
	RunnerCommand,
	ShellChannel,
	TransportExecRequest,
	TransportExecResult,
} from "@drone/compute";
import { ComputeTransportError, resolveInside, safeRelativePath } from "./compute-operation-lifetime";
import {
	type CollectingTransport,
	captureOutput,
	DEFAULT_MAX_RESPONSE_BYTES,
	DEFAULT_MAX_UPLOAD_BYTES,
	DEFAULT_TIMEOUT_MS,
	type DefaultComputeExecutorOptions,
	readUpload,
	safeRemoteAbsolutePath,
	shellQuote,
	toBuffer,
	withTimeout,
	writable,
} from "./runner-helpers";
import { HostKeyPolicy, resolveIdentityFile, sshLines } from "./ssh-host-config";

function processShell(child: ChildProcessWithoutNullStreams): ShellChannel {
	return {
		stdin: writable(child.stdin),
		stdout: child.stdout,
		stderr: child.stderr,
		close: async () => {
			if (!child.killed) child.kill();
		},
	};
}

function collectProcess(
	child: ChildProcessWithoutNullStreams,
	input: string | Uint8Array | undefined,
	timeoutMs: number,
	label: string,
	getLimit: () => number,
	limitMessage: string,
	stopOnLimit = false,
): Promise<TransportExecResult> {
	let limitError: Error | undefined;
	const output = captureOutput(child.stdout, child.stderr, (bytes) => {
		if (stopOnLimit && limitError) return false;
		if (!(bytes > getLimit())) return true;
		limitError = new ComputeTransportError("output-limit", limitMessage);
		child.kill("SIGKILL");
		return false;
	});
	child.stdin.end(input === undefined ? undefined : toBuffer(input));
	return withTimeout(
		new Promise<TransportExecResult>((resolveResult, rejectResult) => {
			child.once("error", rejectResult);
			child.once("close", (code, signal) => {
				if (limitError) return rejectResult(limitError);
				if (signal)
					return rejectResult(
						new ComputeTransportError("process-signal", `${label} terminated by ${signal}`, true),
					);
				resolveResult({ exitCode: code ?? 1, ...output() });
			});
		}),
		timeoutMs,
		() => child.kill("SIGKILL"),
	);
}

export class LocalRunnerTransport implements CollectingTransport {
	private readonly jobs = new Map<string, string>();
	private disposed = false;

	constructor(
		readonly runnerPath: string,
		private readonly python: string,
		private readonly timeoutMs: number,
		private readonly maxResponseBytes: number,
		private readonly maxUploadBytes: number,
		private readonly remoteRoot: string,
	) {}

	async runRunner(
		command: RunnerCommand,
		input: string,
		timeoutMs = this.timeoutMs,
	): Promise<TransportExecResult> {
		if (this.disposed) throw new ComputeTransportError("disposed", "Local runner transport is disposed");
		return await this.spawnProcess([this.runnerPath, command], input, timeoutMs);
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
		return await collectProcess(
			child,
			input,
			timeoutMs,
			"Runner",
			() => this.maxResponseBytes,
			"Runner output exceeds the response limit",
			true,
		);
	}

	async upload(request: Parameters<CollectingTransport["upload"]>[0]): Promise<void> {
		const destination = resolve(request.destination);
		const data = await readUpload(request.source, () => request.maxBytes ?? this.maxUploadBytes);
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, data, { mode: 0o600 });
	}

	async download(request: Parameters<CollectingTransport["download"]>[0]): Promise<Uint8Array> {
		const path = safeRelativePath(request.source);
		for (const workDir of this.jobs.values()) {
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
		return processShell(child);
	}

	remember(spec: JobSpec): void {
		// runner.py owns the durable run location. Keep the same root it receives
		// through the environment instead of trusting the caller's workDir field.
		this.jobs.set(spec.jobId, resolve(this.remoteRoot, "runs", spec.jobId, "outputs"));
	}
	async close(): Promise<void> {
		this.disposed = true;
	}
}

/**
 * OpenSSH is deliberately a separate fallback. It is useful for ProxyCommand,
 * GSSAPI and certificate configurations that ssh2 cannot represent. BatchMode
 * and strict host checking make this path non-interactive by construction.
 */
export class OpenSshRunnerTransport implements CollectingTransport {
	private disposed = false;
	private checkedHostKey = false;
	private readonly policy: HostKeyPolicy;

	constructor(
		private readonly host: HostProfile,
		private readonly options: DefaultComputeExecutorOptions,
		private readonly agentDir: string,
		readonly runnerPath: string,
		private readonly runnerRoot: string,
	) {
		this.policy = new HostKeyPolicy(options, agentDir);
	}

	private sshArgs(): string[] {
		const userHost = `${this.host.username ? `${this.host.username}@` : ""}${this.host.host}`;
		const userKnownHosts = join(homedir(), ".ssh", "known_hosts");
		const droneKnownHosts = this.options.knownHostsPath ?? join(this.agentDir, "compute", "known_hosts");
		const args = [
			"BatchMode=yes",
			"StrictHostKeyChecking=yes",
			`UserKnownHostsFile=${userKnownHosts},${droneKnownHosts}`,
			"ForwardAgent=no",
		].flatMap((option) => ["-o", option]);
		if (this.host.port) args.push("-p", String(this.host.port));
		if (this.host.identityFile) args.push("-i", resolveIdentityFile(this.host.identityFile));
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
		return await collectProcess(
			child,
			input,
			timeoutMs,
			"OpenSSH",
			() => this.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
			"OpenSSH response exceeds limit",
		);
	}

	private async ensureHostKey(): Promise<void> {
		if (this.checkedHostKey) return;
		const args = ["-p", String(this.host.port ?? 22), "-T", "5", this.host.host];
		const scan = spawn("ssh-keyscan", args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
		const output = captureOutput(scan.stdout, scan.stderr);
		const code = await withTimeout(
			new Promise<number | null>((resolveScan, rejectScan) => {
				scan.once("error", rejectScan);
				scan.once("close", resolveScan);
			}),
			this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			() => scan.kill("SIGKILL"),
		);
		const { stdout, stderr } = output();
		if (code !== 0 || stdout.length === 0)
			throw new ComputeTransportError("host-key-scan", stderr.toString("utf8") || "ssh-keyscan failed", true);
		const fields = sshLines(stdout.toString("utf8"))[0]?.split(/\s+/u);
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

	async upload(request: Parameters<CollectingTransport["upload"]>[0]): Promise<void> {
		const destination = safeRemoteAbsolutePath(request.destination);
		const data = await readUpload(
			request.source,
			() => request.maxBytes ?? this.options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
		);
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

	async download(request: Parameters<CollectingTransport["download"]>[0]): Promise<Uint8Array> {
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
		return processShell(child);
	}

	async close(): Promise<void> {
		this.disposed = true;
	}
}
