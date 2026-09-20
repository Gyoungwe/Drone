import { join } from "node:path";
import {
	emptyInstitutionalConfig,
	type InstitutionalConfig,
	type InstitutionalSaveInput,
} from "@drone/shared";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { JsonStore } from "../json-store";
import { createLogger } from "../log";

const log = createLogger("institutional");

function configPath(): string {
	return join(getAgentDir(), "institutional.json");
}

function store(): JsonStore<InstitutionalConfig> {
	return new JsonStore<InstitutionalConfig>({
		path: configPath(),
		defaultValue: () => emptyInstitutionalConfig(),
	});
}

function normalizeUrl(value: string | undefined): string | undefined {
	if (value == null) return undefined;
	const trimmed = String(value).trim();
	if (!trimmed) return undefined;
	// allow http(s) only
	if (!/^https?:\/\//i.test(trimmed)) return undefined;
	// basic length guard
	if (trimmed.length > 2048) return undefined;
	return trimmed;
}

function normalizeTemplate(value: string | undefined): string | undefined {
	if (value == null) return undefined;
	const trimmed = String(value).trim();
	if (!trimmed) return undefined;
	if (trimmed.length > 2048) return undefined;
	// must be http(s) and contain either %s or end with ?url= or similar, but we allow any http(s) for flexibility
	if (!/^https?:\/\//i.test(trimmed)) return undefined;
	return trimmed;
}

function normalizeInstitutionName(value: string | undefined): string | undefined {
	if (value == null) return undefined;
	const trimmed = String(value).trim();
	if (!trimmed) return undefined;
	if (trimmed.length > 120) return trimmed.slice(0, 120);
	return trimmed;
}

export function loadInstitutionalConfigSync(): InstitutionalConfig {
	const s = store();
	const raw = s.readSync();
	return normalizeConfig(raw);
}

export async function loadInstitutionalConfig(): Promise<InstitutionalConfig> {
	const s = store();
	const raw = await s.read();
	return normalizeConfig(raw);
}

function normalizeConfig(raw: unknown): InstitutionalConfig {
	const base = emptyInstitutionalConfig();
	if (typeof raw !== "object" || raw === null) return base;
	const input = raw as Partial<InstitutionalConfig> & Record<string, unknown>;
	const ezproxyTemplate = normalizeTemplate(
		typeof input.ezproxyTemplate === "string" ? input.ezproxyTemplate : undefined,
	);
	const openUrlResolver = normalizeUrl(
		typeof input.openUrlResolver === "string" ? input.openUrlResolver : undefined,
	);
	const institutionName = normalizeInstitutionName(
		typeof input.institutionName === "string" ? input.institutionName : undefined,
	);
	const autoDownloadEnabled =
		typeof input.autoDownloadEnabled === "boolean" ? input.autoDownloadEnabled : base.autoDownloadEnabled;
	let perTaskLimit = base.perTaskLimit;
	if (typeof input.perTaskLimit === "number" && Number.isInteger(input.perTaskLimit)) {
		perTaskLimit = Math.min(100, Math.max(1, input.perTaskLimit));
	}
	const lastLoginAt = typeof input.lastLoginAt === "string" ? input.lastLoginAt : undefined;
	const lastLoginUrl = typeof input.lastLoginUrl === "string" ? input.lastLoginUrl : undefined;
	const configured = Boolean(ezproxyTemplate || openUrlResolver || institutionName || lastLoginAt);
	return {
		version: 1,
		ezproxyTemplate,
		openUrlResolver,
		institutionName,
		autoDownloadEnabled,
		perTaskLimit,
		lastLoginAt,
		lastLoginUrl,
		configured,
	};
}

export async function saveInstitutionalConfig(input: InstitutionalSaveInput): Promise<InstitutionalConfig> {
	const current = await loadInstitutionalConfig();
	const next: InstitutionalConfig = {
		...current,
		version: 1,
		ezproxyTemplate:
			input.ezproxyTemplate !== undefined
				? normalizeTemplate(input.ezproxyTemplate)
				: current.ezproxyTemplate,
		openUrlResolver:
			input.openUrlResolver !== undefined ? normalizeUrl(input.openUrlResolver) : current.openUrlResolver,
		institutionName:
			input.institutionName !== undefined
				? normalizeInstitutionName(input.institutionName)
				: current.institutionName,
		autoDownloadEnabled:
			typeof input.autoDownloadEnabled === "boolean"
				? input.autoDownloadEnabled
				: current.autoDownloadEnabled,
		perTaskLimit:
			typeof input.perTaskLimit === "number" && Number.isInteger(input.perTaskLimit)
				? Math.min(100, Math.max(1, input.perTaskLimit))
				: current.perTaskLimit,
	};
	next.configured = Boolean(
		next.ezproxyTemplate || next.openUrlResolver || next.institutionName || next.lastLoginAt,
	);
	const s = store();
	await s.write(next);
	log.info("institutional config saved", {
		hasEzproxy: Boolean(next.ezproxyTemplate),
		hasOpenUrl: Boolean(next.openUrlResolver),
		auto: next.autoDownloadEnabled,
		limit: next.perTaskLimit,
	});
	return next;
}

export async function touchInstitutionalLogin(url?: string): Promise<InstitutionalConfig> {
	const current = await loadInstitutionalConfig();
	const next: InstitutionalConfig = {
		...current,
		lastLoginAt: new Date().toISOString(),
		lastLoginUrl: url ? normalizeUrl(url) || url.slice(0, 2048) : current.lastLoginUrl,
		configured: true,
	};
	const s = store();
	await s.write(next);
	return next;
}

export function buildProxiedUrl(originalUrl: string, template?: string): string | null {
	if (!template) return null;
	const trimmed = template.trim();
	if (!trimmed) return null;
	try {
		// if template contains %s, replace all occurrences
		if (trimmed.includes("%s")) {
			return trimmed.replaceAll("%s", encodeURIComponent(originalUrl));
		}
		// if template looks like a prefix ending with ?url= or &url= or /login?url=, append encoded
		// also support templates that are just a host like https://ezproxy.example.edu/login?url=
		// we check if template contains '=' at end or contains 'url=' and ends with '='
		const urlObj = new URL(originalUrl);
		// if template already contains original host, don't double proxy
		if (trimmed.includes(urlObj.host)) return null;

		// Heuristic: if template contains '://' and ends with '=' or contains '%', append
		if (/[?&=]$/.test(trimmed) || trimmed.endsWith("url=") || trimmed.endsWith("url")) {
			const sep = trimmed.includes("?")
				? trimmed.endsWith("?") || trimmed.endsWith("&") || trimmed.endsWith("=")
					? ""
					: "&"
				: "?";
			// if already ends with =, just append
			if (trimmed.endsWith("=")) return `${trimmed}${encodeURIComponent(originalUrl)}`;
			return `${trimmed}${sep}url=${encodeURIComponent(originalUrl)}`;
		}
		// Most common: https://ezproxy.example.edu/login?url=  -> append
		if (trimmed.includes("ezproxy") || trimmed.includes("login")) {
			const hasQuery = trimmed.includes("?");
			if (hasQuery) {
				if (trimmed.endsWith("?") || trimmed.endsWith("&"))
					return `${trimmed}${encodeURIComponent(originalUrl)}`;
				if (trimmed.includes("url=")) {
					// if url param exists but empty, fill it; else append
					if (/url=$/.test(trimmed)) return `${trimmed}${encodeURIComponent(originalUrl)}`;
					return `${trimmed}&url=${encodeURIComponent(originalUrl)}`;
				}
				return `${trimmed}&url=${encodeURIComponent(originalUrl)}`;
			}
			return `${trimmed}?url=${encodeURIComponent(originalUrl)}`;
		}
		// Fallback: treat as prefix + encoded url
		return `${trimmed}${encodeURIComponent(originalUrl)}`;
	} catch {
		return null;
	}
}

/**
 * 从实际导航 URL 自动推断 EZproxy / WebVPN 模板并保存
 * - EZproxy: https://ezproxy.example.edu/login?url=https://www.nature.com/xxx → https://ezproxy.example.edu/login?url=%s
 * - WebVPN: https://webvpn.example.edu/https/443/www.nature.com/xxx → https://webvpn.example.edu/%s 形式需特殊处理，这里仅记录 host，模板仍靠 session
 */
export function inferEzproxyTemplateFromUrl(navigatedUrl: string): string | null {
	try {
		const u = new URL(navigatedUrl);
		const href = u.href;
		// EZproxy 典型：host 含 ezproxy 且 query 含 url= 且 url 参数是 http(s)
		if (u.hostname.includes("ezproxy") && u.search) {
			const params = new URLSearchParams(u.search);
			const target = params.get("url");
			if (target && /^https?:\/\//i.test(target)) {
				// 模板 = 当前 URL 去掉 url 参数值，替换为 %s
				// 保留 ?url= 前缀
				const base = `${href.split("url=")[0]}url=`;
				if (/^https?:\/\//i.test(base)) return `${base}%s`;
			}
			// 另一种：/login?url= 直接在 href 中
			if ((href.includes("url=") && /url=https?%3A/i.test(href)) || href.includes("url=https://")) {
				const idx = href.indexOf("url=");
				if (idx > 0) {
					const base = href.slice(0, idx + 4);
					if (/^https?:\/\//i.test(base)) return `${base}%s`;
				}
			}
		}
		// 通用：任何含 ?url= 或 &url= 且值是 http(s) 的，认为是代理模板
		if ((href.includes("?url=") || href.includes("&url=")) && /url=https?/i.test(href)) {
			const match = href.match(/^(https?:\/\/[^?]+\?[^=]*url=)/i);
			if (match) {
				const base = match[1] as string;
				// 防止把目标 host 也当成模板的一部分
				if (
					base &&
					!base.includes("nature.com") &&
					!base.includes("sciencedirect.com") &&
					!base.includes("springer.com") &&
					!base.includes("wiley.com")
				) {
					// 粗略：只要 base 是 http(s) 且长度合理
					if (base.length < 200) return `${base}%s`;
				} else {
					// 即使包含目标，也尝试提取到 url= 为止
					const idx = href.toLowerCase().indexOf("url=");
					if (idx > 0) {
						const base2 = href.slice(0, idx + 4);
						if (base2.length < 300) return `${base2}%s`;
					}
				}
			}
		}
		return null;
	} catch {
		return null;
	}
}

export async function detectAndSaveTemplateFromUrl(
	navigatedUrl: string,
): Promise<InstitutionalConfig | null> {
	const inferred = inferEzproxyTemplateFromUrl(navigatedUrl);
	if (!inferred) return null;
	const current = await loadInstitutionalConfig();
	// 已有相同模板则不重复写
	if (current.ezproxyTemplate === inferred) return current;
	// 只有当新模板看起来更通用（host 相同但更短）或当前未配置时才覆盖，避免误覆盖
	const shouldSave = !current.ezproxyTemplate || inferred.length <= current.ezproxyTemplate.length + 20;
	if (!shouldSave) return current;
	return saveInstitutionalConfig({ ezproxyTemplate: inferred });
}

export async function clearInstitutionalLogin(): Promise<InstitutionalConfig> {
	const s = store();
	const current = await s.read();
	const next = { ...current, lastLoginAt: undefined, lastLoginUrl: undefined };
	await s.write(next);
	return normalizeConfig(next);
}
