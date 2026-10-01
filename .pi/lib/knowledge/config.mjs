import { createKnowledgeConfigApi } from "@drone/knowledge/config";
import { runtimeSlot } from "../runtime-bridge.mjs";
import { invalidateKnowledgeUi } from "./ui-state.mjs";

// The package owns binding validation, atomic persistence, and revision
// semantics. This adapter only supplies the host-owned runtime state and keeps
// the existing UI invalidation side effect for the desktop/CLI surface.
const config = runtimeSlot("knowledge", "config", () => createKnowledgeConfigApi());

export function knowledgeDirectory() {
	return config.knowledgeDirectory();
}

export function projectIdentity(cwd, configured) {
	return config.projectIdentity(cwd, configured);
}

export function readKnowledgeBinding(options = {}) {
	return config.readKnowledgeBinding(options);
}

export function withKnowledgeBinding(binding, operation) {
	return config.withKnowledgeBinding(binding, operation);
}

export async function saveKnowledgeBinding(input, expectedRevision = null) {
	const value = await config.saveKnowledgeBinding(input, expectedRevision);
	invalidateKnowledgeUi();
	return value;
}
