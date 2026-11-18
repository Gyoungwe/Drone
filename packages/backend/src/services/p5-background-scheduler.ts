import type { Usage } from "@gyoungwe/plugin-api/p5-receipts";
import type { SpendGate } from "./p5-spend-ledger";

export type P5BackgroundUsage =
	| Omit<Extract<Usage, { state: "known" }>, "metered">
	| Omit<Extract<Usage, { state: "unknown" }>, "metered">;

export interface P5BackgroundJob {
	readonly workspaceId: string;
	readonly jobId: string;
	/** Return unrecorded usage; the scheduler owns metering, including failed runs. */
	run(signal: AbortSignal): Promise<P5BackgroundUsage>;
}

export interface P5BackgroundCompletion {
	readonly usage: Usage;
	readonly finishedAt: string;
}

export interface P5BackgroundSchedulerPorts {
	isEnabled(workspaceId: string): boolean;
	readonly spend: SpendGate;
	clock(): Date;
}

export interface P5BackgroundScheduler {
	/** Resolves after execution and usage persistence. IDs are unique for this scheduler's lifetime. */
	enqueue(job: P5BackgroundJob): Promise<P5BackgroundCompletion>;
	/** Running jobs settle only after run(signal) and usage persistence finish. */
	cancel(jobId: string): boolean;
	/** The host commits the disabled setting first; running jobs receive an abort signal. */
	disable(workspaceId: string): void;
	dispose(): Promise<void>;
}

interface ScheduledJob {
	readonly job: P5BackgroundJob;
	readonly queue: WorkspaceQueue;
	readonly controller: AbortController;
	resolve(completion: P5BackgroundCompletion): void;
	reject(error: unknown): void;
}

interface WorkspaceQueue {
	readonly pending: ScheduledJob[];
	current: ScheduledJob | undefined;
	done: Promise<void>;
}

class BackgroundScheduler implements P5BackgroundScheduler {
	private readonly queues = new Map<string, WorkspaceQueue>();
	private readonly jobs = new Map<string, ScheduledJob>();
	private readonly seenIds = new Set<string>();
	private readonly accountingFailures = new Map<string, unknown>();
	private disposed = false;

	constructor(private readonly ports: P5BackgroundSchedulerPorts) {}

	async enqueue(job: P5BackgroundJob): Promise<P5BackgroundCompletion> {
		if (this.disposed) throw new Error("P5 background scheduler disposed");
		if (this.seenIds.has(job.jobId)) throw new Error("Duplicate P5 background job ID");
		if (!this.ports.isEnabled(job.workspaceId)) throw new Error("P5 background workspace disabled");
		this.seenIds.add(job.jobId);
		const queue = this.queues.get(job.workspaceId) ?? {
			pending: [],
			current: undefined,
			done: Promise.resolve(),
		};
		this.queues.set(job.workspaceId, queue);
		const completion = new Promise<P5BackgroundCompletion>((resolve, reject) => {
			const scheduled = { job, queue, controller: new AbortController(), resolve, reject };
			this.jobs.set(job.jobId, scheduled);
			queue.pending.push(scheduled);
		});
		if (!queue.current) queue.done = this.drain(job.workspaceId, queue);
		return completion;
	}

	cancel(jobId: string): boolean {
		const scheduled = this.jobs.get(jobId);
		if (!scheduled) return false;
		const error = new Error("P5 background job cancelled");
		scheduled.controller.abort(error);
		const index = scheduled.queue.pending.indexOf(scheduled);
		if (index >= 0) {
			scheduled.queue.pending.splice(index, 1);
			this.jobs.delete(jobId);
			scheduled.reject(error);
		}
		return true;
	}

	disable(workspaceId: string): void {
		for (const { job } of this.jobs.values()) {
			if (job.workspaceId === workspaceId) this.cancel(job.jobId);
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		for (const jobId of this.jobs.keys()) this.cancel(jobId);
		await Promise.all([...this.queues.values()].map((queue) => queue.done));
	}

	private async drain(workspaceId: string, queue: WorkspaceQueue): Promise<void> {
		let scheduled = queue.pending.shift();
		while (scheduled) {
			queue.current = scheduled;
			try {
				scheduled.resolve(await this.execute(scheduled));
			} catch (error) {
				// Deliver failures to the enqueue caller; the detached queue must still drain.
				scheduled.reject(error);
			} finally {
				this.jobs.delete(scheduled.job.jobId);
				queue.current = undefined;
			}
			scheduled = queue.pending.shift();
		}
		this.queues.delete(workspaceId);
	}

	private async execute({ job, controller }: ScheduledJob): Promise<P5BackgroundCompletion> {
		const { signal } = controller;
		signal.throwIfAborted();
		if (this.accountingFailures.has(job.workspaceId)) throw this.accountingFailures.get(job.workspaceId);
		if (!this.ports.isEnabled(job.workspaceId)) throw new Error("P5 background workspace disabled");
		if ((await this.ports.spend.check({ workspaceId: job.workspaceId, metered: true })) === "denied")
			throw new Error("P5 background workspace budget denied");
		// Consent or cancellation can change while the asynchronous ledger check is pending.
		signal.throwIfAborted();
		if (!this.ports.isEnabled(job.workspaceId)) throw new Error("P5 background workspace disabled");
		let usage: Usage = {
			state: "unknown",
			metered: true,
			inputTokens: null,
			outputTokens: null,
			cost: null,
		};
		try {
			usage = { ...(await job.run(signal)), metered: true };
		} finally {
			await this.recordUsage(job.workspaceId, usage);
		}
		signal.throwIfAborted();
		return { usage, finishedAt: this.ports.clock().toISOString() };
	}

	private async recordUsage(workspaceId: string, usage: Usage): Promise<void> {
		try {
			await this.ports.spend.record({ ...usage, workspaceId });
		} catch (error) {
			// A stale ledger cannot authorize more spend until the host replaces this scheduler.
			this.accountingFailures.set(workspaceId, error);
			throw error;
		}
	}
}

/** Host-runtime owner only: no plugin registration, window lifetime, or user-initiated runs. */
export function createP5BackgroundScheduler(ports: P5BackgroundSchedulerPorts): P5BackgroundScheduler {
	return new BackgroundScheduler(ports);
}
