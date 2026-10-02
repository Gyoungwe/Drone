import { canTransitionJob, InvalidJobTransitionError, JobStatusMachine } from "../jobs";
import { JOB_TERMINAL_STATES, type JobRecord, type JobState } from "../types";

export { canTransitionJob, InvalidJobTransitionError, JOB_TERMINAL_STATES, JobStatusMachine };
export function isTerminalStatus(status: JobState): boolean {
	return JOB_TERMINAL_STATES.includes(status);
}
export function transitionJob(record: JobRecord, status: JobState, updatedAt = Date.now()): JobRecord {
	if (
		!canTransitionJob(record.status, status) ||
		(isTerminalStatus(record.status) && status !== record.status)
	)
		throw new InvalidJobTransitionError(record.status, status);
	return status === record.status ? record : { ...record, status, updatedAt };
}
export function transitionTable(): Readonly<Record<JobState, readonly JobState[]>> {
	return {
		draft: ["authorized", "failed", "unknown"],
		authorized: ["prepared", "failed", "unknown"],
		prepared: ["submitting", "failed", "unknown"],
		submitting: ["queued", "running", "failed", "unknown"],
		queued: ["running", "cancelling", "failed", "unknown"],
		running: ["collecting", "cancelling", "failed", "unknown"],
		collecting: ["succeeded", "failed", "unknown"],
		succeeded: [],
		failed: [],
		cancelling: ["cancelled", "failed", "unknown"],
		cancelled: [],
		unknown: [
			"prepared",
			"submitting",
			"queued",
			"running",
			"collecting",
			"succeeded",
			"failed",
			"cancelling",
			"cancelled",
			"needs-login",
			"needs_login",
			"blocked",
			"partial",
		],
		"needs-login": [
			"prepared",
			"submitting",
			"queued",
			"running",
			"cancelling",
			"failed",
			"cancelled",
			"unknown",
		],
		needs_login: [
			"prepared",
			"submitting",
			"queued",
			"running",
			"cancelling",
			"failed",
			"cancelled",
			"unknown",
		],
		blocked: [],
		partial: [],
	};
}
