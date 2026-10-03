import { spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type {
	ControlledKernelRunner,
	KernelLanguage,
	KernelRunnerCapabilities,
	KernelRunOutput,
	KernelRunRequest,
	KernelRunResult,
} from "@drone/discovery";

/** Process seam kept injectable for deterministic tests without replacing production execution. */
export type ContainerProcess = (
	command: string,
	args: readonly string[],
	options: { cwd?: string },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface ContainerKernelRunnerOptions {
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
}

const DEFAULT_IMAGES: Record<KernelLanguage, string> = {
	python: "python:3.12-slim",
	r: "r-base:4.4.2",
};
const DEFAULT_MAX_PIDS = 128;
const DEFAULT_MEMORY_BYTES = 1_073_741_824;
const DEFAULT_CPUS = 2;
const DEFAULT_TMPFS_BYTES = 134_217_728;

function outputKind(text: string): KernelRunOutput["contentKind"] {
	const lines = text.split(/\r?\n/);
	if (lines.every((line) => !line || line.startsWith("[summary]"))) return "summary";
	if (lines.every((line) => !line || line.startsWith("[plot]"))) return "plot";
	return "raw";
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
	} catch {
		return false;
	}
}

/** Probe Docker/Podman without treating a missing daemon as a working kernel. */
export async function detectContainerRuntime(
	requested: ContainerKernelRunnerOptions["runtime"],
	processRunner: ContainerProcess = commandProcess(),
): Promise<"docker" | "podman" | undefined> {
	if (requested) return (await commandExists(requested, processRunner)) ? requested : undefined;
	for (const runtime of ["docker", "podman"] as const) {
		if (await commandExists(runtime, processRunner)) return runtime;
	}
	return undefined;
}

function projectRunsPath(projectRoot: string, runDirectory: string): string {
	if (isAbsolute(runDirectory) || runDirectory.includes("\u0000"))
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

function imageFor(options: ContainerKernelRunnerOptions, language: KernelLanguage): string {
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
export function buildContainerKernelArgv(
	request: KernelRunRequest,
	canonicalRunDirectory: string,
	options: ContainerKernelRunnerOptions & {
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
		`type=bind,src=${canonicalRunDirectory},dst=/workspace/runs,rw`,
		"--workdir",
		"/workspace/runs",
		image,
		...command,
	];
}

/**
 * Real container-only runner. It mounts the selected project runs directory as
 * the sole writable volume, disables networking, drops capabilities, and uses
 * argv-only execution. It never falls back to a host interpreter.
 */
export class ContainerKernelRunner implements ControlledKernelRunner {
	readonly capabilities: KernelRunnerCapabilities;
	private readonly runtime: "docker" | "podman";
	private readonly projectRoot: string;
	private readonly options: Required<
		Pick<ContainerKernelRunnerOptions, "maxPids" | "memoryBytes" | "cpus" | "tmpfsBytes">
	> &
		ContainerKernelRunnerOptions;

	private constructor(runtime: "docker" | "podman", options: ContainerKernelRunnerOptions) {
		this.runtime = runtime;
		this.projectRoot = resolve(options.projectRoot);
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
	static async create(options: ContainerKernelRunnerOptions): Promise<ContainerKernelRunner | undefined> {
		if (!isAbsolute(options.projectRoot)) throw new Error("projectRoot must be absolute");
		const processRunner = options.process ?? commandProcess();
		const runtime = await detectContainerRuntime(options.runtime, processRunner);
		return runtime ? new ContainerKernelRunner(runtime, options) : undefined;
	}

	get runtimeName(): "docker" | "podman" {
		return this.runtime;
	}

	async run(request: KernelRunRequest): Promise<KernelRunResult> {
		const hostRunDirectory = projectRunsPath(this.projectRoot, request.runDirectory);
		await mkdir(hostRunDirectory, { recursive: true });
		const canonicalRoot = await realpath(resolve(this.projectRoot, "runs")).catch(() =>
			resolve(this.projectRoot, "runs"),
		);
		const canonicalRun = await realpath(hostRunDirectory).catch(() => hostRunDirectory);
		const withinRuns = relative(canonicalRoot, canonicalRun).replaceAll("\\", "/");
		if (withinRuns.startsWith("../") || withinRuns === ".." || isAbsolute(withinRuns))
			throw new Error("container runner path escaped project runs");
		const args = buildContainerKernelArgv(request, canonicalRun, this.options);
		const started = Date.now();
		return new Promise((resolveResult, reject) => {
			let settled = false;
			const child = spawn(this.runtime, args, {
				cwd: this.projectRoot,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			let producedBytes = 0;
			const max = request.maxOutputBytes;
			const append = (value: Buffer | string, target: "stdout" | "stderr") => {
				const text = typeof value === "string" ? value : value.toString("utf8");
				producedBytes += Buffer.byteLength(text);
				if (target === "stdout") stdout = `${stdout}${text}`.slice(0, max);
				else stderr = `${stderr}${text}`.slice(0, max);
			};
			child.stdout.on("data", (value: Buffer) => append(value, "stdout"));
			child.stderr.on("data", (value: Buffer) => append(value, "stderr"));
			const finish = (result: KernelRunResult) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolveResult(result);
			};
			const timer = setTimeout(() => {
				if (settled) return;
				child.kill("SIGKILL");
				settled = true;
				reject(new Error("container-timeout"));
			}, request.timeoutMs);
			child.once("error", (error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(error);
			});
			child.once("close", (exitCode) => {
				const outputs: KernelRunOutput[] = [];
				if (stdout)
					outputs.push({
						text: stdout,
						contentKind: outputKind(stdout),
						classification: request.dataClassification,
					});
				if (stderr)
					outputs.push({ text: stderr, contentKind: "raw", classification: request.dataClassification });
				finish({ exitCode: exitCode ?? 1, outputs, durationMs: Date.now() - started, producedBytes });
			});
		});
	}
}

/** A capability object used by the service while Docker/Podman is unavailable. */
export function unavailableContainerCapabilities(): KernelRunnerCapabilities {
	return {
		kind: "unavailable",
		languages: ["python", "r"],
		networkDisabled: false,
		writesOnlyToRunDirectory: false,
	};
}
