import type { KnowledgeUiServicePort } from "../knowledge/ui";
import { writeMemory } from "../project/memory";
import type { MemoryStore } from "./store";

/**
 * 观察 → 项目记忆（唯一流向）：写入 `<cwd>/.pi/memory/`（人可审阅、可进 git），
 * 再从观察记忆删除，避免两层重复注入。返回写入的文件名；观察不存在时抛错。
 */
export function promoteObservation(store: MemoryStore, cwd: string, projectId: string, id: number): string {
	const hit = store.find(projectId, id);
	if (!hit) throw new Error(`memory ${id} not found in this project`);
	const day = new Date(hit.createdAt).toISOString().slice(0, 10);
	const file = writeMemory(cwd, {
		name: `${hit.title.slice(0, 48)} m${hit.id}`,
		description: hit.title,
		type: "project",
		body: [hit.title, hit.body, `（由观察记忆提升：${day} ${hit.kind}）`].filter(Boolean).join("\n\n"),
	});
	store.remove(projectId, id);
	return file;
}

/**
 * 观察 → 知识库（单向沉淀）：写成本项目「记忆」分类笔记（含会话、日期、涉及文件），
 * 再把原记录标记为已沉淀，之后不再参与召回与注入。
 */
export async function promoteToKnowledge(
	store: MemoryStore,
	knowledge: Pick<KnowledgeUiServicePort, "saveMemory">,
	cwd: string,
	projectId: string,
	id: number,
): Promise<{ path: string }> {
	const hit = store.find(projectId, id);
	if (!hit) throw new Error(`memory ${id} not found in this project`);
	if (hit.promotedTo) return { path: hit.promotedTo };
	const files =
		hit.kind === "change"
			? [hit.title.replace(/^修改 /u, "")]
			: hit.sessionId
				? store.sessionFiles(projectId, hit.sessionId)
				: [];
	const saved = await knowledge.saveMemory(cwd, {
		id: hit.id,
		kind: hit.kind,
		title: hit.title,
		body: hit.body,
		createdAt: hit.createdAt,
		files,
		...(hit.sessionId ? { sessionId: hit.sessionId } : {}),
	});
	store.markPromoted(projectId, id, saved.path);
	return saved;
}
