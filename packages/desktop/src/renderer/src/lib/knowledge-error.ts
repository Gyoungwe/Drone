import { useKnowledgeStore } from "../stores/knowledge";
import { pushToast } from "../stores/toasts";

/** Report host knowledge navigation failures even when the UI plugin is unavailable. */
export function reportKnowledgeError(error: unknown) {
	const raw = error instanceof Error ? error.message : String(error);
	const text = raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, "").split("\n")[0] ?? raw;
	pushToast("error", "toast.knowledgeSetupFailed", text);
	useKnowledgeStore
		.getState()
		.apply({ kind: "notice", id: String(Date.now()), sessionId: null, severity: "error", text });
}
