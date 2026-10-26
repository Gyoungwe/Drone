import { getPi } from "../api";
import { isDraftSessionId, useSessionsStore } from "../stores/sessions";

function selectedSession(): string | null {
	const sessionId = useSessionsStore.getState().activeSessionId;
	return isDraftSessionId(sessionId) ? null : sessionId;
}

/** The renderer chooses a real session; main resolves its identity and revokes the previous lease. */
export function syncPluginCaller(sessionId: string | null): Promise<string> {
	return getPi().pluginRuntimeSelectSession(isDraftSessionId(sessionId) ? null : sessionId);
}

export async function invokePluginRuntime(
	binding: string,
	operation: string,
	input: unknown,
): Promise<unknown> {
	const selected = selectedSession();
	const selectionToken = await getPi().pluginRuntimeSelectSession(selected);
	if (selectedSession() !== selected) throw new Error("Plugin caller selection changed before invocation");
	return getPi().pluginRuntimeInvoke(binding, operation, input, selectionToken);
}
