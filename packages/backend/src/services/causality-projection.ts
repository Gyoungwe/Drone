import type { JobRecord, SubmissionRecord } from "@drone/compute";
import type { CausalEnvelope } from "@drone/shared";
import type { IntentRecord } from "../session/intent-journal";
import type { EvidenceCheckpoint, EvidenceReplayReceipt } from "./analysis-evidence";
import type { AnalysisComputeBinding } from "./analysis-orchestration";
import type { ComputeEvent } from "./compute";

/** A renderer/host-safe lineage row. It deliberately contains no args, text, paths or credentials. */
export interface CausalityProjectionRecord {
	readonly eventId: CausalEnvelope["eventId"];
	readonly causationId?: CausalEnvelope["causationId"];
	readonly runAttemptId?: CausalEnvelope["runAttemptId"];
	readonly kind:
		| "analysis-binding"
		| "compute-job"
		| "compute-event"
		| "submission"
		| "intent"
		| "checkpoint"
		| "replay";
	readonly ref: string;
	readonly status?: string;
	readonly at?: string | number;
}

export interface CausalityProjectionInput {
	readonly analysisBindings?: Readonly<Record<string, AnalysisComputeBinding>>;
	readonly jobs?: readonly JobRecord[];
	readonly computeEvents?: readonly ComputeEvent[];
	readonly submissions?: readonly SubmissionRecord[];
	readonly intents?: readonly IntentRecord[];
	readonly checkpoints?: readonly EvidenceCheckpoint[];
	readonly replays?: readonly EvidenceReplayReceipt[];
}

export interface CausalityProjection {
	readonly records: readonly CausalityProjectionRecord[];
	readonly byRunAttempt: ReadonlyMap<string, readonly CausalityProjectionRecord[]>;
	readonly byEventId: ReadonlyMap<string, CausalityProjectionRecord>;
}

/**
 * Build a deterministic, read-only view over the independent durable ledgers.
 * Missing lineage is intentionally omitted: legacy records stay partial instead
 * of being connected by guessed timestamps, filenames or array order.
 */
export function projectCausality(input: CausalityProjectionInput): CausalityProjection {
	const rows: CausalityProjectionRecord[] = [];
	for (const [analysisId, binding] of Object.entries(input.analysisBindings ?? {})) {
		push(rows, binding.lineage, {
			kind: "analysis-binding",
			ref: analysisId,
			status: "bound",
		});
	}
	for (const job of input.jobs ?? []) {
		push(rows, job.spec.lineage, {
			kind: "compute-job",
			ref: job.jobId,
			status: job.status,
			at: job.updatedAt,
		});
	}
	for (const event of input.computeEvents ?? []) {
		push(rows, event.lineage, {
			kind: "compute-event",
			ref: `${event.jobId}:${event.id}`,
			status: event.status,
			at: event.at,
		});
	}
	for (const submission of input.submissions ?? []) {
		push(rows, submission.lineage, {
			kind: "submission",
			ref: submission.jobId,
			status: "submitted",
			at: submission.submittedAt,
		});
	}
	for (const intent of input.intents ?? []) {
		push(rows, intent.lineage, {
			kind: "intent",
			ref: `${intent.toolCallId}:${intent.kind}`,
			status: intent.kind === "end" ? (intent.isError ? "error" : "completed") : intent.kind,
			at: intent.ts,
		});
	}
	for (const checkpoint of input.checkpoints ?? []) {
		push(rows, checkpoint.lineage, {
			kind: "checkpoint",
			ref: checkpoint.id,
			status: "frozen",
			at: checkpoint.createdAt,
		});
	}
	for (const replay of input.replays ?? []) {
		push(rows, replay.lineage, {
			kind: "replay",
			ref: replay.id,
			status: replay.status,
			at: replay.completedAt,
		});
	}

	const deduped = new Map<string, CausalityProjectionRecord>();
	for (const row of rows) {
		if (!deduped.has(row.eventId)) deduped.set(row.eventId, row);
	}
	const records = [...deduped.values()].sort(compareRows);
	const byEventId = new Map(records.map((row) => [row.eventId, row] as const));
	const grouped = new Map<string, CausalityProjectionRecord[]>();
	for (const row of records) {
		if (!row.runAttemptId) continue;
		const bucket = grouped.get(row.runAttemptId) ?? [];
		bucket.push(row);
		grouped.set(row.runAttemptId, bucket);
	}
	return { records, byRunAttempt: grouped, byEventId };
}

function push(
	rows: CausalityProjectionRecord[],
	lineage: CausalEnvelope | undefined,
	row: Omit<CausalityProjectionRecord, "eventId" | "causationId" | "runAttemptId">,
): void {
	if (!lineage) return;
	rows.push({
		...row,
		eventId: lineage.eventId,
		...(lineage.causationId ? { causationId: lineage.causationId } : {}),
		...(lineage.runAttemptId ? { runAttemptId: lineage.runAttemptId } : {}),
	});
}

function compareRows(a: CausalityProjectionRecord, b: CausalityProjectionRecord): number {
	const at = a.at;
	const bt = b.at;
	if (typeof at === "number" && typeof bt === "number") return at - bt || a.eventId.localeCompare(b.eventId);
	return String(at ?? "").localeCompare(String(bt ?? "")) || a.eventId.localeCompare(b.eventId);
}
