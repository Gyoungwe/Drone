import { randomUUID } from "node:crypto";
import type { HostProfile, JobRecord } from "@drone/compute";
import type { ComputeEvent, ComputeExecutor } from "./compute";
import { asRecord, mergeStatus, now, POLLABLE, statusOf } from "./compute-job-state";

export interface ComputeReconcileHost {
	executor: Pick<ComputeExecutor, "status"> | undefined;
	hostFor(alias: string): HostProfile | undefined;
	updateJob(job: JobRecord, fields: Record<string, unknown>): JobRecord;
	persistJob(job: JobRecord): Promise<void>;
	appendEvent(event: ComputeEvent): Promise<void>;
	runExclusive<T>(jobId: string, task: () => Promise<T> | T): Promise<T>;
}

export async function reconcileComputeJob(
	host: ComputeReconcileHost,
	current: JobRecord,
): Promise<JobRecord> {
	const status = statusOf(current);
	if (!POLLABLE.has(status) || !host.executor) {
		return { ...current };
	}
	const targetHost = host.hostFor(String(asRecord(current).hostAlias));
	if (!targetHost) {
		return { ...current };
	}
	try {
		const remote = await host.runExclusive(String(asRecord(current).jobId), () =>
			host.executor?.status(current, targetHost),
		);
		if (!remote) {
			return { ...current };
		}
		const nextStatus = mergeStatus(status, remote.status);
		const updated = host.updateJob(current, {
			...remote,
			status: nextStatus,
			updatedAt: now(),
		});
		await host.persistJob(updated);
		if (nextStatus !== status)
			await host.appendEvent({
				id: randomUUID(),
				jobId: String(asRecord(current).jobId),
				type: "status",
				at: now(),
				status: nextStatus,
			});
		return { ...updated };
	} catch (error) {
		const updated = host.updateJob(current, {
			status: "unknown",
			updatedAt: now(),
			error: String(error),
		});
		await host.persistJob(updated);
		await host.appendEvent({
			id: randomUUID(),
			jobId: String(asRecord(current).jobId),
			type: "error",
			at: now(),
			status: "unknown",
			detail: String(error),
		});
		return { ...updated };
	}
}
