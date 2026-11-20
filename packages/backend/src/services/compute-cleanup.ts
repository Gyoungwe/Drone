import { randomUUID } from "node:crypto";
import type { HostProfile, JobRecord } from "@drone/compute";
import type { ComputeEvent, ComputeExecutor, ComputeStatusResult } from "./compute";
import { asRecord, isTerminal, mergeStatus, now } from "./compute-job-state";

export type ComputeCleanupEvidence = {
	state: "confirmed" | "unknown" | "failed" | "unsupported";
	jobId: string;
	method?: "direct" | "slurm";
	observedAt?: string;
	error?: string;
};

export interface ComputeCancelHost {
	executor: Pick<ComputeExecutor, "cancel"> | undefined;
	requireJob(jobId: string): Promise<JobRecord>;
	requireHost(alias: string): Promise<HostProfile>;
	updateJob(job: JobRecord, fields: Record<string, unknown>): JobRecord;
	persistJob(job: JobRecord): Promise<void>;
	appendEvent(event: ComputeEvent): Promise<void>;
	runExclusive<T>(jobId: string, task: () => Promise<T> | T): Promise<T>;
}

type CancelOutcome = { result: ComputeStatusResult | undefined } | { error: string };

export function isCleanupForJob(evidence: unknown, jobId: string): evidence is ComputeCleanupEvidence {
	const cleanup = asRecord(evidence);
	const { state } = cleanup;
	return (
		cleanup.jobId === jobId &&
		(state === "confirmed" || state === "unknown" || state === "failed" || state === "unsupported")
	);
}

function cancelOutcome(previous: JobRecord, outcome: CancelOutcome) {
	const jobId = previous.remoteId ?? previous.jobId;
	if ("error" in outcome) {
		return {
			status: mergeStatus(previous.status, "unknown"),
			cleanup: { state: "unknown", jobId, error: outcome.error } satisfies ComputeCleanupEvidence,
			...(isTerminal(previous.status) ? {} : { error: outcome.error }),
		};
	}
	const { result } = outcome;
	const cleanup: ComputeCleanupEvidence = isCleanupForJob(result?.cleanup, jobId)
		? result.cleanup
		: { state: "unknown", jobId };
	return {
		status: result ? mergeStatus(previous.status, result.status) : previous.status,
		...(typeof result?.remoteId === "string" ? { remoteId: result.remoteId } : {}),
		cleanup,
	};
}

export async function cancelComputeJob(host: ComputeCancelHost, jobId: string): Promise<JobRecord> {
	const job = await host.requireJob(jobId);
	const terminal = isTerminal(job.status);
	const { executor } = host;
	const cancel = executor?.cancel;
	if (terminal && (!cancel || asRecord(asRecord(job).cleanup).state === "confirmed")) return job;

	const targetHost = await host.requireHost(job.hostAlias);
	const requestedAt = now();
	const requested = host.updateJob(job, {
		status: terminal ? job.status : "cancelling",
		cancelRequestedAt: requestedAt,
		updatedAt: requestedAt,
	});
	await host.persistJob(requested);
	if (!cancel) return requested;

	let outcome: CancelOutcome;
	try {
		outcome = { result: await host.runExclusive(jobId, () => cancel.call(executor, requested, targetHost)) };
	} catch (error) {
		outcome = { error: String(error) };
	}
	const fields = cancelOutcome(requested, outcome);
	const updated = host.updateJob(requested, { ...fields, updatedAt: now() });
	await host.persistJob(updated);
	if (terminal || !("error" in outcome)) {
		await host.appendEvent({
			id: randomUUID(),
			jobId,
			type: terminal ? "cleanup" : "cancelled",
			at: now(),
			status: fields.status,
		});
	}
	return updated;
}
