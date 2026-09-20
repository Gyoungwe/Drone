import {
	buildProxiedUrl,
	clearInstitutionalLogin,
	clearInstitutionalSession,
	getInstitutionalStatus,
	institutionalFetch,
	isElectronAvailable,
	loadInstitutionalConfig,
	openInstitutionalLoginWindow,
	openInstitutionalUrlInWindow,
	saveInstitutionalConfig,
} from "@drone/backend";

export async function openInstitutionalLogin(url?: string): Promise<{ url: string }> {
	return openInstitutionalLoginWindow(url);
}

export async function openInstitutionalUrl(url: string): Promise<{ url: string }> {
	return openInstitutionalUrlInWindow(url);
}

export async function getStatus() {
	return getInstitutionalStatus();
}

export async function saveConfig(input: {
	ezproxyTemplate?: string;
	openUrlResolver?: string;
	institutionName?: string;
	autoDownloadEnabled?: boolean;
	perTaskLimit?: number;
}) {
	return saveInstitutionalConfig(input as any);
}

export async function clear() {
	await clearInstitutionalSession();
	try {
		await clearInstitutionalLogin();
	} catch {}
	return getInstitutionalStatus();
}

export async function testAccess(url: string) {
	if (!url) throw new Error("URL required");
	try {
		new URL(url);
	} catch {
		throw new Error("Invalid URL");
	}
	const cfg = await loadInstitutionalConfig();
	const proxied = cfg.ezproxyTemplate ? buildProxiedUrl(url, cfg.ezproxyTemplate) : null;

	if (!isElectronAvailable()) {
		return {
			url,
			proxiedUrl: proxied || undefined,
			status: 0,
			ok: false,
			error: "Electron session unavailable (not in desktop)",
			via: "institutional_session" as const,
		};
	}

	const candidates: Array<{ via: "ezproxy" | "institutional_session"; url: string }> = [];
	if (proxied) candidates.push({ via: "ezproxy", url: proxied });
	candidates.push({ via: "institutional_session", url });

	for (const cand of candidates) {
		try {
			const res = await institutionalFetch(cand.url, { timeoutMs: 15000 });
			return {
				url,
				proxiedUrl: proxied || undefined,
				status: res.status,
				ok: res.status >= 200 && res.status < 400,
				contentType: res.headers["content-type"],
				finalUrl: res.finalUrl,
				via: cand.via,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (cand === candidates[candidates.length - 1]) {
				return {
					url,
					proxiedUrl: proxied || undefined,
					status: 0,
					ok: false,
					error: message,
					via: cand.via,
				};
			}
		}
	}
	return {
		url,
		proxiedUrl: proxied || undefined,
		status: 0,
		ok: false,
		error: "No candidate succeeded",
		via: "institutional_session" as const,
	};
}
