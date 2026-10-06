export type McpServerRuntimeStatus =
	| "connected"
	| "cached"
	| "failed"
	| "needs-auth"
	| "not-connected"
	| "disabled";

export interface McpServerStatus {
	name: string;
	status: McpServerRuntimeStatus;
	toolCount: number;
	resourceCount?: number;
	failedAgoSeconds?: number;
	disabled: boolean;
	listenState?: string;
	catalogStale?: boolean;
}

export interface McpStatus {
	version: 1;
	servers: McpServerStatus[];
	totalTools: number;
	totalResources: number;
	connectedCount: number;
	disabledCount: number;
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

/**
 * 一键接入的现成 MCP（不自研）：写入用户级 ~/.pi/agent/mcp.json，可随时在 MCP 面板停用。
 * computer use 先接浏览器控制（Playwright MCP，微软官方维护）。
 */
export interface McpPreset {
	id: "playwright";
	name: string;
	label: { zh: string; en: string };
	description: { zh: string; en: string };
	homepage: string;
	server: { command: string; args: string[] };
}
export const MCP_PRESETS: readonly McpPreset[] = [
	{
		id: "playwright",
		name: "playwright",
		label: { zh: "浏览器控制（Playwright MCP）", en: "Browser control (Playwright MCP)" },
		description: {
			zh: "让 Agent 打开网页、点击、填表、截图和读取页面结构；首次使用会通过 npx 下载，需要 Node.js。",
			en: "Lets the agent open pages, click, fill forms, take screenshots and read page structure. First use downloads it via npx and needs Node.js.",
		},
		homepage: "https://github.com/microsoft/playwright-mcp",
		server: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
	},
];
