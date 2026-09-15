import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ZoteroStatus } from "@percho/shared";

/**
 * Zotero 接入状态（Zotero 面板用）。刻意在后端 TS 里独立实现少量探测逻辑，
 * 不从 `.pi/lib/zotero-setup.mjs` 动态 import——与全仓约定一致（main/backend 只经 SDK 扩展机制加载 .mjs）。
 * 常量（server 名/本机 API/文档/下载/桌面路径）与 zotero-setup.mjs 保持一致，改动很少。
 */
const ZOTERO_MCP_SERVER = "zotero";
const LOCAL_API = "http://127.0.0.1:23119/api";
const DOCS_URL = "https://github.com/54yyyu/zotero-mcp";
const DOWNLOAD_URL = "https://www.zotero.org/download";

function mcpPath(): string {
	return join(getAgentDir(), "mcp.json");
}

function serverMap(value: unknown): Record<string, unknown> {
	const record = value as { mcpServers?: unknown; "mcp-servers"?: unknown } | null;
	const servers = record?.mcpServers ?? record?.["mcp-servers"];
	return servers && typeof servers === "object" && !Array.isArray(servers)
		? (servers as Record<string, unknown>)
		: {};
}

/** 读取 ~/.pi/agent/mcp.json 里 zotero server 的注册/启用/命令（对应 zotero-setup.mjs readZoteroMcp） */
async function readZoteroMcp(): Promise<{ registered: boolean; enabled: boolean; command: string | null }> {
	const path = mcpPath();
	if (!existsSync(path)) return { registered: false, enabled: false, command: null };
	try {
		const raw = serverMap(JSON.parse(await readFile(path, "utf8")))[ZOTERO_MCP_SERVER];
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			return { registered: false, enabled: false, command: null };
		const server = raw as { disabled?: unknown; command?: unknown };
		return {
			registered: true,
			enabled: server.disabled !== true,
			command: typeof server.command === "string" ? server.command : null,
		};
	} catch {
		return { registered: false, enabled: false, command: null };
	}
}

/** 探测 Zotero 本机 API（桌面端需打开「允许本机其他应用通信」） */
async function probeLocalApi(): Promise<boolean> {
	try {
		await fetch(LOCAL_API, { method: "GET", signal: AbortSignal.timeout(800) });
		return true;
	} catch {
		return false;
	}
}

/** 检测 Zotero 桌面端可执行文件（对应 zotero-setup.mjs zoteroDesktopPath） */
function zoteroDesktopPath(): string | null {
	const home = homedir();
	const candidates =
		process.platform === "win32"
			? [
					join(
						process.env.LOCALAPPDATA || join(home, "AppData", "Local"),
						"Programs",
						"Zotero",
						"zotero.exe",
					),
					join(process.env.ProgramFiles || "C:\\Program Files", "Zotero", "zotero.exe"),
				]
			: process.platform === "darwin"
				? ["/Applications/Zotero.app"]
				: ["/usr/bin/zotero", "/usr/local/bin/zotero", join(home, ".local", "bin", "zotero")];
	return candidates.find((path) => existsSync(path)) || null;
}

export async function getZoteroStatus(): Promise<ZoteroStatus> {
	const [mcp, localApiReachable] = await Promise.all([readZoteroMcp(), probeLocalApi()]);
	const desktopPath = zoteroDesktopPath();
	return {
		registered: mcp.registered,
		enabled: mcp.enabled,
		command: mcp.command,
		localApiReachable,
		desktopDetected: Boolean(desktopPath),
		desktopPath,
		docsUrl: DOCS_URL,
		downloadUrl: DOWNLOAD_URL,
	};
}
