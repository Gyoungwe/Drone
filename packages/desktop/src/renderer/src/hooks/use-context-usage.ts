import type { ContextUsageInfo } from "@drone/shared";
import { useEffect, useState } from "react";
import { getPi } from "../api";
import { isDraftSessionId } from "../stores/sessions";
import { createContextUsageRefresh } from "./context-usage-refresh";

const REFRESH_EVENTS = new Set([
	"message_end",
	"tool_execution_end",
	"turn_end",
	"agent_settled",
	"compaction_end",
	"auto_compaction_end",
	"session_info_changed",
]);

/** SDK context estimates, not cumulative usage. Discard old-session and out-of-order responses. */
export function useContextUsage(sessionId: string | null): ContextUsageInfo | null {
	const [data, setData] = useState<{ id: string; value: ContextUsageInfo | null } | null>(null);
	useEffect(() => {
		if (!sessionId || isDraftSessionId(sessionId)) return;
		const reader = createContextUsageRefresh(
			() => getPi().getContextUsage(sessionId),
			(value) => setData({ id: sessionId, value }),
		);
		void reader.refresh();
		const off = getPi().onEvent(({ sessionId: sid, event }) => {
			if (sid === sessionId && REFRESH_EVENTS.has(event.type)) void reader.refresh();
		});
		return () => {
			reader.dispose();
			off();
		};
	}, [sessionId]);
	return sessionId && !isDraftSessionId(sessionId) && data?.id === sessionId ? data.value : null;
}
