export interface ToolBudgetOptions {
	maxReads?: number;
	maxSearches?: number;
	maxRepeats?: number;
}

export interface ToolBudgetFailure {
	status: "budget-exhausted";
	code: "tool-loop";
	message: string;
	next: string;
}

export interface ToolBudget {
	reset(): void;
	consume(kind: "read" | "search", key: unknown, options?: { recovery?: boolean }): ToolBudgetFailure | null;
	snapshot(): { reads: number; searches: number };
}

/** Per-turn budget for parent knowledge read/search tools. */
export function createToolBudget(options: ToolBudgetOptions = {}): ToolBudget {
	const maxReads = options.maxReads ?? 8;
	const maxSearches = options.maxSearches ?? 4;
	const maxRepeats = options.maxRepeats ?? 2;
	let reads = 0;
	let searches = 0;
	let recoveries = 0;
	const repeats = new Map<string, number>();
	function reset(): void {
		reads = 0;
		searches = 0;
		recoveries = 0;
		repeats.clear();
	}
	function consume(
		kind: "read" | "search",
		key: unknown,
		{ recovery = false } = {},
	): ToolBudgetFailure | null {
		const recoveryAllowed = recovery && kind === "read" && ++recoveries <= 2;
		const normalized = String(key ?? "").trim();
		const repeatKey = `${kind}:${normalized}`;
		const seen = (repeats.get(repeatKey) ?? 0) + 1;
		repeats.set(repeatKey, seen);
		if (kind === "read") reads += 1;
		else searches += 1;
		const overReads = kind === "read" && reads > maxReads;
		const overSearches = kind === "search" && searches > maxSearches;
		const overRepeat = seen > maxRepeats && !recoveryAllowed;
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
