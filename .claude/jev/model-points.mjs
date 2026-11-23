/**
 * The decision points answered by Jev itself, wired for hook.mjs. Each one runs only when a TypeSafe key
 * is configured, records `model: "jev"` with its decision, and records `answer: "error"` when the call
 * fails, leaving the deterministic rules in charge.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decision, record, STATE_DIR } from "./decision.mjs";
import { apiKey, askJev, redact } from "./jev-client.mjs";
import { TASK_QUESTIONS } from "./jev-questions.mjs";
import { secretRule } from "./permission-policy.mjs";
import { inspectScript, SCRIPT_LIMIT } from "./script-inspect.mjs";
import { taskHint } from "./task-route.mjs";

const SKILLS_DIR = fileURLToPath(new URL("../../.agents/skills/", import.meta.url));
const CACHE_FILE = path.join(STATE_DIR, "script-answers.json");
const CACHE_LIMIT = 500;
const PROMPT_LIMIT = 8000;

/** A JSON file as a bounded `{ get, set, save }` map; the oldest entries fall out first. */
export function jsonCache(file, limit = CACHE_LIMIT) {
	const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
	return {
		get: (key) => data[key],
		set: (key, value) => {
			delete data[key];
			data[key] = value;
		},
		save: () => {
			const kept = Object.fromEntries(Object.entries(data).slice(-limit));
			mkdirSync(path.dirname(file), { recursive: true });
			writeFileSync(file, JSON.stringify(kept));
		},
	};
}

/** Scripts to judge: never a secret path, never a directory, never more than the limit. */
function readScript(file) {
	if (secretRule(file) !== null || !existsSync(file) || !statSync(file).isFile()) return null;
	return readFileSync(file, "utf8").slice(0, SCRIPT_LIMIT * 2);
}

const failure = (point, rule, error) => {
	const message = error instanceof Error ? error.message : String(error);
	record(STATE_DIR, { ...decision(point, "error", rule, 0), model: "jev", error: message });
	return message;
};

/** PreToolUse for a Bash command the regex policy had no opinion on. Resolves to a hook output or null. */
export async function scriptPoint(command, cwd, output) {
	const key = apiKey();
	if (key === null) return null;
	const cache = jsonCache(CACHE_FILE);
	try {
		const ask = (state, questions) => askJev(state, questions, { key });
		const result = await inspectScript(command, cwd, { readFile: readScript, ask, cache, redact });
		if (result === null) return null;
		cache.save();
		const { verdict, cached, label } = result;
		record(STATE_DIR, {
			...(verdict ?? decision("permission", "none", "jev-script")),
			model: "jev",
			cached,
			key: label,
		});
		if (verdict === null) return null;
		return output("PreToolUse", {
			permissionDecision: "ask",
			permissionDecisionReason: `[jev] ${verdict.rule}（p=${verdict.confidence}）：Jev 读了 ${label} 的内容后判断需要你确认。`,
		});
	} catch (error) {
		return {
			systemMessage: `[jev] 脚本检查失败，按原规则放行：${failure("permission", "jev-script", error)}`,
		};
	}
}

/** UserPromptSubmit. Resolves to a hook output or null; `fallback` is the keyword heuristic. */
export async function taskPoint(prompt, output, fallback) {
	const key = apiKey();
	if (key === null || prompt.trim() === "") return fallback(prompt);
	try {
		const { answers } = await askJev({ prompt: redact(prompt.slice(0, PROMPT_LIMIT)) }, TASK_QUESTIONS, {
			key,
		});
		const { entry, text } = taskHint(answers.task_kind, (name) =>
			existsSync(path.join(SKILLS_DIR, name, "SKILL.md")),
		);
		record(STATE_DIR, { ...entry, model: "jev" });
		return text === null ? null : output("UserPromptSubmit", { additionalContext: text });
	} catch (error) {
		const message = failure("skills", "jev-task-kind", error);
		return { ...(fallback(prompt) ?? {}), systemMessage: `[jev] 任务分类失败，改用关键词：${message}` };
	}
}
