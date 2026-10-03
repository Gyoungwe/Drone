import type { InstitutionalSaveInput, InstitutionalStatus, InstitutionalTestResult } from "@drone/shared";
import {
	buildProxiedUrl,
	clearInstitutionalLogin,
	loadInstitutionalConfig,
	saveInstitutionalConfig,
} from "../institutional/config";
import { clearInstitutionalSession, institutionalFetch, isElectronAvailable } from "../institutional/session";
import { getInstitutionalStatus } from "../institutional/status";

/** Host-facing institutional access boundary used by desktop and research adapters. */
export interface InstitutionalServicePort {
	getStatus(): Promise<InstitutionalStatus>;
	saveConfig(input: InstitutionalSaveInput): Promise<InstitutionalStatus>;
	clear(): Promise<InstitutionalStatus>;
	testAccess(url: string): Promise<InstitutionalTestResult>;
}

export class InstitutionalService implements InstitutionalServicePort {
	getStatus(): Promise<InstitutionalStatus> {
		return getInstitutionalStatus();
	}

	async saveConfig(input: InstitutionalSaveInput): Promise<InstitutionalStatus> {
		await saveInstitutionalConfig(input);
		return this.getStatus();
	}

	async clear(): Promise<InstitutionalStatus> {
		await clearInstitutionalSession();
		try {
			await clearInstitutionalLogin();
		} catch {
			// Clearing an absent provider login is idempotent for the host API.
		}
		return this.getStatus();
	}

	async testAccess(url: string): Promise<InstitutionalTestResult> {
		if (!url) throw new Error("URL required");
		try {
			new URL(url);
		} catch {
			throw new Error("Invalid URL");
		}
		const config = await loadInstitutionalConfig();
		const proxiedUrl = config.ezproxyTemplate ? buildProxiedUrl(url, config.ezproxyTemplate) : null;
		if (!isElectronAvailable()) {
			return {
				url,
				proxiedUrl: proxiedUrl || undefined,
				status: 0,
				ok: false,
				error: "Electron session unavailable (not in desktop)",
				via: "institutional_session",
			};
		}

		const candidates: Array<{ via: "ezproxy" | "institutional_session"; url: string }> = [];
		if (proxiedUrl) candidates.push({ via: "ezproxy", url: proxiedUrl });
		candidates.push({ via: "institutional_session", url });
		for (const candidate of candidates) {
			try {
				const result = await institutionalFetch(candidate.url, { timeoutMs: 15_000 });
				return {
					url,
					proxiedUrl: proxiedUrl || undefined,
					status: result.status,
					ok: result.status >= 200 && result.status < 400,
					contentType: result.headers["content-type"],
					finalUrl: result.finalUrl,
					via: candidate.via,
				};
			} catch (error) {
				if (candidate === candidates[candidates.length - 1]) {
					return {
						url,
						proxiedUrl: proxiedUrl || undefined,
						status: 0,
						ok: false,
						error: error instanceof Error ? error.message : String(error),
						via: candidate.via,
					};
				}
			}
		}
		return {
			url,
			proxiedUrl: proxiedUrl || undefined,
			status: 0,
			ok: false,
			error: "No candidate succeeded",
			via: "institutional_session",
		};
	}
}
