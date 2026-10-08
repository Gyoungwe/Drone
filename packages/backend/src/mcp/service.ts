import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	MCP_PRESETS,
	type McpConfigServer,
	type McpConfigSnapshot,
	type McpPreset,
	type McpRuntimeState,
	type McpStatus,
} from "@drone/shared";
import { getAgentDir } from "../session-engine/sdk";

type RawServer = Record<string, unknown>;
type McpScope = McpConfigServer["scope"];

interface ConfigSource {
	path: string;
	scope: McpScope;
	/**
	 * Pi's own `mcp.json` pair: a project `.pi/mcp.json` entry REPLACES the global
	 * `<agentDir>/mcp.json` entry with the same name (other sources merge field by field),
	 * matching pi-mcp-adapter's `loadMcpConfigWithSources`.
	 */
	piMcp?: "global" | "project";
}

export interface McpServiceOptions {
	agentDir?: string;
	homeDir?: string;
	/**
	 * Reload sessions after a host-facing configuration change. `cwd` limits the reload to one
	 * project; undefined means every open session (user-level config affects all projects).
	 */
	onServerEnabled?: (cwd?: string) => Promise<void>;
	/** Whether this host bundles/loads an MCP runtime (pi-mcp-adapter). */
	runtimeBundled?: boolean;
}

function emptyStatus(runtime?: McpRuntimeState): McpStatus {
	return {
		version: 1,
		servers: [],
		totalTools: 0,
		totalResources: 0,
		connectedCount: 0,
		disabledCount: 0,
		...(runtime ? { runtime } : {}),
	};
}

/** True for entries that only toggle `disabled`/`enabled` (older Drone builds wrote these into `.pi/mcp.json`). */
function isDisableStub(server: unknown): boolean {
	if (!server || typeof server !== "object" || Array.isArray(server)) return false;
	const keys = Object.keys(server);
	return keys.length > 0 && keys.every((key) => key === "disabled" || key === "enabled");
}

/**
 * Explicit enabled-state of one raw entry, in the dialect of the file that holds it:
 * - Pi's own `mcp.json` pair (`<agentDir>/mcp.json`, `.pi/mcp.json`): pi-mcp-adapter 5.x translates
 *   only `enabled: false` into a disabled server and IGNORES `disabled`. Older Drone builds and
 *   `/zotero-setup` wrote `disabled: true` there; it is still read as the user's intent (back-compat)
 *   and rewritten as `enabled: false` on the next toggle / startup normalization.
 * - Every other source (`.mcp.json`, `~/.config/mcp/mcp.json`, `mcp-adapter.json`): the adapter's own
 *   format, where only a literal `disabled: true` disables.
 * Returns undefined when the entry does not set the state.
 */
export function rawServerDisabled(server: RawServer, piFormat: boolean): boolean | undefined {
	if (piFormat) {
		if (server.enabled === false) return true;
		if (server.disabled === true) return true;
		if (server.enabled === true) return false;
		return undefined;
	}
	if (server.disabled === true) return true;
	if (server.disabled === false) return false;
	return undefined;
}

/** Copy of `server` with its enabled-state written in the dialect pi-mcp-adapter honours for that file. */
export function withServerEnabled(server: RawServer, enabled: boolean, piFormat: boolean): RawServer {
	const next = { ...server };
	if (piFormat) {
		// Pi format: `disabled` is not a Pi field (the adapter ignores it), so never keep it.
		delete next.disabled;
		if (enabled) delete next.enabled;
		else next.enabled = false;
		return next;
	}
	if (enabled) delete next.disabled;
	else next.disabled = true;
	return next;
}

/**
 * Rewrite legacy `disabled` flags in a Pi-format server map (`disabled: true` → `enabled: false`,
 * `disabled: false` → removed). Returns true when something changed.
 */
export function normalizeLegacyPiServers(servers: Record<string, unknown>): boolean {
	let changed = false;
	for (const [name, raw] of Object.entries(servers)) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const server = raw as RawServer;
		if (!Object.hasOwn(server, "disabled")) continue;
		const disabled = rawServerDisabled(server, true) === true;
		servers[name] = withServerEnabled(server, !disabled, true);
		changed = true;
	}
	return changed;
}

export interface McpStatusLogLine {
	level: "info" | "warn";
	message: string;
	data: Record<string, unknown>;
}

/** Describe server state transitions between two runtime snapshots for main.log. */
export function describeMcpStatusChange(
	previous: McpStatus | undefined,
	next: McpStatus,
): McpStatusLogLine[] {
	const lines: McpStatusLogLine[] = [];
	const before = new Map((previous?.servers ?? []).map((server) => [server.name, server]));
	for (const server of next.servers) {
		const prior = before.get(server.name);
		if (prior && prior.status === server.status && prior.toolCount === server.toolCount) continue;
		const data: Record<string, unknown> = {
			server: server.name,
			status: server.status,
			tools: server.toolCount,
		};
		if (server.blockedReason) data.reason = server.blockedReason;
		if (server.status === "failed" || server.status === "needs-auth" || server.status === "blocked") {
			lines.push({ level: "warn", message: `MCP server ${server.status}`, data });
		} else if (server.status === "connected" || server.status === "cached") {
			lines.push({ level: "info", message: "MCP server ready", data });
		} else {
			lines.push({ level: "info", message: `MCP server ${server.status}`, data });
		}
	}
	for (const name of before.keys()) {
		if (!next.servers.some((server) => server.name === name))
			lines.push({ level: "info", message: "MCP server removed", data: { server: name } });
	}
	if (
		!previous ||
		previous.totalTools !== next.totalTools ||
		previous.connectedCount !== next.connectedCount
	) {
		lines.push({
			level: "info",
			message: "MCP runtime status",
			data: {
				servers: next.servers.length,
				connected: next.connectedCount,
				disabled: next.disabledCount,
				tools: next.totalTools,
			},
		});
	}
	return lines;
}

function transportOf(server: RawServer): McpConfigServer["transport"] {
	if (typeof server.command === "string") return "stdio";
	if (typeof server.url === "string") return "http";
	if (typeof server.socket === "string") return "socket";
	return "unknown";
}

function serverMap(value: Record<string, unknown>): Record<string, unknown> {
	const servers = value.mcpServers ?? value["mcp-servers"];
	return servers && typeof servers === "object" && !Array.isArray(servers)
		? (servers as Record<string, unknown>)
		: {};
}

async function readRaw(path: string): Promise<Record<string, unknown>> {
	if (!existsSync(path)) return {};
	// Windows PowerShell 5 (`Set-Content -Encoding UTF8`) writes a BOM, which JSON.parse rejects.
	const text = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${path} must contain an object`);
	}
	return value as Record<string, unknown>;
}

function mergeServer(base: RawServer | undefined, next: RawServer): RawServer {
	const merged = { ...base, ...next };
	if (typeof next.command === "string") {
		delete merged.url;
		delete merged.socket;
	} else if (typeof next.url === "string") {
		delete merged.command;
		delete merged.socket;
	} else if (typeof next.socket === "string") {
		delete merged.command;
		delete merged.url;
	}
	return merged;
}

export interface McpServicePort {
	getStatus(cwd?: string): McpStatus;
	getConfig(cwd?: string): Promise<McpConfigSnapshot>;
	setServerEnabled(name: string, enabled: boolean, cwd?: string): Promise<McpConfigSnapshot>;
	addPreset?(id: McpPreset["id"], cwd?: string): Promise<McpConfigSnapshot>;
}

export class McpService implements McpServicePort {
	private readonly agentDir: string;
	private readonly homeDir: string;
	private readonly onServerEnabled?: (cwd?: string) => Promise<void>;
	private readonly runtimeBundled: boolean;
	private lastStatus: McpStatus | undefined;
	private readonly statusByCwd = new Map<string, McpStatus>();

	constructor(options: McpServiceOptions = {}) {
		this.agentDir = options.agentDir ?? getAgentDir();
		this.homeDir = options.homeDir ?? homedir();
		this.onServerEnabled = options.onServerEnabled;
		this.runtimeBundled = options.runtimeBundled === true;
	}

	/** Same precedence order as pi-mcp-adapter 5.x (later sources win). */
	private sources(cwd?: string): ConfigSource[] {
		const sources: ConfigSource[] = [
			{ path: join(this.homeDir, ".config", "mcp", "mcp.json"), scope: "user" },
			{ path: join(this.homeDir, ".agents", "mcp.json"), scope: "user" },
			{ path: join(this.homeDir, ".agents", "mcp", "mcp.json"), scope: "user" },
			{ path: join(this.agentDir, "mcp.json"), scope: "user", piMcp: "global" },
			{ path: join(this.agentDir, "mcp-adapter.json"), scope: "user" },
		];
		if (cwd) {
			const project = resolve(cwd);
			sources.push(
				{ path: join(project, ".mcp.json"), scope: "project" },
				{ path: join(project, ".pi", "mcp.json"), scope: "project", piMcp: "project" },
				{ path: join(project, ".pi", "mcp-adapter.json"), scope: "project" },
			);
		}
		const seen = new Set<string>();
		return sources.filter((source) => !seen.has(source.path) && seen.add(source.path));
	}

	private async readSources(
		cwd?: string,
	): Promise<{ source: ConfigSource; value: Record<string, unknown>; servers: Record<string, unknown> }[]> {
		const result = [];
		for (const source of this.sources(cwd)) {
			const value = await readRaw(source.path);
			result.push({ source, value, servers: serverMap(value) });
		}
		return result;
	}

	setStatus(status: McpStatus, cwd?: string): void {
		const next = { ...structuredClone(status), runtime: "running" as const };
		this.lastStatus = next;
		if (cwd) this.statusByCwd.set(resolve(cwd), structuredClone(next));
	}

	/** Last runtime snapshot for a project (undefined until the runtime reports). */
	peekStatus(cwd: string): McpStatus | undefined {
		const status = this.statusByCwd.get(resolve(cwd));
		return status ? structuredClone(status) : undefined;
	}

	getStatus(cwd?: string): McpStatus {
		const fallback = emptyStatus(this.runtimeBundled ? "starting" : "missing");
		if (!cwd) return structuredClone(this.lastStatus ?? fallback);
		return structuredClone(this.statusByCwd.get(resolve(cwd)) ?? fallback);
	}

	async getConfig(cwd?: string): Promise<McpConfigSnapshot> {
		const loaded = await this.readSources(cwd);
		const sources = loaded.map((item) => item.source);
		const merged = new Map<string, { server: RawServer; source: ConfigSource; disabled: boolean }>();
		const piProjectNames = new Set(
			Object.keys(loaded.find((item) => item.source.piMcp === "project")?.servers ?? {}),
		);

		for (const { source, servers } of loaded) {
			for (const [name, raw] of Object.entries(servers)) {
				if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
				// pi-mcp-adapter: the project .pi/mcp.json entry replaces the global mcp.json one.
				if (source.piMcp === "global" && piProjectNames.has(name)) continue;
				const previous = merged.get(name);
				// Later sources win the enabled-state only when they set it explicitly (adapter merge semantics).
				const explicit = rawServerDisabled(raw as RawServer, source.piMcp !== undefined);
				merged.set(name, {
					server: mergeServer(previous?.server, raw as RawServer),
					source,
					disabled: explicit ?? previous?.disabled ?? false,
				});
			}
		}

		const preferredPath =
			[...sources]
				.reverse()
				.find((source) => !source.path.endsWith("mcp-adapter.json") && existsSync(source.path))?.path ??
			(cwd ? join(resolve(cwd), ".mcp.json") : join(this.agentDir, "mcp.json"));
		const servers = [...merged.entries()].map(([name, { server, source, disabled }]) => ({
			name,
			transport: transportOf(server),
			...(typeof server.command === "string" ? { command: server.command } : {}),
			...(typeof server.url === "string" ? { url: server.url } : {}),
			disabled,
			scope: source.scope,
			sourcePath: source.path,
		}));
		return { path: preferredPath, cwd: cwd ? resolve(cwd) : null, servers };
	}

	/**
	 * Toggle a server in the file that owns its definition (the highest-precedence source that
	 * defines it with more than an enabled-state). Never writes partial `{ disabled }`/`{ enabled }`
	 * entries: in pi's project `.pi/mcp.json` such a stub REPLACES the global definition and leaves a
	 * server without command/url. Stubs left by older builds are removed while toggling.
	 *
	 * The state is written in the dialect pi-mcp-adapter 5.x honours for the owning file: `enabled: false`
	 * (removed to enable) in Pi's `mcp.json` pair, `disabled: true` elsewhere. Legacy `disabled` flags in
	 * Pi files are normalized on the way.
	 */
	async setServerEnabled(name: string, enabled: boolean, cwd?: string): Promise<McpConfigSnapshot> {
		const loaded = await this.readSources(cwd);
		const definers = loaded.filter(({ servers }) => Object.hasOwn(servers, name));
		if (definers.length === 0) throw new Error(`MCP server not found: ${name}`);
		for (const { servers } of definers) {
			const raw = servers[name];
			if (!raw || typeof raw !== "object" || Array.isArray(raw))
				throw new Error(`MCP server must be an object: ${name}`);
		}
		const owner =
			[...definers].reverse().find(({ servers }) => !isDisableStub(servers[name])) ?? definers.at(-1);
		if (!owner) throw new Error(`MCP server not found: ${name}`);
		const touched = new Set<(typeof loaded)[number]>();
		for (const item of definers) {
			if (item === owner || !isDisableStub(item.servers[name])) continue;
			delete item.servers[name];
			touched.add(item);
		}
		const piFormat = (item: (typeof loaded)[number]) => item.source.piMcp !== undefined;
		owner.servers[name] = withServerEnabled(owner.servers[name] as RawServer, enabled, piFormat(owner));
		touched.add(owner);
		if (enabled) {
			// A lower-precedence definition that is still disabled would otherwise keep the server off
			// (adapter sources merge field by field; a Pi-format owner cannot express `disabled: false`).
			// Clear the flag where it lives, on full definitions only.
			for (const item of definers) {
				if (item === owner || !Object.hasOwn(item.servers, name)) continue;
				const raw = item.servers[name] as RawServer;
				if (rawServerDisabled(raw, piFormat(item)) !== true) continue;
				if (piFormat(owner)) {
					item.servers[name] = withServerEnabled(raw, true, piFormat(item));
					touched.add(item);
				} else {
					// Adapter-format owner: an explicit `disabled: false` wins the merge without touching others.
					owner.servers[name] = { ...(owner.servers[name] as RawServer), disabled: false };
				}
			}
		}
		for (const item of touched) {
			if (piFormat(item)) normalizeLegacyPiServers(item.servers);
			const key =
				item.value["mcp-servers"] !== undefined && item.value.mcpServers === undefined
					? "mcp-servers"
					: "mcpServers";
			item.value[key] = item.servers;
			await this.writeRaw(item.source.path, item.value);
		}
		const projectScoped = [...touched].some((item) => item.source.scope === "project");
		await this.onServerEnabled?.(projectScoped && cwd ? cwd : undefined);
		return this.getConfig(cwd);
	}

	/**
	 * One-shot startup migration of the user-level Pi config (`<agentDir>/mcp.json`): legacy
	 * `disabled: true` entries written by older Drone builds / `/zotero-setup` are ignored by
	 * pi-mcp-adapter 5.x (so "disabled" servers still started). Rewrites them as `enabled: false`.
	 * Project files are never touched here. Returns true when the file was rewritten.
	 */
	async normalizeLegacyUserConfig(): Promise<boolean> {
		const path = join(this.agentDir, "mcp.json");
		const value = await readRaw(path);
		const servers = serverMap(value);
		if (!normalizeLegacyPiServers(servers)) return false;
		const key =
			value["mcp-servers"] !== undefined && value.mcpServers === undefined ? "mcp-servers" : "mcpServers";
		value[key] = servers;
		await this.writeRaw(path, value);
		return true;
	}

	/**
	 * 一键接入预设 MCP：写入用户级 mcp.json；同名已存在时只重新启用，不覆盖用户改过的命令。
	 * 用户级配置影响所有项目，所以重载全部会话；`cwd` 只决定返回哪个项目的有效配置。
	 */
	async addPreset(id: McpPreset["id"], cwd?: string): Promise<McpConfigSnapshot> {
		const preset = MCP_PRESETS.find((item) => item.id === id);
		if (!preset) throw new Error(`Unknown MCP preset: ${id}`);
		const path = join(this.agentDir, "mcp.json");
		const value = await readRaw(path);
		const key =
			value["mcp-servers"] !== undefined && value.mcpServers === undefined ? "mcp-servers" : "mcpServers";
		const servers = serverMap(value);
		const existing = servers[preset.name];
		if (existing && typeof existing === "object" && !Array.isArray(existing)) {
			const { disabled: _disabled, enabled: _enabled, ...rest } = existing as RawServer;
			servers[preset.name] = isDisableStub(existing)
				? { command: preset.server.command, args: [...preset.server.args] }
				: rest;
		} else {
			servers[preset.name] = { command: preset.server.command, args: [...preset.server.args] };
		}
		normalizeLegacyPiServers(servers);
		value[key] = servers;
		await this.writeRaw(path, value);
		await this.onServerEnabled?.();
		return this.getConfig(cwd);
	}

	private async writeRaw(path: string, value: Record<string, unknown>): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		const tempPath = `${path}.${process.pid}.tmp`;
		await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		await chmod(tempPath, 0o600);
		await rename(tempPath, path);
	}
}
