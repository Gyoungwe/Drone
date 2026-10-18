import type { AnalysisContext as PluginAnalysisContext } from "@gyoungwe/plugin-api";
import {
	assertValidArtifactManifest,
	EVIDENCE_CAPSULE_LIMIT,
	type EvidenceAccessLevel,
	type EvidenceArtifact,
	type EvidenceArtifactRole,
	isSafeBranchId,
	isSafeEvidencePath,
} from "./artifacts";
import { digestJson, isSha256 } from "./digest";
import { type EvidenceProvenance, validateProvenance } from "./provenance";

export type EvidenceAnalysisMode = "exploratory" | "inferential";

/** Host-neutral analysis projection. It intentionally has no workspace path. */
export interface EvidenceAnalysisSnapshot {
	readonly version: 1;
	readonly id: string;
	readonly question: string;
	readonly assay: string;
	readonly mode: EvidenceAnalysisMode;
	readonly stage?: string;
	readonly status?: string;
	readonly capabilities?: readonly string[];
	readonly adapter?: { readonly id: string; readonly version: string };
	readonly provenance?: EvidenceProvenance;
	readonly review?: {
		readonly approved: boolean;
		readonly detail: string;
		readonly limitations: readonly string[];
	};
	readonly publicationRequested?: boolean;
	readonly events?: readonly { readonly type: string; readonly at: string; readonly detail?: string }[];
}

export interface FrozenEvidenceFile {
	readonly artifact: EvidenceArtifact;
	readonly kind: EvidenceArtifactRole;
}

export interface EvidenceLineage {
	readonly eventId: string;
	readonly runAttemptId?: string;
	readonly parentEventId?: string;
}

export interface EvidenceCheckpoint {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly analysis: EvidenceAnalysisSnapshot;
	readonly files: readonly FrozenEvidenceFile[];
	readonly environmentFingerprint?: string;
	readonly createdAt: string;
	readonly lineage?: EvidenceLineage;
}

export type EvidenceBranchStatus = "preparing" | "ready" | "failed";

/** A branch descriptor contains no workspace or execution authorization. */
export interface EvidenceBranch {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly checkpointId: string;
	readonly sourceAnalysisId: string;
	readonly status: EvidenceBranchStatus;
	readonly createdAt: string;
}

function checkpointBody(value: Omit<EvidenceCheckpoint, "id">): Omit<EvidenceCheckpoint, "id"> {
	const { lineage: _lineage, analysis, ...rest } = value;
	const { provenance, ...analysisRest } = analysis;
	const contentAnalysis: EvidenceAnalysisSnapshot = {
		version: analysisRest.version,
		id: analysisRest.id,
		question: analysisRest.question,
		assay: analysisRest.assay,
		mode: analysisRest.mode,
		...(analysisRest.stage ? { stage: analysisRest.stage } : {}),
		...(analysisRest.status ? { status: analysisRest.status } : {}),
		...(analysisRest.capabilities ? { capabilities: [...analysisRest.capabilities] } : {}),
		...(analysisRest.adapter ? { adapter: { ...analysisRest.adapter } } : {}),
		...(provenance ? { provenance } : {}),
		...(analysisRest.review
			? { review: { ...analysisRest.review, limitations: [...analysisRest.review.limitations] } }
			: {}),
		...(analysisRest.publicationRequested !== undefined
			? { publicationRequested: analysisRest.publicationRequested }
			: {}),
		...(analysisRest.events ? { events: analysisRest.events.map((event) => ({ ...event })) } : {}),
	};
	const files = [...value.files].sort((left, right) => left.artifact.path.localeCompare(right.artifact.path));
	return { ...rest, files, analysis: contentAnalysis as EvidenceAnalysisSnapshot };
}

export function checkpointId(value: Omit<EvidenceCheckpoint, "id">): string {
	return digestJson(checkpointBody(value));
}

function validateAnalysis(value: EvidenceAnalysisSnapshot): void {
	if (
		value.version !== 1 ||
		typeof value.id !== "string" ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.id) ||
		typeof value.question !== "string" ||
		!value.question.trim() ||
		typeof value.assay !== "string" ||
		!value.assay.trim() ||
		(value.mode !== "exploratory" && value.mode !== "inferential")
	)
		throw new Error("Invalid evidence analysis snapshot");
	const rawAnalysis = value as unknown as Record<string, unknown>;
	if ("branchOf" in rawAnalysis || "workspace" in rawAnalysis)
		throw new Error("Evidence analysis snapshot cannot contain host workspace state");
	if (value.provenance) validateProvenance(value.provenance);
	if (value.events?.some((event) => typeof event.at !== "string" || typeof event.type !== "string"))
		throw new Error("Invalid analysis event");
}

export function validateCheckpoint(checkpoint: EvidenceCheckpoint): void {
	const { id, ...body } = checkpoint;
	if (checkpoint.schemaVersion !== 1 || id !== checkpointId(body))
		throw new Error("Checkpoint manifest checksum mismatch");
	validateAnalysis(checkpoint.analysis);
	if (Number.isNaN(Date.parse(checkpoint.createdAt))) throw new Error("Invalid checkpoint timestamp");
	if (checkpoint.lineage && (!checkpoint.lineage.eventId || checkpoint.lineage.eventId.includes("/")))
		throw new Error("Invalid checkpoint lineage");
	if (
		checkpoint.environmentFingerprint !== undefined &&
		(typeof checkpoint.environmentFingerprint !== "string" || checkpoint.environmentFingerprint.length > 512)
	)
		throw new Error("Invalid environment fingerprint");
	if (!Array.isArray(checkpoint.files) || checkpoint.files.length === 0 || checkpoint.files.length > 10000)
		throw new Error("Invalid evidence files");
	const validation = assertValidArtifactManifest(
		{ version: 1, entries: checkpoint.files.map((file) => file.artifact) },
		{ requireIdentity: true },
	);
	if ((validation.totalBytes ?? 0) > EVIDENCE_CAPSULE_LIMIT)
		throw new Error("Evidence exceeds capsule limit");
	const kinds = new Set(["input", "output", "code", "environment", "review"]);
	for (const file of checkpoint.files) {
		if (!kinds.has(file.kind) || file.kind !== file.artifact.role)
			throw new Error("Evidence file kind does not match artifact role");
		if (!isSafeEvidencePath(file.artifact.path) || !isSha256(file.artifact.sha256))
			throw new Error("Invalid frozen artifact");
	}
}

export function createCheckpoint(
	input: Omit<EvidenceCheckpoint, "id" | "schemaVersion">,
): EvidenceCheckpoint {
	const body: Omit<EvidenceCheckpoint, "id"> = {
		schemaVersion: 1,
		...input,
		files: [...input.files].sort((left, right) => left.artifact.path.localeCompare(right.artifact.path)),
	};
	const checkpoint: EvidenceCheckpoint = { ...body, id: checkpointId(body) };
	validateCheckpoint(checkpoint);
	return checkpoint;
}

export function createBranch(input: {
	readonly id: string;
	readonly checkpoint: EvidenceCheckpoint;
	readonly createdAt: string;
	readonly status?: EvidenceBranchStatus;
}): EvidenceBranch {
	if (!isSafeBranchId(input.id)) throw new Error("Unsafe evidence branch id");
	validateCheckpoint(input.checkpoint);
	if (Number.isNaN(Date.parse(input.createdAt))) throw new Error("Invalid branch timestamp");
	const branch: EvidenceBranch = {
		schemaVersion: 1,
		id: input.id,
		checkpointId: input.checkpoint.id,
		sourceAnalysisId: input.checkpoint.analysis.id,
		status: input.status ?? "preparing",
		createdAt: input.createdAt,
	};
	validateBranch(branch);
	return branch;
}

export function validateBranch(branch: EvidenceBranch): void {
	if (
		branch.schemaVersion !== 1 ||
		!isSafeBranchId(branch.id) ||
		!isSha256(branch.checkpointId) ||
		!branch.sourceAnalysisId ||
		!["preparing", "ready", "failed"].includes(branch.status) ||
		Number.isNaN(Date.parse(branch.createdAt))
	)
		throw new Error("Invalid evidence branch");
}

/** Strip a shared AnalysisContext down to the portable, path-free evidence projection. */
export interface AnalysisContextLike extends PluginAnalysisContext {
	readonly stage?: string;
	readonly status?: string;
	readonly capabilities?: readonly string[];
	readonly provenance?: EvidenceProvenance;
	readonly review?: EvidenceAnalysisSnapshot["review"];
	readonly publicationRequested?: boolean;
	readonly events?: EvidenceAnalysisSnapshot["events"];
}

export function toEvidenceAnalysisSnapshot(context: AnalysisContextLike): EvidenceAnalysisSnapshot {
	return {
		version: 1,
		id: context.id,
		question: context.question,
		assay: context.assay,
		mode: context.mode,
		stage: context.stage,
		status: context.status,
		capabilities: context.capabilities ? [...context.capabilities] : [],
		...(context.adapter ? { adapter: { ...context.adapter } } : {}),
		...(context.provenance ? { provenance: context.provenance as unknown as EvidenceProvenance } : {}),
		...(context.review
			? {
					review: {
						approved: context.review.approved,
						detail: context.review.detail,
						limitations: [...context.review.limitations],
					},
				}
			: {}),
		publicationRequested: context.publicationRequested,
		events: context.events ? context.events.map((event) => ({ ...event })) : [],
	};
}

export type EvidenceAccess = EvidenceAccessLevel;
