/**
 * Pure research access policy shared by host adapters.
 *
 * The native research package keeps its own Pi-local implementation. Desktop
 * host code consumes this dependency-free contract instead of loading the
 * optional package just to normalize proxy URLs or recognize a browser
 * challenge response.
 */

/** Build a proxied URL from a user-configured institution template. */
export function buildProxiedUrl(originalUrl: string, template?: string): string | null {
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

/** Infer an EZproxy-style template from a successful login URL. */
export function inferEzproxyTemplateFromUrl(navigatedUrl: string): string | null {
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

const CLOUDFLARE_BODY = /cf-chl|challenge-platform|just a moment|checking your browser/i;

/** Header or body signals that a response is a Cloudflare interstitial. */
export function looksLikeCloudflare(headers: unknown, sample: string | null | undefined): boolean {
	if (headerValue(headers, "cf-mitigated")) return true;
	return CLOUDFLARE_BODY.test(sample ?? "");
}

function headerValue(headers: unknown, name: string): string {
	if (!headers || typeof headers !== "object") return "";
	const readable = headers as { get?: (header: string) => unknown };
	if (typeof readable.get === "function") return String(readable.get(name) ?? "").trim();
	for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
		if (key.toLowerCase() === name.toLowerCase()) return String(value ?? "").trim();
	}
	return "";
}

export interface CloudflareAskCopy {
	title: string;
	body: string;
	continueLabel: string;
	skipLabel: string;
	retryNote: string;
	skipNote: string;
}

/** Dialog copy selected by the host's current reply language. */
export function cloudflareAskCopy(language = ""): CloudflareAskCopy {
	if (language.toLowerCase().startsWith("zh")) {
		return {
			title: "需要你完成浏览器验证",
			body: "这是 Cloudflare 人机验证。请在已经打开的窗口里完成，程序不会绕过。",
			continueLabel: "我已完成，继续",
			skipLabel: "跳过这个来源",
			retryNote: "请重新读取同一页面，不要绕过，刚才的挑战页不是证据",
			skipNote: "已跳过这个来源。挑战页不是证据，不要重试，也不要绕过。",
		};
	}
	return {
		title: "Browser verification needed",
		body: "This is a Cloudflare human check. Finish it in the browser window that is already open. The program will not bypass it.",
		continueLabel: "I've finished, continue",
		skipLabel: "Skip this source",
		retryNote: "Re-read the same page. Do not bypass it. The challenge page you just saw is not evidence.",
		skipNote:
			"This source was skipped. The challenge page is not evidence. Do not retry and do not bypass it.",
	};
}
