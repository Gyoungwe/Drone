import { createAnalysisContext } from "@gyoungwe/plugin-api";
import { AssemblyAdapter } from "./assembly";
import { BulkRnaseqAdapter } from "./bulk-rnaseq";
import { AnalysisAdapterRegistry, adapterSnapshotSha256 } from "./registry";

export * from "./assembly";
export * from "./bulk-rnaseq";
export * from "./registry";

export function createAnalysisAdapterRegistry(): AnalysisAdapterRegistry {
	return new AnalysisAdapterRegistry([new BulkRnaseqAdapter(), new AssemblyAdapter()]);
}

export interface PiAnalysisRegistrationOptions {
	readonly registry?: AnalysisAdapterRegistry;
}

function result(details: unknown) {
	return {
		content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
		details,
	};
}

function text(value: unknown, label: string, max = 256): string {
	const normalized = String(value ?? "")
		.normalize("NFKC")
		.replace(/\s+/g, " ")
		.trim();
	if (!normalized || normalized.length > max) throw new Error(`${label} must be a non-empty bounded string`);
	return normalized;
}

function mode(value: unknown): "exploratory" | "inferential" {
	if (value !== "exploratory" && value !== "inferential")
		throw new Error("mode must be exploratory or inferential");
	return value;
}

/**
 * Register the portable analysis discovery and scientific readiness tools.
 * Execution, authorization, persistence and remote collection stay in the
 * Drone host; these tools only evaluate an immutable plan.
 */
export function registerPiAnalysis(pi: any, options: PiAnalysisRegistrationOptions = {}) {
	const registry = options.registry ?? createAnalysisAdapterRegistry();
	pi.registerTool({
		name: "analysis_list_adapters",
		label: "Analysis · list adapters",
		description:
			"List versioned analysis adapters and their declared inputs, outputs, capabilities and side effects.",
		drone: { readOnly: true, recoverySafe: true, capabilities: ["analysis"] },
		parameters: { type: "object", properties: {} },
		async execute() {
			return result({
				adapters: registry.list().map((adapter) => ({
					identity: adapter.identity,
					contract: adapter.contract,
					adapterSnapshotSha256: adapterSnapshotSha256(adapter),
				})),
			});
		},
	});

	pi.registerTool({
		name: "analysis_assess_readiness",
		label: "Analysis · assess readiness",
		description:
			"Resolve one versioned adapter and evaluate its scientific readiness gates without executing a workflow or writing files.",
		drone: { readOnly: true, recoverySafe: true, capabilities: ["analysis", "planning", "files"] },
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", minLength: 1, maxLength: 128 },
				question: { type: "string", minLength: 1, maxLength: 512 },
				assay: { type: "string", minLength: 1, maxLength: 128 },
				mode: { type: "string", enum: ["exploratory", "inferential"] },
				adapter: {
					type: "object",
					properties: { id: { type: "string" }, version: { type: "string" } },
					required: ["id", "version"],
				},
				spec: { type: "object" },
				evidence: { type: "object" },
			},
			required: ["id", "question", "assay", "mode", "spec", "evidence"],
		},
		async execute(_id: string, params: any) {
			const assay = text(params?.assay, "assay");
			const identity = params?.adapter
				? {
						id: text(params.adapter.id, "adapter.id"),
						version: text(params.adapter.version, "adapter.version"),
					}
				: undefined;
			const adapter = registry.resolve(assay, identity);
			const context = createAnalysisContext({
				id: text(params.id, "id", 128),
				question: text(params.question, "question", 512),
				assay,
				mode: mode(params.mode),
				adapter: adapter.identity,
			});
			const plan = adapter.buildPlan(context, params.spec, params.evidence);
			return result({
				status: plan.assessment.ok ? "ready" : "blocked",
				adapter: adapter.identity,
				method: plan.method,
				requiredOutputs: plan.requiredOutputs,
				assessment: plan.assessment,
				adapterSnapshotSha256: plan.adapterSnapshotSha256,
				execution: "host-required",
			});
		},
	});

	return { tools: ["analysis_list_adapters", "analysis_assess_readiness"] } as const;
}

export { AssemblyAdapter, BulkRnaseqAdapter };
export default registerPiAnalysis;
