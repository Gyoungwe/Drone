import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import {
	assertValid,
	boundedInteger,
	MAX_CODE_LENGTH,
	nonEmptyText,
	safeId,
	safeRunPath,
} from "./validation";

export type KernelLanguage = "python" | "r";
export type KernelSessionStatus = "ready" | "running" | "closed" | "idle-timeout" | "needs-container";
export type DataClassification = "public" | "internal" | "controlled" | "restricted";
export type KernelContentKind = "summary" | "plot" | "table" | "raw";

export interface KernelRunnerCapabilities {
	/** `container` is the only production capability. `fixture` is test-only and explicit. */
	readonly kind: "container" | "fixture" | "unavailable";
	readonly languages: readonly KernelLanguage[];
	readonly networkDisabled: boolean;
	readonly writesOnlyToRunDirectory: boolean;
}

export interface KernelRunRequest {
	readonly requestId: string;
	readonly language: KernelLanguage;
	readonly code: string;
	readonly runDirectory: string;
	readonly timeoutMs: number;
	readonly maxOutputBytes: number;
	readonly dataClassification: DataClassification;
}

export interface KernelRunOutput {
	readonly text: string;
	readonly contentKind: KernelContentKind;
	readonly classification: DataClassification;
}

export interface KernelRunResult {
	readonly exitCode: number;
	readonly outputs: readonly KernelRunOutput[];
	readonly durationMs: number;
	readonly producedBytes: number;
}

/** The only execution seam exposed to a production KernelSession. It has no shell method. */
export interface ControlledKernelRunner {
	readonly capabilities: KernelRunnerCapabilities;
	run(request: KernelRunRequest): Promise<KernelRunResult>;
}

export interface RunFileWriter {
	write(path: string, content: string, mediaType: string): Promise<unknown>;
}

export interface KernelSessionOptions {
	readonly sessionId: string;
	readonly runDirectory: string;
	readonly language: KernelLanguage;
	readonly dataClassification: DataClassification;
	readonly runner: ControlledKernelRunner;
	readonly writer?: RunFileWriter;
	readonly idleTimeoutMs?: number;
	readonly executionTimeoutMs?: number;
	readonly maxExecutions?: number;
	readonly maxOutputBytes?: number;
	readonly now?: () => number;
}

export interface KernelExecution {
	readonly id: string;
	readonly code: string;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly status: "succeeded" | "failed" | "blocked";
	readonly exitCode?: number;
	readonly output: string;
	readonly outputClassification: DataClassification;
	readonly contentKinds: readonly KernelContentKind[];
	readonly producedBytes: number;
	readonly redactedBytes: number;
	readonly blockedReason?: string;
}

export interface KernelExport {
	readonly scriptPath: string;
	readonly notebookPath: string;
	readonly script: string;
	readonly notebook: string;
}

export interface KernelStatus {
	readonly sessionId: string;
	readonly status: KernelSessionStatus;
	readonly executionCount: number;
	readonly remainingExecutions: number;
	readonly expiresAt?: string;
}

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_EXECUTIONS = 32;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const encoder = new TextEncoder();

function validClassification(value: unknown): value is DataClassification {
	return value === "public" || value === "internal" || value === "controlled" || value === "restricted";
}

function validKind(value: unknown): value is KernelContentKind {
	return value === "summary" || value === "plot" || value === "table" || value === "raw";
}

function ensureOptions(options: KernelSessionOptions): void {
	assertValid(safeId(options.sessionId), "sessionId is invalid");
	assertValid(safeRunPath(options.runDirectory), "runDirectory must be a project-relative runs path");
	assertValid(options.language === "python" || options.language === "r", "unsupported kernel language");
	assertValid(validClassification(options.dataClassification), "invalid data classification");
	assertValid(options.runner && typeof options.runner.run === "function", "controlled runner is required");
	const capabilities = options.runner.capabilities;
	assertValid(
		capabilities.kind === "container" ||
			capabilities.kind === "fixture" ||
			capabilities.kind === "unavailable",
		"invalid runner kind",
	);
	assertValid(capabilities.languages.includes(options.language), "runner does not support this language");
	if (capabilities.kind !== "unavailable") {
		assertValid(capabilities.networkDisabled, "kernel runner must disable network access");
		assertValid(capabilities.writesOnlyToRunDirectory, "kernel runner must constrain writes to runs");
	}
	for (const [label, value] of [
		["idleTimeoutMs", options.idleTimeoutMs],
		["executionTimeoutMs", options.executionTimeoutMs],
		["maxExecutions", options.maxExecutions],
		["maxOutputBytes", options.maxOutputBytes],
	] as const) {
		if (value !== undefined) assertValid(boundedInteger(value, 1, 24 * 60 * 60_000), `${label} is invalid`);
	}
}

/**
 * Filter output before it can reach a model or a UI. Controlled projects expose
 * summaries and plots only; restricted projects expose summaries only.
 */
export function filterKernelOutput(
	outputs: readonly KernelRunOutput[],
	policy: DataClassification,
	maxBytes = DEFAULT_MAX_OUTPUT_BYTES,
): {
	readonly text: string;
	readonly redactedBytes: number;
	readonly blocked: boolean;
	readonly kinds: readonly KernelContentKind[];
} {
	assertValid(validClassification(policy), "invalid output policy");
	assertValid(boundedInteger(maxBytes, 1, DEFAULT_MAX_OUTPUT_BYTES * 100), "maxBytes is invalid");
	const accepted: string[] = [];
	const kinds: KernelContentKind[] = [];
	let redactedBytes = 0;
	let blocked = false;
	const classificationRank: Record<DataClassification, number> = {
		public: 0,
		internal: 1,
		controlled: 2,
		restricted: 3,
	};
	for (const item of outputs) {
		if (
			!validKind(item.contentKind) ||
			!validClassification(item.classification) ||
			!nonEmptyText(item.text, maxBytes)
		) {
			blocked = true;
			continue;
		}
		const withinClassification = classificationRank[item.classification] <= classificationRank[policy];
		const allowed =
			withinClassification &&
			(policy === "public" || policy === "internal"
				? item.contentKind !== "raw" || item.classification === "public"
				: policy === "controlled"
					? item.contentKind === "summary" || item.contentKind === "plot"
					: item.contentKind === "summary" && item.classification === "public");
		if (!allowed) {
			redactedBytes += encoder.encode(item.text).byteLength;
			blocked = true;
			continue;
		}
		accepted.push(item.text);
		kinds.push(item.contentKind);
	}
	const text = accepted.join("\n");
	if (encoder.encode(text).byteLength > maxBytes) {
		const bytes = encoder.encode(text).slice(0, maxBytes);
		redactedBytes += encoder.encode(text).byteLength - bytes.byteLength;
		return { text: new TextDecoder().decode(bytes), redactedBytes, blocked: true, kinds };
	}
	return { text, redactedBytes, blocked, kinds };
}

function notebookFor(history: readonly KernelExecution[], language: KernelLanguage): string {
	return JSON.stringify(
		{
			cells: history.map((execution) => ({
				cell_type: "code",
				execution_count: null,
				metadata: { drone: { executionId: execution.id, status: execution.status } },
				outputs: execution.output
					? [{ name: "stdout", output_type: "stream", text: `${execution.output}\n` }]
					: [],
				source: execution.code.split("\n").map((line) => `${line}\n`),
			})),
			metadata: {
				kernelspec: { language, name: language, display_name: language },
				drone: { schemaVersion: 1 },
			},
			nbformat: 4,
			nbformat_minor: 5,
		},
		null,
		2,
	);
}

export class KernelSession {
	private readonly options: Required<
		Pick<KernelSessionOptions, "idleTimeoutMs" | "executionTimeoutMs" | "maxExecutions" | "maxOutputBytes">
	> &
		KernelSessionOptions;
	private state: KernelSessionStatus;
	private executionCount = 0;
	private history: KernelExecution[] = [];
	private idleTimer?: ReturnType<typeof setTimeout>;
	private expiresAt?: number;

	constructor(options: KernelSessionOptions) {
		ensureOptions(options);
		this.options = {
			...options,
			idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
			executionTimeoutMs: options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
			maxExecutions: options.maxExecutions ?? DEFAULT_MAX_EXECUTIONS,
			maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
		};
		this.state =
			options.runner.capabilities.kind === "container" || options.runner.capabilities.kind === "fixture"
				? "ready"
				: "needs-container";
		this.armIdleTimer();
	}

	get status(): KernelStatus {
		const remaining = Math.max(0, this.options.maxExecutions - this.executionCount);
		return {
			sessionId: this.options.sessionId,
			status: this.state,
			executionCount: this.executionCount,
			remainingExecutions: remaining,
			...(this.expiresAt === undefined ? {} : { expiresAt: new Date(this.expiresAt).toISOString() }),
		};
	}

	get executions(): readonly KernelExecution[] {
		return this.history;
	}

	async execute(code: string): Promise<KernelExecution> {
		assertValid(this.state === "ready", `kernel session is ${this.state}`);
		assertValid(nonEmptyText(code, MAX_CODE_LENGTH), "kernel code is empty or too large");
		assertValid(this.executionCount < this.options.maxExecutions, "kernel execution budget exceeded");
		this.state = "running";
		this.executionCount += 1;
		this.armIdleTimer();
		const id = randomUUID();
		const startedAt = new Date(this.now()).toISOString();
		let execution: KernelExecution;
		try {
			const result = await Promise.race([
				this.options.runner.run({
					requestId: id,
					language: this.options.language,
					code,
					runDirectory: this.options.runDirectory,
					timeoutMs: this.options.executionTimeoutMs,
					maxOutputBytes: this.options.maxOutputBytes,
					dataClassification: this.options.dataClassification,
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("runner-timeout")), this.options.executionTimeoutMs),
				),
			]);
			assertValid(result && Number.isInteger(result.exitCode), "runner returned invalid exit status");
			assertValid(
				Number.isFinite(result.producedBytes) && result.producedBytes >= 0,
				"runner returned invalid byte count",
			);
			const filtered = filterKernelOutput(
				result.outputs,
				this.options.dataClassification,
				this.options.maxOutputBytes,
			);
			const status =
				result.exitCode === 0 && !filtered.blocked
					? "succeeded"
					: result.exitCode === 0
						? "blocked"
						: "failed";
			execution = {
				id,
				code,
				startedAt,
				finishedAt: new Date(this.now()).toISOString(),
				status,
				...(result.exitCode === 0 ? { exitCode: result.exitCode } : {}),
				output: filtered.text,
				outputClassification: this.options.dataClassification,
				contentKinds: filtered.kinds,
				producedBytes: result.producedBytes,
				redactedBytes: filtered.redactedBytes,
				...(filtered.blocked ? { blockedReason: "output-policy" } : {}),
			};
		} catch (error) {
			execution = {
				id,
				code,
				startedAt,
				finishedAt: new Date(this.now()).toISOString(),
				status: "failed",
				output: "",
				outputClassification: this.options.dataClassification,
				contentKinds: [],
				producedBytes: 0,
				redactedBytes: 0,
				blockedReason:
					error instanceof Error && error.message === "runner-timeout" ? "timeout" : "runner-failure",
			};
		}
		this.history.push(execution);
		this.state = "ready";
		this.armIdleTimer();
		return execution;
	}

	export(writer?: RunFileWriter): Promise<KernelExport> {
		assertValid(this.state === "ready", `kernel session is ${this.state}`);
		const fileWriter = writer ?? this.options.writer;
		assertValid(
			fileWriter && typeof fileWriter.write === "function",
			"a run file writer is required for export",
		);
		const script = this.history.map((execution) => execution.code).join("\n\n");
		const notebook = notebookFor(this.history, this.options.language);
		const base = `${this.options.runDirectory}/exports/${this.options.sessionId}`;
		const scriptPath = `${base}.${this.options.language === "python" ? "py" : "R"}`;
		const notebookPath = `${base}.ipynb`;
		return Promise.all([
			fileWriter.write(scriptPath, script, this.options.language === "python" ? "text/x-python" : "text/x-r"),
			fileWriter.write(notebookPath, notebook, "application/x-ipynb+json"),
		]).then(() => ({ scriptPath, notebookPath, script, notebook }));
	}

	close(reason: "closed" | "idle-timeout" = "closed"): void {
		if (this.state === "closed" || this.state === "idle-timeout") return;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.state = reason;
	}

	private now(): number {
		return this.options.now?.() ?? Date.now();
	}

	private armIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		if (this.state !== "ready") return;
		this.expiresAt = this.now() + this.options.idleTimeoutMs;
		this.idleTimer = setTimeout(() => this.close("idle-timeout"), this.options.idleTimeoutMs);
	}
}

export type KernelPreparation =
	| { readonly status: "ready"; readonly capabilities: KernelRunnerCapabilities }
	| { readonly status: "needs-container"; readonly reason: string };

/** Explicit capability gate used before creating an interactive session. */
export function prepareKernel(runner: ControlledKernelRunner, language: KernelLanguage): KernelPreparation {
	if (!runner?.capabilities?.languages.includes(language))
		return { status: "needs-container", reason: "language is unavailable" };
	if (runner.capabilities.kind !== "container")
		return {
			status: "needs-container",
			reason: "a container runtime is required for production kernel execution",
		};
	if (!runner.capabilities.networkDisabled || !runner.capabilities.writesOnlyToRunDirectory)
		return { status: "needs-container", reason: "runner sandbox guarantees are incomplete" };
	return { status: "ready", capabilities: runner.capabilities };
}

/**
 * Test-only runner. It uses an argv-only child process and never accepts a shell
 * command. It is deliberately marked `fixture`, so production preparation still
 * reports `needs-container`.
 */
export class SubprocessFixtureRunner implements ControlledKernelRunner {
	readonly capabilities: KernelRunnerCapabilities = {
		kind: "fixture",
		languages: ["python", "r"],
		networkDisabled: true,
		writesOnlyToRunDirectory: true,
	};

	constructor(private readonly commands: Partial<Record<KernelLanguage, string>> = { python: "python3" }) {}

	run(request: KernelRunRequest): Promise<KernelRunResult> {
		const command = this.commands[request.language];
		if (
			!command ||
			(request.language === "python" && command !== "python3") ||
			(request.language === "r" && command !== "Rscript")
		)
			return Promise.reject(new Error("fixture-command-not-allowlisted"));
		const args =
			request.language === "python" ? ["-I", "-c", request.code] : ["--vanilla", "-e", request.code];
		const started = Date.now();
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd: request.runDirectory,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			const append = (value: Buffer, target: "stdout" | "stderr") => {
				const text = value.toString("utf8");
				if (target === "stdout") stdout = `${stdout}${text}`.slice(0, request.maxOutputBytes);
				else stderr = `${stderr}${text}`.slice(0, request.maxOutputBytes);
			};
			child.stdout.on("data", (value: Buffer) => append(value, "stdout"));
			child.stderr.on("data", (value: Buffer) => append(value, "stderr"));
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				reject(new Error("fixture-timeout"));
			}, request.timeoutMs);
			child.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			child.once("close", (exitCode) => {
				clearTimeout(timer);
				const outputs: KernelRunOutput[] = [];
				if (stdout) {
					const contentKind = stdout
						.split(/\r?\n/)
						.every((line) => line.length === 0 || line.startsWith("[summary]"))
						? "summary"
						: stdout.split(/\r?\n/).every((line) => line.length === 0 || line.startsWith("[plot]"))
							? "plot"
							: "raw";
					outputs.push({ text: stdout, contentKind, classification: request.dataClassification });
				}
				if (stderr)
					outputs.push({ text: stderr, contentKind: "raw", classification: request.dataClassification });
				resolve({
					exitCode: exitCode ?? 1,
					outputs,
					durationMs: Date.now() - started,
					producedBytes: encoder.encode(`${stdout}${stderr}`).byteLength,
				});
			});
		});
	}
}

/** Capability record used when Docker/Podman is absent; it never pretends to execute. */
export class UnavailableKernelRunner implements ControlledKernelRunner {
	readonly capabilities: KernelRunnerCapabilities = {
		kind: "unavailable",
		languages: ["python", "r"],
		networkDisabled: false,
		writesOnlyToRunDirectory: false,
	};

	run(_request: KernelRunRequest): Promise<KernelRunResult> {
		return Promise.reject(new Error("needs-container"));
	}
}
