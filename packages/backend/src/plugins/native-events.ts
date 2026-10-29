import type { ExtensionEvent } from "@earendil-works/pi-coding-agent";

/** JSON event contracts exercised by the managed native adapter on Pi 1.1.0. */
export const NATIVE_EVENTS = [
	"session_start",
	"session_shutdown",
	"session_tree",
	"context",
	"before_agent_start",
	"agent_start",
	"agent_end",
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

export type NativeEventName = (typeof NATIVE_EVENTS)[number];
