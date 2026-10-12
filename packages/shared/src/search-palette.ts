/** ⌘K 搜索面板的纯逻辑（P6）：按标题搜任务 / 项目，筛选 全部 / 置顶 / 项目 / 任务。 */
export type SearchFilter = "all" | "pinned" | "project" | "task";
export interface SearchItem {
	kind: "task" | "project";
	/** task: sessionId；project: cwd */
	id: string;
	title: string;
	subtitle?: string;
	pinned: boolean;
	lastActive: number;
}
export const SEARCH_RESULT_LIMIT = 50;

export function pinKey(kind: SearchItem["kind"], id: string): string {
	return `${kind}:${id}`;
}

function score(title: string, query: string): number {
	if (!query) return 1;
	const t = title.toLowerCase();
	if (t === query) return 4;
	if (t.startsWith(query)) return 3;
	if (t.split(/[\s/\\_\-.]+/).some((w) => w.startsWith(query))) return 2;
	return t.includes(query) ? 1 : 0;
}

export function searchPalette(
	items: readonly SearchItem[],
	rawQuery: string,
	filter: SearchFilter,
): SearchItem[] {
	const query = rawQuery.trim().toLowerCase();
	return items
		.filter((item) => (filter === "all" ? true : filter === "pinned" ? item.pinned : item.kind === filter))
		.map((item) => ({ item, s: score(item.title, query) }))
		.filter((x) => x.s > 0)
		.sort(
			(a, b) =>
				b.s - a.s || Number(b.item.pinned) - Number(a.item.pinned) || b.item.lastActive - a.item.lastActive,
		)
		.slice(0, SEARCH_RESULT_LIMIT)
		.map((x) => x.item);
}

/** 解析持久化的置顶列表，丢弃非法项。 */
export function parsePins(raw: string | null): string[] {
	try {
		const value = raw ? (JSON.parse(raw) as unknown) : [];
		return Array.isArray(value)
			? [...new Set(value.filter((v): v is string => typeof v === "string" && /^(task|project):./.test(v)))]
			: [];
	} catch {
		return [];
	}
}
