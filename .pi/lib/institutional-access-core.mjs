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
export {
  INSTITUTIONAL_AGENT_DIR,
  INSTITUTIONAL_CONFIG_NAME,
  INSTITUTIONAL_CONFIG_PATH,
  buildProxiedUrl,
  detectAndSaveTemplateFromUrl,
  emptyInstitutionalConfig,
  inferEzproxyTemplateFromUrl,
  loadInstitutionalConfig,
  normalizeInstitutionalConfig,
  saveInstitutionalConfig
};
