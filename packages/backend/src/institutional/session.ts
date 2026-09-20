import { createLogger } from "../log";

const log = createLogger("institutional-session");

const PARTITION = "persist:drone-institutional";

let electronSession: any | null = null;
let electronNet: any | null = null;

function tryLoadElectron(): { session: any; net: any } | null {
	if (electronSession && electronNet) return { session: electronSession, net: electronNet };
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const electron = require("electron");
		if (electron?.session && electron?.net) {
			electronSession = electron.session;
			electronNet = electron.net;
			return { session: electronSession, net: electronNet };
		}
	} catch {
		// not in electron main, or electron not available
	}
	return null;
}

export function getPartitionName(): string {
	return PARTITION;
}

export function isElectronAvailable(): boolean {
	return Boolean(tryLoadElectron());
}

export function getInstitutionalSession(): any | null {
	const loaded = tryLoadElectron();
	if (!loaded) return null;
	try {
		return loaded.session.fromPartition(PARTITION);
	} catch (err) {
		log.warn("failed to get institutional session", err);
		return null;
	}
}

export async function getInstitutionalCookiesCount(): Promise<number> {
	const sess = getInstitutionalSession();
	if (!sess) return 0;
	try {
		const cookies = await sess.cookies.get({});
		return cookies.length;
	} catch {
		return 0;
	}
}

export async function hasInstitutionalSessionCookies(): Promise<boolean> {
	const count = await getInstitutionalCookiesCount();
	return count > 0;
}

export async function clearInstitutionalSession(): Promise<void> {
	const sess = getInstitutionalSession();
	if (!sess) return;
	try {
		await sess.clearStorageData({
			storages: ["cookies", "localstorage", "sessionstorage", "cachestorage", "indexeddb", "serviceworkers"],
		});
		log.info("institutional session cleared");
	} catch (err) {
		log.warn("failed to clear institutional session", err);
		throw err;
	}
}

export interface InstitutionalFetchOptions {
	timeoutMs?: number;
	headers?: Record<string, string>;
}

export async function institutionalFetch(
	url: string,
	options: InstitutionalFetchOptions = {},
): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array; finalUrl: string }> {
	const loaded = tryLoadElectron();
	if (!loaded) throw new Error("Electron session unavailable");
	const sess = loaded.session.fromPartition(PARTITION);
	const timeoutMs = options.timeoutMs ?? 30000;

	// Use Electron's net.fetch with session option (Electron 30+)
	// Fallback to sess.fetch if available, else net.fetch
	const fetchFn: typeof fetch = (loaded.net?.fetch as typeof fetch) || (globalThis.fetch as typeof fetch);
	if (typeof fetchFn !== "function") throw new Error("fetch unavailable");

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await (fetchFn as any)(url, {
			method: "GET",
			headers: options.headers,
			signal: controller.signal,
			session: sess,
			bypassCustomProtocolHandlers: false,
		});
		const finalUrl = (response as any).url || url;
		const headers: Record<string, string> = {};
		response.headers.forEach((value: string, key: string) => {
			headers[key.toLowerCase()] = value;
		});
		const arrayBuf = await response.arrayBuffer();
		return {
			status: response.status,
			headers,
			body: new Uint8Array(arrayBuf),
			finalUrl,
		};
	} finally {
		clearTimeout(timer);
	}
}

export async function institutionalFetchWithFallback(
	url: string,
	proxiedUrl: string | null,
	options: InstitutionalFetchOptions = {},
): Promise<{
	via: "direct" | "ezproxy" | "institutional_session";
	result: Awaited<ReturnType<typeof institutionalFetch>>;
} | null> {
	// Try proxied URL first if available, then direct URL via institutional session
	const candidates: Array<{ via: "ezproxy" | "institutional_session"; url: string }> = [];
	if (proxiedUrl) candidates.push({ via: "ezproxy", url: proxiedUrl });
	candidates.push({ via: "institutional_session", url });

	for (const cand of candidates) {
		try {
			const result = await institutionalFetch(cand.url, options);
			// Consider 2xx as success, 3xx redirect also interesting
			if (result.status >= 200 && result.status < 400) {
				const ct = result.headers["content-type"] || "";
				// If HTML landing page that looks like login, treat as not ok (heuristic)
				if (ct.includes("text/html") && result.body.byteLength < 50_000) {
					const text = new TextDecoder().decode(result.body.slice(0, 4000)).toLowerCase();
					if (
						text.includes("shibboleth") ||
						(text.includes("login") && text.includes("password")) ||
						(text.includes("ezproxy") && text.includes("login")) ||
						text.includes("openathens") ||
						text.includes("institutional access")
					) {
						// Might be login page, but still return for caller to decide; we treat as not a PDF
						// Continue to next candidate if we have more
						if (cand.via === "ezproxy" && candidates.length > 1) continue;
					}
				}
				return { via: cand.via, result };
			}
		} catch (err) {
			log.warn(`institutional fetch failed for ${cand.via} ${cand.url}`, err);
		}
	}
	return null;
}
