import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import * as os from "node:os";
import {
	countNpmPackages,
	countPipPackages,
	type HostEnvironment,
	type HostProbeCommand,
	hostProbeCommands,
	npmPackagesCommand,
	osLabel,
	parseVersion,
	pythonPackagesCommand,
} from "@drone/shared";

export type ProbeExec = (command: string, args: string[]) => Promise<string | null>;

export interface HostEnvDeps {
	platform: string;
	exec: ProbeExec;
	os: Pick<typeof os, "release" | "arch" | "hostname" | "cpus" | "totalmem" | "freemem" | "loadavg"> & {
		version?: () => string;
	};
	diskPath: string;
	statfs: (path: string) => Promise<{ blocks: number; bsize: number; bavail: number }>;
	now: () => Date;
}

/** 固定命令、只读、5s 超时；失败返回 null（工具未安装不是错误）。 */
export const defaultExec: ProbeExec = (command, args) =>
	new Promise((resolve) => {
		execFile(
			command,
			args,
			{ timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, shell: process.platform === "win32" },
			(error, stdout, stderr) => {
				if (error && !stdout) return resolve(null);
				resolve(`${stdout}${stderr}`.trim() || null);
			},
		);
	});

/**
 * macOS `os.freemem()` only counts completely free pages, so a Mac with a warm file
 * cache always looks ~100% full. Activity Monitor treats inactive, speculative and
 * purgeable pages as available too; read them from `vm_stat`.
 */
export function parseVmStatAvailableBytes(output: string): number | null {
	const pageSize = Number(output.match(/page size of (\d+) bytes/u)?.[1]);
	if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
	const pages = (label: string) => {
		const value = output.match(new RegExp(`^Pages ${label}:\\s+(\\d+)\\.`, "mu"))?.[1];
		return value === undefined ? null : Number(value);
	};
	const free = pages("free");
	if (free === null) return null;
	const reclaimable = ["inactive", "speculative", "purgeable"].reduce(
		(sum, label) => sum + (pages(label) ?? 0),
		0,
	);
	return (free + reclaimable) * pageSize;
}

async function run(deps: HostEnvDeps, c: HostProbeCommand): Promise<string | null> {
	try {
		return await deps.exec(c.command, c.args);
	} catch {
		return null;
	}
}

export async function probeHostEnvironment(deps: HostEnvDeps): Promise<HostEnvironment> {
	const cpus = deps.os.cpus();
	const load = deps.platform === "win32" ? null : (deps.os.loadavg()[0] ?? null);
	const [tools, pip, npm, disk, vmStat] = await Promise.all([
		Promise.all(
			hostProbeCommands(deps.platform).map(async (c) => {
				const out = await run(deps, c);
				return { id: c.id, label: c.label, version: out ? parseVersion(out) : null };
			}),
		),
		run(deps, pythonPackagesCommand(deps.platform)),
		run(deps, npmPackagesCommand(deps.platform)),
		deps.statfs(deps.diskPath).then(
			(s) => ({ path: deps.diskPath, totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize }),
			() => null,
		),
		deps.platform === "darwin"
			? run(deps, { id: "vm_stat", label: "vm_stat", command: "vm_stat", args: [] })
			: Promise.resolve(null),
	]);
	const totalMemory = deps.os.totalmem();
	const darwinAvailable = vmStat ? parseVmStatAvailableBytes(vmStat) : null;
	return {
		os: osLabel(deps.platform, deps.os.release(), deps.os.version?.()),
		kernel: deps.os.release(),
		arch: deps.os.arch(),
		hostname: deps.os.hostname(),
		cpu: {
			model: cpus[0]?.model.trim() ?? "",
			cores: cpus.length,
			loadPercent: load == null || cpus.length === 0 ? null : Math.round((load / cpus.length) * 100),
		},
		memory: {
			totalBytes: totalMemory,
			freeBytes: darwinAvailable === null ? deps.os.freemem() : Math.min(totalMemory, darwinAvailable),
		},
		disk,
		tools,
		pythonPackages: pip ? countPipPackages(pip) : null,
		npmPackages: npm ? countNpmPackages(npm) : null,
		probedAt: deps.now().toISOString(),
	};
}

export function defaultHostEnvDeps(diskPath: string): HostEnvDeps {
	return {
		platform: process.platform,
		exec: defaultExec,
		os,
		diskPath,
		statfs: (p) => statfs(p),
		now: () => new Date(),
	};
}
