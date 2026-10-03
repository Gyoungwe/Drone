import {
	type IdempotentSubmitInput,
	MemorySubmissionLedger,
	type SubmissionLedger,
	submitIdempotently,
} from "../schedulers/direct";
import type { JobRecord, JobSpec } from "../types";

export type { IdempotentSubmitInput, SubmissionLedger };
export { MemorySubmissionLedger, submitIdempotently };

export type IdempotencyDecision =
	| { readonly kind: "new"; readonly key: string }
	| { readonly kind: "existing"; readonly job: JobRecord }
	| { readonly kind: "conflict"; readonly job: JobRecord; readonly reason: "different-spec" };

export function idempotencyKey(spec: JobSpec): string {
	if (spec.idempotencyKey?.trim()) return spec.idempotencyKey.trim();
	if (spec.jobId?.trim()) return spec.jobId.trim();
	throw new Error("job spec requires an idempotencyKey or jobId before submission");
}

export function decideIdempotentSubmit(
	spec: JobSpec,
	existing: JobRecord | undefined,
	fingerprint: (spec: JobSpec) => string,
): IdempotencyDecision {
	const key = idempotencyKey(spec);
	if (!existing) return { kind: "new", key };
	return fingerprint(existing.spec) === fingerprint(spec)
		? { kind: "existing", job: existing }
		: { kind: "conflict", job: existing, reason: "different-spec" };
}
