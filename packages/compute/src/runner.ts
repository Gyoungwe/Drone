import type { RunnerTransport, TransportExecResult } from "./transport";
import {
	type JobSpec,
	type RemoteJobStatus,
	RUNNER_COMMANDS,
	RUNNER_PROTOCOL_VERSION,
	type RunnerCapabilities,
	type RunnerCommand,
	type RunnerRequest,
	type RunnerResponse,
	type RunnerVersion,
} from "./types";

export interface RunnerClientOptions {
	readonly runnerPath?: string;
	readonly protocolVersion?: number;
	readonly minRunnerVersion?: string;
	readonly timeoutMs?: number;
}

export interface RunnerNegotiation {
	readonly version: RunnerVersion;
	readonly capabilities: RunnerCapabilities;
}

export class RunnerProtocolError extends Error {
	readonly code: string;
	readonly retryable: boolean;

	constructor(code: string, message: string, retryable = false) {
		super(message);
		this.name = "RunnerProtocolError";
		this.code = code;
		this.retryable = retryable;
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function textOf(value: string | Uint8Array): string {
	return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function parseMajorMinorPatch(value: string): [number, number, number] | undefined {
	const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isRunnerVersionAtLeast(actual: string, minimum: string): boolean {
	const a = parseMajorMinorPatch(actual);
	const b = parseMajorMinorPatch(minimum);
	if (!a || !b) return actual === minimum;
	for (let i = 0; i < 3; i += 1) {
		if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
	}
	return true;
}

function extractResponseData<T>(response: RunnerResponse<T>): T {
	if (response.payload !== undefined) return response.payload;
	if (response.data !== undefined) return response.data;
	if (response.result !== undefined) return response.result;
	return undefined as T;
}

function ensureVersion(value: unknown, expectedProtocol: number): RunnerVersion {
	const row = asRecord(value);
	const runnerVersion =
		typeof row.runnerVersion === "string"
			? row.runnerVersion
			: typeof row.version === "string"
				? row.version
				: "";
	const protocolVersion = Number(row.protocolVersion);
	if (!runnerVersion || !Number.isInteger(protocolVersion)) {
		throw new RunnerProtocolError("invalid-version", "Runner version response is incomplete");
	}
	if (protocolVersion !== expectedProtocol) {
		throw new RunnerProtocolError(
			"protocol-mismatch",
			`Runner protocol ${protocolVersion} is not supported by client protocol ${expectedProtocol}`,
		);
	}
	return {
		runnerVersion,
		protocolVersion,
		...(typeof row.commit === "string" ? { commit: row.commit } : {}),
	};
}

function ensureCapabilities(value: unknown, version: RunnerVersion): RunnerCapabilities {
	const row = asRecord(value);
	const scheduler = row.scheduler;
	if (scheduler !== "direct" && scheduler !== "slurm" && scheduler !== "unsupported") {
		throw new RunnerProtocolError("invalid-capabilities", "Runner capabilities have an invalid scheduler");
	}
	const features = Array.isArray(row.features)
		? row.features.filter((feature): feature is string => typeof feature === "string")
		: undefined;
	return {
		...version,
		scheduler,
		...(typeof row.containerRuntime === "string" ? { containerRuntime: row.containerRuntime } : {}),
		...(typeof row.nextflowVersion === "string" ? { nextflowVersion: row.nextflowVersion } : {}),
		...(typeof row.diskQuotaBytes === "number" ? { diskQuotaBytes: row.diskQuotaBytes } : {}),
		...(typeof row.loginNodeOnly === "boolean" ? { loginNodeOnly: row.loginNodeOnly } : {}),
		...(typeof row.maxConcurrentJobs === "number" ? { maxConcurrentJobs: row.maxConcurrentJobs } : {}),
		...(features ? { features } : {}),
	};
}

export class RunnerClient {
	readonly transport: RunnerTransport;
	readonly options: Required<Pick<RunnerClientOptions, "runnerPath" | "protocolVersion" | "timeoutMs">> &
		Pick<RunnerClientOptions, "minRunnerVersion">;
	private sequence = 0;
	private negotiatedState?: RunnerNegotiation;

	constructor(transport: RunnerTransport, options: RunnerClientOptions = {}) {
		this.transport = transport;
		this.options = {
			runnerPath: options.runnerPath ?? "drone-runner",
			protocolVersion: options.protocolVersion ?? RUNNER_PROTOCOL_VERSION,
			timeoutMs: options.timeoutMs ?? 30_000,
			...(options.minRunnerVersion ? { minRunnerVersion: options.minRunnerVersion } : {}),
		};
	}

	get negotiated(): RunnerNegotiation | undefined {
		return this.negotiatedState;
	}

	async execute<T = unknown>(command: RunnerCommand, payload?: unknown, jobId?: string): Promise<T> {
		if (!RUNNER_COMMANDS.includes(command))
			throw new RunnerProtocolError("invalid-command", `Unsupported runner command: ${command}`);
		const request: RunnerRequest = {
			protocolVersion: this.options.protocolVersion as typeof RUNNER_PROTOCOL_VERSION,
			command,
			requestId: `${Date.now().toString(36)}-${(++this.sequence).toString(36)}`,
			...(jobId ? { jobId } : {}),
			...(payload === undefined ? {} : { payload }),
		};
		const stdin = JSON.stringify(request);
		const result = await this.runTransport(command, stdin);
		const stdout = textOf(result.stdout);
		const stderr = textOf(result.stderr);
		if (result.exitCode !== 0) {
			throw new RunnerProtocolError("runner-exit", stderr || `Runner exited with ${result.exitCode}`, true);
		}
		let response: RunnerResponse<T>;
		try {
			response = JSON.parse(stdout) as RunnerResponse<T>;
		} catch {
			throw new RunnerProtocolError("invalid-json", "Runner returned invalid JSON", true);
		}
		if (response.protocolVersion !== this.options.protocolVersion) {
			throw new RunnerProtocolError(
				"protocol-mismatch",
				`Runner protocol ${response.protocolVersion} is not supported by client protocol ${this.options.protocolVersion}`,
			);
		}
		if (!response.ok) {
			const error = response.error;
			throw new RunnerProtocolError(
				error?.code ?? "runner-error",
				error?.message ?? "Runner command failed",
				error?.retryable ?? false,
			);
		}
		return extractResponseData(response);
	}

	async version(): Promise<RunnerVersion> {
		return ensureVersion(await this.execute("version"), this.options.protocolVersion);
	}

	async capabilities(): Promise<RunnerCapabilities> {
		const version = this.negotiatedState?.version ?? (await this.version());
		return ensureCapabilities(await this.execute("capabilities"), version);
	}

	async negotiate(): Promise<RunnerNegotiation> {
		const version = await this.version();
		if (
			this.options.minRunnerVersion &&
			!isRunnerVersionAtLeast(version.runnerVersion, this.options.minRunnerVersion)
		) {
			throw new RunnerProtocolError(
				"runner-too-old",
				`Runner ${version.runnerVersion} is older than required ${this.options.minRunnerVersion}`,
			);
		}
		const capabilities = ensureCapabilities(await this.execute("capabilities"), version);
		this.negotiatedState = { version, capabilities };
		return this.negotiatedState;
	}

	async prepare(spec: JobSpec): Promise<unknown> {
		return await this.execute("prepare", { spec }, spec.jobId);
	}

	async start(spec: JobSpec): Promise<unknown> {
		return await this.execute("start", { spec }, spec.jobId);
	}

	async status(jobId: string): Promise<RemoteJobStatus> {
		return (await this.execute("status", undefined, jobId)) as RemoteJobStatus;
	}

	async logs(jobId: string, cursor?: string): Promise<unknown> {
		return await this.execute("logs", cursor === undefined ? undefined : { cursor }, jobId);
	}

	async cancel(jobId: string): Promise<unknown> {
		return await this.execute("cancel", undefined, jobId);
	}

	async collect(jobId: string, manifest?: unknown): Promise<unknown> {
		return await this.execute("collect", manifest === undefined ? undefined : { manifest }, jobId);
	}

	private async runTransport(command: RunnerCommand, stdin: string): Promise<TransportExecResult> {
		if (this.transport.runRunner)
			return await this.transport.runRunner(command, stdin, this.options.timeoutMs);
		return await this.transport.exec({
			argv: [this.options.runnerPath, command],
			stdin,
			timeoutMs: this.options.timeoutMs,
		});
	}
}

export { RUNNER_PROTOCOL_VERSION } from "./types";
