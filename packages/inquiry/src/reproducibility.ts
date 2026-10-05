import type { ReproducibilityStatus, RunProvenanceSummary } from "./models";

/** Classify execution reproducibility from observable, host-recorded metadata only. */
export function reproducibilityStatus(
	codeFingerprint: string | null | undefined,
	runProvenance: RunProvenanceSummary | null | undefined,
): ReproducibilityStatus {
	const hasCode = typeof codeFingerprint === "string" && codeFingerprint.trim().length > 0;
	const hasRun =
		runProvenance !== null && typeof runProvenance === "object" && Object.keys(runProvenance).length > 0;
	if (hasCode && hasRun) return "reproducible";
	if (hasCode || hasRun) return "partial";
	return "not-reproducible";
}
