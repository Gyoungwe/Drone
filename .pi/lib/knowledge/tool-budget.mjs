/** Per-turn budget for parent knowledge read/search tools (stops tool-loop). */

export function createToolBudget(options = {}) {
	const maxReads = options.maxReads ?? 8;
	const maxSearches = options.maxSearches ?? 4;
	const maxRepeats = options.maxRepeats ?? 2;
	let reads = 0;
	let searches = 0;
	const repeats = new Map();

	function reset() {
		reads = 0;
		searches = 0;
		repeats.clear();
	}

	function consume(kind, key) {
		const normalized = String(key ?? "").trim();
		const repeatKey = `${kind}:${normalized}`;
		const seen = (repeats.get(repeatKey) ?? 0) + 1;
		repeats.set(repeatKey, seen);
		if (kind === "read") reads += 1;
		else if (kind === "search") searches += 1;

		const overReads = kind === "read" && reads > maxReads;
		const overSearches = kind === "search" && searches > maxSearches;
		const overRepeat = seen > maxRepeats;
		if (!overReads && !overSearches && !overRepeat) return null;
		return {
			status: "budget-exhausted",
			code: "tool-loop",
			message: overRepeat
				? `Repeated ${kind} (${normalized || "empty"}) ${seen} times; stop looping and answer from what you have.`
				: `Knowledge ${kind} budget exhausted (${kind === "read" ? reads : searches}/${kind === "read" ? maxReads : maxSearches}). Synthesize an answer now.`,
			next: "Write the final answer from already-read evidence. Do not call research_read_knowledge or research_search_knowledge again this turn.",
		};
	}

	return { reset, consume, snapshot: () => ({ reads, searches }) };
}
