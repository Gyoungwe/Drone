/** Compatibility adapter. Domain implementation lives in @drone/knowledge. */
import { loadWorkspaceConfig } from "../../extensions/workspace-config.mjs";
import { publishExplainer } from "../obsidian-workbench.mjs";
import { configureKnowledgeHost } from "./runtime/runtime-host.mjs";
configureKnowledgeHost({ loadWorkspaceConfig, publishExplainer });
export * from "./runtime/specialist-delivery.mjs";
