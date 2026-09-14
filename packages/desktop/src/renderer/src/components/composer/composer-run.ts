/** Whether the composer should expose Stop (abort the in-flight run). */
export function composerRunActive(input: { sending: boolean; agentActive: boolean; phase: string }): boolean {
	return input.sending || input.agentActive || input.phase === "streaming";
}
