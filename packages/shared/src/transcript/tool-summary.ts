/**
 * 工具调用的一行摘要（桌面 ToolCallCard / lan-web ToolCard 共用）。
 *
 * 目标：折叠态永远显示「人话」——命令、路径、URL、查询或目标，而不是原始 JSON。
 * 已知字段按优先级取值；未知工具（如 task_plan / capability_load）退化为
 *   1) 第一个字符串字段的值；2) ≤3 个标量字段的 `key: value`；3) 字段名列表（`capabilities · options`）。
 * 流式中的不完整 JSON 用正则按同样优先级抽取，值随流式增长原地更新。
 */
const PRIMARY_KEYS = [
	"command",
	"cmd",
	"filePath",
	"path",
	"file",
	"url",
	"query",
	"pattern",
	"goal",
	"title",
	"name",
	"status",
	"prompt",
	"text",
	"id",
] as const;

const MAX = 120;

const clip = (value: string, limit = MAX): string => {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

function scalarText(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) {
		return value.length ? value.map(String).join(", ") : null;
	}
	return null;
}

export function summarizeToolArgs(args: string): string {
	if (!args || args === "{}") return "";
	let parsed: Record<string, unknown> | null = null;
	try {
		const value = JSON.parse(args) as unknown;
		if (value && typeof value === "object" && !Array.isArray(value))
			parsed = value as Record<string, unknown>;
		else return clip(args);
	} catch {
		// 流式中的不完整 JSON：按优先级正则抽取字段值（值允许未闭合）
		for (const key of PRIMARY_KEYS) {
			const value = args.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`))?.[1];
			if (value) return clip(value);
		}
		return clip(args);
	}
	for (const key of PRIMARY_KEYS) {
		const text = scalarText(parsed[key]);
		if (text) return clip(text);
	}
	const entries = Object.entries(parsed);
	const firstString = entries.find(([, v]) => typeof v === "string" && (v as string).trim());
	if (firstString) return clip(firstString[1] as string);
	const scalars = entries
		.map(([k, v]) => [k, scalarText(v)] as const)
		.filter((pair): pair is readonly [string, string] => pair[1] !== null);
	if (scalars.length > 0 && scalars.length <= 3) {
		return clip(scalars.map(([k, v]) => `${k}: ${clip(v, 40)}`).join(" · "));
	}
	if (entries.length > 0) return clip(entries.map(([k]) => k).join(" · "));
	return "";
}
