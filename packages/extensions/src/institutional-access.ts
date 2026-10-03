import { createRequire } from "node:module";
import {
	buildProxiedUrl,
	detectAndSaveTemplateFromUrl,
	loadInstitutionalConfig,
	saveInstitutionalConfig,
} from "@drone/research/institutional-access";
export { buildProxiedUrl, detectAndSaveTemplateFromUrl, loadInstitutionalConfig, saveInstitutionalConfig };

const require = createRequire(import.meta.url);
const PARTITION = "persist:drone-institutional";

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

/** Host ports used by research source archive; Electron never enters @drone/research. */
export function isElectronAvailable(): boolean {
	return Boolean(electron());
}

export function getInstitutionalSession(): any | null {
	return session();
}

export async function institutionalFetch(url: string, options: Record<string, any> = {}): Promise<Record<string, any>> {
	const loaded = electron();
	if (!loaded) throw new Error("Electron session unavailable");
	const sess = session();
	const timeoutMs = options.timeoutMs ?? 30_000;
	const fetchFn = loaded.net?.fetch || globalThis.fetch;
	if (typeof fetchFn !== "function") throw new Error("fetch unavailable");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchFn(url, {
			method: "GET",
			headers: options.headers,
			signal: controller.signal,
			session: sess,
		});
		const headers: Record<string, string> = {};
		response.headers.forEach((value: string, key: string) => {
			headers[key.toLowerCase()] = value;
		});
		return {
			status: response.status,
			headers,
			body: new Uint8Array(await response.arrayBuffer()),
			finalUrl: response.url || url,
			response,
		};
	} finally {
		clearTimeout(timer);
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
		await detectAndSaveTemplateFromUrl(navigatedUrl);
		const config = await loadInstitutionalConfig();
		await saveInstitutionalConfig({
			...config,
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
				const config = await loadInstitutionalConfig();
				const opened = openWindow(buildProxiedUrl(target, config.ezproxyTemplate) || target);
				const next = { ...config, lastLoginAt: new Date().toISOString(), lastLoginUrl: opened.url };
				await saveInstitutionalConfig(next);
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
			const config = await loadInstitutionalConfig();
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
