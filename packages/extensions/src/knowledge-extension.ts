export {
	registerKnowledgeInterface,
	registerWikiReviewAcceptance,
} from "./internal/knowledge-extension";

// Keep the deterministic policy benchmark on the same generated entry as the
// production knowledge extension. The policy itself remains owned by the
// domain package; this export keeps the extension boundary independent of host paths.
export { createSpecialistBudget, decideSpecialistRun } from "@gyoungwe/pi-knowledge/host";
