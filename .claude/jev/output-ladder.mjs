/**
 * Jev output point (paper §V, Fig. 4): the visibility ladder for check output. The full output is always
 * stored as a chunk; the ladder only chooses what the model sees this turn:
 *   full  — short output, or JEV_RAW=1
 *   hide  — the same command produced the same output and exit code as its last run
 *   short — passed: one summary line
 *   long  — failed: failing test names and assertion lines only (the strict tier), then the chunk id
 * Nothing is deleted; `jev-run.mjs --show <chunk> --grep <pattern>` retrieves detail on demand.
 */
import { createHash } from "node:crypto";

export const FULL_LIMIT = 80;
const FAILURE_LIMIT = 40;
const TAIL_FALLBACK = 15;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const FAILURE = [
	/^\s*not ok \d+/,
	/^\s*✖ /,
	/^\s*(?:FAIL|×|✗) /,
	/AssertionError|^\s*(?:Expected|Received|expected|actual)\b/,
	/\berror TS\d+:/,
	/^\S+:\d+:\d+ \S+/,
	/^\s*(?:Error|TypeError|ReferenceError|SyntaxError|RangeError):/,
	/\bnpm (?:ERR!|error)/,
];

const PASS_SUMMARY = [
	/^\s*[#ℹ] (?:tests|pass|fail|skipped) \d+/,
	/^\s*Tests?\s+\d+.*(?:passed|failed)/,
	/^\s*Checked \d+ files?/,
	/^\s*Found \d+ (?:errors?|warnings?)/,
];

export function clean(text) {
	return text.replace(ANSI, "");
}

/** Timings change between identical runs; they must not make the same result look new. */
export function normalize(text) {
	return clean(text)
		.replace(/duration_ms \d+(?:\.\d+)?/g, "duration_ms <t>")
		.replace(/\d+(?:\.\d+)?\s?(?:ms|s)\b/g, "<t>");
}

export function chunkId(text) {
	return createHash("sha256").update(normalize(text)).digest("hex").slice(0, 8);
}

function summary(lines) {
	const found = lines.filter((line) => PASS_SUMMARY.some((pattern) => pattern.test(line)));
	return found.length === 0
		? "no summary line"
		: found
				.slice(0, 4)
				.map((line) => line.trim())
				.join(" · ");
}

function failureView(lines, head, hint) {
	const hits = lines.filter((line) => FAILURE.some((pattern) => pattern.test(line)));
	const shown = hits.length > 0 ? hits.slice(0, FAILURE_LIMIT) : lines.slice(-TAIL_FALLBACK);
	const more = hits.length > FAILURE_LIMIT ? ` (+${hits.length - FAILURE_LIMIT} more failure lines)` : "";
	const basis = hits.length > 0 ? "failure lines" : `no failure pattern matched; last ${TAIL_FALLBACK} lines`;
	return {
		confidence: hits.length > 0 ? 1 : 0.5,
		text: [`${head} · ${basis}${more}`, ...shown, hint].join("\n"),
	};
}

/** `runner` is the absolute path of jev-run.mjs, used in the retrieval hint. */
/** `previous` is the `fingerprint` this command returned last time. */
export function ladder({ output, exitCode, raw, previous, runner }) {
	const stored = clean(output);
	const id = chunkId(stored);
	const lines = stored.trimEnd().split("\n");
	const total = stored.trim() === "" ? 0 : lines.length;
	const base = { id, fingerprint: `${id}/${exitCode}`, stored, lines: total };
	if (raw || total <= FULL_LIMIT) return { ...base, answer: "full", confidence: 1, text: stored.trimEnd() };
	const mark = exitCode === 0 ? "✓ exit 0" : `✗ exit ${exitCode}`;
	const head = `${mark} · ${total} lines · chunk ${id}`;
	if (previous === base.fingerprint)
		return { ...base, answer: "hide", confidence: 1, text: `${head} · same as last run` };
	if (exitCode === 0) return { ...base, answer: "short", confidence: 1, text: `${head} · ${summary(lines)}` };
	const hint = `→ node ${runner} --show ${id} --grep <pattern>`;
	return { ...base, answer: "long", ...failureView(lines, head, hint) };
}
