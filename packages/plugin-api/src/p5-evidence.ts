/** P5 section 3 Evidence/Analysis/bundle wire contracts. References never convey authority. */
import { FileReadback, Hash, Id, Relative, resultEnvelope, Time } from "./p5-receipts.js";

export { resultEnvelope };

const dialect = "https://json-schema.org/draft/2020-12/schema";

function closedObject<const Properties extends Record<string, object>>(properties: Properties) {
	return {
		type: "object",
		properties,
		required: Object.keys(properties),
		additionalProperties: false,
	} as const;
}

function nullable<const Schema extends object>(schema: Schema) {
	return { anyOf: [schema, { type: "null" }] } as const;
}

function arrayOf<const Schema extends object>(items: Schema, minItems = 0, maxItems = 10000) {
	return { type: "array", items, minItems, maxItems } as const;
}

const text = { type: "string", minLength: 1, maxLength: 20000 } as const;
const boolean = { type: "boolean" } as const;
const integer = { type: "integer", minimum: 0 } as const;
const identity = closedObject({ id: Id, version: text });
const gate = closedObject({
	code: {
		enum: [
			"scientific-ambiguity",
			"missing-data",
			"missing-biological-replicates",
			"reference-mismatch",
			"unsupported-method",
		],
	},
	severity: { enum: ["pause", "block"] },
	message: text,
	evidenceKey: text,
});
const readiness = closedObject({
	ok: boolean,
	inferentialClaimsAllowed: boolean,
	gates: arrayOf(gate),
	warnings: arrayOf(text),
});
const plan = closedObject({
	format: { const: "drone-analysis-evidence-plan" },
	version: { const: 1 },
	analysis: identity,
	adapter: identity,
	adapterSnapshotSha256: Hash,
	method: identity,
	requiredOutputs: arrayOf(Relative, 1),
	readiness,
	execution: { const: "host-required" },
	evidence: { const: "host-supplied" },
});
const context = closedObject({
	version: { const: 1 },
	id: Id,
	question: text,
	assay: text,
	mode: { enum: ["exploratory", "inferential"] },
	adapter: identity,
});
const adapterPlan = closedObject({
	method: identity,
	requiredOutputs: arrayOf(Relative, 1),
	assessment: readiness,
	adapterSnapshotSha256: Hash,
});
const checkpointSummary = closedObject({
	checkpointId: Hash,
	analysisId: Id,
	createdAt: Time,
	fileCount: integer,
});
const access = closedObject({
	artifactId: Id,
	versionId: Id,
	accessLevel: { enum: ["public", "restricted", "private"] },
});
const output = closedObject({ path: Relative, bytes: integer, sha256: Hash });
const exportSource = {
	anyOf: [
		closedObject({ kind: { const: "text" }, text: { type: "string" } }),
		closedObject({ kind: { const: "staged-file" }, fileRef: Id }),
	],
} as const;
const exportFile = closedObject({
	path: Relative,
	mediaType: { enum: ["text/x-python", "text/x-r", "application/x-ipynb+json", "application/json"] },
	source: exportSource,
	sha256: Hash,
	bytes: integer,
});

export const Identity = { $schema: dialect, ...identity } as const;
export const Gate = { $schema: dialect, ...gate } as const;
export const Readiness = { $schema: dialect, ...readiness } as const;
export const Plan = { $schema: dialect, ...plan } as const;
export const PlanInput = { $schema: dialect, ...closedObject({ plan }) } as const;
export const ValidatedPlan = {
	$schema: dialect,
	...closedObject({ plan, planSha256: Hash }),
} as const;
export const Context = { $schema: dialect, ...context } as const;
export const AdapterPlan = { $schema: dialect, ...adapterPlan } as const;
export const PreparationInput = {
	$schema: dialect,
	...closedObject({ context, adapterPlan }),
} as const;
export const OverviewInput = { $schema: dialect, ...closedObject({ analysisId: Id }) } as const;
export const CapabilityInput = {
	$schema: dialect,
	...closedObject({ analysisId: Id, capabilityId: Id }),
} as const;
export const CheckpointSummary = { $schema: dialect, ...checkpointSummary } as const;
export const Overview = {
	$schema: dialect,
	...closedObject({
		checkpoints: arrayOf(checkpointSummary),
		branches: arrayOf(Id),
		executableReplay: { const: "unavailable" },
		receipts: arrayOf(Id),
	}),
} as const;
export const Capability = {
	$schema: dialect,
	...closedObject({
		capabilityId: Id,
		checkpointIds: arrayOf(Hash),
		verification: { enum: ["unverified", "matched", "mismatched"] },
		executableReplay: { const: "unavailable" },
	}),
} as const;
export const Access = { $schema: dialect, ...access } as const;
export const FreezeInput = {
	$schema: dialect,
	...closedObject({ requestId: Id, analysisId: Id, runReceiptRef: Id, plan, access: arrayOf(access, 1) }),
} as const;
export const ImportInput = {
	$schema: dialect,
	...closedObject({ requestId: Id, sourceFileRef: Id, expectedSha256: Hash }),
} as const;
export const ForkInput = {
	$schema: dialect,
	...closedObject({ requestId: Id, checkpointId: Hash, branchId: Id }),
} as const;
export const EvidenceExportInput = {
	$schema: dialect,
	...closedObject({
		requestId: Id,
		checkpointId: Hash,
		audience: { enum: ["public", "restricted", "private"] },
		destination: Relative,
	}),
} as const;
export const Output = { $schema: dialect, ...output } as const;
export const VerifyInput = {
	$schema: dialect,
	...closedObject({ checkpointId: Hash, environmentFingerprint: nullable(text), outputs: arrayOf(output) }),
} as const;
export const Verification = {
	$schema: dialect,
	...closedObject({
		status: { enum: ["reproduced", "failed"] },
		detail: text,
		outputChecks: arrayOf(closedObject({ path: Relative, matched: boolean })),
		environmentMatched: boolean,
		comparisonOnly: { const: true },
	}),
} as const;
export const EvidenceCommit = {
	$schema: dialect,
	...closedObject({
		checkpointId: Hash,
		branchId: nullable(Id),
		stateVersion: Hash,
		hostReceiptRefs: arrayOf(Id, 1),
	}),
} as const;
export const ExportSource = { $schema: dialect, ...exportSource } as const;
export const ExportFile = { $schema: dialect, ...exportFile } as const;
export const BundleInput = {
	$schema: dialect,
	...closedObject({ requestId: Id, files: arrayOf(exportFile, 1, 2) }),
} as const;
export const BundleCommit = {
	$schema: dialect,
	...closedObject({
		files: arrayOf(FileReadback, 1, 2),
		receiptRef: Id,
		cleanup: { enum: ["complete", "failed"] },
		stateVersion: nullable(Hash),
	}),
} as const;

export interface Identity {
	readonly id: Id;
	readonly version: string;
}
export interface Gate {
	readonly code: (typeof Gate.properties.code.enum)[number];
	readonly severity: "pause" | "block";
	readonly message: string;
	readonly evidenceKey: string;
}
export interface Readiness {
	readonly ok: boolean;
	readonly inferentialClaimsAllowed: boolean;
	readonly gates: readonly Gate[];
	readonly warnings: readonly string[];
}
export interface Plan {
	readonly format: "drone-analysis-evidence-plan";
	readonly version: 1;
	readonly analysis: Identity;
	readonly adapter: Identity;
	readonly adapterSnapshotSha256: Hash;
	readonly method: Identity;
	readonly requiredOutputs: readonly Relative[];
	readonly readiness: Readiness;
	readonly execution: "host-required";
	readonly evidence: "host-supplied";
}
export interface PlanInput {
	readonly plan: Plan;
}
export interface ValidatedPlan {
	readonly plan: Plan;
	readonly planSha256: Hash;
}
export interface Context {
	readonly version: 1;
	readonly id: Id;
	readonly question: string;
	readonly assay: string;
	readonly mode: "exploratory" | "inferential";
	readonly adapter: Identity;
}
export interface AdapterPlan {
	readonly method: Identity;
	readonly requiredOutputs: readonly Relative[];
	readonly assessment: Readiness;
	readonly adapterSnapshotSha256: Hash;
}
export interface PreparationInput {
	readonly context: Context;
	readonly adapterPlan: AdapterPlan;
}
export interface OverviewInput {
	readonly analysisId: Id;
}
export interface CapabilityInput {
	readonly analysisId: Id;
	readonly capabilityId: Id;
}
export interface CheckpointSummary {
	readonly checkpointId: Hash;
	readonly analysisId: Id;
	readonly createdAt: Time;
	readonly fileCount: number;
}
export interface Overview {
	readonly checkpoints: readonly CheckpointSummary[];
	readonly branches: readonly Id[];
	readonly executableReplay: "unavailable";
	readonly receipts: readonly Id[];
}
export interface Capability {
	readonly capabilityId: Id;
	readonly checkpointIds: readonly Hash[];
	readonly verification: "unverified" | "matched" | "mismatched";
	readonly executableReplay: "unavailable";
}
export interface Access {
	readonly artifactId: Id;
	readonly versionId: Id;
	readonly accessLevel: "public" | "restricted" | "private";
}
export interface FreezeInput {
	readonly requestId: Id;
	readonly analysisId: Id;
	readonly runReceiptRef: Id;
	readonly plan: Plan;
	readonly access: readonly Access[];
}
export interface ImportInput {
	readonly requestId: Id;
	readonly sourceFileRef: Id;
	readonly expectedSha256: Hash;
}
export interface ForkInput {
	readonly requestId: Id;
	readonly checkpointId: Hash;
	readonly branchId: Id;
}
export interface EvidenceExportInput {
	readonly requestId: Id;
	readonly checkpointId: Hash;
	readonly audience: "public" | "restricted" | "private";
	readonly destination: Relative;
}
export interface Output {
	readonly path: Relative;
	readonly bytes: number;
	readonly sha256: Hash;
}
export interface VerifyInput {
	readonly checkpointId: Hash;
	readonly environmentFingerprint: string | null;
	readonly outputs: readonly Output[];
}
export interface Verification {
	readonly status: "reproduced" | "failed";
	readonly detail: string;
	readonly outputChecks: readonly { readonly path: Relative; readonly matched: boolean }[];
	readonly environmentMatched: boolean;
	readonly comparisonOnly: true;
}
export interface EvidenceCommit {
	readonly checkpointId: Hash;
	readonly branchId: Id | null;
	readonly stateVersion: Hash;
	readonly hostReceiptRefs: readonly Id[];
}
export type ExportSource =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "staged-file"; readonly fileRef: Id };
export interface ExportFile {
	readonly path: Relative;
	readonly mediaType: (typeof ExportFile.properties.mediaType.enum)[number];
	readonly source: ExportSource;
	readonly sha256: Hash;
	readonly bytes: number;
}
export interface BundleInput {
	readonly requestId: Id;
	readonly files: readonly ExportFile[];
}
export interface BundleCommit {
	readonly files: readonly FileReadback[];
	readonly receiptRef: Id;
	readonly cleanup: "complete" | "failed";
	readonly stateVersion: Hash | null;
}
