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
	/** 已沉淀到知识库的笔记路径；沉淀后不再注入。 */
	promotedTo?: string | null;
	sessionId?: string;
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
		const columns = this.db.prepare("PRAGMA table_info(mem_observations)").all() as Array<{ name: string }>;
		if (!columns.some((column) => column.name === "promoted_to"))
			this.db.exec("ALTER TABLE mem_observations ADD COLUMN promoted_to TEXT");
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
						`${select} JOIN mem_fts f ON f.rowid = o.id WHERE mem_fts MATCH ? AND o.project_id = ? AND o.session_id != ? AND o.promoted_to IS NULL ORDER BY bm25(mem_fts), o.created_at DESC LIMIT ?`,
					)
					.all(terms.join(" OR "), projectId, exclude, limit) as unknown as MemoryHit[])
			: [];
		const recent = this.db
			.prepare(
				`${select} WHERE o.project_id = ? AND o.session_id != ? AND o.promoted_to IS NULL ORDER BY o.created_at DESC, o.id DESC LIMIT ?`,
			)
			.all(projectId, exclude, limit) as unknown as MemoryHit[];
		const seen = new Set(matched.map((hit) => hit.id));
		return [...matched, ...recent.filter((hit) => !seen.has(hit.id))].slice(0, limit);
	}

	/** 按 id 取本项目观察详情（memory_get）；跨项目 id 一律不返回。 */
	get(projectId: string, ids: number[]): MemoryHit[] {
		const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 20);
		if (!wanted.length) return [];
		return this.db
			.prepare(
				`SELECT id, session_id AS sessionId, kind, title, body, created_at AS createdAt FROM mem_observations WHERE project_id = ? AND id IN (${wanted.map(() => "?").join(", ")}) ORDER BY created_at DESC, id DESC`,
			)
			.all(projectId, ...wanted) as unknown as MemoryHit[];
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

	/** 本项目最近的观察（设置列表用）。 */
	list(projectId: string, limit = 50): MemoryHit[] {
		return this.db
			.prepare(
				"SELECT id, session_id AS sessionId, kind, title, body, created_at AS createdAt, promoted_to AS promotedTo FROM mem_observations WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
			)
			.all(projectId, limit) as unknown as MemoryHit[];
	}

	/** 取本项目的一条观察；不属于本项目返回 undefined。 */
	find(projectId: string, id: number): MemoryHit | undefined {
		return this.db
			.prepare(
				"SELECT id, session_id AS sessionId, kind, title, body, created_at AS createdAt, promoted_to AS promotedTo FROM mem_observations WHERE project_id = ? AND id = ?",
			)
			.get(projectId, id) as unknown as MemoryHit | undefined;
	}

	/** 删除本项目的一条观察（含 FTS 行）。返回是否删除。 */
	remove(projectId: string, id: number): boolean {
		const result = this.db
			.prepare("DELETE FROM mem_observations WHERE project_id = ? AND id = ?")
			.run(projectId, id);
		if (result.changes === 0) return false;
		this.db.prepare("DELETE FROM mem_fts WHERE rowid = ?").run(id);
		return true;
	}

	/** 同一会话改过的文件（沉淀笔记的来源信息）。 */
	sessionFiles(projectId: string, sessionId: string): string[] {
		const rows = this.db
			.prepare(
				"SELECT title FROM mem_observations WHERE project_id = ? AND session_id = ? AND kind = 'change' ORDER BY id LIMIT 50",
			)
			.all(projectId, sessionId) as Array<{ title: string }>;
		return rows.map((row) => row.title.replace(/^修改 /u, ""));
	}

	/** 标记为已沉淀（单向）：之后不再参与召回与注入。 */
	markPromoted(projectId: string, id: number, path: string): boolean {
		return (
			this.db
				.prepare(
					"UPDATE mem_observations SET promoted_to = ? WHERE project_id = ? AND id = ? AND promoted_to IS NULL",
				)
				.run(path, projectId, id).changes > 0
		);
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
