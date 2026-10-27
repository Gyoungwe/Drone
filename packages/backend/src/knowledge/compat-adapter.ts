/**
 * Compatibility composition adapter.  Runtime access to pi-knowledge is
 * deliberately isolated here; `ui.ts` only consumes the structural port.
 */
import {
	configureKnowledgeHost,
	configureKnowledgeRuntime,
	configureKnowledgeWorker,
	knowledgeCompatibility,
} from "./compat";
import type { KnowledgeCompatibilityPort } from "./ui";

export const defaultKnowledgeCompatibility = knowledgeCompatibility as unknown as KnowledgeCompatibilityPort;

export const defaultKnowledgeRuntimeSetup = {
	configureHost: configureKnowledgeHost,
	configureRuntime: configureKnowledgeRuntime,
	configureWorker: configureKnowledgeWorker,
};
