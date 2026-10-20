// A bound Vault is not an implicit scope for every chat turn, but a question that
// names one of the Vault's own Wiki topics ("LoRA 的秩怎么选", "SpCas9 的 PAM") should
// reuse that page even when it contains none of the research keywords. The probe
// only accepts a hit when the page title is literally mentioned in the question,
// so ordinary chat never gains hidden navigation context.
const STOP = new Set(
	"what when where which with from that this have about into your their there these those does using used make more most some such than then them they will would could should also only over very just like".split(
		" ",
	),
);

const tokens = (text: string) =>
	String(text || "")
		.toLocaleLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

export function mentionedWikiTitle(query: string, titles: readonly string[]): string | null {
	const q = String(query || "").toLocaleLowerCase();
	if (q.trim().length < 3) return null;
	const queryTokens = new Set(tokens(q).filter((t) => /[a-z0-9]/.test(t) && t.length >= 4 && !STOP.has(t)));
	for (const raw of titles) {
		const title = String(raw || "")
			.toLocaleLowerCase()
			.replace(/\.md$/, "")
			.replace(/[-_]+/g, " ")
			.trim();
		if (!title) continue;
		// Whole title mentioned (covers CJK titles such as "转录组分析").
		if (title.length >= 3 && q.includes(title)) return raw;
		// A distinctive Latin/number token shared with the title, e.g. "lora", "spcas9".
		const lead = tokens(title).filter((t) => t.length >= 4 && !STOP.has(t));
		if (lead.some((t) => queryTokens.has(t))) return raw;
	}
	return null;
}
