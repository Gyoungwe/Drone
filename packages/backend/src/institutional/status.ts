import type { InstitutionalStatus } from "@drone/shared";
import { loadInstitutionalConfig, loadInstitutionalConfigSync } from "./config";
import { getInstitutionalCookiesCount, getPartitionName, isElectronAvailable } from "./session";

function isLoggedInHeuristic(config: { lastLoginAt?: string }, cookiesCount: number): boolean {
	if (cookiesCount > 0) return true;
	if (!config.lastLoginAt) return false;
	try {
		const last = new Date(config.lastLoginAt).getTime();
		const now = Date.now();
		// 7 days heuristic
		return now - last < 7 * 24 * 60 * 60 * 1000;
	} catch {
		return false;
	}
}

export async function getInstitutionalStatus(): Promise<InstitutionalStatus> {
	const config = await loadInstitutionalConfig();
	const electronAvailable = isElectronAvailable();
	let cookiesCount = 0;
	if (electronAvailable) {
		try {
			cookiesCount = await getInstitutionalCookiesCount();
		} catch {
			cookiesCount = 0;
		}
	}
	return {
		config,
		session: {
			cookiesCount,
			hasSessionCookies: cookiesCount > 0,
			partition: getPartitionName(),
			lastAccessAt: config.lastLoginAt,
		},
		loggedIn: isLoggedInHeuristic(config, cookiesCount),
		electronAvailable,
	};
}

export function getInstitutionalStatusSync(): InstitutionalStatus {
	const config = loadInstitutionalConfigSync();
	const electronAvailable = isElectronAvailable();
	// sync version can't read cookies, so 0
	return {
		config,
		session: {
			cookiesCount: 0,
			hasSessionCookies: false,
			partition: getPartitionName(),
			lastAccessAt: config.lastLoginAt,
		},
		loggedIn: isLoggedInHeuristic(config, 0),
		electronAvailable,
	};
}
