/** Compatibility adapter. KnowledgeService is owned by @drone/knowledge. */
import { Worker } from "node:worker_threads";
import { emitProcessEvent } from "../process-events.mjs";
import { runRuntimeExclusive } from "../runtime-bridge.mjs";
import { hasPaperCitation, requiresPaperEvidence } from "../source-delivery.mjs";
import {
	configureKnowledgeEvidence,
	configureKnowledgeRuntime,
	configureKnowledgeWorker,
} from "../../../packages/knowledge/src/runtime-host.ts";

configureKnowledgeRuntime({ runRuntimeExclusive, emitProcessEvent });
configureKnowledgeEvidence({ hasPaperCitation, requiresPaperEvidence });
configureKnowledgeWorker((_url, options) => new Worker(new URL("./worker.mjs", import.meta.url), options));

export * from "../../../packages/knowledge/src/service.ts";
