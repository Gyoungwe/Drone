/**
 * The constrained writer: `codex exec` in a read-only sandbox, outside any repository, answering one JSON
 * shape (--output-schema). It only drafts; lesson-store.mjs validates every draft and lesson-judge.mjs
 * decides merges. Drafting runs in a detached process started by the Stop hook, a batch at a time.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FIELD_LIMITS } from "./lesson-store.mjs";

export const BATCH = 8;
const WRITER_TIMEOUT_MS = 240_000;

const DRAFT = {
	type: "object",
	additionalProperties: false,
	required: ["index", "is_failure_lesson", "cause", "fix", "signature", "evidence"],
	properties: {
		index: { type: "integer" },
		is_failure_lesson: { type: "boolean" },
		cause: { type: "string" },
		fix: { type: "string" },
		signature: { type: "string" },
		evidence: { type: "string" },
	},
};
export const DRAFT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["drafts"],
	properties: { drafts: { type: "array", items: DRAFT } },
};

/** The writer's instructions; the insights follow, numbered. */
export function writerPrompt(insights) {
	const rules = [
		"把下面每条开发 Insight 转成一条失败经验草稿，每条输入对应 drafts 里一项，index 用输入编号。",
		"只有记录了一次具体失败（报错、检查失败、误判、环境问题）及其原因的才算失败经验；设计说明、概念解释填 is_failure_lesson=false，其余字段填空串。",
		`cause 写根因（≤${FIELD_LIMITS.cause} 字），fix 写下一步做法（≤${FIELD_LIMITS.fix} 字），都用中文。`,
		"evidence 必须从该条 Insight 原文逐字复制一段（报错文字、命令或现象），不要改写。",
		"signature 是 JavaScript 正则源码，要能匹配真实工具输出里的这条报错，同时必须匹配 evidence；不要写能匹配普通句子的宽泛正则。",
		"只输出 JSON。",
	];
	const body = insights.map((insight, index) => `[${index}]\n${insight.text}`).join("\n\n");
	return `${rules.join("\n")}\n\n${body}\n`;
}

/** Run Codex on one batch; resolves to the drafts array or throws. `run` exists for tests. */
export function draftLessons(insights, run = spawnSync) {
	const dir = mkdtempSync(path.join(os.tmpdir(), "jev-writer-"));
	try {
		const schema = path.join(dir, "schema.json");
		const out = path.join(dir, "out.json");
		const cwd = path.join(dir, "cwd");
		mkdirSync(cwd);
		writeFileSync(schema, JSON.stringify(DRAFT_SCHEMA));
		const args = [
			"exec",
			"--skip-git-repo-check",
			"-s",
			"read-only",
			"--output-schema",
			schema,
			"-o",
			out,
			"-",
		];
		const result = run("codex", args, {
			cwd,
			input: writerPrompt(insights),
			encoding: "utf8",
			timeout: WRITER_TIMEOUT_MS,
		});
		if (result.status !== 0)
			throw new Error(`codex exit ${result.status}: ${String(result.stderr).slice(-300)}`);
		return JSON.parse(readFileSync(out, "utf8")).drafts;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
