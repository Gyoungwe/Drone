import type { JobRecord } from "@drone/compute";

type ScalarParameters = Readonly<Record<string, string | number | boolean | null>>;

/** Bounded run metadata used for provenance display and reproducibility checks. */
export interface InquiryRunProvenanceSummary {
	readonly containerDigests?: readonly string[];
	readonly workflow?: string;
	readonly modules?: readonly string[];
	readonly commandSummary?: string;
	readonly environment?: Readonly<Record<string, string>>;
}

/** Metadata accepted from a trusted host event after it has verified the file. */
export interface InquiryEventArtifact {
	readonly id?: string;
	readonly path: string;
	readonly bytes?: number;
	readonly size?: number;
	readonly sha256?: string;
	readonly location?: "local" | "remote";
	readonly purpose?: "input" | "draft" | "intermediate" | "deliverable" | "evidence";
	readonly status?: "valid" | "superseded" | "cleanup-candidate" | "archived" | "pending-review";
	readonly parentIds?: readonly string[];
	readonly runId?: string;
	readonly sourceKind?: "task" | "run" | "input" | "tool" | "workflow" | "manual";
	readonly sourceId?: string;
}

export interface InquiryEventManifest {
	readonly entries?: readonly InquiryEventArtifact[];
}

interface InquiryExecutionEventBase {
	readonly id: string;
	readonly runId?: string;
	readonly startedAt?: number | string;
	readonly detail?: string;
	readonly codeFingerprint?: string;
	readonly parameters?: ScalarParameters;
	readonly sessionId?: string;
	readonly turn?: number;
	readonly runProvenance?: InquiryRunProvenanceSummary;
	readonly artifacts?: readonly InquiryEventArtifact[];
	readonly manifest?: InquiryEventManifest;
	readonly projectId?: string;
}

export interface InquiryComputeEvent extends InquiryExecutionEventBase {
	readonly jobId: string;
	readonly type: "created" | "submitted" | "status" | "logs" | "collected" | "cancelled" | "error";
	readonly at: number | string;
	readonly status?: string;
	readonly cursor?: string;
	readonly hostId?: string;
}

export interface InquiryTaskTerminalEvent extends InquiryExecutionEventBase {
	readonly taskId: string;
	readonly status: "succeeded" | "failed" | "cancelled" | "blocked" | "partial" | "unknown";
	readonly at?: number | string;
}

export interface InquiryLocalExecutionEvent {
	readonly id: string;
	readonly projectId?: string;
	readonly sessionId?: string;
	readonly turn?: number;
	readonly toolName: string;
	readonly startedAt?: number | string;
	readonly finishedAt?: number | string;
	readonly codeFingerprint: string;
	readonly parameters: ScalarParameters;
	readonly runProvenance: InquiryRunProvenanceSummary;
	readonly outcome: "running" | "succeeded" | "failed" | "blocked" | "unknown";
	readonly artifacts?: readonly InquiryEventArtifact[];
}

export interface InquiryDecisionEvent {
	readonly id: string;
	readonly kind:
		| "task-authorization"
		| "workflow-repair"
		| "subagent-dispatch"
		| "compute-submit"
		| "zotero-write"
		| "rebind";
	readonly summary: string;
	readonly basis?: readonly string[];
	readonly affectedArtifactIds?: readonly string[];
	readonly at?: number | string;
	readonly projectId?: string;
}

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
	const runProvenance: InquiryRunProvenanceSummary = {
		workflow: "name" in workflow ? workflow.name : `workflow:${job.jobId}`,
		modules: modules.map((m) => `${m.name}@${m.version}${m.commit ? `:${m.commit}` : ""}`),
		containerDigests: modules.flatMap((m) => (m.containerDigest ? [m.containerDigest] : [])),
		commandSummary: "compute runner: prepare → start → status → collect",
		environment: { host: job.hostAlias },
	};
	const extra = job as JobRecord & { sessionId?: string; turn?: number; codeFingerprint?: string };
	const codeFingerprint = extra.codeFingerprint ?? ("specHash" in workflow ? workflow.specHash : undefined);
	return {
		hostId: job.hostAlias,
		...(codeFingerprint ? { codeFingerprint } : {}),
		parameters,
		runProvenance,
		...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
		...(extra.turn !== undefined ? { turn: extra.turn } : {}),
	};
}
