import type { JobRecord, JobState } from "@drone/compute";

const TERMINAL = new Set<JobState>(["succeeded", "failed", "cancelled", "blocked", "partial"]);
export const POLLABLE = new Set<JobState>([
	"draft",
	"authorized",
	"prepared",
	"submitting",
	"queued",
	"running",
	"collecting",
	"cancelling",
	"unknown",
	"needs-login",
	"needs_login",
]);

export function now(): number {
	return Date.now();
}

export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function statusOf(value: JobRecord): JobState {
	const status = asRecord(value).status;
	return typeof status === "string" ? (status as JobState) : "unknown";
}

export function setRecordFields<T extends object>(value: T, fields: Record<string, unknown>): T {
	return { ...asRecord(value), ...fields } as T;
}

export function isTerminal(status: JobState): boolean {
	return TERMINAL.has(status);
}

const STATUS_RANK: Partial<Record<JobState, number>> = {
	draft: 0,
	authorized: 1,
	prepared: 2,
	submitting: 3,
	queued: 4,
	running: 5,
	collecting: 6,
	cancelling: 6,
};

/** Keep reconciliation monotonic. A stale runner response cannot revive a terminal job. */
export function mergeStatus(previous: JobState, next: JobState): JobState {
	if (isTerminal(previous)) return previous;
	if (next === "unknown") return "unknown";
	if (previous === "unknown") return next;
	// Terminal runner states are authoritative even though they are not part of
	// the in-flight rank table. Without this branch a queued job could never
	// reconcile to succeeded because the fallback rank (-1) looked stale.
	if (isTerminal(next)) return next;
	if ((STATUS_RANK[next] ?? -1) < (STATUS_RANK[previous] ?? -1)) return previous;
	return next;
}
