/**
 * 本机环境面板（P10）：概览（CPU / 内存 / 磁盘）+ 环境探测（系统 / 内核 / 架构 / 工具链 / Python 包数 / npm 包数）。
 * 纯函数放这里，main 侧只负责执行命令；探测命令固定且只读，不拼接用户输入。
 */
export interface HostToolVersion {
	id: string;
	label: string;
	version: string | null;
}

export interface HostEnvironment {
	os: string;
	kernel: string;
	arch: string;
	hostname: string;
	cpu: { model: string; cores: number; loadPercent: number | null };
	memory: { totalBytes: number; freeBytes: number };
	disk: { path: string; totalBytes: number; freeBytes: number } | null;
	tools: HostToolVersion[];
	pythonPackages: number | null;
	npmPackages: number | null;
	probedAt: string;
}

export interface HostProbeCommand {
	id: string;
	label: string;
	command: string;
	args: string[];
}

/** 工具链探测命令；Windows 下 python 叫 python / py，其余平台用 python3。 */
export function hostProbeCommands(platform: string): HostProbeCommand[] {
	const python = platform === "win32" ? "python" : "python3";
	return [
		{ id: "node", label: "Node.js", command: "node", args: ["--version"] },
		{ id: "python", label: "Python", command: python, args: ["--version"] },
		{ id: "git", label: "Git", command: "git", args: ["--version"] },
		{ id: "conda", label: "Conda", command: "conda", args: ["--version"] },
		{ id: "R", label: "R", command: "R", args: ["--version"] },
		{ id: "docker", label: "Docker", command: "docker", args: ["--version"] },
	];
}

export function pythonPackagesCommand(platform: string): HostProbeCommand {
	const python = platform === "win32" ? "python" : "python3";
	return {
		id: "pip",
		label: "pip",
		command: python,
		args: ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"],
	};
}

export function npmPackagesCommand(platform: string): HostProbeCommand {
	return {
		id: "npm",
		label: "npm",
		command: platform === "win32" ? "npm.cmd" : "npm",
		args: ["ls", "-g", "--depth=0", "--json"],
	};
}

/** 从 `xxx --version` 输出里取第一个版本号。 */
export function parseVersion(output: string): string | null {
	const m = output.match(/(\d+\.\d+(?:\.\d+)?(?:[-+.][\w.]+)?)/);
	return m?.[1] ?? null;
}

export function countPipPackages(output: string): number | null {
	try {
		const list = JSON.parse(output) as unknown;
		return Array.isArray(list) ? list.length : null;
	} catch {
		return null;
	}
}

export function countNpmPackages(output: string): number | null {
	try {
		const tree = JSON.parse(output) as { dependencies?: Record<string, unknown> };
		return tree && typeof tree === "object" ? Object.keys(tree.dependencies ?? {}).length : null;
	} catch {
		return null;
	}
}

export function osLabel(platform: string, release: string, version?: string): string {
	if (platform === "darwin") return `macOS (Darwin ${release})`;
	if (platform === "win32") return version ? `Windows (${version})` : `Windows ${release}`;
	if (platform === "linux") return version ? `Linux (${version})` : "Linux";
	return platform;
}

export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let v = bytes;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function usagePercent(total: number, free: number): number {
	if (total <= 0) return 0;
	return Math.min(100, Math.max(0, Math.round(((total - free) / total) * 100)));
}
