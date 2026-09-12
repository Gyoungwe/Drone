/** Public progress explanation, deliberately separate from provider hidden reasoning. */
export interface ProgressDisplay {
	text: string;
	detail?: string;
	next?: string;
	phase?: string;
	kind?: "plan" | "update" | "summary";
}
const clean = (raw: unknown, limit: number) =>
	typeof raw === "string"
		? raw
				.split("")
				.map((char) => (char.charCodeAt(0) < 32 ? " " : char))
				.join("")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, limit)
		: "";
export function progressDisplay(details: unknown): ProgressDisplay | undefined {
	if (!details || typeof details !== "object") return;
	const d = details as Record<string, unknown>,
		text = clean(d.status, 60);
	if (!text) return;
	const detail = clean(d.detail, 400),
		next = clean(d.next, 160),
		phase = clean(d.phase, 40);
	return {
		text,
		...(detail ? { detail } : {}),
		...(next ? { next } : {}),
		...(phase ? { phase } : {}),
		...(["plan", "update", "summary"].includes(String(d.kind))
			? { kind: d.kind as ProgressDisplay["kind"] }
			: {}),
	};
}
