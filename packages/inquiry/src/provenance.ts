import type {
	ArtifactProvenance,
	ArtifactRecord,
	AttemptRecord,
	InquirySnapshot,
	RunProvenanceSummary,
} from "./models";
import { reproducibilityStatus } from "./reproducibility";

const MAX_PARENT_CHAIN = 20;

function runProvenanceFor(
	artifact: ArtifactRecord,
	attempts: readonly AttemptRecord[],
): RunProvenanceSummary | undefined {
	if (artifact.runProvenance && Object.keys(artifact.runProvenance).length > 0) return artifact.runProvenance;
	const candidate = attempts.find(
		(attempt) => attempt.runProvenance && Object.keys(attempt.runProvenance).length > 0,
	);

	return candidate?.runProvenance;
}

/** Build a bounded, content-free provenance projection for one artifact. */
export function artifactProvenance(
	snapshot: Pick<InquirySnapshot, "artifacts" | "attempts">,
	artifactId: string,
): ArtifactProvenance | undefined {
	const artifact = snapshot.artifacts.find((item) => item.id === artifactId);
	if (!artifact) return undefined;
	const byId = new Map(snapshot.artifacts.map((item) => [item.id, item]));
	const attempts = snapshot.attempts.filter((attempt) => attempt.artifactIds.includes(artifact.id));
	const parentChain: ArtifactRecord[] = [];
	const queue = [...artifact.parentIds];
	const visited = new Set<string>([artifact.id]);
	let parentChainTruncated = false;
	while (queue.length > 0) {
		const parentId = queue.shift();
		if (!parentId || visited.has(parentId)) continue;
		visited.add(parentId);
		const parent = byId.get(parentId);
		if (!parent) continue;
		if (parentChain.length >= MAX_PARENT_CHAIN) {
			parentChainTruncated = true;
			break;
		}
		parentChain.push(parent);
		queue.push(...parent.parentIds);
	}
	if (queue.length > 0) parentChainTruncated = true;
	const runProvenance = runProvenanceFor(artifact, attempts);
	const sourceAttemptSession = attempts.find((attempt) => attempt.sessionId);
	const sourceAttemptTurn = attempts.find((attempt) => attempt.turn !== undefined);
	const codeFingerprint = attempts.find((attempt) => attempt.codeFingerprint)?.codeFingerprint;
	return {
		artifact,
		parentChain,
		parentChainTruncated,
		attempts,
		...(runProvenance ? { runProvenance } : {}),
		...(artifact.sessionId || sourceAttemptSession?.sessionId
			? { sourceSessionId: artifact.sessionId ?? sourceAttemptSession?.sessionId }
			: {}),
		...(artifact.turn !== undefined || sourceAttemptTurn?.turn !== undefined
			? { sourceTurn: artifact.turn ?? sourceAttemptTurn?.turn }
			: {}),
		reproducibility: reproducibilityStatus(codeFingerprint, runProvenance),
	};
}
