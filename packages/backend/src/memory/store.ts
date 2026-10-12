import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MemoryProjectStatus } from "@drone/shared";

/** 一条自动捕获的观察（首批：只存规则化摘要，不存工具原始输出）。 */
export interface MemoryObservation {
	projectId: string;
	sessionId: string;
	/** 去重键：同一会话里的同一来源（如工具调用 id）只记一次。 */
	sourceKey: string;
	kind: "prompt" | "change" | "command" | "error";
	title: string;
	body: string;
}

export interface MemoryHit {
	id: number;
	kind: MemoryObservation["kind"];
	title: string;
	body: string;
	createdAt: number;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const RUNS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}_]+/gu;

/** 检索词：中日韩连续字符切成二元组，其他按词。FTS5 unicode61 会把整段中文当一个词，直接搜几乎不命中。 */
export function searchGrams(text: string): string[] {
	const out = new Set<string>();
	for (const run of text.toLowerCase().match(RUNS) ?? []) {
		if (!CJK.test(run)) {
			if (run.length > 1) out.add(run);
		} else if (run.length === 1) out.add(run);
		else for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
	}
	return [...out];
}

/** 观察记忆：本机 SQLite，三张表（观察 / FTS / 按项目设置），按 project_id 隔离。 */
export class MemoryStore {
	private readonly db: DatabaseSync;
	private readonly loaded = new Map<string, number>();

	constructor(path: string) {
		if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path);
		this.db.exec(`
			PRAGMA journal_mode = WAL;
			CREATE TABLE IF NOT EXISTS mem_observations (
				id INTEGER PRIMARY KEY,
				project_id TEXT NOT NULL,
				session_id TEXT NOT NULL,
				source_key TEXT NOT NULL,
				kind TEXT NOT NULL,
				title TEXT NOT NULL,
				body TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				UNIQUE (project_id, session_id, source_key)
			);
			CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(grams, tokenize = 'unicode61');
			CREATE TABLE IF NOT EXISTS mem_settings (project_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
		`);
	}

	isEnabled(projectId: string): boolean {
		const row = this.db.prepare("SELECT enabled FROM mem_settings WHERE project_id = ?").get(projectId) as
			| { enabled: number }
			| undefined;
		return row ? row.enabled === 1 : true;
	}

	setEnabled(projectId: string, enabled: boolean): void {
		this.db
			.prepare(
				"INSERT INTO mem_settings (project_id, enabled) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET enabled = excluded.enabled",
			)
			.run(projectId, enabled ? 1 : 0);
	}

	/** 写入一条观察；重复来源被唯一约束忽略。返回是否新增。 */
	add(obs: MemoryObservation, now = Date.now()): boolean {
		if (!this.isEnabled(obs.projectId)) return false;
		const result = this.db
			.prepare(
				"INSERT OR IGNORE INTO mem_observations (project_id, session_id, source_key, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.run(obs.projectId, obs.sessionId, obs.sourceKey, obs.kind, obs.title, obs.body, now);
		if (result.changes === 0) return false;
		this.db
			.prepare("INSERT INTO mem_fts (rowid, grams) VALUES (?, ?)")
			.run(result.lastInsertRowid, searchGrams(`${obs.title} ${obs.body}`).join(" "));
		return true;
	}

	/** 召回本项目观察（排除当前会话自身）：先按相关度，不足 limit 时用最近的观察补齐。 */
	search(
		projectId: string,
		query: string,
		options: { excludeSession?: string; limit?: number } = {},
	): MemoryHit[] {
		const limit = options.limit ?? 8;
		const exclude = options.excludeSession ?? "";
		const select = "SELECT o.id, o.kind, o.title, o.body, o.created_at AS createdAt FROM mem_observations o";
		const terms = searchGrams(query).map((g) => `"${g.replaceAll('"', '""')}"`);
		const matched = terms.length
			? (this.db
					.prepare(
						`${select} JOIN mem_fts f ON f.rowid = o.id WHERE mem_fts MATCH ? AND o.project_id = ? AND o.session_id != ? ORDER BY bm25(mem_fts), o.created_at DESC LIMIT ?`,
					)
					.all(terms.join(" OR "), projectId, exclude, limit) as unknown as MemoryHit[])
			: [];
		const recent = this.db
			.prepare(
				`${select} WHERE o.project_id = ? AND o.session_id != ? ORDER BY o.created_at DESC, o.id DESC LIMIT ?`,
			)
			.all(projectId, exclude, limit) as unknown as MemoryHit[];
		const seen = new Set(matched.map((hit) => hit.id));
		return [...matched, ...recent.filter((hit) => !seen.has(hit.id))].slice(0, limit);
	}

	markLoaded(projectId: string, count: number): void {
		this.loaded.set(projectId, count);
	}

	status(projectId: string): MemoryProjectStatus {
		const row = this.db
			.prepare("SELECT COUNT(*) AS n FROM mem_observations WHERE project_id = ?")
			.get(projectId) as {
			n: number;
		};
		return {
			enabled: this.isEnabled(projectId),
			count: Number(row.n),
			lastLoaded: this.loaded.get(projectId) ?? 0,
		};
	}

	clear(projectId: string): void {
		this.db.exec("BEGIN");
		try {
			this.db
				.prepare("DELETE FROM mem_fts WHERE rowid IN (SELECT id FROM mem_observations WHERE project_id = ?)")
				.run(projectId);
			this.db.prepare("DELETE FROM mem_observations WHERE project_id = ?").run(projectId);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
		this.loaded.delete(projectId);
	}

	close(): void {
		this.db.close();
	}
}
