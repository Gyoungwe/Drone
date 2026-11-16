import type { AnalysisContext } from "@drone/shared";
import type { AnalysisAdapterRegistryPort } from "@gyoungwe/plugin-api";

export const unavailableAdapters: AnalysisAdapterRegistryPort = {
	resolve(assay: string): never {
		throw new Error(`Analysis plugin host is unavailable for assay: ${assay}`);
	},
	list: () => [],
	find: () => undefined,
	findByAssay: () => [],
};

/** A blocked analysis never reaches ComputeService or an executor. */
export class AnalysisTaskGateError extends Error {
	readonly code = "analysis_task_gate_blocked" as const;
	readonly context: AnalysisContext;

	constructor(message: string, context: AnalysisContext) {
		super(message);
		this.name = "AnalysisTaskGateError";
		this.context = context;
	}
}
