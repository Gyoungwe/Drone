export type McpServerRuntimeStatus =
	| "connected"
	| "cached"
	| "failed"
	| "needs-auth"
	| "not-connected"
	| "disabled"
	| "blocked";

export interface McpServerStatus {
	name: string;
	status: McpServerRuntimeStatus;
	toolCount: number;
	directToolCount?: number;
	resourceCount?: number;
	failedAgoSeconds?: number;
	disabled: boolean;
	listenState?: string;
	catalogStale?: boolean;
	/** Why the runtime refused a project-scoped server (e.g. project servers need approval). */
	blockedReason?: string;
}

/**
 * MCP runtime state as seen by the host:
 * - `missing`: no MCP runtime (pi-mcp-adapter) is bundled/loaded, so mcp.json is never read.
 * - `starting`: the runtime is bundled but has not reported status for this project yet.
 * - `running`: the runtime reported at least one status snapshot.
 */
export type McpRuntimeState = "missing" | "starting" | "running";

export interface McpStatus {
	version: 1;
	servers: McpServerStatus[];
	totalTools: number;
	totalResources: number;
	connectedCount: number;
	disabledCount: number;
	runtime?: McpRuntimeState;
}

export interface McpConfigServer {
	name: string;
	transport: "stdio" | "http" | "socket" | "unknown";
	command?: string;
	url?: string;
	disabled: boolean;
	scope: "user" | "project";
	sourcePath: string;
}

export interface McpConfigSnapshot {
	path: string;
	cwd: string | null;
	servers: McpConfigServer[];
}

export interface McpStatusEvent {
	cwd: string;
	status: McpStatus;
}

/** Bundled MCP runtime: the desktop installer ships this exact pi package (see packages/desktop/pi-packages). */
export const MCP_RUNTIME_PACKAGE = "pi-mcp-adapter";
/** pi-mcp-adapter 5.1.0 is the first release whose peer range accepts @earendil-works/pi-ai ^1.0.0 (Drone ships pi 1.0.0). */
export const MCP_RUNTIME_VERSION = "5.1.0";

const SERVER_STATUSES: ReadonlySet<string> = new Set<McpServerRuntimeStatus>([
	"connected",
	"cached",
	"failed",
	"needs-auth",
	"not-connected",
	"disabled",
	"blocked",
]);

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * Reduce a runtime status snapshot (pi-mcp-adapter `pi-mcp-adapter/status/v1`) to the host contract.
 * Unknown fields are dropped and unknown server states become `not-connected`, so a newer
 * runtime can never break the strict IPC schema. Returns null for payloads that are not snapshots.
 */
export function normalizeMcpStatus(payload: unknown, runtime: McpRuntimeState = "running"): McpStatus | null {
	if (!payload || typeof payload !== "object") return null;
	const raw = payload as Record<string, unknown>;
	if (raw.version !== 1 || !Array.isArray(raw.servers)) return null;
	const servers: McpServerStatus[] = [];
	for (const item of raw.servers) {
		if (!item || typeof item !== "object") continue;
		const server = item as Record<string, unknown>;
		if (typeof server.name !== "string" || !server.name) continue;
		const status =
			typeof server.status === "string" && SERVER_STATUSES.has(server.status)
				? server.status
				: "not-connected";
		servers.push({
			name: server.name,
			status: status as McpServerRuntimeStatus,
			toolCount: count(server.toolCount),
			...(server.directToolCount !== undefined ? { directToolCount: count(server.directToolCount) } : {}),
			...(server.resourceCount !== undefined ? { resourceCount: count(server.resourceCount) } : {}),
			...(typeof server.failedAgoSeconds === "number" && server.failedAgoSeconds >= 0
				? { failedAgoSeconds: server.failedAgoSeconds }
				: {}),
			disabled: server.disabled === true,
			...(typeof server.listenState === "string" ? { listenState: server.listenState } : {}),
			...(server.catalogStale === true ? { catalogStale: true } : {}),
			...(typeof server.blockedReason === "string" ? { blockedReason: server.blockedReason } : {}),
		});
	}
	return {
		version: 1,
		servers,
		totalTools: count(raw.totalTools),
		totalResources: count(raw.totalResources),
		connectedCount: count(raw.connectedCount),
		disabledCount: count(raw.disabledCount),
		runtime,
	};
}

/**
 * 一键接入的现成 MCP（不自研）：写入用户级 ~/.pi/agent/mcp.json，可随时在 MCP 面板停用。
 * computer use 先接浏览器控制（Playwright MCP，微软官方维护）。
 */
export interface McpPreset {
	id: "playwright" | "playwright-chrome";
	name: string;
	label: { zh: string; en: string };
	description: { zh: string; en: string };
	/** Extra steps the user must do outside Drone (e.g. install a browser extension). */
	setup?: { zh: string; en: string; url: string };
	homepage: string;
	server: { command: string; args: string[] };
}
export const MCP_PRESETS: readonly McpPreset[] = [
	{
		id: "playwright",
		name: "playwright",
		label: { zh: "浏览器控制（Playwright MCP）", en: "Browser control (Playwright MCP)" },
		description: {
			zh: "让 Agent 用你电脑上的 Chrome 打开一个独立窗口，打开网页、点击、填表、截图和读取页面结构；登录状态会保存在该浏览器配置里，下次无需重登。遇到 Cloudflare 等人机验证时，Agent 会停下来请你在窗口里手动完成，不会尝试绕过。首次使用会通过 npx 下载，需要 Node.js。它看不到你已经打开的 Chrome 标签页。",
			en: "Lets the agent drive a separate window of your installed Chrome: open pages, click, fill forms, take screenshots and read page structure. Sign-ins are kept in that browser profile so you do not log in again. On Cloudflare or other human checks the agent stops and asks you to complete them in the window; it never tries to bypass them. First use downloads it via npx and needs Node.js. It cannot see the Chrome tabs you already have open.",
		},
		homepage: "https://github.com/microsoft/playwright-mcp",
		server: { command: "npx", args: ["-y", "@playwright/mcp@latest", "--browser", "chrome"] },
	},
	{
		id: "playwright-chrome",
		name: "playwright-chrome",
		label: { zh: "控制我已打开的 Chrome", en: "Control my open Chrome" },
		description: {
			zh: "用 Playwright MCP 的扩展模式连接你正在用的 Chrome / Edge，复用已打开的标签页和登录状态；首次连接时在浏览器里选择要交给 Agent 的标签页。需要 Node.js。",
			en: "Connects Playwright MCP in extension mode to the Chrome or Edge you are using, reusing open tabs and signed-in sessions. On first connection you pick the tab to hand over. Needs Node.js.",
		},
		setup: {
			zh: "先在 Chrome 应用商店安装「Playwright MCP Bridge」扩展（必须从商店安装，手动加载的扩展 ID 不同会连不上）；想免去每次确认，可把扩展页显示的 PLAYWRIGHT_MCP_EXTENSION_TOKEN 填进该服务的 env。",
			en: 'First install the "Playwright MCP Bridge" extension from the Chrome Web Store (unpacked builds have a different ID and will not connect). To skip the per-connection prompt, add the PLAYWRIGHT_MCP_EXTENSION_TOKEN shown by the extension to the server env.',
			url: "https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm",
		},
		homepage: "https://github.com/microsoft/playwright-mcp/tree/main/packages/extension",
		server: { command: "npx", args: ["-y", "@playwright/mcp@latest", "--extension"] },
	},
];
