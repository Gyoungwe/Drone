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
	signal?: AbortSignal,
): Promise<unknown> {
	signal?.throwIfAborted();
	const selected = selectedSession();
	const selectionToken = await syncPluginCaller(selected);
	if (selectedSession() !== selected) throw new Error("Plugin caller selection changed before invocation");
	signal?.throwIfAborted();
	if (!signal) return getPi().pluginRuntimeInvoke(binding, operation, input, selectionToken);
	const requestId = crypto.randomUUID();
	let cancellation: Promise<PromiseSettledResult<boolean>[]> | undefined;
	const cancel = () => {
		cancellation = Promise.allSettled([getPi().pluginRuntimeCancel(binding, selectionToken, requestId)]);
	};
	const pending = getPi().pluginRuntimeInvoke(binding, operation, input, selectionToken, requestId);
	signal.addEventListener("abort", cancel, { once: true });
	if (signal.aborted) cancel();
	const results = await Promise.allSettled([pending]);
	signal.removeEventListener("abort", cancel);
	if (cancellation) results.push(...(await cancellation));
	const failures = results.filter((result) => result.status === "rejected");
	if (failures.length > 1)
		throw new AggregateError(
			failures.map((result) => result.reason),
			"Plugin invocation and cancellation failed",
		);
	if (failures.length === 1) throw failures[0]?.reason;
	return (results[0] as PromiseFulfilledResult<unknown>).value;
}
