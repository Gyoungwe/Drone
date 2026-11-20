import { randomUUID } from "node:crypto";
import type { HostProfile, JobRecord } from "@drone/compute";
import type { ComputeEvent, ComputeExecutor } from "./compute";
import { asRecord, isTerminal, now, statusOf } from "./compute-job-state";

export interface ComputeCancelHost {
	executor: Pick<ComputeExecutor, "cancel"> | undefined;
	requireJob(jobId: string): Promise<JobRecord>;
	requireHost(alias: string): Promise<HostProfile>;
	updateJob(job: JobRecord, fields: Record<string, unknown>): JobRecord;
	persistJob(job: JobRecord): Promise<void>;
	appendEvent(event: ComputeEvent): Promise<void>;
	runExclusive<T>(jobId: string, task: () => Promise<T> | T): Promise<T>;
}

export async function cancelComputeJob(host: ComputeCancelHost, jobId: string): Promise<JobRecord> {
	const job = await host.requireJob(jobId);
	if (isTerminal(statusOf(job))) return job;
	const targetHost = await host.requireHost(String(asRecord(job).hostAlias));
	const cancelling = host.updateJob(job, { status: "cancelling", updatedAt: now() });
	await host.persistJob(cancelling);
	if (!host.executor?.cancel) return cancelling;
	try {
		const result = await host.runExclusive(jobId, () => host.executor?.cancel?.(cancelling, targetHost));
		const cancelled = host.updateJob(cancelling, {
			...(result ?? {}),
			status: result?.status ?? "cancelled",
			updatedAt: now(),
		});
		await host.persistJob(cancelled);
		await host.appendEvent({
			id: randomUUID(),
			jobId,
			type: "cancelled",
			at: now(),
			status: statusOf(cancelled),
		});
		return cancelled;
	} catch (error) {
		const unknown = host.updateJob(cancelling, {
			status: "unknown",
			updatedAt: now(),
			error: String(error),
		});
		await host.persistJob(unknown);
		return unknown;
	}
}
