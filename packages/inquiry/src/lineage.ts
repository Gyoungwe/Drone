import type {
	ArtifactRecord,
	ArtifactStatus,
	AttemptRecord,
	FindingRecord,
	InquirySnapshot,
	QuestionRecord,
} from "./models";

const SHA256 = /^[a-f0-9]{64}$/i;

/** Paths are project-relative so a ledger cannot silently escape its workspace. */
export function isSafeArtifactPath(path: string): boolean {
	if (!path || path.includes("\u0000") || path.startsWith("~")) return false;
	if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path)) return false;
	const parts = path.replaceAll("\\", "/").split("/");
	return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function validateArtifactRecord(record: ArtifactRecord): readonly string[] {
	const errors: string[] = [];
	if (record.schemaVersion !== 1) errors.push("unsupported schema version");
	if (!nonEmpty(record.id)) errors.push("id is required");
	if (!nonEmpty(record.projectId)) errors.push("projectId is required");
	if (!isSafeArtifactPath(record.path)) errors.push("path must be a safe project-relative path");
	if (record.location !== "local" && record.location !== "remote") errors.push("invalid location");
	if (!Number.isSafeInteger(record.bytes) || record.bytes < 0)
		errors.push("bytes must be a non-negative integer");
	if (!SHA256.test(record.sha256)) errors.push("sha256 must be a 64-character hexadecimal digest");
	if (!record.source || !nonEmpty(record.source.id)) errors.push("source id is required");
	if (!["task", "run", "input", "tool", "workflow", "manual"].includes(record.source?.kind))
		errors.push("invalid source kind");
	if (!["input", "draft", "intermediate", "deliverable", "evidence"].includes(record.purpose))
		errors.push("invalid purpose");
	if (!["valid", "superseded", "cleanup-candidate", "archived"].includes(record.status))
		errors.push("invalid status");
	if (new Set(record.parentIds).size !== record.parentIds.length) errors.push("parentIds must be unique");
	if (record.parentIds.some((id) => !nonEmpty(id))) errors.push("parentIds must be non-empty");
	if (record.runId !== undefined && !nonEmpty(record.runId)) errors.push("runId must be non-empty");
	if (!validDate(record.createdAt) || !validDate(record.updatedAt))
		errors.push("timestamps must be ISO dates");
	return errors;
}

function validDate(value: unknown): boolean {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Validate parent references and detect lineage cycles before persisting an artifact. */
export function validateArtifactLineage(
	record: ArtifactRecord,
	artifacts: readonly ArtifactRecord[],
): readonly string[] {
	const errors = [...validateArtifactRecord(record)];
	const byId = new Map(artifacts.map((item) => [item.id, item]));
	for (const parentId of record.parentIds) {
		const parent = byId.get(parentId);
		if (!parent) {
			errors.push(`missing parent artifact: ${parentId}`);
			continue;
		}
		if (parent.projectId !== record.projectId) errors.push(`parent belongs to another project: ${parentId}`);
		if (parent.id === record.id) errors.push("artifact cannot parent itself");
		if (hasAncestor(parent.id, record.id, byId)) errors.push(`lineage cycle through parent: ${parentId}`);
	}
	return [...new Set(errors)];
}

function hasAncestor(start: string, target: string, byId: ReadonlyMap<string, ArtifactRecord>): boolean {
	const seen = new Set<string>();
	let current = byId.get(start);
	while (current) {
		if (current.id === target) return true;
		if (seen.has(current.id)) return true;
		seen.add(current.id);
		current = current.parentIds.map((id) => byId.get(id)).find(Boolean);
	}
	return false;
}

export interface CleanupCandidate {
	readonly artifact: ArtifactRecord;
	readonly reason: "unreferenced" | "superseded" | "stale-draft";
	readonly referencedBy: readonly string[];
}

/** Return a deterministic, read-only cleanup proposal. No files are touched. */
export function cleanupCandidates(
	snapshot: Pick<InquirySnapshot, "artifacts" | "findings" | "attempts" | "updatedAt">,
	options: { readonly staleBefore?: string } = {},
): readonly CleanupCandidate[] {
	const references = new Map<string, string[]>();
	const addReference = (artifactId: string, owner: string) => {
		const list = references.get(artifactId) ?? [];
		list.push(owner);
		references.set(artifactId, list);
	};
	for (const finding of snapshot.findings)
		for (const artifactId of finding.artifactIds) addReference(artifactId, `finding:${finding.id}`);
	for (const attempt of snapshot.attempts)
		for (const artifactId of attempt.artifactIds) addReference(artifactId, `attempt:${attempt.id}`);
	for (const artifact of snapshot.artifacts)
		for (const parentId of artifact.parentIds) addReference(parentId, `artifact:${artifact.id}`);
	const staleBefore = options.staleBefore ? Date.parse(options.staleBefore) : Number.NaN;
	return snapshot.artifacts
		.filter((artifact) => {
			if (artifact.status === "archived") return false;
			if ((references.get(artifact.id)?.length ?? 0) > 0) return false;
			if (artifact.status === "cleanup-candidate") return true;
			if (artifact.status === "superseded") return true;
			return (
				artifact.purpose === "draft" &&
				Number.isFinite(staleBefore) &&
				Date.parse(artifact.updatedAt) < staleBefore
			);
		})
		.map((artifact) => ({
			artifact,
			reason:
				artifact.status === "superseded"
					? ("superseded" as const)
					: artifact.status === "cleanup-candidate"
						? ("unreferenced" as const)
						: ("stale-draft" as const),
			referencedBy: [...(references.get(artifact.id) ?? [])].sort(),
		}))
		.sort((a, b) => a.artifact.id.localeCompare(b.artifact.id));
}

export function validateFindingReferences(
	finding: FindingRecord,
	snapshot: InquirySnapshot,
): readonly string[] {
	const errors: string[] = [];
	const artifacts = new Map(snapshot.artifacts.map((artifact) => [artifact.id, artifact]));
	for (const artifactId of finding.artifactIds) {
		const artifact = artifacts.get(artifactId);
		if (!artifact) errors.push(`missing artifact reference: ${artifactId}`);
		else if (artifact.status === "archived")
			errors.push(`archived artifact cannot support finding: ${artifactId}`);
	}
	for (const hypothesisId of finding.hypothesisIds) {
		if (!snapshot.questions.some((question) => question.id === hypothesisId))
			errors.push(`missing hypothesis reference: ${hypothesisId}`);
	}
	return [...new Set(errors)];
}

export function statusAllowsPublication(status: ArtifactStatus): boolean {
	return status === "valid" || status === "superseded";
}

export type LedgerRecord = ArtifactRecord | FindingRecord | QuestionRecord | AttemptRecord;
