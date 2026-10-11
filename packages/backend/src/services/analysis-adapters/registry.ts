import { createHash } from "node:crypto";
import { stableJson } from "@drone/compute";
import type {
	AnalysisContext,
	AnalysisIdentity,
	AnalysisReadiness,
	AnalysisReviewCheck,
} from "@drone/shared";
import type { ComputePreflightJobSpec } from "../compute-preflight";

export interface AnalysisArtifactEvidence {
	readonly path: string;
	readonly bytes?: number;
	readonly sha256?: string;
	readonly text?: string;
}

export interface AnalysisAdapterPlan {
	readonly method: AnalysisIdentity;
	readonly requiredOutputs: readonly string[];
	readonly assessment: AnalysisReadiness;
	readonly adapterSnapshotSha256: string;
}

export type AnalysisResearchStage = "design" | "readiness" | "execution" | "review" | "delivery";
export type AnalysisSideEffect =
	| "read-only"
	| "network"
	| "project-write"
	| "code-execution"
	| "external-service";

export interface AnalysisSchemaField {
	readonly id: string;
	readonly type: "file" | "table" | "metadata" | "metric" | "report";
	readonly required: boolean;
	readonly formats?: readonly string[];
}

/** Versioned, immutable capability contract for an assay adapter. */
export interface AnalysisAdapterContract {
	readonly schemaVersion: 1;
	readonly assay: string;
	readonly domain: "bioinformatics" | "genomics" | "transcriptomics" | "proteomics" | "other";
	readonly researchStages: readonly AnalysisResearchStage[];
	readonly inputs: readonly AnalysisSchemaField[];
	readonly outputs: readonly AnalysisSchemaField[];
	readonly capabilities: readonly string[];
	readonly sideEffects: readonly AnalysisSideEffect[];
	readonly evidenceTypes: readonly string[];
	readonly workflow?: AnalysisIdentity;
}

export interface AnalysisAdapter {
	readonly identity: AnalysisIdentity;
	readonly contract: AnalysisAdapterContract;
	supports(assay: string): boolean;
	/** Validates host evidence; no execution, authorization or persistence effects. */
	buildPlan(context: AnalysisContext, spec: ComputePreflightJobSpec, evidence: unknown): AnalysisAdapterPlan;
	reviewResults(
		context: AnalysisContext,
		artifacts: readonly AnalysisArtifactEvidence[],
	): readonly AnalysisReviewCheck[];
	readonly reviewInstructions: string;
}

/** Exact versions are resolved on resume. Missing or ambiguous policies fail closed. */
export class AnalysisAdapterRegistry {
	private readonly adapters = new Map<string, AnalysisAdapter>();
	constructor(adapters: readonly AnalysisAdapter[]) {
		for (const adapter of adapters) {
			validateAdapterContract(adapter);
			const key = this.key(adapter.identity);
			if (this.adapters.has(key)) throw new Error(`Duplicate analysis adapter: ${key}`);
			this.adapters.set(key, adapter);
		}
	}
	resolve(assay: string, identity?: AnalysisIdentity): AnalysisAdapter {
		const candidates = identity
			? [this.adapters.get(this.key(identity))].filter((item): item is AnalysisAdapter => Boolean(item))
			: [...this.adapters.values()].filter((item) => item.supports(assay));
		if (candidates.length !== 1 || !candidates[0]?.supports(assay))
			throw new Error(
				`No unique compatible analysis adapter for ${assay}${identity ? ` (${this.key(identity)})` : ""}`,
			);
		return candidates[0];
	}
	/** Immutable registry view used by capability discovery and diagnostics. */
	list(): readonly AnalysisAdapter[] {
		return [...this.adapters.values()];
	}
	find(identity: AnalysisIdentity): AnalysisAdapter | undefined {
		return this.adapters.get(this.key(identity));
	}
	findByAssay(assay: string): readonly AnalysisAdapter[] {
		return [...this.adapters.values()].filter((adapter) => adapter.supports(assay));
	}
	private key(identity: AnalysisIdentity): string {
		return `${identity.id}@${identity.version}`;
	}
}

export function validateAdapterContract(adapter: AnalysisAdapter): void {
	const contract = adapter.contract;
	if (
		contract.schemaVersion !== 1 ||
		(contract.assay !== adapter.identity.id && !adapter.supports(contract.assay))
	)
		throw new Error(`Invalid adapter contract for ${adapter.identity.id}`);
	if (
		!contract.domain ||
		contract.researchStages.length === 0 ||
		contract.inputs.length === 0 ||
		contract.outputs.length === 0
	)
		throw new Error(`Adapter ${adapter.identity.id} must declare domain, stages, inputs and outputs`);
	if (new Set(contract.inputs.map((field) => field.id)).size !== contract.inputs.length)
		throw new Error(`Adapter ${adapter.identity.id} has duplicate input fields`);
	if (new Set(contract.outputs.map((field) => field.id)).size !== contract.outputs.length)
		throw new Error(`Adapter ${adapter.identity.id} has duplicate output fields`);
	if (!contract.capabilities.length || !contract.evidenceTypes.length || !contract.sideEffects.length)
		throw new Error(`Adapter ${adapter.identity.id} must declare capabilities, evidence and side effects`);
}

export function adapterSnapshotSha256(adapter: AnalysisAdapter): string {
	validateAdapterContract(adapter);
	return createHash("sha256")
		.update(stableJson({ identity: adapter.identity, contract: adapter.contract }))
		.digest("hex");
}

export function recordEvidence(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Adapter evidence must be an object");
	return value as Record<string, unknown>;
}

export function methodIdentity(value: unknown): AnalysisIdentity {
	const method = recordEvidence(value);
	if (
		typeof method.id !== "string" ||
		!method.id.trim() ||
		typeof method.version !== "string" ||
		!method.version.trim()
	)
		throw new Error("An explicit method id and version are required");
	return { id: method.id, version: method.version };
}

export function requiredOutputs(spec: ComputePreflightJobSpec): readonly string[] {
	const paths = spec.outputs?.map((entry) => (typeof entry === "string" ? entry : entry.path)) ?? [];
	if (
		!paths.length ||
		paths.some(
			(path) =>
				!path ||
				path.startsWith("/") ||
				path.includes("\\") ||
				path.split("/").some((part) => part === ".." || part === "." || !part),
		)
	)
		throw new Error("A nonempty set of relative output files must be pinned before execution");
	return [...new Set(paths)];
}
