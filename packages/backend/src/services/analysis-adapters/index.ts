import { AssemblyAdapter } from "./assembly";
import { BulkRnaseqAdapter } from "./bulk-rnaseq";
import { AnalysisAdapterRegistry } from "./registry";

export * from "./assembly";
export * from "./bulk-rnaseq";
export * from "./registry";
export function createAnalysisAdapterRegistry(): AnalysisAdapterRegistry {
	return new AnalysisAdapterRegistry([new BulkRnaseqAdapter(), new AssemblyAdapter()]);
}
