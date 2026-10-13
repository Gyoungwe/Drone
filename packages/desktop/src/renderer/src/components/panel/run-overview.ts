import type { UIMessage } from "@drone/shared";

export interface RunOverview {
	stages: Array<{ id: string; text: string; next?: string }>;
	tools: number;
	files: string[];
}

const FILE_TOOLS = new Set(["write", "edit"]);

/** 右栏「本次运行」概览：从对话里取阶段说明、工具次数、改动文件（无任务清单时代替示例卡）。 */
export function runOverview(messages: readonly UIMessage[]): RunOverview {
	const stages: RunOverview["stages"] = [];
	const files: string[] = [];
	let tools = 0;
	for (const m of messages) {
		if (m.kind !== "assistant") continue;
		if (m.progress?.text)
			stages.push({ id: m.id, text: m.progress.text, ...(m.progress.next ? { next: m.progress.next } : {}) });
		for (const tool of m.tools) {
			tools++;
			if (!FILE_TOOLS.has(tool.name)) continue;
			try {
				const path = (JSON.parse(tool.args) as { path?: unknown }).path;
				if (typeof path === "string" && !files.includes(path)) files.push(path);
			} catch {
				// 参数不是 JSON：不计文件
			}
		}
	}
	return { stages, tools, files };
}
