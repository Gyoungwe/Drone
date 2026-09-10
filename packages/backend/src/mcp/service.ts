import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { McpConfigServer, McpConfigSnapshot, McpStatus } from "@percho/shared";

type RawServer = Record<string, unknown>;

function configPath(): string {
	return join(getAgentDir(), "mcp.json");
}

function transportOf(server: RawServer): McpConfigServer["transport"] {
	if (typeof server.command === "string") return "stdio";
	if (typeof server.url === "string") return "http";
	if (typeof server.socket === "string") return "socket";
	return "unknown";
}

async function readRaw(): Promise<{ path: string; value: Record<string, unknown> }> {
	const path = configPath();
	if (!existsSync(path)) return { path, value: { mcpServers: {} } };
	const text = await readFile(path, "utf8");
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mcp.json must contain an object");
	return { path, value: value as Record<string, unknown> };
}

export class McpService {
	private status: McpStatus = {
		version: 1,
		servers: [],
		totalTools: 0,
		totalResources: 0,
		connectedCount: 0,
		disabledCount: 0,
	};

	setStatus(status: McpStatus): void {
		this.status = status;
	}

	getStatus(): McpStatus {
		return structuredClone(this.status);
	}

	async getConfig(): Promise<McpConfigSnapshot> {
		const { path, value } = await readRaw();
		const servers = value.mcpServers && typeof value.mcpServers === "object" && !Array.isArray(value.mcpServers)
			? Object.entries(value.mcpServers as Record<string, unknown>).map(([name, raw]) => {
					const server = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as RawServer : {};
					return {
						name,
						transport: transportOf(server),
						...(typeof server.command === "string" ? { command: server.command } : {}),
						...(typeof server.url === "string" ? { url: server.url } : {}),
						disabled: server.disabled === true,
					};
				})
			: [];
		return { path, servers };
	}

	async setServerEnabled(name: string, enabled: boolean): Promise<McpConfigSnapshot> {
		const { path, value } = await readRaw();
		const servers = value.mcpServers;
		if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw new Error("mcpServers must be an object");
		const server = (servers as Record<string, unknown>)[name];
		if (!server || typeof server !== "object" || Array.isArray(server)) throw new Error(`MCP server not found: ${name}`);
		const next = { ...(server as RawServer) };
		if (enabled) delete next.disabled;
		else next.disabled = true;
		(servers as Record<string, unknown>)[name] = next;
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		return this.getConfig();
	}
}
