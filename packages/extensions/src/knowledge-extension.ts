import { configureKnowledgeExtensionRuntime } from "./internal/knowledge-runtime";
import {
	registerKnowledgeInterface as registerPluginKnowledgeInterface,
	registerWikiReviewAcceptance,
} from "@gyoungwe/pi-knowledge/host";

export function registerKnowledgeInterface(pi: any, options?: any): any {
	configureKnowledgeExtensionRuntime();
	return registerPluginKnowledgeInterface(pi, options);
}

export { registerWikiReviewAcceptance };

// Keep the deterministic policy benchmark on the same generated entry as the
// production knowledge extension. The policy itself remains owned by the
// domain package; this export keeps the extension boundary independent of host paths.
export { createSpecialistBudget, decideSpecialistRun } from "@gyoungwe/pi-knowledge/host";
