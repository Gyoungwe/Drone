/**
 * Pure URL policy for institution-proxy navigation.
 *
 * Keeping this policy in the research package lets backend services and the
 * extension compatibility layer share the same contract without moving
 * Electron sessions or filesystem persistence into the package. The `.pi`
 * implementation remains self-contained for packaged extension execution.
 */

/**
 * Build a proxied URL from a user-configured institution template.
 *
 * Templates may contain `%s`, end in `url=`/`?`/`&`, or be a proxy/login
 * prefix. Existing target hosts are rejected to avoid applying a proxy twice.
 */
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

/**
 * Infer an EZproxy-style template from the URL reached by an institutional
 * login flow. Only HTTP(S) URLs with an explicit `url=` target are accepted.
 */
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
