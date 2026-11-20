import { join } from "node:path";
import { canonicalProjectId } from "../project-id";
import { createP5BackgroundSettings } from "./p5-background-settings";
import { type P5BackgroundStatus, readP5BackgroundStatus } from "./p5-background-status";
import { createP5SpendLedger } from "./p5-spend-ledger";

export interface BackgroundJobsServicePort {
	getStatus(cwd: string): Promise<P5BackgroundStatus>;
	setEnabled(cwd: string, enabled: boolean): Promise<P5BackgroundStatus>;
	setDailyTokenLimit(cwd: string, limit: number): Promise<P5BackgroundStatus>;
}

/** Local calendar day "YYYY-MM-DD" in the process time zone (D14: budget resets at local midnight). */
export function localDayKey(date: Date): string {
	const year = String(date.getFullYear()).padStart(4, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function createBackgroundJobsService(options: {
	readonly agentDir: string;
	readonly clock: () => Date;
}): BackgroundJobsServicePort {
	const { agentDir, clock } = options;
	const settings = createP5BackgroundSettings({ path: join(agentDir, "p5-background-settings.json") });
	const ledger = createP5SpendLedger({
		path: join(agentDir, "p5-spend-ledger.json"),
		clock,
		localDayKey,
		limitFor: settings.limitFor,
	});
	return {
		getStatus: (cwd) => readP5BackgroundStatus(settings, ledger, canonicalProjectId(cwd)),
		async setEnabled(cwd, enabled) {
			const workspaceId = canonicalProjectId(cwd);
			settings.setEnabled(workspaceId, enabled);
			return readP5BackgroundStatus(settings, ledger, workspaceId);
		},
		async setDailyTokenLimit(cwd, limit) {
			const workspaceId = canonicalProjectId(cwd);
			settings.setDailyTokenLimit(workspaceId, limit);
			return readP5BackgroundStatus(settings, ledger, workspaceId);
		},
	};
}
