import type { KnowledgeFlowCard, WorkbenchTask } from "@drone/shared";
import { taskArtifactLinks } from "../chat/TaskArtifactLinks";

/**
 * 会话产物列表：flow.cards 里带路径的回执卡（归档 / 入库 / 总结……）+ 工作台观察到的任务文件。
 * Only merge observed task files; planned acceptance paths are not outputs.
 */
export function mergeKnowledgeArtifacts(
	cards: KnowledgeFlowCard[],
	tasks: WorkbenchTask[],
	cwd = "",
): KnowledgeFlowCard[] {
	const key = (path: string) => {
		let p = path.replaceAll("\\", "/");
		if (!/^(?:[a-z]:\/|\/)/i.test(p) && cwd)
			p = `${cwd.replaceAll("\\", "/").replace(/\/$/, "")}/${p.replace(/^\.\//, "")}`;
		return /^[a-z]:/i.test(p) ? p.toLowerCase() : p;
	};
	const merged = new Map<string, KnowledgeFlowCard>();
	for (const card of cards) if (card.path) merged.set(key(card.path), card);
	for (const task of tasks)
		for (const file of taskArtifactLinks(task)) {
			const k = key(file.path);
			if (!merged.has(k))
				merged.set(k, {
					key: k,
					kind: "artifact",
					title: file.path.split(/[\\/]/).pop() || file.path,
					path: file.path,
					status: file.state,
					detail: "工作台记录的文件产物；不代表科学结论已核验。",
					at: 0,
				});
		}
	return [...merged.values()];
}
