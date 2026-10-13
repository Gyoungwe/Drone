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
