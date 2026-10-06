/**
 * 入库时的自动关联：用新笔记的标题在本地检索最相关的已有笔记，返回可写成 [[双链]] 的路径。
 * 只读；未绑定 Vault、索引不可用或没有命中时返回空数组（沉淀照常进行）。
 */
import { readKnowledgeBinding, withKnowledgeBinding } from "./config";
import { getKnowledgeService } from "./service";

export async function findRelatedNotes(title: string, limit = 5): Promise<string[]> {
	const query = String(title || "").trim().slice(0, 120);
	if (!query) return [];
	try {
		const binding = await readKnowledgeBinding();
		if (!binding) return [];
		const service = await getKnowledgeService();
		const found = await withKnowledgeBinding(binding, () =>
			service.request("search", { query, limit: limit + 2, project: "" }),
		);
		const wanted = query.toLowerCase();
		const paths: string[] = [];
		for (const hit of (found?.hits ?? []) as { path: string; title: string; kind: string }[]) {
			if (hit.kind === "explainer" || hit.kind === "navigation") continue;
			// The note being deposited may already exist under the same title; never link a note to itself.
			if (String(hit.title || "").trim().toLowerCase() === wanted) continue;
			paths.push(hit.path);
			if (paths.length >= limit) break;
		}
		return paths;
	} catch {
		return [];
	}
}

/** 在正文末尾追加「相关笔记」双链区；已在正文里链接过的不再重复 */
export function appendRelatedLinks(markdown: string, paths: readonly string[]): string {
	const text = String(markdown || "");
	const fresh = paths.filter((path) => !text.includes(`[[${path.replace(/\.md$/, "")}`));
	if (!fresh.length) return text;
	return `${text.trimEnd()}\n\n## 相关笔记\n${fresh.map((path) => `- [[${path.replace(/\.md$/, "")}]]`).join("\n")}\n`;
}
