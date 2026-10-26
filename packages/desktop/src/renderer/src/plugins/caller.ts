import type { PluginUiRuntimeClient } from "@gyoungwe/plugin-api/ui";
import { getPi } from "../api";
import { isDraftSessionId, useSessionsStore } from "../stores/sessions";

function selectedSession(): string | null {
	const sessionId = useSessionsStore.getState().activeSessionId;
	return isDraftSessionId(sessionId) ? null : sessionId;
}

let selectionRequest = 0;
let selectionLease: { sessionId: string | null; token: string } | undefined;

/** The renderer chooses a real session; main resolves its identity and revokes the previous lease. */
export async function syncPluginCaller(sessionId: string | null): Promise<string> {
	const selected = isDraftSessionId(sessionId) ? null : sessionId;
	const request = ++selectionRequest;
	if (selectionLease?.sessionId !== selected) selectionLease = undefined;
	const token = await getPi().pluginRuntimeSelectSession(selected);
	if (request === selectionRequest && selectedSession() === selected)
		selectionLease = { sessionId: selected, token };
	return token;
}

/** Main already checked source/owner; discard delivery queued for another UI binding or caller lease. */
export function subscribePluginRuntime(
	binding: string,
	listener: Parameters<PluginUiRuntimeClient["subscribe"]>[0],
): () => void {
	return getPi().onPluginRuntimeEvent((event) => {
		const lease = selectionLease;
		if (
			!lease ||
			event.binding !== binding ||
			event.selectionToken !== lease.token ||
			lease.sessionId !== selectedSession()
		)
			return;
		listener({ type: event.type, revision: event.revision });
	});
}

export async function invokePluginRuntime(
	binding: string,
	operation: string,
	input: unknown,
): Promise<unknown> {
	const selected = selectedSession();
	const selectionToken = await syncPluginCaller(selected);
	if (selectedSession() !== selected) throw new Error("Plugin caller selection changed before invocation");
	return getPi().pluginRuntimeInvoke(binding, operation, input, selectionToken);
}
