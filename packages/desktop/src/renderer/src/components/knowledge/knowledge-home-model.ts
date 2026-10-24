import type { KnowledgeGraph as GraphData, KnowledgeOverview } from "@drone/shared";

export type KnowledgeCategory = "all" | "paper" | "software" | "method" | "idea";
export type KnowledgeLeafCategory = Exclude<KnowledgeCategory, "all"> | "other";

function keywordCategory(value: string): KnowledgeLeafCategory {
	if (/paper|literature|文献|论文/u.test(value)) return "paper";
	if (/software|tool|软件/u.test(value)) return "software";
	if (/method|protocol|方法/u.test(value)) return "method";
	if (/idea|hypothes|想法|假设/u.test(value)) return "idea";
	return "other";
}

export function classifyKnowledgePath(path: string): KnowledgeLeafCategory {
	const segments = path.toLowerCase().split(/[\\/]/u);
	const filename = segments[segments.length - 1];
	for (const directory of segments.slice(0, -1).reverse()) {
		if (
			/^(papers?|literature|文献|论文|software|tools?|软件|methods?|protocols?|方法|ideas?|hypotheses|想法|假设)$/u.test(
				directory,
			)
		)
			return keywordCategory(directory);
	}
	return keywordCategory(filename);
}

export function classifyKnowledgeHit(kind: string, path: string): KnowledgeLeafCategory {
	const type = kind.trim().toLowerCase();
	return type && type !== "note" ? keywordCategory(type) : classifyKnowledgePath(path);
}

/** Overview groups cover at least the bounded recent list; consume the worker's classification. */
export function classifyRecentKnowledgeNote(
	path: string,
	groups: KnowledgeOverview["recentByCategory"],
): KnowledgeLeafCategory {
	for (const category of ["paper", "software", "method", "idea"] as const)
		if (groups?.[category]?.some((note) => note.path === path)) return category;
	return "other";
}

export function deriveKnowledgeCategoryCounts(
	data: GraphData | null,
	noteCount: number | undefined,
): Record<KnowledgeCategory, number | null> {
	const graph = data?.semantic ?? data;
	const complete = !!graph && !graph.health?.truncated && graph.totalNotes === noteCount;
	const counts: Record<KnowledgeCategory, number | null> = {
		all: noteCount ?? null,
		paper: null,
		software: null,
		method: null,
		idea: null,
	};
	if (!complete || !graph) return counts;
	for (const node of graph.nodes) {
		const kind = classifyKnowledgeHit(node.contentType ?? node.type ?? "", node.path);
		if (kind !== "other") counts[kind] = (counts[kind] ?? 0) + 1;
	}
	return counts;
}
