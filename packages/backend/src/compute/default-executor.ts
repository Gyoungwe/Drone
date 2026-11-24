import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ArtifactManifest, HostCapability, HostProfile, JobRecord, JobSpec } from "@drone/compute";
import { RunnerClient as ProtocolClient, validateArtifactManifest } from "@drone/compute";
import type {
	ComputeCollectOptions,
	ComputeExecutor,
	ComputeLogsResult,
	ComputeStatusResult,
	ComputeSubmitResult,
	ComputeTerminalSession,
} from "../services/compute";
import {
	ComputeOperationLifetime,
	ComputeTransportError,
	cancelWithEvidence,
	safeRelativePath,
	statusWithEvidence,
} from "./compute-operation-lifetime";
import { LocalRunnerTransport, OpenSshRunnerTransport } from "./process-runner-transports";
import { deployRunnerScript } from "./runner-deployment";
import {
	type CollectingTransport,
	DEFAULT_MAX_RESPONSE_BYTES,
	DEFAULT_MAX_UPLOAD_BYTES,
	DEFAULT_TIMEOUT_MS,
	type DefaultComputeExecutorOptions,
	expandHome,
	HostConcurrency,
	runnerScriptPath,
	safeRemoteAbsolutePath,
	shellQuote,
	toBuffer,
} from "./runner-helpers";
import { Ssh2RunnerTransport } from "./ssh2-runner-transport";

export type {
	CollectingTransport,
	ComputeCredential,
	ComputeCredentialProvider,
	DefaultComputeExecutorOptions,
	UnknownHostKeyPrompt,
} from "./runner-helpers";

const MIN_RUNNER_VERSION = "1.0.0";
const DEFAULT_MAX_COLLECT_BYTES = 500 * 1024 * 1024;
const DEFAULT_REMOTE_ROOT = ".drone";

export class DefaultComputeExecutor implements ComputeExecutor {
	private readonly lifetime = new ComputeOperationLifetime();
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
		return deployRunnerScript(
			transport,
			source,
			this.remoteRoot(host),
			this.options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
		);
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
		const createSshTransport = (runnerPath: string) => {
			const Transport = host.transport === "openssh" ? OpenSshRunnerTransport : Ssh2RunnerTransport;
			return new Transport(host, this.options, this.agentDir, runnerPath, this.remoteRoot(host));
		};
		const provisional = createSshTransport(`${DEFAULT_REMOTE_ROOT}/runner/pending/runner.py`);
		const deployed = await this.deployRunner(host, provisional);
		await provisional.close();
		const ssh = createSshTransport(deployed);
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

	async submit(spec: JobSpec, host: HostProfile, signal?: AbortSignal): Promise<ComputeSubmitResult> {
		this.lifetime.assertActive(signal);
		return await this.limited(host, async () => {
			this.lifetime.assertActive(signal);
			const { client, transport } = await this.client(host);
			if (transport instanceof LocalRunnerTransport) transport.remember(spec);
			await client.negotiate();
			this.lifetime.assertActive(signal);
			await client.prepare(spec);
			this.lifetime.assertActive(signal);
			const started = (await client.start(spec)) as { status?: JobRecord["status"]; remoteId?: string };
			return { remoteId: started.remoteId ?? spec.jobId, status: started.status ?? "queued" };
		});
	}

	async status(job: JobRecord, host: HostProfile): Promise<ComputeStatusResult> {
		return await this.limited(host, async () => {
			const { client } = await this.client(host);
			return await statusWithEvidence(client, job);
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
			return await cancelWithEvidence(client, job);
		});
	}

	async collect(
		job: JobRecord,
		host: HostProfile,
		options?: ComputeCollectOptions,
		signal?: AbortSignal,
	): Promise<{ manifest: ArtifactManifest }> {
		// Admission and write tracking share the executor's disposal fence.
		this.lifetime.assertActive(signal);
		const { client, transport } = await this.client(host);
		const maxBytes = options?.maxBytes ?? this.options.maxCollectBytes ?? DEFAULT_MAX_COLLECT_BYTES;
		const expected = options?.expected?.map((path) => ({ path }));
		const request = { maxBytes, ...(expected ? { manifest: expected } : {}) };
		const value = (await this.limited(host, () => {
			this.lifetime.assertActive(signal);
			return client.execute("collect", request, job.remoteId ?? job.jobId);
		})) as { manifest?: ArtifactManifest };
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
		const validation = validateArtifactManifest(value.manifest, { maxTotalBytes: maxBytes, expected });
		if (!validation.valid) throw new ComputeTransportError("invalid-manifest", validation.errors.join("; "));
		if (options) {
			const { targetDir } = options;
			await this.lifetime.write(signal, value.manifest.entries, targetDir, maxBytes, (path, limit) => {
				const root = this.remoteRoot(host);
				const source =
					transport instanceof LocalRunnerTransport
						? path
						: `${root}/runs/${job.remoteId ?? job.jobId}/outputs/${path}`.replace(/\/+/gu, "/");
				return transport.download({ source, maxBytes: limit });
			});
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
					const text = decoder.decode(toBuffer(chunk), { stream: true });
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
		await this.lifetime.dispose();
		for (const transport of this.transports.values()) await transport.close?.();
		this.transports.clear();
	}
}

export function createDefaultComputeExecutor(options: DefaultComputeExecutorOptions = {}): ComputeExecutor {
	return new DefaultComputeExecutor(options);
}
