import { DELIVER_TOOL, type RunSnapshot, type SessionTranscriptState } from "@drone/shared";

/** transcript 快照 → P14 RunSnapshot（纯函数，便于单测）。 */
export function runSnapshotOf(
	entry: Pick<
		SessionTranscriptState,
		"agentActive" | "streaming" | "todos" | "pendingLlmError" | "messages" | "unseenCompletion"
	>,
	pendingAsks: number,
	pendingSend = false,
): RunSnapshot {
	const s = entry.streaming;
	const runningTools = s?.tools.filter((t) => t.state === "running").length ?? 0;
	const last = entry.messages.at(-1);
	const delivered =
		!entry.agentActive &&
		entry.unseenCompletion &&
		last?.kind === "assistant" &&
		last.tools.some((t) => t.name === DELIVER_TOOL && t.state === "done");
	return {
		pendingSend,
		agentActive: entry.agentActive,
		firstEventSeen:
			s != null &&
			(s.thinking.length > 0 || s.text.length > 0 || s.tools.length > 0 || s.activity.length > 0),
		thinking: !!s && s.thinking.length > 0 && s.text.length === 0 && runningTools === 0,
		streamingText: !!s && s.text.length > 0 && runningTools === 0,
		runningTools,
		planning: entry.todos.some((t) => t.status === "in_progress") && runningTools === 0 && !s?.text,
		pendingAsks,
		stopped: false,
		error: entry.pendingLlmError != null,
		delivered,
	};
}
