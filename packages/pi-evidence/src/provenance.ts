import type { AnalysisIdentity } from "@gyoungwe/plugin-api";
import {
	assertValidArtifactManifest,
	type EvidenceArtifact,
	type EvidenceArtifactManifest,
} from "./artifacts";
import { digestJson, isSha256 } from "./digest";

export interface EvidenceProvenance {
	readonly schemaVersion: 1;
	readonly adapter?: AnalysisIdentity;
	readonly workflow?: AnalysisIdentity;
	readonly method?: AnalysisIdentity;
	readonly workflowDigest?: string;
	readonly methodDigest?: string;
	readonly toolContractDigest?: string;
	readonly containerDigest?: string;
	readonly environmentFingerprint?: string;
	readonly specSha256?: string;
	readonly artifacts: readonly EvidenceArtifact[];
	readonly sourceRefs?: readonly string[];
	readonly observedAt?: string;
}

export function validateProvenance(value: EvidenceProvenance): void {
	if (value.schemaVersion !== 1 || !Array.isArray(value.artifacts))
		throw new Error("Invalid evidence provenance");
	assertValidArtifactManifest({ version: 1, entries: value.artifacts }, { requireIdentity: true });
	for (const [label, digest] of [
		["workflowDigest", value.workflowDigest],
		["methodDigest", value.methodDigest],
		["toolContractDigest", value.toolContractDigest],
		["containerDigest", value.containerDigest],
		["specSha256", value.specSha256],
	] as const) {
		if (digest !== undefined && !isSha256(digest)) throw new Error(`Invalid ${label}`);
	}
	if (
		value.sourceRefs?.some(
			(ref) =>
				typeof ref !== "string" ||
				!ref.trim() ||
				ref.startsWith("/") || ref.startsWith("~") || /^[A-Za-z]:[\\/]/.test(ref) ||
				/(?:^|[/\\])(?:\.pi|\.drone|\.git|\.ssh|auth\.json|credentials?)(?:[/\\]|$)/iu.test(ref),
		)
	)
		throw new Error("Invalid provenance source reference");
}

export function provenanceDigest(value: EvidenceProvenance): string {
	validateProvenance(value);
	return digestJson({
		...value,
		artifacts: [...value.artifacts].sort((a, b) => a.path.localeCompare(b.path)),
	});
}

export function workflowDigest(value: unknown): string {
	return digestJson(value);
}

export function methodDigest(value: unknown): string {
	return digestJson(value);
}

export function toolContractDigest(value: unknown): string {
	return digestJson(value);
}

export function containerDigest(value: unknown): string {
	return digestJson(value);
}

export function createEvidenceProvenance(
	input: Omit<EvidenceProvenance, "schemaVersion">,
): EvidenceProvenance {
	const value: EvidenceProvenance = {
		schemaVersion: 1,
		...input,
		artifacts: [...input.artifacts].sort((a, b) => a.path.localeCompare(b.path)),
	};
	validateProvenance(value);
	return value;
}

export type SharedAnalysisIdentity = AnalysisIdentity;
export type EvidenceArtifactForProvenance = EvidenceArtifact;
export type EvidenceManifestForProvenance = EvidenceArtifactManifest;
