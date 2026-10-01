// packages/extensions/src/institutional-access.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

// packages/research/src/institutional-proxy.ts
function buildProxiedUrl(originalUrl, template) {
	if (!template) return null;
	const trimmed = template.trim();
	if (!trimmed) return null;
	try {
		if (trimmed.includes("%s")) return trimmed.replaceAll("%s", encodeURIComponent(originalUrl));
		const urlObj = new URL(originalUrl);
		if (trimmed.includes(urlObj.host)) return null;
		if (/[?&=]$/.test(trimmed) || trimmed.endsWith("url=") || trimmed.endsWith("url")) {
			const separator = trimmed.includes("?")
				? trimmed.endsWith("?") || trimmed.endsWith("&") || trimmed.endsWith("=")
					? ""
					: "&"
				: "?";
			if (trimmed.endsWith("=")) return `${trimmed}${encodeURIComponent(originalUrl)}`;
			return `${trimmed}${separator}url=${encodeURIComponent(originalUrl)}`;
		}
		if (trimmed.includes("ezproxy") || trimmed.includes("login")) {
			const hasQuery = trimmed.includes("?");
			if (hasQuery) {
				if (trimmed.endsWith("?") || trimmed.endsWith("&"))
					return `${trimmed}${encodeURIComponent(originalUrl)}`;
				if (trimmed.includes("url=")) {
					if (/url=$/.test(trimmed)) return `${trimmed}${encodeURIComponent(originalUrl)}`;
					return `${trimmed}&url=${encodeURIComponent(originalUrl)}`;
				}
				return `${trimmed}&url=${encodeURIComponent(originalUrl)}`;
			}
			return `${trimmed}?url=${encodeURIComponent(originalUrl)}`;
		}
		return `${trimmed}${encodeURIComponent(originalUrl)}`;
	} catch {
		return null;
	}
}
function inferEzproxyTemplateFromUrl(navigatedUrl) {
	try {
		const url = new URL(navigatedUrl);
		const href = url.href;
		if (url.hostname.includes("ezproxy") && url.search) {
			const target = new URLSearchParams(url.search).get("url");
			if (target && /^https?:\/\//i.test(target)) {
				const base = `${href.split("url=")[0]}url=`;
				if (/^https?:\/\//i.test(base)) return `${base}%s`;
			}
			if ((href.includes("url=") && /url=https?%3A/i.test(href)) || href.includes("url=https://")) {
				const index = href.indexOf("url=");
				if (index > 0) {
					const base = href.slice(0, index + 4);
					if (/^https?:\/\//i.test(base)) return `${base}%s`;
				}
			}
		}
		if ((href.includes("?url=") || href.includes("&url=")) && /url=https?/i.test(href)) {
			const match = href.match(/^(https?:\/\/[^?]+\?[^=]*url=)/i);
			if (match) {
				const base = match[1];
				if (
					base &&
					!base.includes("nature.com") &&
					!base.includes("sciencedirect.com") &&
					!base.includes("springer.com") &&
					!base.includes("wiley.com") &&
					base.length < 200
				)
					return `${base}%s`;
				if (base && base.length < 300) return `${base}%s`;
			}
		}
		return null;
	} catch {
		return null;
	}
}

// packages/extensions/src/institutional-access.ts
var require2 = createRequire(import.meta.url);
var PARTITION = "persist:drone-institutional";
var CONFIG_PATH = join(homedir(), ".pi", "agent", "institutional.json");
var defaultConfig = () => ({ version: 1, autoDownloadEnabled: true, perTaskLimit: 20 });
function normalizeConfig(raw) {
	if (!raw || typeof raw !== "object") return defaultConfig();
	const value = raw;
	const template =
		typeof value.ezproxyTemplate === "string" && /^https?:\/\//i.test(value.ezproxyTemplate)
			? value.ezproxyTemplate.slice(0, 2048)
			: void 0;
	const institutionName =
		typeof value.institutionName === "string" ? value.institutionName.trim().slice(0, 120) : void 0;
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
		lastLoginAt: typeof value.lastLoginAt === "string" ? value.lastLoginAt : void 0,
		lastLoginUrl: typeof value.lastLoginUrl === "string" ? value.lastLoginUrl : void 0,
	};
}
async function loadConfig() {
	try {
		return normalizeConfig(JSON.parse(await readFile(CONFIG_PATH, "utf8")));
	} catch {
		return defaultConfig();
	}
}
async function saveConfig(config) {
	await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
	await writeFile(
		CONFIG_PATH,
		`${JSON.stringify(config, null, 2)}
`,
		"utf8",
	);
}
function electron() {
	try {
		return require2("electron");
	} catch {
		return null;
	}
}
function session() {
	const loaded = electron();
	try {
		return loaded?.session?.fromPartition(PARTITION) || null;
	} catch {
		return null;
	}
}
function openWindow(url) {
	const loaded = electron();
	if (!loaded?.BrowserWindow) throw new Error("Electron unavailable");
	const win = new loaded.BrowserWindow({
		width: 1220,
		height: 860,
		title: "\u673A\u6784\u8BBF\u95EE\u767B\u5F55 - Drone",
		webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true },
		autoHideMenuBar: true,
	});
	const recordNavigation = async (navigatedUrl) => {
		const config = await loadConfig();
		const inferred = inferEzproxyTemplateFromUrl(navigatedUrl) ?? void 0;
		await saveConfig({
			...config,
			ezproxyTemplate: inferred || config.ezproxyTemplate,
			lastLoginAt: /* @__PURE__ */ new Date().toISOString(),
			lastLoginUrl: navigatedUrl.slice(0, 2048),
		});
	};
	win.webContents?.on?.("did-navigate", (_event, navigatedUrl) => {
		void recordNavigation(navigatedUrl).catch(() => {});
	});
	void win.loadURL(url);
	return { url };
}
function toolResponse(value, details) {
	return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: details ?? value };
}
function institutionalAccess(pi) {
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
			activity: { text: "\u6B63\u5728\u6253\u5F00\u673A\u6784\u767B\u5F55\u7A97\u53E3\u2026", phase: "auth" },
		},
		async execute(_id, params) {
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
				const next = {
					...config,
					lastLoginAt: /* @__PURE__ */ new Date().toISOString(),
					lastLoginUrl: opened.url,
				};
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
export { institutionalAccess as default };
