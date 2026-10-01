import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildProxiedUrl, inferEzproxyTemplateFromUrl } from "@drone/research/institutional-proxy";

const require = createRequire(import.meta.url);
const PARTITION = "persist:drone-institutional";
const CONFIG_PATH = join(homedir(), ".pi", "agent", "institutional.json");

type PiTool = {
	registerTool(definition: {
		name: string;
		label: string;
		description: string;
		parameters: Record<string, unknown>;
		drone?: Record<string, unknown>;
		execute: (...args: any[]) => Promise<unknown>;
	}): void;
};

type Config = {
	version: 1;
	ezproxyTemplate?: string;
	institutionName?: string;
	autoDownloadEnabled: boolean;
	perTaskLimit: number;
	lastLoginAt?: string;
	lastLoginUrl?: string;
};

const defaultConfig = (): Config => ({ version: 1, autoDownloadEnabled: true, perTaskLimit: 20 });

function normalizeConfig(raw: unknown): Config {
	if (!raw || typeof raw !== "object") return defaultConfig();
	const value = raw as Record<string, unknown>;
	const template =
		typeof value.ezproxyTemplate === "string" && /^https?:\/\//i.test(value.ezproxyTemplate)
			? value.ezproxyTemplate.slice(0, 2048)
			: undefined;
	const institutionName =
		typeof value.institutionName === "string" ? value.institutionName.trim().slice(0, 120) : undefined;
	const limit =
		typeof value.perTaskLimit === "number" && Number.isInteger(value.perTaskLimit)
			? Math.min(100, Math.max(1, value.perTaskLimit))
			: 20;
	return {
		version: 1,
		ezproxyTemplate: template,
		institutionName,
		autoDownloadEnabled: typeof value.autoDownloadEnabled === "boolean" ? value.autoDownloadEnabled : true,
		perTaskLimit: limit,
		lastLoginAt: typeof value.lastLoginAt === "string" ? value.lastLoginAt : undefined,
		lastLoginUrl: typeof value.lastLoginUrl === "string" ? value.lastLoginUrl : undefined,
	};
}

async function loadConfig(): Promise<Config> {
	try {
		return normalizeConfig(JSON.parse(await readFile(CONFIG_PATH, "utf8")));
	} catch {
		return defaultConfig();
	}
}

async function saveConfig(config: Config): Promise<void> {
	await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function electron(): any | null {
	try {
		return require("electron");
	} catch {
		return null;
	}
}

function session(): any | null {
	const loaded = electron();
	try {
		return loaded?.session?.fromPartition(PARTITION) || null;
	} catch {
		return null;
	}
}

function openWindow(url: string): { url: string } {
	const loaded = electron();
	if (!loaded?.BrowserWindow) throw new Error("Electron unavailable");
	const win = new loaded.BrowserWindow({
		width: 1220,
		height: 860,
		title: "机构访问登录 - Drone",
		webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true },
		autoHideMenuBar: true,
	});
	const recordNavigation = async (navigatedUrl: string) => {
		const config = await loadConfig();
		const inferred = inferEzproxyTemplateFromUrl(navigatedUrl) ?? undefined;
		await saveConfig({
			...config,
			ezproxyTemplate: inferred || config.ezproxyTemplate,
			lastLoginAt: new Date().toISOString(),
			lastLoginUrl: navigatedUrl.slice(0, 2048),
		});
	};
	win.webContents?.on?.("did-navigate", (_event: unknown, navigatedUrl: string) => {
		void recordNavigation(navigatedUrl).catch(() => {});
	});
	void win.loadURL(url);
	return { url };
}

function toolResponse(value: unknown, details?: unknown) {
	return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: details ?? value };
}

export default function institutionalAccess(pi: PiTool): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	pi.registerTool({
		name: "research_institutional_login",
		label: "Institutional login",
		description:
			"Open the persistent institutional browser window for EZproxy, Shibboleth, CARSI, OpenAthens, or WebVPN login.",
		parameters: {
			type: "object",
			properties: {
				url: { type: "string", description: "Optional publisher or DOI URL." },
				reason: { type: "string", description: "Optional reason shown in the result." },
			},
		},
		drone: {
			capabilities: ["research"],
			journal: false,
			subagent: "exclude",
			activity: { text: "正在打开机构登录窗口…", phase: "auth" },
		},
		async execute(_id, params: { url?: string; reason?: string }) {
			const target = params?.url || "https://www.nature.com/";
			if (!electron())
				return toolResponse(
					{
						status: "electron_unavailable",
						message: "Institutional login requires Drone desktop (Electron).",
					},
					{ status: "electron_unavailable" },
				);
			try {
				const config = await loadConfig();
				const opened = openWindow(buildProxiedUrl(target, config.ezproxyTemplate) || target);
				const next = { ...config, lastLoginAt: new Date().toISOString(), lastLoginUrl: opened.url };
				await saveConfig(next);
				return toolResponse(
					{
						status: "login_window_opened",
						opened_url: opened.url,
						requested_url: params?.url || null,
						reason: params?.reason || null,
						partition: PARTITION,
					},
					{ status: "login_window_opened" },
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return toolResponse({ status: "failed", error: message }, { status: "failed", error: message });
			}
		},
	});
	pi.registerTool({
		name: "research_institutional_status",
		label: "Institutional status",
		description: "Show institutional access configuration and session status.",
		parameters: { type: "object", properties: {} },
		drone: { readOnly: true, capabilities: ["research"] },
		async execute() {
			const config = await loadConfig();
			const current = session();
			let cookiesCount = 0;
			try {
				cookiesCount = current ? (await current.cookies.get({})).length : 0;
			} catch {
				cookiesCount = 0;
			}
			const status = {
				config,
				session: {
					cookiesCount,
					hasSessionCookies: cookiesCount > 0,
					partition: PARTITION,
					lastAccessAt: config.lastLoginAt,
				},
				loggedIn: cookiesCount > 0 || Boolean(config.lastLoginAt),
				electronAvailable: Boolean(electron()),
			};
			return toolResponse(status, status);
		},
	});
}
