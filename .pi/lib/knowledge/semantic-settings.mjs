import { createSemanticSettingsApi, validateSemanticConfig } from "@drone/knowledge/semantic-settings";
import { runRuntimeExclusive, runtimeSlot } from "../runtime-bridge.mjs";

// Persistence and schema validation live in @drone/knowledge. This adapter
// only binds the API to the host-owned runtime state and scheduler.
const api = runtimeSlot("knowledge", "semanticSettings", () => createSemanticSettingsApi());

function runForPath(path, task) {
	return runRuntimeExclusive("knowledge.semantic-settings", path, task);
}

export { validateSemanticConfig };

export function readSemanticSettings(vaultId) {
	return runForPath(vaultId, () => api.readSemanticSettings(vaultId));
}

export function saveSemanticSettings(vaultId, input, expectedRevision) {
	return runForPath(vaultId, () => api.saveSemanticSettings(vaultId, input, expectedRevision));
}
