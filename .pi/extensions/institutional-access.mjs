// @ts-nocheck
// packages/extensions/src/institutional-access.ts
import { createRequire } from "node:module";

// packages/research/src/institutional-access.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
      const separator = trimmed.includes("?") ? trimmed.endsWith("?") || trimmed.endsWith("&") || trimmed.endsWith("=") ? "" : "&" : "?";
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
      if (href.includes("url=") && /url=https?%3A/i.test(href) || href.includes("url=https://")) {
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
        if (base && !base.includes("nature.com") && !base.includes("sciencedirect.com") && !base.includes("springer.com") && !base.includes("wiley.com") && base.length < 200)
          return `${base}%s`;
        if (base && base.length < 300) return `${base}%s`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// packages/research/src/institutional-access.ts
var INSTITUTIONAL_CONFIG_NAME = "institutional.json";
var INSTITUTIONAL_AGENT_DIR = join(homedir(), ".pi", "agent");
var INSTITUTIONAL_CONFIG_PATH = join(INSTITUTIONAL_AGENT_DIR, INSTITUTIONAL_CONFIG_NAME);
function emptyInstitutionalConfig() {
  return { version: 1, autoDownloadEnabled: true, perTaskLimit: 20 };
}
function normalizeUrl(value) {
  if (value == null) return void 0;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.length > 2048 || !/^https?:\/\//i.test(trimmed)) return void 0;
  return trimmed;
}
function normalizeInstitutionalConfig(raw) {
  const base = emptyInstitutionalConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const value = raw;
  const ezproxyTemplate = normalizeUrl(value.ezproxyTemplate);
  const openUrlResolver = normalizeUrl(value.openUrlResolver);
  const institutionName = typeof value.institutionName === "string" ? value.institutionName.trim().slice(0, 120) || void 0 : void 0;
  const autoDownloadEnabled = typeof value.autoDownloadEnabled === "boolean" ? value.autoDownloadEnabled : base.autoDownloadEnabled;
  const perTaskLimit = typeof value.perTaskLimit === "number" && Number.isInteger(value.perTaskLimit) ? Math.min(100, Math.max(1, value.perTaskLimit)) : base.perTaskLimit;
  const lastLoginAt = typeof value.lastLoginAt === "string" ? value.lastLoginAt : void 0;
  const lastLoginUrl = normalizeUrl(value.lastLoginUrl);
  return {
    version: 1,
    ezproxyTemplate,
    institutionName,
    openUrlResolver,
    autoDownloadEnabled,
    perTaskLimit,
    lastLoginAt,
    lastLoginUrl,
    configured: Boolean(ezproxyTemplate || openUrlResolver || institutionName || lastLoginAt)
  };
}
async function loadInstitutionalConfig(path = INSTITUTIONAL_CONFIG_PATH, io = { readFile: (file) => readFile(file, "utf8") }) {
  try {
    return normalizeInstitutionalConfig(JSON.parse(await io.readFile(path)));
  } catch {
    return emptyInstitutionalConfig();
  }
}
async function saveInstitutionalConfig(config, path = INSTITUTIONAL_CONFIG_PATH, io = {
  readFile: (file) => readFile(file, "utf8"),
  writeFile: async (file, data) => {
    await writeFile(file, data, "utf8");
  },
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  }
}) {
  const normalized = normalizeInstitutionalConfig(config);
  await io.mkdir(dirname(path));
  await io.writeFile(path, `${JSON.stringify(normalized, null, 2)}
`);
  return normalized;
}
async function detectAndSaveTemplateFromUrl(navigatedUrl, { path = INSTITUTIONAL_CONFIG_PATH, io } = {}) {
  const inferred = inferEzproxyTemplateFromUrl(navigatedUrl);
  if (!inferred) return null;
  const config = await loadInstitutionalConfig(path, io);
  if (config.ezproxyTemplate === inferred) return config;
  return saveInstitutionalConfig({ ...config, ezproxyTemplate: inferred }, path, io);
}

// packages/extensions/src/institutional-access.ts
var require2 = createRequire(import.meta.url);
var PARTITION = "persist:drone-institutional";
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
function isElectronAvailable() {
  return Boolean(electron());
}
function getInstitutionalSession() {
  return session();
}
async function institutionalFetch(url, options = {}) {
  const loaded = electron();
  if (!loaded) throw new Error("Electron session unavailable");
  const sess = session();
  const timeoutMs = options.timeoutMs ?? 3e4;
  const fetchFn = loaded.net?.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: options.headers,
      signal: controller.signal,
      session: sess
    });
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      headers,
      body: new Uint8Array(await response.arrayBuffer()),
      finalUrl: response.url || url,
      response
    };
  } finally {
    clearTimeout(timer);
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
    autoHideMenuBar: true
  });
  const recordNavigation = async (navigatedUrl) => {
    await detectAndSaveTemplateFromUrl(navigatedUrl);
    const config = await loadInstitutionalConfig();
    await saveInstitutionalConfig({
      ...config,
      lastLoginAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastLoginUrl: navigatedUrl.slice(0, 2048)
    });
  };
  win.webContents?.on?.("did-navigate", (_event, navigatedUrl) => {
    void recordNavigation(navigatedUrl).catch(() => {
    });
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
    description: "Open the persistent institutional browser window for EZproxy, Shibboleth, CARSI, OpenAthens, or WebVPN login.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional publisher or DOI URL." },
        reason: { type: "string", description: "Optional reason shown in the result." }
      }
    },
    drone: {
      capabilities: ["research"],
      journal: false,
      subagent: "exclude",
      activity: { text: "\u6B63\u5728\u6253\u5F00\u673A\u6784\u767B\u5F55\u7A97\u53E3\u2026", phase: "auth" }
    },
    async execute(_id, params) {
      const target = params?.url || "https://www.nature.com/";
      if (!electron())
        return toolResponse(
          {
            status: "electron_unavailable",
            message: "Institutional login requires Drone desktop (Electron)."
          },
          { status: "electron_unavailable" }
        );
      try {
        const config = await loadInstitutionalConfig();
        const opened = openWindow(buildProxiedUrl(target, config.ezproxyTemplate) || target);
        const next = { ...config, lastLoginAt: (/* @__PURE__ */ new Date()).toISOString(), lastLoginUrl: opened.url };
        await saveInstitutionalConfig(next);
        return toolResponse(
          {
            status: "login_window_opened",
            opened_url: opened.url,
            requested_url: params?.url || null,
            reason: params?.reason || null,
            partition: PARTITION
          },
          { status: "login_window_opened" }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolResponse({ status: "failed", error: message }, { status: "failed", error: message });
      }
    }
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
          lastAccessAt: config.lastLoginAt
        },
        loggedIn: cookiesCount > 0 || Boolean(config.lastLoginAt),
        electronAvailable: Boolean(electron())
      };
      return toolResponse(status, status);
    }
  });
}
export {
  buildProxiedUrl,
  institutionalAccess as default,
  detectAndSaveTemplateFromUrl,
  getInstitutionalSession,
  institutionalFetch,
  isElectronAvailable,
  loadInstitutionalConfig,
  saveInstitutionalConfig
};
