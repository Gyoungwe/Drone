import type { KnowledgeGraph as GraphData } from "@drone/shared";

export type KnowledgeCategory = "all" | "paper" | "software" | "method" | "idea";
export type KnowledgeLeafCategory = Exclude<KnowledgeCategory, "all"> | "other";

export function classifyKnowledgePath(path: string): KnowledgeLeafCategory {
	const normalized = path.toLowerCase();
	if (/paper|literature|文献|论文/u.test(normalized)) return "paper";
	if (/software|tool|软件/u.test(normalized)) return "software";
	if (/method|protocol|方法/u.test(normalized)) return "method";
	if (/idea|hypothes|想法|假设/u.test(normalized)) return "idea";
	return "other";
}

export function classifyKnowledgeHit(kind: string, path: string): KnowledgeLeafCategory {
	return classifyKnowledgePath(`${kind}/${path}`);
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
		const kind = classifyKnowledgePath(`${node.contentType ?? node.type ?? ""}/${node.path}`);
		if (kind !== "other") counts[kind] = (counts[kind] ?? 0) + 1;
	}
	return counts;
}
