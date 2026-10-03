/** Compatibility adapter. KnowledgeService is owned by @drone/knowledge. */
import { Worker } from "node:worker_threads";
import { emitProcessEvent } from "../process-events.mjs";
import { runRuntimeExclusive, runtimeSlot } from "../runtime-bridge.mjs";
import { hasPaperCitation, requiresPaperEvidence } from "../source-delivery.mjs";
import {
	configureKnowledgeEvidence,
	configureKnowledgeRuntime,
	configureKnowledgeWorker,
} from "./runtime/runtime-host.mjs";

configureKnowledgeRuntime({ runRuntimeExclusive, runtimeSlot, emitProcessEvent });
configureKnowledgeEvidence({ hasPaperCitation, requiresPaperEvidence });
configureKnowledgeWorker((_url, options) => new Worker(new URL("./runtime/worker.mjs", import.meta.url), options));

export * from "./runtime/service.mjs";
