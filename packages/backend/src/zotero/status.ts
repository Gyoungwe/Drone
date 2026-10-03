import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readZoteroMcpConfig, ZOTERO_SETUP_BINDING } from "@drone/research/zotero-setup";
import type { ZoteroStatus } from "@drone/shared";
import { getAgentDir } from "../session-engine/sdk";

/**
 * Zotero 接入状态（Zotero 面板用）。刻意在后端 TS 里独立实现少量探测逻辑，
 * 不从 `.pi/lib/zotero-setup.mjs` 动态 import——与全仓约定一致（main/backend 只经 SDK 扩展机制加载 .mjs）。
 * 常量（server 名/本机 API/文档/下载/桌面路径）与 zotero-setup.mjs 保持一致，改动很少。
 */
const LOCAL_API = ZOTERO_SETUP_BINDING.localApi;
const DOCS_URL = ZOTERO_SETUP_BINDING.docs;
const DOWNLOAD_URL = ZOTERO_SETUP_BINDING.download;

function mcpPath(): string {
	return join(getAgentDir(), "mcp.json");
}

/** 读取 ~/.pi/agent/mcp.json 里 zotero server 的注册/启用/命令（对应 zotero-setup.mjs readZoteroMcp） */
async function readZoteroMcp(): Promise<{ registered: boolean; enabled: boolean; command: string | null }> {
	const path = mcpPath();
	if (!existsSync(path)) return { registered: false, enabled: false, command: null };
	try {
		const server = readZoteroMcpConfig(JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")));
		return {
			registered: server.registered,
			enabled: server.registered && !server.disabled,
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
