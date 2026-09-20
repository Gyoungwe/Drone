import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_NAME = "institutional.json";
const PARTITION = "persist:drone-institutional";

function agentDir() {
	return join(homedir(), ".pi", "agent");
}

function configPath() {
	return join(agentDir(), CONFIG_NAME);
}

export function emptyInstitutionalConfig() {
	return { version: 1, autoDownloadEnabled: true, perTaskLimit: 20 };
}

function normalizeTemplate(value) {
	if (value == null) return undefined;
	const trimmed = String(value).trim();
	if (!trimmed) return undefined;
	if (trimmed.length > 2048) return undefined;
	if (!/^https?:\/\//i.test(trimmed)) return undefined;
	return trimmed;
}

function normalizeUrl(value) {
	if (value == null) return undefined;
	const trimmed = String(value).trim();
	if (!trimmed) return undefined;
	if (trimmed.length > 2048) return undefined;
	if (!/^https?:\/\//i.test(trimmed)) return undefined;
	return trimmed;
}

export async function loadInstitutionalConfig() {
	try {
		const raw = JSON.parse(await readFile(configPath(), "utf8"));
		return normalizeConfig(raw);
	} catch {
		return emptyInstitutionalConfig();
	}
}

function normalizeConfig(raw) {
	const base = emptyInstitutionalConfig();
	if (typeof raw !== "object" || raw === null) return base;
	const ezproxyTemplate = normalizeTemplate(raw.ezproxyTemplate);
	const openUrlResolver = normalizeUrl(raw.openUrlResolver);
	const institutionName =
		typeof raw.institutionName === "string"
			? raw.institutionName.trim().slice(0, 120) || undefined
			: undefined;
	const autoDownloadEnabled =
		typeof raw.autoDownloadEnabled === "boolean" ? raw.autoDownloadEnabled : base.autoDownloadEnabled;
	let perTaskLimit = base.perTaskLimit;
	if (typeof raw.perTaskLimit === "number" && Number.isInteger(raw.perTaskLimit)) {
		perTaskLimit = Math.min(100, Math.max(1, raw.perTaskLimit));
	}
	const lastLoginAt = typeof raw.lastLoginAt === "string" ? raw.lastLoginAt : undefined;
	const lastLoginUrl = typeof raw.lastLoginUrl === "string" ? raw.lastLoginUrl : undefined;
	return {
		version: 1,
		ezproxyTemplate,
		openUrlResolver,
		institutionName,
		autoDownloadEnabled,
		perTaskLimit,
		lastLoginAt,
		lastLoginUrl,
		configured: Boolean(ezproxyTemplate || openUrlResolver || institutionName || lastLoginAt),
	};
}

export function buildProxiedUrl(originalUrl, template) {
	if (!template) return null;
	const trimmed = String(template).trim();
	if (!trimmed) return null;
	try {
		if (trimmed.includes("%s")) {
			return trimmed.replaceAll("%s", encodeURIComponent(originalUrl));
		}
		const urlObj = new URL(originalUrl);
		if (trimmed.includes(urlObj.host)) return null;
		if (/[?&=]$/.test(trimmed) || trimmed.endsWith("url=") || trimmed.endsWith("url")) {
			if (trimmed.endsWith("=")) return `${trimmed}${encodeURIComponent(originalUrl)}`;
			const sep = trimmed.includes("?") ? (trimmed.endsWith("?") || trimmed.endsWith("&") ? "" : "&") : "?";
			return `${trimmed}${sep}url=${encodeURIComponent(originalUrl)}`;
		}
		if (trimmed.includes("ezproxy") || trimmed.includes("login")) {
			const hasQuery = trimmed.includes("?");
			if (hasQuery) {
				if (trimmed.endsWith("?") || trimmed.endsWith("&"))
					return `${trimmed}${encodeURIComponent(originalUrl)}`;
				if (/url=$/.test(trimmed)) return `${trimmed}${encodeURIComponent(originalUrl)}`;
				if (trimmed.includes("url=")) return `${trimmed}&url=${encodeURIComponent(originalUrl)}`;
				return `${trimmed}&url=${encodeURIComponent(originalUrl)}`;
			}
			return `${trimmed}?url=${encodeURIComponent(originalUrl)}`;
		}
		return `${trimmed}${encodeURIComponent(originalUrl)}`;
	} catch {
		return null;
	}
}

export function inferEzproxyTemplateFromUrl(navigatedUrl) {
	try {
		const u = new URL(navigatedUrl);
		const href = u.href;
		if (u.hostname.includes("ezproxy") && u.search) {
			const params = new URLSearchParams(u.search);
			const target = params.get("url");
			if (target && /^https?:\/\//i.test(target)) {
				const base = `${href.split("url=")[0]}url=`;
				if (/^https?:\/\//i.test(base)) return `${base}%s`;
			}
			if ((href.includes("url=") && /url=https?%3A/i.test(href)) || href.includes("url=https://")) {
				const idx = href.indexOf("url=");
				if (idx > 0) {
					const base = href.slice(0, idx + 4);
					if (/^https?:\/\//i.test(base)) return `${base}%s`;
				}
			}
		}
		if ((href.includes("?url=") || href.includes("&url=")) && /url=https?/i.test(href)) {
			const match = href.match(/^(https?:\/\/[^?]+\?[^=]*url=)/i);
			if (match) {
				const base = match[1];
				if (base.length < 200) return `${base}%s`;
			}
		}
		return null;
	} catch {
		return null;
	}
}

export async function detectAndSaveTemplateFromUrl(navigatedUrl) {
	const { writeFile, mkdir } = await import("node:fs/promises");
	const { dirname } = await import("node:path");
	const inferred = inferEzproxyTemplateFromUrl(navigatedUrl);
	if (!inferred) return null;
	try {
		const cfg = await loadInstitutionalConfig();
		if (cfg.ezproxyTemplate === inferred) return cfg;
		const next = { ...cfg, ezproxyTemplate: inferred, configured: true };
		const path = configPath();
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(next, null, 2));
		return next;
	} catch {
		return null;
	}
}

let electronSession = null;
let electronNet = null;

function tryLoadElectron() {
	if (electronSession && electronNet) return { session: electronSession, net: electronNet };
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const electron = require("electron");
		if (electron?.session && electron?.net) {
			electronSession = electron.session;
			electronNet = electron.net;
			return { session: electronSession, net: electronNet };
		}
	} catch {}
	return null;
}

export function isElectronAvailable() {
	return Boolean(tryLoadElectron());
}

export function getInstitutionalSession() {
	const loaded = tryLoadElectron();
	if (!loaded) return null;
	try {
		return loaded.session.fromPartition(PARTITION);
	} catch {
		return null;
	}
}

export async function institutionalFetch(url, options = {}) {
	const loaded = tryLoadElectron();
	if (!loaded) throw new Error("Electron session unavailable");
	const sess = loaded.session.fromPartition(PARTITION);
	const timeoutMs = options.timeoutMs ?? 30000;
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
		const finalUrl = response.url || url;
		const headers = {};
		response.headers.forEach((value, key) => {
			headers[key.toLowerCase()] = value;
		});
		const arrayBuf = await response.arrayBuffer();
		return { status: response.status, headers, body: new Uint8Array(arrayBuf), finalUrl, response };
	} finally {
		clearTimeout(timer);
	}
}
