/** Compatibility adapter. Domain implementation lives in @drone/knowledge. */
import { configureKnowledgeRuntime } from "./runtime/runtime-host.mjs";
import { flowCardBuilder, toolMeta } from "../tool-manifest.mjs";

configureKnowledgeRuntime({ toolMeta, flowCardBuilder });
export * from "./runtime/ui-state.mjs";
