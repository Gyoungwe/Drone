import type { RemoteRunner, RunnerResponse } from "./runner";
import type { ComputeExecutorKind, JobSpec } from "./types";

export type JobStatus =
	| "draft"
	| "prepared"
	| "submitted"
	| "running"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "unknown";

export type SubmissionDecision =
	| { kind: "submit"; reason: "no-lock" }
	| { kind: "reuse"; jobId: string; reason: "job-id-present" | "remote-job-found" }
	| { kind: "unknown"; reason: "lock-without-job-id" };

/** Idempotency rule for retries: an ambiguous side effect is never replayed automatically. */
export function submissionDecision(input: {
	lockExists: boolean;
	jobId?: string;
	discoveredJobId?: string;
}): SubmissionDecision {
	if (input.jobId) return { kind: "reuse", jobId: input.jobId, reason: "job-id-present" };
	if (input.discoveredJobId)
		return { kind: "reuse", jobId: input.discoveredJobId, reason: "remote-job-found" };
	if (input.lockExists) return { kind: "unknown", reason: "lock-without-job-id" };
	return { kind: "submit", reason: "no-lock" };
}

const terminal = new Set<JobStatus>(["succeeded", "failed", "cancelled"]);
const allowed: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
	draft: ["prepared", "unknown"],
	prepared: ["submitted", "unknown"],
	submitted: ["running", "succeeded", "failed", "cancelled", "unknown"],
	running: ["succeeded", "failed", "cancelled", "unknown"],
	succeeded: [],
	failed: [],
	cancelled: [],
	unknown: ["submitted", "running", "succeeded", "failed", "cancelled", "unknown"],
};

export function transitionJob(current: JobStatus, next: JobStatus): JobStatus {
	if (terminal.has(current)) {
		if (current !== next) throw new Error(`Terminal job ${current} cannot transition to ${next}`);
		return current;
	}
	if (!allowed[current].includes(next)) throw new Error(`Invalid job transition ${current} -> ${next}`);
	return next;
}

export interface SchedulerAdapter {
	readonly kind: ComputeExecutorKind;
	prepare(job: JobSpec, runner: RemoteRunner): Promise<RunnerResponse>;
	start(job: JobSpec, runner: RemoteRunner): Promise<RunnerResponse>;
	status(job: JobSpec, runner: RemoteRunner): Promise<RunnerResponse>;
	logs(job: JobSpec, cursor: string | undefined, runner: RemoteRunner): Promise<RunnerResponse>;
	cancel(job: JobSpec, runner: RemoteRunner): Promise<RunnerResponse>;
	collect(job: JobSpec, runner: RemoteRunner): Promise<RunnerResponse>;
}

function adapter(kind: ComputeExecutorKind): SchedulerAdapter {
	return {
		kind,
		prepare: (job, runner) =>
			runner.request({
				operation: "prepare",
				jobId: job.jobId,
				payload: { executor: kind, workflowSpecSha256: job.workflow.workflowSpecSha256 },
			}),
		start: (job, runner) =>
			runner.request({ operation: "start", jobId: job.jobId, payload: { executor: kind } }),
		status: (job, runner) => runner.request({ operation: "status", jobId: job.jobId }),
		logs: (job, cursor, runner) => runner.request({ operation: "logs", jobId: job.jobId, cursor }),
		cancel: (job, runner) => runner.request({ operation: "cancel", jobId: job.jobId }),
		collect: (job, runner) =>
			runner.request({ operation: "collect", jobId: job.jobId, payload: { remoteWrite: job.remoteWrite } }),
	};
}

export const directScheduler = adapter("direct");
export const slurmScheduler = adapter("slurm");
