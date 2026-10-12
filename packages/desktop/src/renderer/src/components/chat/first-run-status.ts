import type { PiApi } from "@drone/shared";

export interface FirstRunStatus {
	knowledge: boolean;
	zotero: boolean;
	compute: boolean;
}

/** Probe what the user already configured. Each probe fails closed (false) so a broken IPC never hides the guide. */
export async function probeFirstRunStatus(
	pi: Pick<PiApi, "getZoteroStatus" | "getZoteroWebApi" | "listHosts" | "getKnowledgeOverview">,
	cwd: string | null,
): Promise<FirstRunStatus> {
	const safe = async (fn: () => Promise<boolean>) => {
		try {
			return await fn();
		} catch {
			return false;
		}
	};
	const [knowledge, zotero, compute] = await Promise.all([
		safe(async () => (cwd ? (await pi.getKnowledgeOverview({ cwd })).binding?.revision != null : false)),
		safe(async () => {
			const [status, web] = await Promise.all([pi.getZoteroStatus(), pi.getZoteroWebApi().catch(() => null)]);
			return Boolean(status?.enabled || web?.configured);
		}),
		safe(async () => (await pi.listHosts()).length > 0),
	]);
	return { knowledge, zotero, compute };
}

/** The guide is done once every workspace connection exists; partially configured users still see what is missing. */
export function firstRunComplete(status: FirstRunStatus | null): boolean {
	return Boolean(status?.knowledge && status.zotero && status.compute);
}
