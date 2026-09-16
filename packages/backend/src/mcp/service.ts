import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { McpConfigServer, McpConfigSnapshot, McpStatus } from "@drone/shared";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

type RawServer = Record<string, unknown>;
type McpScope = McpConfigServer["scope"];

interface ConfigSource {
	path: string;
	scope: McpScope;
}

interface McpServiceOptions {
	agentDir?: string;
	homeDir?: string;
}

function emptyStatus(): McpStatus {
	return {
		version: 1,
		servers: [],
		totalTools: 0,
		totalResources: 0,
		connectedCount: 0,
		disabledCount: 0,
	};
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
	const text = await readFile(path, "utf8");
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

export class McpService {
	private readonly agentDir: string;
	private readonly homeDir: string;
	private lastStatus = emptyStatus();
	private readonly statusByCwd = new Map<string, McpStatus>();

	constructor(options: McpServiceOptions = {}) {
		this.agentDir = options.agentDir ?? getAgentDir();
		this.homeDir = options.homeDir ?? homedir();
	}

	private sources(cwd?: string): ConfigSource[] {
		const sources: ConfigSource[] = [
			{ path: join(this.homeDir, ".config", "mcp", "mcp.json"), scope: "user" },
			{ path: join(this.homeDir, ".agents", "mcp.json"), scope: "user" },
			{ path: join(this.homeDir, ".agents", "mcp", "mcp.json"), scope: "user" },
			{ path: join(this.agentDir, "mcp.json"), scope: "user" },
		];
		if (cwd) {
			const project = resolve(cwd);
			sources.push(
				{ path: join(project, ".mcp.json"), scope: "project" },
				{ path: join(project, ".pi", "mcp.json"), scope: "project" },
			);
		}
		return sources;
	}

	private writePath(cwd?: string): string {
		return cwd ? join(resolve(cwd), ".pi", "mcp.json") : join(this.agentDir, "mcp.json");
	}

	setStatus(status: McpStatus, cwd?: string): void {
		this.lastStatus = structuredClone(status);
		if (cwd) this.statusByCwd.set(resolve(cwd), structuredClone(status));
	}

	getStatus(cwd?: string): McpStatus {
		if (!cwd) return structuredClone(this.lastStatus);
		return structuredClone(this.statusByCwd.get(resolve(cwd)) ?? emptyStatus());
	}

	async getConfig(cwd?: string): Promise<McpConfigSnapshot> {
		const sources = this.sources(cwd);
		const merged = new Map<string, { server: RawServer; source: ConfigSource }>();

		for (const source of sources) {
			const value = await readRaw(source.path);
			for (const [name, raw] of Object.entries(serverMap(value))) {
				if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
				const previous = merged.get(name);
				merged.set(name, {
					server: mergeServer(previous?.server, raw as RawServer),
					source,
				});
			}
		}

		const preferredPath =
			[...sources].reverse().find((source) => existsSync(source.path))?.path ??
			(cwd ? join(resolve(cwd), ".mcp.json") : join(this.agentDir, "mcp.json"));
		const servers = [...merged.entries()].map(([name, { server, source }]) => ({
			name,
			transport: transportOf(server),
			...(typeof server.command === "string" ? { command: server.command } : {}),
			...(typeof server.url === "string" ? { url: server.url } : {}),
			disabled: server.disabled === true,
			scope: source.scope,
			sourcePath: source.path,
		}));
		return { path: preferredPath, cwd: cwd ? resolve(cwd) : null, servers };
	}

	async setServerEnabled(name: string, enabled: boolean, cwd?: string): Promise<McpConfigSnapshot> {
		const effective = await this.getConfig(cwd);
		if (!effective.servers.some((server) => server.name === name)) {
			throw new Error(`MCP server not found: ${name}`);
		}

		const path = this.writePath(cwd);
		const value = await readRaw(path);
		const key =
			value["mcp-servers"] !== undefined && value.mcpServers === undefined ? "mcp-servers" : "mcpServers";
		const servers = serverMap(value);
		const raw = servers[name];
		if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
			throw new Error(`MCP server must be an object: ${name}`);
		}
		servers[name] = { ...(raw as RawServer | undefined), disabled: !enabled };
		value[key] = servers;

		await mkdir(dirname(path), { recursive: true });
		const tempPath = `${path}.${process.pid}.tmp`;
		await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		await chmod(tempPath, 0o600);
		await rename(tempPath, path);
		return this.getConfig(cwd);
	}
}
