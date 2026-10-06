/**
 * 每日「发现」（新旧对照）的领域逻辑：找出上次运行后更新的笔记，拼出与相关旧笔记对照的提问，
 * 解析模型返回的想法并只保留有依据（依据路径必须是本次提供给模型的笔记）的条目。
 * 不调用模型、不写 Vault；模型调用和排程由宿主（backend）负责。
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const DAILY_DISCOVERY_LIMITS = {
	maxScannedFiles: 4000,
	maxNoteBytes: 256 * 1024,
	maxNewNotes: 8,
	maxRelatedNotes: 10,
	maxNoteChars: 2400,
	maxIdeas: 3,
} as const;

/** 只扫描可复用知识所在的目录；导航页、讲解页和附件不参与 */
const SCAN_ROOTS = ["Library", "Wiki", "Projects"];
const SKIP_DIRS = new Set(["Explainers", "Attachments", ".obsidian", ".trash", ".git"]);
const NAVIGATION = /(?:^|\/)(?:Index|Home|Context)\.md$/;

export interface DiscoveryNote {
	path: string;
	title: string;
	text: string;
	mtime: number;
}

export interface DailyIdea {
	title: string;
	idea: string;
	basis: string[];
	test: string;
	whyOverlooked: string;
}

function titleOf(path: string, text: string): string {
	const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
	return (heading || path.split("/").pop()?.replace(/\.md$/, "") || path).slice(0, 200);
}

/** 上次运行后修改过的笔记（最新的优先，有数量与大小上限） */
export async function collectRecentNotes(vault: string, sinceMs: number): Promise<DiscoveryNote[]> {
	const found: { path: string; mtime: number; size: number }[] = [];
	let scanned = 0;
	async function walk(dir: string): Promise<void> {
		if (scanned >= DAILY_DISCOVERY_LIMITS.maxScannedFiles) return;
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
		if (!entries) return;
		for (const entry of entries) {
			if (scanned >= DAILY_DISCOVERY_LIMITS.maxScannedFiles) return;
			if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.isFile() && entry.name.endsWith(".md")) {
				scanned++;
				const path = relative(vault, full).split(sep).join("/");
				if (NAVIGATION.test(path)) continue;
				const info = await stat(full).catch(() => null);
				if (info && info.mtimeMs > sinceMs && info.size <= DAILY_DISCOVERY_LIMITS.maxNoteBytes)
					found.push({ path, mtime: info.mtimeMs, size: info.size });
			}
		}
	}
	for (const root of SCAN_ROOTS) await walk(join(vault, root));
	found.sort((a, b) => b.mtime - a.mtime);
	const notes: DiscoveryNote[] = [];
	for (const item of found.slice(0, DAILY_DISCOVERY_LIMITS.maxNewNotes)) {
		const text = await readFile(join(vault, item.path), "utf8").catch(() => "");
		if (!text.trim()) continue;
		notes.push({
			path: item.path,
			title: titleOf(item.path, text),
			text: text.slice(0, DAILY_DISCOVERY_LIMITS.maxNoteChars),
			mtime: item.mtime,
		});
	}
	return notes;
}

/** 保存为想法笔记的 Markdown 正文（标注为推测，带依据与验证方式） */
export function ideaNoteMarkdown(idea: DailyIdea, createdAt: Date): string {
	return [
		"---",
		"type: idea",
		'status: "speculative"',
		"source: daily-discovery",
		`created: ${JSON.stringify(createdAt.toISOString())}`,
		"---",
		"",
		`# ${idea.title}`,
		"",
		idea.idea,
		"",
		"## 依据",
		...idea.basis.map((path) => `- [[${path.replace(/\.md$/, "")}]]`),
		"",
		"## 如何检验",
		idea.test,
		...(idea.whyOverlooked ? ["", "## 为什么可能被忽略", idea.whyOverlooked] : []),
		"",
		"> 推测：由每日发现根据知识库自动提出，尚未验证。",
		"",
	].join("\n");
}
