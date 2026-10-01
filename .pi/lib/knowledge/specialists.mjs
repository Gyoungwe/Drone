/** Compatibility adapter. Domain implementation lives in @drone/knowledge. */
import { deliveryContract } from "../source-delivery.mjs";
import { configureKnowledgeRuntime } from "../../../packages/knowledge/src/runtime-host.ts";
configureKnowledgeRuntime({ deliveryContract });
export * from "../../../packages/knowledge/src/specialists.ts";
