import { readFile } from "node:fs/promises";
import { arch, cpus, release, totalmem } from "node:os";
import { onPath, run } from "./exec";

/**
 * 运行平台：操作系统 / 架构 / 默认 shell / WSL / GPU。
 * The agent must know where it runs before choosing commands (PowerShell vs bash), env managers or GPU builds.
 */
export interface GpuInfo {
	name: string;
	memoryGb?: number;
	driver?: string;
}
export interface PlatformInfo {
	os: "windows" | "macos" | "linux" | string;
	release: string;
	arch: string;
	shell: string;
	/** windows: wsl.exe available; linux: running inside WSL; otherwise null */
	wsl: "available" | "inside" | null;
	gpus: GpuInfo[];
	cpus?: number;
	memoryGb?: number;
}

export function osName(platform: string): PlatformInfo["os"] {
	if (platform === "win32" || /^windows/i.test(platform) || /mingw|msys|cygwin/i.test(platform))
		return "windows";
	if (platform === "darwin" || /^darwin/i.test(platform)) return "macos";
	if (platform === "linux" || /^linux/i.test(platform)) return "linux";
	return platform.toLowerCase();
}

/** 默认 shell：Windows 下是 PowerShell（除非在 Git Bash/MSYS 里），其余读 $SHELL。 */
export function defaultShell(platform: string, env: Record<string, string | undefined>): string {
	if (osName(platform) === "windows") {
		if (env.MSYSTEM || /bash/i.test(env.SHELL ?? "")) return "bash (Git Bash/MSYS)";
		return env.PSModulePath ? "powershell" : "cmd";
	}
	const shell = env.SHELL?.split("/").pop();
	return shell || "sh";
}

/** `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader` */
export function parseNvidiaSmi(text: string): GpuInfo[] {
	const gpus: GpuInfo[] = [];
	for (const line of text.split(/\r?\n/)) {
		const [name, memory, driver] = line.split(",").map((part) => part.trim());
		if (!name || /failed|not found|no devices/i.test(line)) continue;
		const mib = Number(memory?.match(/[\d.]+/)?.[0]);
		gpus.push({
			name,
			...(Number.isFinite(mib) && mib > 0 ? { memoryGb: Math.round((mib / 1024) * 10) / 10 } : {}),
			...(driver ? { driver } : {}),
		});
	}
	return gpus.slice(0, 8);
}

/** `uname -srm` → os/release/arch */
export function parseUname(text: string): Pick<PlatformInfo, "os" | "release" | "arch"> | null {
	const [sys, rel, machine] = text.trim().split(/\s+/);
	if (!sys) return null;
	return { os: osName(sys), release: rel ?? "", arch: machine ?? "" };
}

export function isInsideWsl(procVersion: string): boolean {
	return /microsoft|wsl/i.test(procVersion);
}

export const GPU_QUERY = ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"];

export async function detectPlatform(
	platform: string = process.platform,
	env: Record<string, string | undefined> = process.env,
): Promise<PlatformInfo> {
	const os = osName(platform);
	let wsl: PlatformInfo["wsl"] = null;
	if (os === "windows") wsl = (await onPath("wsl")) ? "available" : null;
	else if (os === "linux")
		wsl = isInsideWsl(await readFile("/proc/version", "utf8").catch(() => "")) ? "inside" : null;
	const smi = await onPath("nvidia-smi");
	const gpus = smi ? parseNvidiaSmi(await run(smi, GPU_QUERY)) : [];
	return {
		os,
		release: release(),
		arch: arch(),
		shell: defaultShell(platform, env),
		wsl,
		gpus,
		cpus: cpus().length,
		memoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
	};
}

/** 同步、无子进程的一行平台摘要（每轮注入系统提示用；GPU 等细节交给 bio_environment）。 */
export function platformLine(platform: string = process.platform, env = process.env): string {
	const os = osName(platform);
	const shell = defaultShell(platform, env);
	const hint =
		os === "windows"
			? "use PowerShell syntax for local commands; most bioconda tools need WSL or a Linux host"
			: "use POSIX shell syntax for local commands";
	return `Host platform: ${os} ${release()} ${arch()}, default shell ${shell}, ${cpus().length} CPUs, ${Math.round(totalmem() / 1024 ** 3)} GB RAM (${hint}). Call bio_environment for GPU, env managers, WSL and installed tools.`;
}

export function formatPlatform(info: PlatformInfo): string {
	const gpu = info.gpus.length
		? info.gpus.map((g) => `${g.name}${g.memoryGb ? ` (${g.memoryGb} GB)` : ""}`).join(", ")
		: "none detected";
	const wsl =
		info.wsl === "available" ? "WSL available" : info.wsl === "inside" ? "running inside WSL" : "no WSL";
	return `Platform: ${info.os} ${info.release} ${info.arch}; shell ${info.shell}; ${wsl}; GPU: ${gpu}`;
}
