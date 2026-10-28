import type { KnowledgeFlowCard } from "@drone/shared";

/**
 * 会话产物列表：flow.cards 里带路径的回执卡（归档 / 入库 / 总结……）。
 * Task journal artifacts are owned by the task plugin UI.
 */
export function mergeKnowledgeArtifacts(cards: KnowledgeFlowCard[], cwd = ""): KnowledgeFlowCard[] {
	const key = (path: string) => {
		let p = path.replaceAll("\\", "/");
		if (!/^(?:[a-z]:\/|\/)/i.test(p) && cwd)
			p = `${cwd.replaceAll("\\", "/").replace(/\/$/, "")}/${p.replace(/^\.\//, "")}`;
		return /^[a-z]:/i.test(p) ? p.toLowerCase() : p;
	};
	const merged = new Map<string, KnowledgeFlowCard>();
	for (const card of cards) if (card.path) merged.set(key(card.path), card);
	return [...merged.values()];
}
