import { spawn } from "node:child_process";
import { access, constants, statfs } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import { delimiter, join } from "node:path";

/**
 * 生信执行环境探测：常用命令行工具（含版本）、conda/mamba 环境、容器运行时、CPU/内存/磁盘。
 * 本地用 Node 直接探测；远程主机把同一份清单变成一段 POSIX sh，经 SSH 执行后用同一个解析器读回。
 */

/** 工具名 → 打印版本的参数（输出里第一个像版本号的片段即版本） */
export const BIO_TOOLS: Record<string, string[]> = {
	samtools: ["--version"],
	bcftools: ["--version"],
	bedtools: ["--version"],
	seqkit: ["version"],
	fastp: ["--version"],
	bwa: [],
	"bwa-mem2": ["version"],
	minimap2: ["--version"],
	hisat2: ["--version"],
	STAR: ["--version"],
	salmon: ["--version"],
	featureCounts: ["-v"],
	gatk: ["--version"],
	blastn: ["-version"],
	diamond: ["version"],
	hmmsearch: ["-h"],
	mafft: ["--version"],
	trimal: ["--version"],
	iqtree2: ["--version"],
	iqtree: ["--version"],
	iqtree3: ["--version"],
	FastTree: [],
	fasttree: [],
	"raxml-ng": ["--version"],
	muscle: ["-version"],
	clustalo: ["--version"],
	busco: ["--version"],
	orthofinder: ["-h"],
	nextflow: ["-version"],
	snakemake: ["--version"],
	Rscript: ["--version"],
	python3: ["--version"],
};
export const ENV_MANAGERS = ["mamba", "micromamba", "conda"];
export const CONTAINER_RUNTIMES = ["apptainer", "singularity", "docker"];

export interface BioEnvironment {
	where: "local" | "remote";
	host?: string;
	tools: Record<string, string | null>;
	envManager: string | null;
	condaEnvs: string[];
	containers: string[];
	cpus: number | null;
	memoryGb: number | null;
	freeMemoryGb: number | null;
	freeDiskGb: number | null;
}

const VERSION = /\d+\.\d+(?:\.\d+)*[A-Za-z]?(?:[-+][0-9A-Za-z][0-9A-Za-z.]*)?/;

/** 从命令输出里取版本号；找不到版本但命令存在时返回 "installed" */
export function parseVersion(output: string): string {
	return VERSION.exec(output)?.[0] ?? "installed";
}

async function onPath(name: string): Promise<string | null> {
	const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
	for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
		for (const ext of extensions) {
			const full = join(dir, name + ext);
			try {
				await access(full, process.platform === "win32" ? constants.F_OK : constants.X_OK);
				return full;
			} catch {
				/* keep looking */
			}
		}
	}
	return null;
}

function run(command: string, args: string[], timeoutMs = 6000): Promise<string> {
	return new Promise((resolve) => {
		let output = "";
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		} catch {
			resolve("");
			return;
		}
		const timer = setTimeout(() => child.kill(), timeoutMs);
		const take = (chunk: Buffer) => {
			if (output.length < 8000) output += chunk.toString("utf8");
		};
		child.stdout?.on("data", take);
		child.stderr?.on("data", take);
		child.once("error", () => {
			clearTimeout(timer);
			resolve(output);
		});
		child.once("close", () => {
			clearTimeout(timer);
			resolve(output);
		});
	});
}

/** 本地探测（不需要审批：只运行各工具的版本参数，不读写数据） */
export async function probeLocal(cwd: string): Promise<BioEnvironment> {
	const tools: Record<string, string | null> = {};
	await Promise.all(
		Object.entries(BIO_TOOLS).map(async ([name, args]) => {
			const path = await onPath(name);
			tools[name] = path ? parseVersion(await run(path, args)) : null;
		}),
	);
	let envManager: string | null = null;
	let condaEnvs: string[] = [];
	for (const manager of ENV_MANAGERS) {
		const path = await onPath(manager);
		if (!path) continue;
		envManager = manager;
		condaEnvs = parseCondaEnvs(await run(path, ["env", "list"], 10_000));
		break;
	}
	const containers: string[] = [];
	for (const runtime of CONTAINER_RUNTIMES) if (await onPath(runtime)) containers.push(runtime);
	let freeDiskGb: number | null = null;
	try {
		const disk = await statfs(cwd);
		freeDiskGb = round((disk.bavail * disk.bsize) / 1024 ** 3);
	} catch {
		/* unknown */
	}
	return {
		where: "local",
		tools,
		envManager,
		condaEnvs,
		containers,
		cpus: cpus().length,
		memoryGb: round(totalmem() / 1024 ** 3),
		freeMemoryGb: round(freemem() / 1024 ** 3),
		freeDiskGb,
	};
}

/** conda/mamba `env list` 的文本输出 → 环境名（或路径末段）；micromamba / mamba 2 的表头与分隔线跳过 */
export function parseCondaEnvs(text: string): string[] {
	const names: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		if (/^Name\s+Active\s+Path$/.test(trimmed) || /^[─━\-=\s]+$/.test(trimmed)) continue;
		const first = trimmed.split(/\s+/)[0] ?? "";
		const name = first.startsWith("/") || /^[A-Za-z]:\\/.test(first) ? first.split(/[\\/]/).pop() : first;
		if (name && name !== "*" && !names.includes(name)) names.push(name);
	}
	return names.slice(0, 50);
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 远程探测脚本：每行 `key<TAB>value`，只运行版本参数与资源查询 */
export function remoteProbeScript(): string {
	const toolLines = Object.entries(BIO_TOOLS).map(
		([name, args]) =>
			`if command -v ${name} >/dev/null 2>&1; then printf 'tool\\t${name}\\t%s\\n' "$(${name} ${args.map(shellQuote).join(" ")} 2>&1 | head -n 5 | tr '\\n\\t' '  ')"; fi`,
	);
	return [
		...toolLines,
		`for m in ${ENV_MANAGERS.join(" ")}; do if command -v $m >/dev/null 2>&1; then printf 'manager\\t%s\\n' "$m"; $m env list 2>/dev/null | while IFS= read -r l; do printf 'env\\t%s\\n' "$l"; done; break; fi; done`,
		`for c in ${CONTAINER_RUNTIMES.join(" ")}; do command -v $c >/dev/null 2>&1 && printf 'container\\t%s\\n' "$c"; done`,
		`printf 'cpus\\t%s\\n' "$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null)"`,
		`awk '/MemTotal/{printf "memkb\\t%s\\n",$2} /MemAvailable/{printf "memfreekb\\t%s\\n",$2}' /proc/meminfo 2>/dev/null`,
		`df -Pk . 2>/dev/null | awk 'NR==2{printf "diskfreekb\\t%s\\n",$4}'`,
	].join("\n");
}

/** 解析远程探测输出 */
export function parseRemoteProbe(host: string, output: string): BioEnvironment {
	const tools: Record<string, string | null> = Object.fromEntries(
		Object.keys(BIO_TOOLS).map((name) => [name, null]),
	);
	let envManager: string | null = null;
	const envLines: string[] = [];
	const containers: string[] = [];
	let cpusValue: number | null = null;
	let memKb: number | null = null;
	let memFreeKb: number | null = null;
	let diskKb: number | null = null;
	for (const line of output.split(/\r?\n/)) {
		const [key, a = "", b = ""] = line.split("\t");
		if (key === "tool" && a in tools) tools[a] = parseVersion(b);
		else if (key === "manager") envManager = a.trim() || null;
		else if (key === "env") envLines.push(a);
		else if (key === "container" && a) containers.push(a.trim());
		else if (key === "cpus") cpusValue = Number(a) || null;
		else if (key === "memkb") memKb = Number(a) || null;
		else if (key === "memfreekb") memFreeKb = Number(a) || null;
		else if (key === "diskfreekb") diskKb = Number(a) || null;
	}
	return {
		where: "remote",
		host,
		tools,
		envManager,
		condaEnvs: parseCondaEnvs(envLines.join("\n")),
		containers,
		cpus: cpusValue,
		memoryGb: memKb === null ? null : round(memKb / 1024 ** 2),
		freeMemoryGb: memFreeKb === null ? null : round(memFreeKb / 1024 ** 2),
		freeDiskGb: diskKb === null ? null : round(diskKb / 1024 ** 2),
	};
}

/** 给模型看的摘要：已装工具（含版本）、缺失工具、环境与资源 */
export function formatEnvironment(env: BioEnvironment): string {
	const installed = Object.entries(env.tools).filter(([, version]) => version);
	const missing = Object.entries(env.tools)
		.filter(([, version]) => !version)
		.map(([name]) => name);
	return [
		`Environment: ${env.where}${env.host ? ` (${env.host})` : ""}`,
		`Resources: ${env.cpus ?? "?"} CPUs, ${env.memoryGb ?? "?"} GB RAM (${env.freeMemoryGb ?? "?"} GB free), ${env.freeDiskGb ?? "?"} GB free disk in the working directory`,
		`Environment manager: ${env.envManager ?? "none"}${env.condaEnvs.length ? `; envs: ${env.condaEnvs.join(", ")}` : ""}`,
		`Containers: ${env.containers.length ? env.containers.join(", ") : "none"}`,
		`Installed tools: ${installed.length ? installed.map(([name, version]) => `${name} ${version}`).join(", ") : "none of the common bioinformatics tools"}`,
		`Not found: ${missing.join(", ") || "-"}`,
		...installHints(env),
		"Record the versions you actually use (they belong in the run record and the Methods section).",
	].join("\n");
}

/** 常见分析所需工具组：缺失时给出 mamba/bioconda 安装建议，而不是让模型直接放弃。 */
export const TOOL_GROUPS: { id: string; label: string; anyOf: string[][]; packages: string[] }[] = [
	{
		id: "phylogeny",
		label: "phylogenetic trees (align → trim → infer)",
		anyOf: [
			["mafft", "muscle", "clustalo"],
			["iqtree2", "iqtree", "iqtree3", "FastTree", "fasttree", "raxml-ng"],
		],
		packages: ["mafft", "trimal", "iqtree", "fasttree"],
	},
];
export function missingToolGroups(env: BioEnvironment) {
	return TOOL_GROUPS.filter((group) =>
		group.anyOf.some((alternatives) => !alternatives.some((t) => env.tools[t])),
	);
}
export function installHints(env: BioEnvironment): string[] {
	return missingToolGroups(env).map((group) => {
		const manager = env.envManager ?? "mamba";
		const command = `${manager} create -n ${group.id} -c conda-forge -c bioconda ${group.packages.join(" ")}`;
		return env.envManager
			? `Missing for ${group.label}: install into a dedicated env with \`${command}\` (needs the user's approval through task_plan), then run inside it; Python-only steps can use the skill's packages (e.g. ete4, biopython).`
			: `Missing for ${group.label}: no conda/mamba found; propose installing Miniforge (mamba) and then \`${command}\`, or a container (bioconda images) — ask the user, do not stop silently.`;
	});
}
