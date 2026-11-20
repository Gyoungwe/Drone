import type { BackendServices } from "@drone/backend";
import { BackgroundJobsContract } from "@drone/shared";
import { bindContract } from "./bind-contract";

export function registerBackgroundJobsIpc(services: Pick<BackendServices, "backgroundJobs">): void {
	const { backgroundJobs } = services;
	bindContract(BackgroundJobsContract, {
		getBackgroundJobsStatus: (cwd) => backgroundJobs.getStatus(cwd),
		setBackgroundJobsEnabled: (cwd, enabled) => backgroundJobs.setEnabled(cwd, enabled),
		setBackgroundJobsDailyLimit: (cwd, limit) => backgroundJobs.setDailyTokenLimit(cwd, limit),
	});
}
