/** Compatibility adapter. Domain implementation lives in @drone/knowledge. */
import { loadWorkspaceConfig } from "../../extensions/workspace-config.mjs";
import { inspectObsidianSetup, inspectSetupDirectory, resolveSetupVault } from "../obsidian-setup.mjs";
import { researchSetupOptions } from "../obsidian-workbench.mjs";
import { LAYOUT } from "../vault-layout.mjs";
import { configureKnowledgeHost, configureKnowledgeSetup } from "../../../packages/knowledge/src/runtime-host.ts";
configureKnowledgeHost({ loadWorkspaceConfig });
configureKnowledgeSetup({ layout: LAYOUT, inspectObsidianSetup, inspectSetupDirectory, resolveSetupVault, researchSetupOptions });
export * from "../../../packages/knowledge/src/ui-service.ts";
