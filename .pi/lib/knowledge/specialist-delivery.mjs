/** Compatibility adapter. Domain implementation lives in @drone/knowledge. */
import { loadWorkspaceConfig } from "../../extensions/workspace-config.mjs";
import { publishExplainer } from "../obsidian-workbench.mjs";
import { configureKnowledgeHost } from "../../../packages/knowledge/src/runtime-host.ts";
configureKnowledgeHost({ loadWorkspaceConfig, publishExplainer });
export * from "../../../packages/knowledge/src/specialist-delivery.ts";
