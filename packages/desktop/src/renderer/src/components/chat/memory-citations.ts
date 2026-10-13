import type { UIToolCall } from "@drone/shared";

const CITE = /\[m:(\d{1,9})\]/g;

/** 本条回答用到的记忆 id：正文里的 [m:编号] 引用 + memory_get 工具读取过的编号，去重保序。 */
export function memoryCitations(text: string, tools: Pick<UIToolCall, "name" | "args">[] = []): number[] {
	const ids: number[] = [];
	const push = (n: number) => {
		if (Number.isSafeInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
	};
	for (const match of text.matchAll(CITE)) push(Number(match[1]));
	for (const tool of tools) {
		if (tool.name !== "memory_get") continue;
		try {
			const parsed = JSON.parse(tool.args) as { ids?: unknown };
			if (Array.isArray(parsed.ids)) for (const id of parsed.ids) push(Number(id));
		} catch {
			for (const match of tool.args.matchAll(/\d+/g)) push(Number(match[0]));
		}
	}
	return ids;
}
