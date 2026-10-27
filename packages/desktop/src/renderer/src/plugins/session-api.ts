import type { SessionUiPort } from "@gyoungwe/plugin-api/ui";
import { getPi } from "../api";
import { selectTranscript, useTranscriptStore } from "../stores/transcript";

export const sessionUiPort: SessionUiPort = {
	prompt: (...args) => getPi().prompt(...args),
};

/** selectTranscript owns the stable empty snapshot and the chosen session's messages. */
export function useSessionMessages(sessionId: string | null) {
	return useTranscriptStore((state) => selectTranscript(state, sessionId).messages);
}
