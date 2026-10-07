/**
 * Graph-augmented retrieval: after lexical/semantic fusion, expand the top hits by one hop over
 * [[wiki links]] (outgoing and backlinks). Neighbors inherit a decayed share of their parent's
 * score plus a small, capped centrality boost so hub pages cannot dominate the ranking.
 * Pure and deterministic; the worker supplies neighbor rows.
 */
export interface GraphHitLike {
	path: string;
	fusionScore?: number;
	retrieval?: string;
	[key: string]: unknown;
}
export interface GraphNeighbor {
	/** Seed hit this neighbor was reached from. */
	from: string;
	path: string;
	title: string;
	kind: string;
	hash?: string;
	direction: "outgoing" | "backlink";
	degree: number;
	/** For backlinks: the source line that mentions the seed. */
	context?: string;
}
export interface GraphExpansionOptions {
	seeds?: number;
	decay?: number;
	centralityWeight?: number;
	centralityCap?: number;
	maxNeighborsPerSeed?: number;
	limit: number;
}
export const GRAPH_RETRIEVAL_DEFAULTS = {
	seeds: 3,
	decay: 0.5,
	centralityWeight: 0.002,
	centralityCap: 0.004,
	maxNeighborsPerSeed: 4,
} as const;

export function centralityBoost(degree: number, weight: number, cap: number): number {
	if (!(degree > 0)) return 0;
	return Math.min(cap, weight * Math.log2(1 + degree));
}

function baseScore(hit: GraphHitLike, index: number): number {
	return typeof hit.fusionScore === "number" && Number.isFinite(hit.fusionScore) ? hit.fusionScore : 1 / (60 + index + 1);
}

export function expandWithGraph(
	hits: readonly GraphHitLike[],
	neighbors: readonly GraphNeighbor[],
	options: GraphExpansionOptions,
): GraphHitLike[] {
	const o = { ...GRAPH_RETRIEVAL_DEFAULTS, ...options };
	const limit = Math.max(1, Math.min(12, Math.floor(o.limit)));
	const scored = new Map<string, { hit: GraphHitLike; score: number }>();
	for (const [index, hit] of hits.entries()) scored.set(hit.path, { hit, score: baseScore(hit, index) });
	const seedScore = new Map(hits.slice(0, o.seeds).map((hit, index) => [hit.path, baseScore(hit, index)]));
	const perSeed = new Map<string, number>();
	const ordered = [...neighbors].sort(
		(a, b) => b.degree - a.degree || a.path.localeCompare(b.path) || a.from.localeCompare(b.from),
	);
	for (const n of ordered) {
		const parent = seedScore.get(n.from);
		if (parent === undefined || n.path === n.from) continue;
		const used = perSeed.get(n.from) || 0;
		const existing = scored.get(n.path);
		const contribution = parent * o.decay + centralityBoost(n.degree, o.centralityWeight, o.centralityCap);
		if (existing) {
			// A direct hit that is also linked from a stronger hit gets a modest corroboration bonus.
			if (existing.hit.retrieval !== "graph") existing.score += contribution * 0.25;
			else {
				existing.score = Math.max(existing.score, contribution);
				const g = existing.hit.graph as { from: string[] };
				if (!g.from.includes(n.from)) g.from.push(n.from);
			}
			continue;
		}
		if (used >= o.maxNeighborsPerSeed) continue;
		perSeed.set(n.from, used + 1);
		scored.set(n.path, {
			hit: {
				path: n.path,
				title: n.title,
				kind: n.kind,
				...(n.hash ? { hash: n.hash } : {}),
				retrieval: "graph",
				graph: { from: [n.from], direction: n.direction, ...(n.context ? { context: n.context } : {}) },
			},
			score: contribution,
		});
	}
	return [...scored.values()]
		.sort((a, b) => b.score - a.score || a.hit.path.localeCompare(b.hit.path))
		.slice(0, limit)
		.map(({ hit, score }) => ({ ...hit, fusionScore: score }));
}

/** The line of `body` that links to `target` (full path or bare note name), trimmed for context. */
export function backlinkContext(body: string, target: string, max = 240): string | undefined {
	const bare = target.split("/").at(-1)?.replace(/\.md$/, "") || target;
	const full = target.replace(/\.md$/, "");
	for (const line of String(body || "").split(/\r?\n/)) {
		for (const m of line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
			const t = (m[1] || "").trim().replace(/\.md$/, "");
			if (t === full || t.toLowerCase() === bare.toLowerCase()) {
				const s = line.trim();
				return s.length > max ? `${s.slice(0, max - 1)}…` : s;
			}
		}
	}
	return undefined;
}
