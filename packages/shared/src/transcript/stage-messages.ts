import { publicTimeline } from "../public-timeline";
import type { StreamingState, UIMessage } from "./types";
/** Same projection before and after turn_end: the UI cannot move a stage below its completed tools. */
export function stageMessages(
	streaming: StreamingState,
	timestamp: number,
): Extract<UIMessage, { kind: "assistant" }>[] | null {
	if (!streaming.progressEntries?.length) return null;
	return publicTimeline({
		text: streaming.text,
		thinking: streaming.thinking,
		tools: streaming.tools,
		steps: streaming.progressEntries,
		textBlockIndex: streaming.textBlockIndex,
	}).map((part, index) => ({
		kind: "assistant",
		id: part.kind === "text" ? streaming.id : `${streaming.id}:stage:${part.key}`,
		cycleId: streaming.id,
		text: part.kind === "text" ? part.text : "",
		thinking: part.kind === "meta" ? part.thinking : "",
		tools: part.kind === "meta" ? part.tools : [],
		timestamp,
		...(part.kind === "progress" ? { progress: part.progress } : {}),
		...(index === 0 && streaming.usage ? { usage: streaming.usage } : {}),
	}));
}
