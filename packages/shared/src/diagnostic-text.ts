/** Redact and bound a scalar diagnostic before it crosses a host boundary. */
export function diagnosticText(value: unknown, max = 600): string {
	if (typeof value !== "string" && typeof value !== "number") return "";
	return String(value)
		.slice(0, 8192)
		.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
			try {
				const url = new URL(raw);
				url.username = "";
				url.password = "";
				url.search = "";
				url.hash = "";
				return url.toString();
			} catch {
				return "[URL omitted]";
			}
		})
		.replace(/(?:bearer\s+)[^\s,;"']+/gi, "Bearer [redacted]")
		.replace(
			/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)["']?\s*[=:]\s*)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s,;]+)/gi,
			"$1[redacted]",
		)
		.replace(
			/(--(?:api[_-]?key|token|password|secret|authorization)(?:=|\s+))(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s,;]+)/gi,
			"$1[redacted]",
		)
		.replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{8,}/g, "[redacted]")
		.split("")
		.map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || "<>".includes(c) ? " " : c))
		.join("")
		.slice(0, max);
}
