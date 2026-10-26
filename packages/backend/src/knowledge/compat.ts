/**
 * Transitional composition root for the optional knowledge package.
 *
 * The service and IPC contracts in `ui.ts` stay host-neutral.  This module is
 * the only backend composition surface that reaches the packaged knowledge
 * implementation while the no-plugin compatibility path is still supported.
 */
import * as knowledgeHost from "@gyoungwe/pi-knowledge/host";

export {
	KNOWLEDGE_WORKER_LIFECYCLE_EVENT,
	type KnowledgeWorkerLifecycleEvent,
	type KnowledgeWorkerMetadata,
} from "@drone/shared";

export {
	configureKnowledgeHost,
	configureKnowledgeRuntime,
	configureKnowledgeWorker,
} from "@gyoungwe/pi-knowledge/host";

export { knowledgeHost };
