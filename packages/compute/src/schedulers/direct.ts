import { JobStatusMachine, type JobStatusMachineOptions } from "../jobs";
import type { RunnerClient } from "../runner";
import type { JobSpec, JobStatus, SubmissionOutcome, SubmissionRecord } from "../types";

export interface SubmissionLedger {
	tryAcquire(jobId: string): Promise<boolean> | boolean;
	release(jobId: string): Promise<void> | void;
	read(jobId: string): Promise<SubmissionRecord | undefined> | SubmissionRecord | undefined;
	findExisting(
		jobId: string,
		idempotencyKey: string,
	): Promise<SubmissionRecord | undefined> | SubmissionRecord | undefined;
	write(record: SubmissionRecord): Promise<void> | void;
}

export class MemorySubmissionLedger implements SubmissionLedger {
	private readonly locks = new Set<string>();
	private readonly records = new Map<string, SubmissionRecord>();

	tryAcquire(jobId: string): boolean {
		if (this.locks.has(jobId)) return false;
		this.locks.add(jobId);
		return true;
	}

	release(jobId: string): void {
		this.locks.delete(jobId);
	}

	read(jobId: string): SubmissionRecord | undefined {
		return this.records.get(jobId);
	}

	findExisting(jobId: string): SubmissionRecord | undefined {
		return this.records.get(jobId);
	}

	write(record: SubmissionRecord): void {
		this.records.set(record.jobId, { ...record });
	}
}

export interface IdempotentSubmitInput {
	readonly jobId: string;
	readonly idempotencyKey: string;
	readonly ledger: SubmissionLedger;
	readonly submit: () => Promise<SubmissionRecord>;
	/** Probe scheduler/process state after a transport failure. */
	readonly findExisting?: () => Promise<SubmissionRecord | undefined>;
}

/**
 * Submit exactly once.  A lock without a durable job id is an unknown outcome
 * and is never replayed automatically; callers must reconcile explicitly.
 */
export async function submitIdempotently(input: IdempotentSubmitInput): Promise<SubmissionOutcome> {
	const existing = await input.ledger.read(input.jobId);
	if (existing) return { kind: "already-submitted", record: existing };
	const acquired = await input.ledger.tryAcquire(input.jobId);
	if (!acquired) {
		const afterLock = await input.ledger.read(input.jobId);
		if (afterLock) return { kind: "already-submitted", record: afterLock };
		const recovered = await input.ledger.findExisting(input.jobId, input.idempotencyKey);
		if (recovered) {
			await input.ledger.write(recovered);
			return { kind: "already-submitted", record: recovered };
		}
		return { kind: "unknown", reason: "Submission lock exists but no durable remote id was found" };
	}
	try {
		const race = await input.ledger.read(input.jobId);
		if (race) return { kind: "already-submitted", record: race };
		try {
			const record = await input.submit();
			await input.ledger.write(record);
			return { kind: "submitted", record };
		} catch (error) {
			const recovered = await input.findExisting?.();
			if (recovered) {
				await input.ledger.write(recovered);
				return { kind: "already-submitted", record: recovered };
			}
			const reason = error instanceof Error ? error.message : "Runner submission outcome is unknown";
			return { kind: "unknown", reason };
		}
	} finally {
		await input.ledger.release(input.jobId);
	}
}

export interface DirectRunnerOptions {
	readonly ledger?: SubmissionLedger;
	readonly machine?: JobStatusMachineOptions;
	readonly now?: () => string;
	/** Set true when a host connection must negotiate before preparation. */
	readonly negotiateBeforePrepare?: boolean;
}

function recordFromStart(spec: JobSpec, value: unknown, now: string): SubmissionRecord {
	const row = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const remoteId =
		typeof row.schedulerJobId === "string"
			? row.schedulerJobId
			: typeof row.jobId === "string"
				? row.jobId
				: undefined;
	const pid = typeof row.pid === "number" ? row.pid : undefined;
	const processStartedAt = typeof row.processStartedAt === "string" ? row.processStartedAt : undefined;
	if (!remoteId && pid === undefined)
		throw new Error("Runner start response did not include a remote id or pid");
	return {
		jobId: spec.jobId,
		idempotencyKey: spec.idempotencyKey ?? spec.jobId,
		...(remoteId ? { remoteId } : {}),
		...(pid === undefined ? {} : { pid }),
		...(processStartedAt ? { processStartedAt } : {}),
		submittedAt: now,
	};
}

/** Direct (no scheduler) runner adapter. Slurm has a separate scheduler seam. */
export class DirectRunner {
	readonly client: RunnerClient;
	readonly ledger: SubmissionLedger;
	private readonly machineOptions: JobStatusMachineOptions;
	private readonly machines = new Map<string, JobStatusMachine>();
	private readonly now: () => string;
	private readonly negotiateBeforePrepare: boolean;

	constructor(client: RunnerClient, options: DirectRunnerOptions = {}) {
		this.client = client;
		this.ledger = options.ledger ?? new MemorySubmissionLedger();
		this.now = options.now ?? (() => new Date().toISOString());
		this.machineOptions = options.machine ?? {};
		this.negotiateBeforePrepare = options.negotiateBeforePrepare ?? false;
	}

	machine(spec: JobSpec): JobStatusMachine {
		const current = this.machines.get(spec.jobId);
		if (current) return current;
		const machine = new JobStatusMachine(spec, {
			...this.machineOptions,
			now: this.machineOptions.now ?? this.now,
		});
		this.machines.set(spec.jobId, machine);
		return machine;
	}

	statusFor(spec: JobSpec): JobStatus {
		return this.machine(spec).status;
	}

	async prepare(spec: JobSpec): Promise<JobStatus> {
		if (this.negotiateBeforePrepare) await this.client.negotiate();
		const machine = this.machine(spec);
		if (machine.state === "draft") await machine.transition("authorized");
		if (machine.state !== "prepared") {
			await this.client.prepare(spec);
			await machine.transition("prepared");
		}
		return machine.status;
	}

	async submit(spec: JobSpec): Promise<{ readonly outcome: SubmissionOutcome; readonly status: JobStatus }> {
		const machine = this.machine(spec);
		if (machine.state === "draft") await this.prepare(spec);
		if (machine.state === "authorized") await this.prepare(spec);
		if (machine.state !== "prepared" && machine.state !== "submitting" && machine.state !== "queued") {
			throw new Error(`Cannot submit job in ${machine.state} state`);
		}
		if (machine.state === "prepared") await machine.transition("submitting");
		const outcome = await submitIdempotently({
			jobId: spec.jobId,
			idempotencyKey: spec.idempotencyKey ?? spec.jobId,
			ledger: this.ledger,
			submit: async () => recordFromStart(spec, await this.client.start(spec), this.now()),
			findExisting: async () => await this.ledger.findExisting(spec.jobId, spec.idempotencyKey ?? spec.jobId),
		});
		if (outcome.kind === "unknown") await machine.markDisconnected(outcome.reason);
		else
			await machine.transition("queued", {
				...(outcome.record.remoteId ? { schedulerJobId: outcome.record.remoteId } : {}),
				...(outcome.record.pid === undefined ? {} : { pid: outcome.record.pid }),
				...(outcome.record.processStartedAt ? { processStartedAt: outcome.record.processStartedAt } : {}),
			});
		return { outcome, status: machine.status };
	}

	async reconcile(spec: JobSpec): Promise<JobStatus> {
		const remote = await this.client.status(spec.jobId);
		return await this.machine(spec).reconcile(remote);
	}

	async logs(spec: JobSpec, cursor?: string): Promise<unknown> {
		return await this.client.logs(spec.jobId, cursor);
	}

	async cancel(spec: JobSpec): Promise<JobStatus> {
		const machine = this.machine(spec);
		if (machine.state === "succeeded" || machine.state === "failed" || machine.state === "cancelled")
			return machine.status;
		if (machine.state !== "cancelling") await machine.transition("cancelling");
		try {
			await this.client.cancel(spec.jobId);
			await machine.transition("cancelled");
		} catch (error) {
			await machine.markDisconnected(error instanceof Error ? error.message : "Cancel outcome is unknown");
		}
		return machine.status;
	}

	async collect(spec: JobSpec): Promise<{ readonly result: unknown; readonly status: JobStatus }> {
		const machine = this.machine(spec);
		if (machine.state !== "collecting" && machine.state !== "succeeded") {
			if (machine.state === "running" || machine.state === "queued") await machine.transition("collecting");
			else throw new Error(`Cannot collect job in ${machine.state} state`);
		}
		try {
			const result = await this.client.collect(spec.jobId, spec.outputs);
			if (machine.state === "collecting") await machine.transition("succeeded");
			return { result, status: machine.status };
		} catch (error) {
			if (machine.state === "collecting")
				await machine.transition("failed", {
					message: error instanceof Error ? error.message : "Artifact collection failed",
				});
			throw error;
		}
	}
}
