/** Compatibility adapter. Domain implementation lives in @drone/knowledge. */
import { deliveryContract } from "../source-delivery.mjs";
import { configureKnowledgeRuntime } from "./runtime/runtime-host.mjs";
configureKnowledgeRuntime({ deliveryContract });
export * from "./runtime/specialists.mjs";
