import type { SessionPhase } from "@drone/shared";

/** Whether the composer should expose Stop (abort the in-flight run). */
export function composerRunActive(input: {
	sending: boolean;
	agentActive: boolean;
	phase: SessionPhase;
}): boolean {
	return input.sending || input.agentActive || input.phase === "streaming";
}
