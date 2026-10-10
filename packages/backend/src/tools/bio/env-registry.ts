import { join } from "node:path";
import { decodeDurableDocument, makeDurableDocument } from "@drone/shared";
import { readDurableDocument, writeDurableDocument } from "../../state/durable-doc";
import { BIO_TOOLS, parseVersion } from "./environment";

/**
 * 分析环境登记表：跨会话记住已经建好的 conda/mamba 环境（本地或远程主机），下次先复用、复用前验证。
 * Registry of analysis environments, persisted at <agentDir>/environments.json. It only records metadata;
 * creating/removing environments still goes through the shell under the normal task/permission flow.
 */
export interface EnvRecord {
	name: string;
	/** "local" or a registered SSH host alias */
	host: string;
	manager: string;
	/** env prefix path when known */
	prefix?: string;
	/** tool → version observed at the last verification */
	tools: Record<string, string>;
	packages?: string[];
	purpose?: string;
	/** e.g. "windows x64", "linux x86_64" */
	platform?: string;
	createdAt: string;
	verifiedAt?: string;
	status: "ok" | "broken" | "unverified";
}
export interface EnvRegistry {
	version: 1;
	envs: EnvRecord[];
}
const ENV_REGISTRY_KIND = "drone.bio.environment-registry";
export const ENV_REGISTRY_FILE = "environments.json";
export const ENV_REGISTRY_LIMIT = 100;
const NAME = /^[A-Za-z0-9._-]{1,64}$/;

/** 同一工具的常见别名（iqtree2/iqtree/iqtree3、FastTree/fasttree…），查找复用时视为等价。 */
const TOOL_ALIASES: string[][] = [
	["iqtree", "iqtree2", "iqtree3"],
	["fasttree", "fasttreemp"],
	["blast", "blastn", "blastp"],
	["hmmer", "hmmsearch", "hmmscan"],
	["bwa", "bwa-mem2"],
];
export function canonicalTool(name: string): string {
	const lower = name.trim().toLowerCase();
	return TOOL_ALIASES.find((group) => group.includes(lower))?.[0] ?? lower;
}

export function registryPath(agentDir: string): string {
	return join(agentDir, ENV_REGISTRY_FILE);
}
export function emptyRegistry(): EnvRegistry {
	return { version: 1, envs: [] };
}
export function normalizeRegistry(value: unknown): EnvRegistry {
	const raw = decodeDurableDocument(value, {
		kind: ENV_REGISTRY_KIND,
		version: 1,
		migrate: (legacy) => {
			if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
				const record = legacy as Record<string, unknown>;
				if (record.kind === ENV_REGISTRY_KIND && record.version === 1 && "data" in record) return record.data;
			}
			return legacy;
		},
	}) as Partial<EnvRegistry> | null;
	const version = raw?.version;
	const recorded = raw?.envs;
	if (version !== 1 || !Array.isArray(recorded)) return emptyRegistry();
	const envs = recorded.filter(
		(e): e is EnvRecord =>
			!!e &&
			typeof e.name === "string" &&
			NAME.test(e.name) &&
			typeof e.host === "string" &&
			typeof e.manager === "string" &&
			typeof e.tools === "object" &&
			e.tools !== null,
	);
	return { version: 1, envs: envs.slice(-ENV_REGISTRY_LIMIT) };
}
export async function loadRegistry(agentDir: string): Promise<EnvRegistry> {
	try {
		return normalizeRegistry(
			await readDurableDocument(registryPath(agentDir), {
				kind: ENV_REGISTRY_KIND,
				version: 1,
				migrate: (legacy) => legacy,
			}),
		);
	} catch {
		return emptyRegistry();
	}
}
export async function saveRegistry(agentDir: string, registry: EnvRegistry): Promise<void> {
	const file = registryPath(agentDir);
	await writeDurableDocument(
		file,
		makeDurableDocument(ENV_REGISTRY_KIND, 1, normalizeRegistry(registry), { scope: "agent" }),
	);
}

export function upsertEnv(registry: EnvRegistry, record: EnvRecord): EnvRegistry {
	if (!NAME.test(record.name)) throw new Error(`invalid environment name: ${record.name}`);
	const envs = registry.envs.filter((e) => !(e.host === record.host && e.name === record.name));
	const previous = registry.envs.find((e) => e.host === record.host && e.name === record.name);
	envs.push({ ...previous, ...record, createdAt: previous?.createdAt ?? record.createdAt });
	return { version: 1, envs: envs.slice(-ENV_REGISTRY_LIMIT) };
}
export function removeEnv(registry: EnvRegistry, host: string, name: string): EnvRegistry {
	return { version: 1, envs: registry.envs.filter((e) => !(e.host === host && e.name === name)) };
}
export function envsOnHost(registry: EnvRegistry, host = "local"): EnvRecord[] {
	return registry.envs.filter((e) => e.host === host);
}

/** 覆盖全部所需工具、未损坏的环境，最近验证的排前面。 */
export function findReusable(registry: EnvRegistry, host: string, tools: readonly string[]): EnvRecord[] {
	const wanted = [...new Set(tools.map(canonicalTool))];
	return envsOnHost(registry, host)
		.filter((e) => e.status !== "broken")
		.filter((e) => {
			const have = new Set(Object.keys(e.tools).map(canonicalTool));
			for (const p of e.packages ?? []) have.add(canonicalTool(p));
			return wanted.every((t) => have.has(t));
		})
		.sort((a, b) => (b.verifiedAt ?? "").localeCompare(a.verifiedAt ?? ""));
}

/** 版本参数：优先用 BIO_TOOLS 里登记的参数，否则 --version。 */
export function versionArgs(tool: string): string[] {
	const exact = Object.entries(BIO_TOOLS).find(([name]) => name.toLowerCase() === tool.toLowerCase());
	return exact ? exact[1] : ["--version"];
}
/** 在环境里检查一个工具的命令（manager run -n env tool args），本地和远程共用。 */
export function verifyArgv(record: Pick<EnvRecord, "manager" | "name" | "prefix">, tool: string): string[] {
	const target = record.prefix ? ["-p", record.prefix] : ["-n", record.name];
	return [record.manager, "run", ...target, tool, ...versionArgs(tool)];
}
export function shellQuote(value: string): string {
	return /^[A-Za-z0-9._\-/:=@+]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
/** 远程验证脚本：每个工具一行 `tool<TAB>name<TAB>output|MISSING` */
export function remoteVerifyScript(record: EnvRecord, tools: readonly string[]): string {
	return tools
		.map((tool) => {
			const cmd = verifyArgv(record, tool).map(shellQuote).join(" ");
			return `if out=$(${cmd} 2>&1); then printf 'tool\\t%s\\t%s\\n' ${shellQuote(tool)} "$(printf '%s' "$out" | head -n 5 | tr '\\n\\t' '  ')"; else printf 'tool\\t%s\\tMISSING\\n' ${shellQuote(tool)}; fi`;
		})
		.join("\n");
}
export function parseVerifyOutput(output: string): Record<string, string | null> {
	const result: Record<string, string | null> = {};
	for (const line of output.split(/\r?\n/)) {
		const [key, tool, value = ""] = line.split("\t");
		if (key !== "tool" || !tool) continue;
		result[tool] = value === "MISSING" ? null : parseVersion(value);
	}
	return result;
}
/** 把一次验证的结果写回记录。 */
export function applyVerification(
	record: EnvRecord,
	observed: Record<string, string | null>,
	now: string,
): EnvRecord {
	const tools = { ...record.tools };
	let missing = 0;
	for (const [tool, version] of Object.entries(observed)) {
		if (version) tools[tool] = version;
		else {
			delete tools[tool];
			missing++;
		}
	}
	const checked = Object.keys(observed).length;
	return {
		...record,
		tools,
		verifiedAt: now,
		status: checked > 0 && missing === checked ? "broken" : "ok",
	};
}
export function formatRecord(e: EnvRecord): string {
	const tools = Object.entries(e.tools)
		.map(([t, v]) => `${t} ${v}`)
		.join(", ");
	return `- ${e.name} @ ${e.host} (${e.manager}${e.prefix ? `, ${e.prefix}` : ""}${e.platform ? `, ${e.platform}` : ""}; ${e.status}${e.verifiedAt ? `, verified ${e.verifiedAt.slice(0, 16)}` : ""})${tools ? `: ${tools}` : ""}${e.purpose ? ` — ${e.purpose}` : ""}`;
}
