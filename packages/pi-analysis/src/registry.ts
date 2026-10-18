import {
	type AnalysisAdapter,
	type AnalysisComputePlanInput,
	type AnalysisIdentity,
	analysisAdapterSnapshotSha256,
} from "@gyoungwe/plugin-api";

/** The portable subset of a host compute submission consumed by an adapter. */
export type AnalysisComputeSpec = AnalysisComputePlanInput;
export type {
	AnalysisAdapter,
	AnalysisAdapterContract,
	AnalysisAdapterPlan,
	AnalysisArtifactEvidence,
	AnalysisComputePlanInput,
	AnalysisContext,
	AnalysisIdentity,
	AnalysisReadiness,
	AnalysisResearchStage,
	AnalysisReviewCheck,
	AnalysisSchemaField,
	AnalysisSideEffect,
} from "@gyoungwe/plugin-api";

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
		return [...this.adapters.values()].sort((left, right) =>
			left.identity.id.localeCompare(right.identity.id),
		);
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
	return analysisAdapterSnapshotSha256(adapter);
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

export function requiredOutputs(spec: AnalysisComputeSpec): readonly string[] {
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
