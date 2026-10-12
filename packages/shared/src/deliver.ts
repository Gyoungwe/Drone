import type { UIMessage } from "./transcript/types";

/** 交付工具（P17）：`deliver_files({files:[{path,title,description}]})`，UI 据参数渲染横向交付卡。 */
export const DELIVER_TOOL = "deliver_files";
export const MAX_DELIVERED_FILES = 12;

export interface DeliveredFile {
	path: string;
	title: string;
	description?: string;
}

export function basenameOf(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** 解析工具参数（流式中途可能是不完整 JSON → 返回空）。 */
export function parseDeliveryArgs(args: string): DeliveredFile[] {
	let v: unknown;
	try {
		v = JSON.parse(args);
	} catch {
		return [];
	}
	const files = (v as { files?: unknown })?.files;
	if (!Array.isArray(files)) return [];
	const out: DeliveredFile[] = [];
	for (const f of files.slice(0, MAX_DELIVERED_FILES)) {
		const r = f as Record<string, unknown>;
		if (typeof r?.path !== "string" || !r.path.trim()) continue;
		const title = typeof r.title === "string" && r.title.trim() ? r.title.trim() : basenameOf(r.path);
		out.push({
			path: r.path,
			title,
			...(typeof r.description === "string" && r.description.trim()
				? { description: r.description.trim() }
				: {}),
		});
	}
	return out;
}

/** 会话里所有成功交付的文件（同路径保留最后一次），新的在前。 */
export function collectDeliveries(messages: readonly UIMessage[]): DeliveredFile[] {
	const byPath = new Map<string, DeliveredFile>();
	for (const m of messages) {
		if (m.kind !== "assistant") continue;
		for (const tool of m.tools)
			if (tool.name === DELIVER_TOOL && tool.state === "done")
				for (const f of parseDeliveryArgs(tool.args)) {
					byPath.delete(f.path);
					byPath.set(f.path, f);
				}
	}
	return [...byPath.values()].reverse();
}
