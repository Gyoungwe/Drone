import type { ExtensionAPI, ExtensionContext, ExtensionEvent } from "@earendil-works/pi-coding-agent";

/** JSON event contracts exercised by the managed native adapter on Pi 1.1.0. */
export const NATIVE_EVENTS = [
	"session_start",
	"session_shutdown",
	"session_tree",
	"context",
	"before_agent_start",
	"agent_start",
	"agent_end",
	"agent_settled",
	"input",
	"tool_call",
	"turn_start",
	"turn_end",
	"message_start",
	"message_end",
	"tool_execution_start",
	"tool_execution_end",
	"tool_result",
] as const satisfies readonly ExtensionEvent["type"][];

/** Host events on the session's extension bus that a managed native adapter may subscribe to like SDK events. */
export const HOST_EVENTS = ["drone:context-evicted"] as const;

/** Every event name a managed native adapter may pass to on(). */
export const PLUGIN_EVENTS = [...NATIVE_EVENTS, ...HOST_EVENTS] as const;

export type NativeEventName = (typeof PLUGIN_EVENTS)[number];

type Deliver = (event: unknown, context: ExtensionContext) => Promise<unknown>;

/**
 * Subscribes a managed native hook. A host event is delivered like an SDK event: with the context of the
 * session this extension was started in, only when the event names that session, and rebuilt from its
 * known fields.
 */
export function onPluginEvent(pi: ExtensionAPI, name: string, deliver: Deliver): unknown {
	if (!(PLUGIN_EVENTS as readonly string[]).includes(name))
		throw new Error(`Unsupported native Pi event: ${name}`);
	if (name !== "drone:context-evicted")
		return (pi.on as (name: string, handler: Deliver) => unknown)(name, deliver);
	const session: { context?: ExtensionContext } = {};
	pi.on("session_start", async (_event, context) => {
		session.context = context;
	});
	return pi.events.on(name, async (payload) => {
		const { context } = session;
		const event = payload as { sessionId?: unknown; toolCallIds?: unknown } | null;
		if (!context || event?.sessionId !== context.sessionManager.getSessionId()) return;
		const ids = Array.isArray(event.toolCallIds) ? event.toolCallIds : [];
		await deliver(
			{ sessionId: event.sessionId, toolCallIds: ids.filter((id) => typeof id === "string").slice(0, 64) },
			context,
		);
	});
}
