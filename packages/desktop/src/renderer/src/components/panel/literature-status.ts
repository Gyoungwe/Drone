/** Colour tone for host-observed literature identity states; pure so chat components can import it without UI stores. */
export function literatureTone(status: string): string {
	if (["verified", "saved", "reused", "both-verified", "attachment-indexed-not-read"].includes(status))
		return "text-green-500";
	if (["failed", "identity-mismatch", "missing", "blocked", "cancelled"].includes(status))
		return "text-red-500";
	return "text-warn";
}
