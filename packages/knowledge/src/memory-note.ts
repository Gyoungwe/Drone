/** 观察记忆 → 知识库笔记（单向沉淀）。纯函数，便于测试。 */
export interface MemoryNoteInput {
	id: number;
	kind: string;
	title: string;
	body: string;
	sessionId?: string;
	createdAt: number;
	files?: string[];
}

const yaml = (value: string) => JSON.stringify(value.replace(/\s+/g, " ").trim());

export function memoryNoteSlug(memory: Pick<MemoryNoteInput, "id" | "title">): string {
	const base = memory.title
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48);
	return `${base || "memory"}-m${memory.id}`;
}

/** 笔记正文：frontmatter（type: memory + 来源）、摘要、涉及文件、相关笔记的 [[链接]]（知识网络据此连边）。 */
export function memoryNoteMarkdown(memory: MemoryNoteInput, related: string[] = []): string {
	const date = new Date(memory.createdAt).toISOString().slice(0, 10);
	const files = [...new Set(memory.files ?? [])].slice(0, 20);
	const lines = [
		"---",
		"type: memory",
		`title: ${yaml(memory.title)}`,
		"source: drone-memory",
		`memory_id: ${memory.id}`,
		`memory_kind: ${memory.kind}`,
		`session: ${yaml(memory.sessionId ?? "")}`,
		`date: ${date}`,
		...(files.length ? ["files:", ...files.map((f) => `  - ${yaml(f)}`)] : []),
		"---",
		"",
		`# ${memory.title.trim()}`,
		"",
		memory.body.trim() || "（无正文）",
		"",
		"## 来源",
		"",
		`- 会话：${memory.sessionId ?? "未知"}`,
		`- 日期：${date}`,
		`- 类型：${memory.kind}`,
		...(files.length ? ["- 涉及文件：", ...files.map((f) => `  - \`${f}\``)] : []),
	];
	const links = [...new Set(related.map((p) => p.replace(/\.md$/i, "")))].slice(0, 5);
	if (links.length) lines.push("", "## 相关", "", ...links.map((p) => `- [[${p}]]`));
	return `${lines.join("\n")}\n`;
}
