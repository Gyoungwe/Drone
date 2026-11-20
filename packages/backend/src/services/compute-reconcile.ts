import { randomUUID } from "node:crypto";
import type { HostProfile, JobRecord } from "@drone/compute";
import type { ComputeEvent, ComputeExecutor, ComputeStatusResult } from "./compute";
import { type ComputeCleanupEvidence, isCleanupForJob } from "./compute-cleanup";
import { asRecord, isTerminal, mergeStatus, now, POLLABLE, statusOf } from "./compute-job-state";

export interface ComputeReconcileHost {
	executor: Pick<ComputeExecutor, "status"> | undefined;
	hostFor(alias: string): HostProfile | undefined;
	updateJob(job: JobRecord, fields: Record<string, unknown>): JobRecord;
	persistJob(job: JobRecord): Promise<void>;
	appendEvent(event: ComputeEvent): Promise<void>;
	runExclusive<T>(jobId: string, task: () => Promise<T> | T): Promise<T>;
}

function cleanupForJob(evidence: unknown, jobId: string): ComputeCleanupEvidence {
	return isCleanupForJob(evidence, jobId) ? evidence : { state: "unknown", jobId };
}

async function reconcileTerminalCleanup(host: ComputeReconcileHost, current: JobRecord): Promise<JobRecord> {
	const { executor } = host;
	const { cancelRequestedAt, cleanup: previousCleanup } = asRecord(current);
	if (!executor || typeof cancelRequestedAt !== "number") return { ...current };
	const previousState = asRecord(previousCleanup).state;
	if (previousCleanup !== undefined && previousState !== "unknown") return { ...current };
	const targetHost = host.hostFor(current.hostAlias);
	if (!targetHost) return { ...current };

	const jobId = current.remoteId ?? current.jobId;
	let outcome: { result: ComputeStatusResult } | { error: string };
	try {
		outcome = { result: await host.runExclusive(current.jobId, () => executor.status(current, targetHost)) };
	} catch (error) {
		outcome = { error: String(error) };
	}
	const cleanup =
		"error" in outcome
			? { state: "unknown", jobId, error: outcome.error }
			: cleanupForJob(outcome.result.cleanup, jobId);
	const updated = host.updateJob(current, { cleanup, updatedAt: now() });
	await host.persistJob(updated);
	if ("result" in outcome && cleanup.state !== previousState) {
		await host.appendEvent({
			id: randomUUID(),
			jobId: current.jobId,
			type: "cleanup",
			at: now(),
			status: current.status,
		});
	}
	return { ...updated };
}

export async function reconcileComputeJob(
	host: ComputeReconcileHost,
	current: JobRecord,
): Promise<JobRecord> {
	const status = statusOf(current);
	if (isTerminal(status)) return reconcileTerminalCleanup(host, current);
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
		const { cleanup, ...remoteFields } = remote;
		const updated = host.updateJob(current, {
			...remoteFields,
			...("cleanup" in remote ? { cleanup: cleanupForJob(cleanup, current.remoteId ?? current.jobId) } : {}),
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
