import {
	isTerminalJobState,
	type JobEvent,
	type JobSpec,
	type JobState,
	type JobStatus,
	type RemoteJobStatus,
} from "./types";

const STATE_RANK: Record<JobState, number> = {
	draft: 0,
	authorized: 1,
	prepared: 2,
	submitting: 3,
	queued: 4,
	running: 5,
	collecting: 6,
	succeeded: 7,
	failed: 7,
	cancelling: 6,
	cancelled: 7,
	unknown: -1,
	needs_login: -1,
	"needs-login": -1,
	blocked: 7,
	partial: 7,
};

const ALLOWED_TRANSITIONS: Record<JobState, readonly JobState[]> = {
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
	],
	needs_login: [
		"prepared",
		"submitting",
		"queued",
		"running",
		"cancelling",
		"unknown",
		"failed",
		"cancelled",
	],
	"needs-login": [
		"prepared",
		"submitting",
		"queued",
		"running",
		"cancelling",
		"unknown",
		"failed",
		"cancelled",
	],
	blocked: [],
	partial: [],
};

export interface JobTransitionEvent {
	readonly from: JobState;
	readonly to: JobState;
	readonly status: JobStatus;
}

export interface JobStatusMachineOptions {
	readonly now?: () => string;
	readonly onTransition?: (event: JobTransitionEvent) => void | Promise<void>;
}

export function canTransitionJob(from: JobState, to: JobState): boolean {
	return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

export class InvalidJobTransitionError extends Error {
	readonly from: JobState;
	readonly to: JobState;

	constructor(from: JobState, to: JobState) {
		super(`Cannot transition job from ${from} to ${to}`);
		this.name = "InvalidJobTransitionError";
		this.from = from;
		this.to = to;
	}
}

export class JobStatusMachine {
	private current: JobStatus;
	private readonly now: () => string;
	private readonly onTransition?: JobStatusMachineOptions["onTransition"];

	constructor(specOrStatus: JobSpec | JobStatus, options: JobStatusMachineOptions = {}) {
		this.now = options.now ?? (() => new Date().toISOString());
		this.onTransition = options.onTransition;
		this.current =
			"state" in specOrStatus
				? { ...specOrStatus }
				: { jobId: specOrStatus.jobId, state: "draft", updatedAt: this.now() };
	}

	get status(): JobStatus {
		return { ...this.current, artifacts: this.current.artifacts ? [...this.current.artifacts] : undefined };
	}

	get state(): JobState {
		return this.current.state;
	}

	async transition(
		to: JobState,
		patch: Omit<Partial<JobStatus>, "jobId" | "state" | "updatedAt"> = {},
	): Promise<JobStatus> {
		const from = this.current.state;
		if (!canTransitionJob(from, to)) throw new InvalidJobTransitionError(from, to);
		this.current = { ...this.current, ...patch, state: to, updatedAt: this.now() };
		await this.onTransition?.({ from, to, status: this.status });
		return this.status;
	}

	/** Mark a lost connection; terminal jobs remain immutable. */
	async markDisconnected(message = "Remote connection lost"): Promise<JobStatus> {
		if (isTerminalJobState(this.current.state)) return this.status;
		return await this.transition("unknown", { message });
	}

	/** Apply a remote observation and preserve forward-only progress. */
	async reconcile(remote: RemoteJobStatus | undefined): Promise<JobStatus> {
		const next = reconcileJob(this.current, remote, this.now());
		if (next.state === this.current.state && next.updatedAt === this.current.updatedAt) return this.status;
		const from = this.current.state;
		this.current = next;
		await this.onTransition?.({ from, to: next.state, status: this.status });
		return this.status;
	}
}

function mergeRemote(local: JobStatus, remote: RemoteJobStatus, state: JobState, now: string): JobStatus {
	return {
		...local,
		...remote,
		state,
		updatedAt: remote.updatedAt ?? now,
		jobId: local.jobId,
	};
}

/**
 * Reconcile local cache with the remote status file/scheduler observation.
 * A terminal local status is never rewritten.  Active statuses never move
 * backwards; an `unknown` local status can return to any observed status.
 */
export function reconcileJob(
	local: JobStatus,
	remote: RemoteJobStatus | undefined,
	now = new Date().toISOString(),
): JobStatus {
	if (isTerminalJobState(local.state)) return { ...local };
	if (!remote || remote.state === "unknown") {
		if (local.state === "unknown") return { ...local, updatedAt: now };
		return {
			...local,
			state: "unknown",
			updatedAt: now,
			message: remote?.message ?? "Remote status unavailable",
		};
	}
	if (local.state === "unknown") return mergeRemote(local, remote, remote.state, now);
	if (remote.state === "failed" || remote.state === "cancelled")
		return mergeRemote(local, remote, remote.state, now);
	if (remote.state === "cancelling") {
		if (local.state === "cancelling") return mergeRemote(local, remote, remote.state, now);
		if (STATE_RANK[local.state] <= STATE_RANK.cancelling)
			return mergeRemote(local, remote, remote.state, now);
		return { ...local };
	}
	if (STATE_RANK[remote.state] < STATE_RANK[local.state]) return { ...local };
	return mergeRemote(local, remote, remote.state, now);
}

export interface EventStore {
	append(event: JobEvent): Promise<void> | void;
	read(jobId: string): Promise<readonly JobEvent[]> | readonly JobEvent[];
}

export class MemoryEventStore implements EventStore {
	private readonly events = new Map<string, JobEvent[]>();

	append(event: JobEvent): void {
		const list = this.events.get(event.jobId) ?? [];
		list.push({ ...event });
		this.events.set(event.jobId, list);
	}

	read(jobId: string): readonly JobEvent[] {
		return [...(this.events.get(jobId) ?? [])];
	}
}

export type EventLineSink = (line: string) => Promise<void> | void;

/** Parse persisted JSONL without accepting lines for another job. */
export function parseEventLines(lines: string, jobId?: string): readonly JobEvent[] {
	const events: JobEvent[] = [];
	for (const line of lines.split(/\r?\n/)) {
		if (!line.trim()) continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof value !== "object" || value === null) continue;
		const event = value as Partial<JobEvent>;
		if (
			typeof event.id !== "string" ||
			typeof event.jobId !== "string" ||
			typeof event.at !== "string" ||
			typeof event.type !== "string"
		)
			continue;
		if (jobId && event.jobId !== jobId) continue;
		events.push(event as JobEvent);
	}
	return events;
}

/** JSONL event writer; persistence is injected so the domain stays portable. */
export class EventJournal implements EventStore {
	private readonly sink: EventLineSink;
	private readonly events = new Map<string, JobEvent[]>();

	constructor(sink: EventLineSink) {
		this.sink = sink;
	}

	async append(event: JobEvent): Promise<void> {
		const line = `${JSON.stringify(event)}\n`;
		await this.sink(line);
		const list = this.events.get(event.jobId) ?? [];
		list.push({ ...event });
		this.events.set(event.jobId, list);
	}

	read(jobId: string): readonly JobEvent[] {
		return [...(this.events.get(jobId) ?? [])];
	}
}

export function createStateEvent(
	jobId: string,
	status: JobStatus,
	id = `${jobId}-${status.updatedAt}`,
): JobEvent {
	return { id, jobId, at: status.updatedAt, type: "state", state: status.state, payload: status };
}

import { assertJobAuthorized } from "./authorization";
import type { WorkflowRemoteRunner, WorkflowRunnerResponse } from "./runner";
import type { ComputeExecutorKind, ComputeWorkflowJobSpec } from "./types";

export type WorkflowJobStatus =
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

const workflowTerminal = new Set<WorkflowJobStatus>(["succeeded", "failed", "cancelled"]);
const workflowAllowed: Readonly<Record<WorkflowJobStatus, readonly WorkflowJobStatus[]>> = {
	draft: ["prepared", "unknown"],
	prepared: ["submitted", "unknown"],
	submitted: ["running", "succeeded", "failed", "cancelled", "unknown"],
	running: ["succeeded", "failed", "cancelled", "unknown"],
	succeeded: [],
	failed: [],
	cancelled: [],
	unknown: ["submitted", "running", "succeeded", "failed", "cancelled", "unknown"],
};

export function transitionWorkflowJob(
	current: WorkflowJobStatus,
	next: WorkflowJobStatus,
): WorkflowJobStatus {
	if (workflowTerminal.has(current)) {
		if (current !== next) throw new Error(`Terminal job ${current} cannot transition to ${next}`);
		return current;
	}
	if (!workflowAllowed[current].includes(next))
		throw new Error(`Invalid job transition ${current} -> ${next}`);
	return next;
}

export interface SchedulerAdapter {
	readonly kind: ComputeExecutorKind;
	prepare(job: ComputeWorkflowJobSpec, runner: WorkflowRemoteRunner): Promise<WorkflowRunnerResponse>;
	start(job: ComputeWorkflowJobSpec, runner: WorkflowRemoteRunner): Promise<WorkflowRunnerResponse>;
	status(job: ComputeWorkflowJobSpec, runner: WorkflowRemoteRunner): Promise<WorkflowRunnerResponse>;
	logs(
		job: ComputeWorkflowJobSpec,
		cursor: string | undefined,
		runner: WorkflowRemoteRunner,
	): Promise<WorkflowRunnerResponse>;
	cancel(job: ComputeWorkflowJobSpec, runner: WorkflowRemoteRunner): Promise<WorkflowRunnerResponse>;
	collect(job: ComputeWorkflowJobSpec, runner: WorkflowRemoteRunner): Promise<WorkflowRunnerResponse>;
}

function workflowAdapter(kind: ComputeExecutorKind): SchedulerAdapter {
	return {
		kind,
		prepare: (job, runner) => {
			assertJobAuthorized(job);
			return runner.request({
				operation: "prepare",
				jobId: job.jobId,
				payload: { executor: kind, workflowSpecSha256: job.workflow.workflowSpecSha256 },
			});
		},
		start: (job, runner) => {
			assertJobAuthorized(job);
			return runner.request({ operation: "start", jobId: job.jobId, payload: { executor: kind } });
		},
		status: (job, runner) => runner.request({ operation: "status", jobId: job.jobId }),
		logs: (job, cursor, runner) => runner.request({ operation: "logs", jobId: job.jobId, cursor }),
		cancel: (job, runner) => runner.request({ operation: "cancel", jobId: job.jobId }),
		collect: (job, runner) =>
			runner.request({ operation: "collect", jobId: job.jobId, payload: { remoteWrite: job.remoteWrite } }),
	};
}

export const directScheduler = workflowAdapter("direct");
export const slurmScheduler = workflowAdapter("slurm");
