import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { JobRecord } from "@drone/compute";
import type { ArtifactRecord, ArtifactRerunRecord, RunProvenanceSummary } from "@drone/inquiry";
import type { ComputeServicePort } from "./compute";
import type { ComputeHostAdapter } from "./compute-adapter";
import type { InquiryComputeEvent, InquiryRerunHandler } from "./inquiry";

/** Project declarative identities and scalar parameters; never command or file bodies. */
export function computeInquiryMetadata(
	job: JobRecord,
): Pick<
	InquiryComputeEvent,
	"codeFingerprint" | "parameters" | "runProvenance" | "sessionId" | "turn" | "hostId"
> {
	const workflow = job.spec.workflow;
	const modules = "modules" in workflow ? workflow.modules : [];
	const parameters: Record<string, string | number | boolean | null> = {};
	if ("steps" in workflow)
		for (const step of workflow.steps)
			for (const [key, value] of Object.entries(step.parameters ?? {}))
				parameters[`${step.id}.${key}`] = value;
	const runProvenance: RunProvenanceSummary = {
		workflow: "name" in workflow ? workflow.name : `workflow:${job.jobId}`,
		modules: modules.map(
			(module) => `${module.name}@${module.version}${module.commit ? `:${module.commit}` : ""}`,
		),
		containerDigests: modules.flatMap((module) => (module.containerDigest ? [module.containerDigest] : [])),
		commandSummary: "compute runner: prepare → start → status → collect",
		environment: { host: job.hostAlias },
	};
	const row = job as unknown as { sessionId?: string; turn?: number; codeFingerprint?: string };
	return {
		hostId: job.hostAlias,
		...(row.codeFingerprint || ("specHash" in workflow && workflow.specHash)
			? { codeFingerprint: row.codeFingerprint ?? ("specHash" in workflow ? workflow.specHash : undefined) }
			: {}),
		parameters,
		runProvenance,
		...(row.sessionId ? { sessionId: row.sessionId } : {}),
		...(row.turn !== undefined ? { turn: row.turn } : {}),
	};
}

/** Submit only; the caller persists the job id before returning to the UI. */
export function createInquiryComputeRerun(options: {
	adapter: Pick<ComputeHostAdapter, "resubmitJob">;
	compute?: Pick<ComputeServicePort, "getJob" | "status" | "collect">;
	collectionRoot: string;
	drainEvents: () => Promise<void>;
	pollIntervalMs?: number;
	maxWaitMs?: number;
}): InquiryRerunHandler {
	return async (provenance): Promise<{ readonly jobId: string }> => {
		const originalId =
			provenance.attempts.find((attempt) => typeof attempt.parameters.jobId === "string")?.parameters.jobId ??
			provenance.artifact.runId;
		if (typeof originalId !== "string" || !options.adapter.resubmitJob)
			throw new Error("No recorded compute workflow is available for this artifact");
		const submitted = await options.adapter.resubmitJob(originalId);
		return { jobId: submitted.id };
	};
}

/** Wait for a submitted job and collect its verified output in the background. */
export function createInquiryComputeRerunCompletion(options: {
	compute: Pick<ComputeServicePort, "getJob" | "status" | "collect">;
	collectionRoot: string;
	drainEvents: () => Promise<void>;
	pollIntervalMs?: number;
	maxWaitMs?: number;
}): (pending: ArtifactRerunRecord) => Promise<ArtifactRecord> {
	return async (pending): Promise<ArtifactRecord> => {
		let job = await options.compute.getJob(pending.jobId);
		const deadline = Date.now() + (options.maxWaitMs ?? 24 * 60 * 60 * 1000);
		while (job && job.status !== "succeeded") {
			if (["failed", "cancelled", "blocked", "partial", "unknown"].includes(job.status))
				throw new Error(`Rerun ended with ${job.status}`);
			if (Date.now() >= deadline) throw new Error(`Rerun is still pending: ${pending.jobId}`);
			await delay(options.pollIntervalMs ?? 1000);
			job = await options.compute.status(pending.jobId);
		}
		if (!job) throw new Error("Submitted rerun is unavailable");
		const collection = await options.compute.collect(job.jobId, {
			targetDir: join(options.collectionRoot, job.jobId),
			expected: [pending.artifact.path],
		});
		const output = collection.manifest.entries.find((entry) => entry.path === pending.artifact.path);
		if (!output?.sha256) throw new Error("Rerun did not collect the requested verified artifact");
		await options.drainEvents();
		const timestamp = new Date().toISOString();
		return {
			...pending.artifact,
			id: `run:${job.jobId}:${output.path}:${output.sha256.toLowerCase()}`,
			path: output.path,
			bytes: output.bytes ?? output.size ?? 0,
			sha256: output.sha256,
			source: { kind: "run", id: job.jobId },
			parentIds: [pending.artifact.id],
			runId: job.jobId,
			runProvenance: computeInquiryMetadata(job).runProvenance,
			status: "valid",
			createdAt: timestamp,
			updatedAt: timestamp,
		};
	};
}
