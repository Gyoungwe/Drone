import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type {
	ControlledSandboxRunner,
	SandboxCapabilities,
	SandboxLanguage,
	SandboxRunOutput,
	SandboxRunRequest,
	SandboxRunResult,
} from "./execution-types.js";
import { PluginResourceReservations } from "./reservations.js";

/** Process seam kept injectable for deterministic tests without replacing production execution. */
export type ContainerProcess = (
	command: string,
	args: readonly string[],
	options: { cwd?: string },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface ContainerSandboxOptions {
	/** Project root used to resolve the project-relative runs directory. */
	readonly projectRoot: string;
	/** Runtime executable. When omitted, Docker then Podman are probed. */
	readonly runtime?: "docker" | "podman";
	readonly pythonImage?: string;
	readonly rImage?: string;
	readonly maxPids?: number;
	readonly memoryBytes?: number;
	readonly cpus?: number;
	readonly tmpfsBytes?: number;
	/** Optional process seam for runtime probing tests; production uses child_process.spawn. */
	readonly process?: ContainerProcess;
	/** Isolated test seam only; production uses the fixed same-user reservation directory. */
	readonly reservationDirectory?: string;
}

const DEFAULT_IMAGES: Record<SandboxLanguage, string> = {
	python: "python:3.12-slim",
	r: "r-base:4.4.2",
};
const DEFAULT_MAX_PIDS = 128;
const DEFAULT_MEMORY_BYTES = 1_073_741_824;
const DEFAULT_CPUS = 2;
const DEFAULT_TMPFS_BYTES = 134_217_728;

function outputKind(text: string): SandboxRunOutput["contentKind"] {
	const lines = text.split(/\r?\n/);
	if (lines.every((line) => !line || line.startsWith("[summary]"))) return "summary";
	if (lines.every((line) => !line || line.startsWith("[plot]"))) return "plot";
	return "raw";
}

function boundedUtf8(text: string, maximum: number): string {
	const bytes = Buffer.from(text);
	if (bytes.length <= maximum) return text;
	let end = maximum;
	while (end > 0 && (bytes.readUInt8(end) & 0xc0) === 0x80) end -= 1;
	return bytes.subarray(0, end).toString("utf8");
}

function commandProcess(): ContainerProcess {
	return (command, args, options) =>
		new Promise((resolveResult, reject) => {
			const child = spawn(command, [...args], {
				cwd: options.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout.setEncoding("utf8");
			child.stderr.setEncoding("utf8");
			child.stdout.on("data", (value: string) => {
				stdout += value;
			});
			child.stderr.on("data", (value: string) => {
				stderr += value;
			});
			child.once("error", reject);
			child.once("close", (exitCode) => resolveResult({ exitCode: exitCode ?? 1, stdout, stderr }));
		});
}

async function commandExists(runtime: string, processRunner: ContainerProcess): Promise<boolean> {
	try {
		const result = await processRunner(runtime, ["version", "--format", "{{.Server.Version}}"], {});
		return result.exitCode === 0;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

/** Probe Docker/Podman without treating a missing daemon as a working kernel. */
export async function detectContainerRuntime(
	requested: ContainerSandboxOptions["runtime"],
	processRunner: ContainerProcess = commandProcess(),
): Promise<"docker" | "podman" | undefined> {
	if (requested) return (await commandExists(requested, processRunner)) ? requested : undefined;
	for (const runtime of ["docker", "podman"] as const) {
		if (await commandExists(runtime, processRunner)) return runtime;
	}
	return undefined;
}

function projectRunsPath(projectRoot: string, runDirectory: string): string {
	if (
		isAbsolute(runDirectory) ||
		runDirectory.includes("\u0000") ||
		runDirectory.includes("\\") ||
		runDirectory.split("/").some((part) => !part || part === "." || part === "..")
	)
		throw new Error("run directory must be relative");
	const root = resolve(projectRoot);
	const candidate = resolve(root, runDirectory);
	const relativePath = relative(root, candidate).replaceAll("\\", "/");
	if (
		!relativePath ||
		relativePath === ".." ||
		relativePath.startsWith("../") ||
		!relativePath.startsWith("runs/")
	)
		throw new Error("container runner writes are restricted to project runs");
	return candidate;
}

function imageFor(options: ContainerSandboxOptions, language: SandboxLanguage): string {
	const image =
		language === "python"
			? (options.pythonImage ?? DEFAULT_IMAGES.python)
			: (options.rImage ?? DEFAULT_IMAGES.r);
	if (
		!image ||
		image.length > 256 ||
		/\s/.test(image) ||
		image.includes(String.fromCharCode(0)) ||
		image.startsWith("-")
	)
		throw new Error("invalid container image");
	return image;
}

/** Build the exact argv passed to Docker/Podman for host-side contract tests. */
export function buildContainerSandboxArgv(
	request: SandboxRunRequest,
	canonicalRunDirectory: string,
	options: ContainerSandboxOptions & {
		readonly maxPids: number;
		readonly memoryBytes: number;
		readonly cpus: number;
		readonly tmpfsBytes: number;
	},
): readonly string[] {
	const image = imageFor(options, request.language);
	const command =
		request.language === "python"
			? ["python", "-I", "-c", request.code]
			: ["Rscript", "--vanilla", "-e", request.code];
	return [
		"run",
		"--rm",
		"--pull=never",
		"--network",
		"none",
		"--read-only",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--pids-limit",
		String(options.maxPids),
		"--memory",
		String(options.memoryBytes),
		"--cpus",
		String(options.cpus),
		"--tmpfs",
		`/tmp:rw,noexec,nosuid,nodev,size=${options.tmpfsBytes}`,
		"--mount",
		`type=bind,src=${canonicalRunDirectory},dst=/workspace/runs`,
		"--workdir",
		"/workspace/runs",
		image,
		...command,
	];
}

/** Validate/create only the canonical workspace's runs descendants, before accepting execution. */
export async function prepareSandboxRunDirectory(
	projectRoot: string,
	runDirectory: string,
	signal?: AbortSignal,
): Promise<string> {
	const hostRunDirectory = projectRunsPath(projectRoot, runDirectory);
	const canonicalProject = await realpath(projectRoot);
	if (canonicalProject !== projectRoot)
		throw new Error("Container workspace root changed or contains a symlink");
	let canonicalRun = canonicalProject;
	for (const part of relative(canonicalProject, hostRunDirectory).split(/[\\/]/)) {
		signal?.throwIfAborted();
		canonicalRun = resolve(canonicalRun, part);
		try {
			await mkdir(canonicalRun);
		} catch (error) {
			// Concurrent accepted executions may create their common runs parent first.
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		const entry = await lstat(canonicalRun);
		if (entry.isSymbolicLink() || !entry.isDirectory() || (await realpath(canonicalRun)) !== canonicalRun)
			throw new Error("Container run directory contains a symlink or is not a directory");
	}
	return canonicalRun;
}

/**
 * Real container-only runner. It mounts the selected project runs directory as
 * the sole writable volume, disables networking, drops capabilities, and uses
 * argv-only execution. It never falls back to a host interpreter.
 */
export class ContainerSandboxRunner implements ControlledSandboxRunner {
	readonly capabilities: SandboxCapabilities;
	private readonly runtime: "docker" | "podman";
	private readonly projectRoot: string;
	private readonly processRunner: ContainerProcess;
	private readonly options: Required<
		Pick<ContainerSandboxOptions, "maxPids" | "memoryBytes" | "cpus" | "tmpfsBytes">
	> &
		ContainerSandboxOptions;

	private constructor(runtime: "docker" | "podman", options: ContainerSandboxOptions) {
		this.runtime = runtime;
		this.projectRoot = resolve(options.projectRoot);
		this.processRunner = options.process ?? commandProcess();
		this.options = {
			...options,
			maxPids: options.maxPids ?? DEFAULT_MAX_PIDS,
			memoryBytes: options.memoryBytes ?? DEFAULT_MEMORY_BYTES,
			cpus: options.cpus ?? DEFAULT_CPUS,
			tmpfsBytes: options.tmpfsBytes ?? DEFAULT_TMPFS_BYTES,
		};
		this.capabilities = {
			kind: "container",
			languages: ["python", "r"],
			networkDisabled: true,
			writesOnlyToRunDirectory: true,
		};
	}

	/** Returns undefined if Docker/Podman is absent or its daemon cannot be reached. */
	static async create(options: ContainerSandboxOptions): Promise<ContainerSandboxRunner | undefined> {
		if (!isAbsolute(options.projectRoot)) throw new Error("projectRoot must be absolute");
		const processRunner = options.process ?? commandProcess();
		const runtime = await detectContainerRuntime(options.runtime, processRunner);
		return runtime
			? new ContainerSandboxRunner(runtime, { ...options, projectRoot: await realpath(options.projectRoot) })
			: undefined;
	}

	get runtimeName(): "docker" | "podman" {
		return this.runtime;
	}

	async run(request: SandboxRunRequest): Promise<SandboxRunResult> {
		request.signal?.throwIfAborted();
		if (request.code.includes("\u0000")) throw new Error("Container code cannot contain a NUL byte");
		const canonicalRun = await prepareSandboxRunDirectory(
			this.projectRoot,
			request.runDirectory,
			request.signal,
		);
		request.signal?.throwIfAborted();
		const reservations = new PluginResourceReservations(this.options.reservationDirectory);
		reservations.reserve("execution-directories", [canonicalRun]);
		const token = randomUUID();
		const name = `drone-discovery-${token}`;
		const args = [
			"run",
			"--name",
			name,
			"--label",
			`drone.discovery.execution=${token}`,
			...buildContainerSandboxArgv(request, canonicalRun, this.options).slice(1),
		];
		const started = Date.now();
		return new Promise((resolveResult, reject) => {
			const child = spawn(this.runtime, args, {
				cwd: this.projectRoot,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			let producedBytes = 0;
			let retainedBytes = 0;
			let stopped: Error | undefined;
			let processError: Error | undefined;
			const max = request.maxOutputBytes;
			const append = (value: Buffer | string, target: "stdout" | "stderr") => {
				const text = typeof value === "string" ? value : value.toString("utf8");
				producedBytes += Buffer.byteLength(text);
				const retained = boundedUtf8(text, max - retainedBytes);
				retainedBytes += Buffer.byteLength(retained);
				if (target === "stdout") stdout += retained;
				else stderr += retained;
			};
			child.stdout.on("data", (value: Buffer) => append(value, "stdout"));
			child.stderr.on("data", (value: Buffer) => append(value, "stderr"));
			const stop = (reason: Error) => {
				if (stopped) return;
				stopped = reason;
				child.kill("SIGKILL");
			};
			const onAbort = () =>
				stop(
					request.signal?.reason instanceof Error ? request.signal.reason : new Error("container-aborted"),
				);
			const timer = setTimeout(() => stop(new Error("container-timeout")), request.timeoutMs);
			request.signal?.addEventListener("abort", onAbort, { once: true });
			if (request.signal?.aborted) onAbort();
			child.once("error", (error) => {
				processError = error;
			});
			child.once("close", (exitCode) => {
				clearTimeout(timer);
				request.signal?.removeEventListener("abort", onAbort);
				const outputs: SandboxRunOutput[] = [];
				if (stdout)
					outputs.push({
						text: stdout,
						contentKind: outputKind(stdout),
						classification: request.dataClassification,
					});
				if (stderr)
					outputs.push({ text: stderr, contentKind: "raw", classification: request.dataClassification });
				void this.removeOwnedContainer(name, token)
					.then(() => {
						try {
							reservations.dispose();
						} catch (cause) {
							throw Object.assign(
								new Error("Execution directory writer lease could not be released", { cause }),
								{ code: "DISCOVERY_CLEANUP_FAILED" },
							);
						}
					})
					.then(() => {
						if (stopped || processError) reject(stopped ?? processError);
						else
							resolveResult({
								exitCode: exitCode ?? 1,
								outputs,
								durationMs: Date.now() - started,
								producedBytes,
							});
					}, reject);
			});
		});
	}

	private async removeOwnedContainer(name: string, token: string): Promise<void> {
		try {
			const inspected = await this.processRunner(
				this.runtime,
				[
					"inspect",
					"--type",
					"container",
					"--format",
					'{{ index .Config.Labels "drone.discovery.execution" }}',
					name,
				],
				{},
			);
			if (inspected.exitCode === 0) {
				if (inspected.stdout.trim() !== token)
					throw new Error("Container ownership label does not match this execution");
				await this.processRunner(this.runtime, ["rm", "--force", name], {});
			}
			// A successful daemon query, rather than any nonzero inspect status, proves absence.
			const remaining = await this.processRunner(
				this.runtime,
				["container", "ls", "--all", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"],
				{},
			);
			if (remaining.exitCode !== 0) throw new Error("Container daemon could not verify execution cleanup");
			if (remaining.stdout.split(/\r?\n/u).includes(name))
				throw new Error("Owned execution container is still present after cleanup");
		} catch (cause) {
			throw Object.assign(new Error("Discovery container cleanup could not be verified", { cause }), {
				code: "DISCOVERY_CLEANUP_FAILED",
			});
		}
	}
}

/** A capability object used by the service while Docker/Podman is unavailable. */
export function unavailableContainerCapabilities(): SandboxCapabilities {
	return {
		kind: "unavailable",
		languages: ["python", "r"],
		networkDisabled: false,
		writesOnlyToRunDirectory: false,
	};
}

export type * from "./execution-types.js";

/** Resolve only configured language defaults that are already cached; never pull or enumerate images. */
export async function describeContainerExecution(
	options: Pick<ContainerSandboxOptions, "runtime" | "process" | "pythonImage" | "rImage"> = {},
): Promise<{ runtime?: "docker" | "podman"; images: Partial<Record<SandboxLanguage, string>> }> {
	const processRunner = options.process ?? commandProcess();
	const runtime = await detectContainerRuntime(options.runtime, processRunner);
	const images: Partial<Record<SandboxLanguage, string>> = {};
	if (!runtime) return { images };
	for (const language of ["python", "r"] as const) {
		const image = imageFor({ projectRoot: "/", ...options }, language);
		const result = await processRunner(runtime, ["image", "inspect", "--format", "{{.Id}}", image], {});
		if (result.exitCode !== 0) continue;
		const id = result.stdout.trim();
		if (!/^sha256:[a-f0-9]{64}$/.test(id))
			throw new Error("Container engine returned an invalid cached image identity");
		images[language] = id;
	}
	return { runtime, images };
}
export type {
	ExecutionReceiptAtomicWrite,
	ExecutionReceiptWriteBoundary,
	SignedExecutionReceipt,
} from "./execution-storage.js";
export { NodeExecutionReceiptStorage } from "./execution-storage.js";
export type {
	ExecutionIdentity,
	ExecutionPrivateReceipt,
	ExecutionReceiptStorage,
} from "./execution-transactions.js";
export { ExecutionTransactions, executionOwnerKey } from "./execution-transactions.js";
