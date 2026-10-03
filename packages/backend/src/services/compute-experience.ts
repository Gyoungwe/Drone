import { createHash } from "node:crypto";
import type { ArtifactEntry, JobRecord } from "@drone/compute";
import type {
	ExperienceArtifact,
	ExperienceOutcome,
	ExperienceProvenance,
	ExperienceRepair,
	ExperienceStorePort,
	TerminalJobExperienceInput,
} from "@drone/knowledge";
import { recordTerminalJobExperience } from "@drone/knowledge";
import type { ComputeEvent } from "./compute";

export type { ComputeExperienceRecorder } from "./compute";

import type { ComputeExperienceRecorder } from "./compute";

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "blocked", "partial"]);

export interface ComputeExperienceBridgeOptions {
	readonly store: ExperienceStorePort;
	/** Optional stable topic/project linkage supplied by the host. */
	readonly topicId?: string | null;
	readonly tags?: readonly string[];
	readonly sourceRefs?: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function terminalStatus(event: ComputeEvent, job: JobRecord): string {
	const value = event.status ?? asRecord(job).status;
	return typeof value === "string" ? value : "unknown";
}

function outcome(status: string, event: ComputeEvent): ExperienceOutcome {
	if (event.type === "error" || status === "failed") return "failure";
	if (status === "succeeded" || event.type === "collected") return "success";
	if (status === "cancelled" || status === "blocked" || status === "partial") return "blocked";
	return "unknown";
}

function artifactRefs(entries: readonly ArtifactEntry[]): ExperienceArtifact[] {
	return entries.flatMap((entry) => {
		const row = asRecord(entry);
		const path = text(row.path);
		const sha256 = text(row.sha256 ?? row.checksum);
		if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) return [];
		const bytes = finiteNumber(row.bytes ?? row.size);
		return [
			{ sha256: sha256.toLowerCase(), ...(path ? { path } : {}), ...(bytes !== undefined ? { bytes } : {}) },
		];
	});
}

function manifestHash(entries: readonly ExperienceArtifact[]): string | undefined {
	if (entries.length === 0) return undefined;
	const canonical = entries
		.slice()
		.sort((left, right) => (left.path ?? "").localeCompare(right.path ?? ""))
		.map((entry) => `${entry.path ?? ""}\u0000${entry.sha256}\u0000${entry.bytes ?? ""}`)
		.join("\u0001");
	return createHash("sha256").update(canonical).digest("hex");
}

function workflowFacts(job: JobRecord): { workflow?: string; workflowRevision?: string } {
	const workflow = asRecord(asRecord(job).spec).workflow;
	const row = asRecord(workflow);
	const name = text(row.name);
	const version = text(row.version);
	return {
		...(name ? { workflow: name } : {}),
		...(version ? { workflowRevision: version } : {}),
	};
}

function contractHash(job: JobRecord): string | undefined {
	const row = asRecord(job);
	const spec = asRecord(row.spec);
	const auth = asRecord(spec.authorization ?? row.authorization);
	const value = text(spec.contractHash ?? row.contractHash ?? auth.contractHash);
	return value && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

function repairFacts(job: JobRecord): {
	repair?: ExperienceRepair;
	workflowSpecDiff?: TerminalJobExperienceInput["workflowSpecDiff"];
	repairSucceeded?: boolean;
} {
	const row = asRecord(job);
	const candidate = asRecord(row.repair ?? asRecord(row.spec).repair);
	if (Object.keys(candidate).length === 0) return {};
	const succeeded = candidate.succeeded === true;
	const summary = text(candidate.summary);
	const observationId = text(candidate.observationId);
	const repair: ExperienceRepair = {
		succeeded,
		...(summary ? { summary } : {}),
		...(observationId ? { observationId } : {}),
	};
	const diff = Array.isArray(candidate.workflowSpecDiff) ? candidate.workflowSpecDiff : undefined;
	return {
		repair,
		repairSucceeded: succeeded,
		...(diff ? { workflowSpecDiff: diff as TerminalJobExperienceInput["workflowSpecDiff"] } : {}),
	};
}

function featureKey(failureSignature: string | undefined, workflow: string | undefined): string {
	const value = failureSignature ?? workflow ?? "compute-job";
	// Experience record identifiers are path-safe navigation keys. Preserve the
	// workflow identity while preventing names such as `nf-core/rnaseq` from
	// being interpreted as a path by the knowledge store.
	const safe = value
		.replace(/[\\/]/g, ":")
		.replace(/\p{Cc}/gu, " ")
		.trim()
		.slice(0, 240);
	return safe && safe !== "." && safe !== ".." ? safe : "compute-job";
}

/**
 * Adapts verified terminal/collection events into the knowledge experience
 * store. The adapter only forwards host observations; it never upgrades an
 * observation to scientifically verified or stores raw commands/output.
 */
export function createComputeExperienceRecorder(
	options: ComputeExperienceBridgeOptions,
): ComputeExperienceRecorder {
	return {
		record: async (event, job) => {
			const status = terminalStatus(event, job);
			if (event.type !== "collected" && event.type !== "error" && !TERMINAL.has(status)) return;
			const row = asRecord(job);
			const spec = asRecord(row.spec);
			const artifacts = artifactRefs(event.artifacts ?? []);
			const facts = workflowFacts(job);
			const hash = contractHash(job);
			const scheduler = text(row.scheduler ?? spec.scheduler ?? spec.executorKind);
			const schedulerJobId = text(row.schedulerJobId ?? row.remoteId);
			const detail = text(event.detail ?? row.error) ?? `Compute job ${String(row.jobId)} ${status}`;
			const failureSignature = outcome(status, event) === "failure" ? detail.slice(0, 240) : undefined;
			const provenance: ExperienceProvenance = {
				runId: text(row.runId ?? row.taskId ?? row.jobId),
				observationId: event.id,
				manifestSha256: manifestHash(artifacts),
				artifactHashes: artifacts,
			};
			const repair = repairFacts(job);
			const input: TerminalJobExperienceInput = {
				jobId: String(row.jobId),
				featureKey: featureKey(failureSignature, facts.workflow),
				summary: detail,
				outcome: outcome(status, event),
				...(typeof row.exitCode === "number" ? { exitCode: row.exitCode } : {}),
				...(failureSignature ? { failureSignature } : {}),
				...(repair.repairSucceeded !== undefined ? { repairSucceeded: repair.repairSucceeded } : {}),
				...(repair.repair ? { repair: repair.repair } : {}),
				...(repair.workflowSpecDiff ? { workflowSpecDiff: repair.workflowSpecDiff } : {}),
				...(hash ? { contractHash: hash } : {}),
				...(facts.workflow ? { workflow: facts.workflow } : {}),
				...(facts.workflowRevision ? { workflowRevision: facts.workflowRevision } : {}),
				...(scheduler ? { scheduler } : {}),
				...(schedulerJobId ? { schedulerJobId } : {}),
				...(artifacts.length > 0 ? { artifactRefs: artifacts } : {}),
				observationId: event.id,
				...(Number.isFinite(event.at) ? { observedAt: new Date(event.at).toISOString() } : {}),
				...(options.topicId !== undefined ? { topicId: options.topicId } : {}),
				provenance,
				...(options.tags ? { tags: options.tags } : {}),
				...(options.sourceRefs ? { sourceRefs: options.sourceRefs } : {}),
			};
			// The knowledge store accepts its normalized ExperienceInput shape. Use
			// the terminal-job adapter so the host observation/provenance envelope is
			// constructed before the store validates and persists it.
			await recordTerminalJobExperience(options.store, input);
		},
	};
}
