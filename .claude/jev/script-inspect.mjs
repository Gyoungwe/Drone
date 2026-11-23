/**
 * Jev permission point, script contents (paper §IV-A: "inspect what a script does, not just its name").
 * The regex policy sees `node tmp/fix.mjs` and has no opinion; this point reads the script, asks Jev the
 * questions in jev-questions.mjs, and turns the answers into a decision with `scriptVerdict`. It can only
 * add an `ask`: Claude Code's own permission flow still applies to everything it lets through.
 * Answers are cached by script content (paper §V, cache point), so a rerun of an unchanged script is free.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { decision } from "./decision.mjs";
import { SCRIPT_QUESTIONS } from "./jev-questions.mjs";

const RUNNERS =
	/^(?:node|bash|sh|zsh|python3?|tsx|npx\s+tsx|bun)\s+(?:-[\w-]+\s+)*([^\s'"]+\.(?:mjs|cjs|js|ts|mts|sh|py))(?:\s|$)/;
const NPM_RUN = /^npm\s+run\s+([\w:.-]+)/;
const SEGMENT_SPLIT = /\s*(?:&&|\|\||;|\|)\s*/;
/** About 5k tokens: well inside Jev's 32k per-question context. */
export const SCRIPT_LIMIT = 20_000;

/** The first script a command runs, as `{ label, file?, npmScript? }`, or null. Pure. */
export function scriptTarget(command, cwd) {
	for (const segment of command.trim().split(SEGMENT_SPLIT)) {
		const run = segment.match(RUNNERS);
		if (run) return { label: run[1], file: path.resolve(cwd, run[1]) };
		const npm = segment.match(NPM_RUN);
		if (npm) return { label: `npm run ${npm[1]}`, npmScript: npm[1], file: path.join(cwd, "package.json") };
	}
	return null;
}

/** Script text to judge, or null when there is nothing to read. */
export function scriptText(target, readFile) {
	const raw = readFile(target.file);
	if (raw === null) return null;
	if (target.npmScript === undefined) return raw.slice(0, SCRIPT_LIMIT);
	const body = JSON.parse(raw).scripts?.[target.npmScript];
	return typeof body === "string" ? body : null;
}

export const contentKey = (label, text) =>
	createHash("sha256").update(`${label}\0${text}`).digest("hex").slice(0, 32);

/** A cached answer set counts only when it answers every current question; adding a question re-asks. */
export const cachedAnswers = (cache, key) => {
	const hit = cache.get(key);
	return hit !== undefined && Object.keys(SCRIPT_QUESTIONS).every((id) => id in hit) ? hit : undefined;
};

/**
 * Yes-probability at which each question stops for the user, worst risk first so the rule names the
 * worst hit. Tuned against the labeled scripts in jev-calibrate.mjs; rerun it after changing a bar.
 */
export const ASK_AT = [
	["publishes_release", 0.5],
	["rewrites_git_history", 0.5],
	["reads_credentials", 0.5],
	["changes_outside_repo", 0.65],
	["sends_network_data", 0.7],
	["deletes_files", 0.85],
];

/**
 * Truth table from Jev's answers (each a `{ type: "noul", noul }`) to a permission decision: `ask` with
 * the first bar reached, or null. Never "allow" and never "deny": the model may only add a question.
 */
export function scriptVerdict(answers, bars = ASK_AT) {
	for (const [id, bar] of bars) {
		const p = answers[id]?.noul ?? 0;
		if (p >= bar) return decision("permission", "ask", `jev-${id}`, Number(p.toFixed(2)));
	}
	return null;
}

/**
 * `deps`: `{ readFile(file) → string|null, ask(state, questions) → Promise<{answers}>, cache: Map-like
 * { get, set }, redact(text) }`. Resolves to `{ verdict, cached, label }` or null when the command runs no
 * readable script. Throws when Jev fails; the caller records the error.
 */
export async function inspectScript(command, cwd, deps) {
	const target = scriptTarget(command, cwd);
	if (target === null) return null;
	const text = scriptText(target, deps.readFile);
	if (text === null || text.trim() === "") return null;
	const key = contentKey(target.label, text);
	const hit = cachedAnswers(deps.cache, key);
	if (hit !== undefined) return { verdict: scriptVerdict(hit), cached: true, label: target.label };
	const state = { command: deps.redact(command), script_path: target.label, script: deps.redact(text) };
	const { answers } = await deps.ask(state, SCRIPT_QUESTIONS);
	deps.cache.set(key, answers);
	return { verdict: scriptVerdict(answers), cached: false, label: target.label };
}
