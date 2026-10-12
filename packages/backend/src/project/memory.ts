import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 项目记忆（P12）：`<cwd>/.pi/memory/` 下一条记忆一个带类型的 Markdown 文件，`MEMORY.md` 是索引。
 * 系统提示只注入索引（每行一条：标题 + 一句话），正文按需用 read 读取，保持提示词精简。
 */
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryEntry {
	name: string;
	description: string;
	type: MemoryType;
	body: string;
}

export const MEMORY_INDEX = "MEMORY.md";
export const MAX_INDEX_LINES = 200;

export function memoryDir(cwd: string): string {
	return join(cwd, ".pi", "memory");
}

export function memorySlug(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || "memory";
}

export function serializeMemory(entry: MemoryEntry): string {
	const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
	return `---\nname: ${oneLine(entry.name)}\ndescription: ${oneLine(entry.description)}\ntype: ${entry.type}\n---\n\n${entry.body.trim()}\n`;
}

export function parseMemory(text: string): MemoryEntry | null {
	const m = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!m) return null;
	const fields: Record<string, string> = {};
	for (const line of (m[1] ?? "").split("\n")) {
		const i = line.indexOf(":");
		if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	const type = fields.type as MemoryType;
	if (!fields.name || !MEMORY_TYPES.includes(type)) return null;
	return { name: fields.name, description: fields.description ?? "", type, body: (m[2] ?? "").trim() };
}

export function renderMemoryIndex(entries: Array<MemoryEntry & { file: string }>): string {
	const lines = entries
		.slice()
		.sort(
			(a, b) => MEMORY_TYPES.indexOf(a.type) - MEMORY_TYPES.indexOf(b.type) || a.name.localeCompare(b.name),
		)
		.map((e) => `- [${e.name}](${e.file}) — ${e.type}: ${e.description}`);
	return `# Memory index\n\n${lines.join("\n")}\n`;
}

function atomicWrite(path: string, text: string): void {
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, text, "utf8");
	renameSync(tmp, path);
}

export function listMemories(cwd: string): Array<MemoryEntry & { file: string }> {
	const dir = memoryDir(cwd);
	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== MEMORY_INDEX);
	} catch {
		return [];
	}
	const out: Array<MemoryEntry & { file: string }> = [];
	for (const file of files) {
		const entry = parseMemory(readFileSync(join(dir, file), "utf8"));
		if (entry) out.push({ ...entry, file });
	}
	return out;
}

/** 写一条记忆（同名覆盖）并重建索引。返回文件名。 */
export function writeMemory(cwd: string, entry: MemoryEntry): string {
	const dir = memoryDir(cwd);
	mkdirSync(dir, { recursive: true });
	const file = `${entry.type}_${memorySlug(entry.name)}.md`;
	atomicWrite(join(dir, file), serializeMemory(entry));
	atomicWrite(join(dir, MEMORY_INDEX), renderMemoryIndex(listMemories(cwd)));
	return file;
}

/** 注入系统提示的段落：只有索引，超过 MAX_INDEX_LINES 行截断。没有记忆返回空数组。 */
export function memoryIndexPrompt(cwd: string): string[] {
	let index: string;
	try {
		index = readFileSync(join(memoryDir(cwd), MEMORY_INDEX), "utf8");
	} catch {
		return [];
	}
	const lines = index.split(/\r?\n/).filter((l) => l.startsWith("- "));
	if (!lines.length) return [];
	const shown = lines.slice(0, MAX_INDEX_LINES);
	return [
		`项目记忆索引（.pi/memory/MEMORY.md，正文按需用 read 读取 .pi/memory/<文件>）：\n${shown.join("\n")}${lines.length > shown.length ? `\n…另有 ${lines.length - shown.length} 条` : ""}`,
	];
}
