/** Compatibility adapter. Domain implementation lives in @drone/knowledge. */
import { configureKnowledgeRuntime } from "../../../packages/knowledge/src/runtime-host.ts";
import { flowCardBuilder, toolMeta } from "../tool-manifest.mjs";

configureKnowledgeRuntime({ toolMeta, flowCardBuilder });
export * from "../../../packages/knowledge/src/ui-state.ts";
