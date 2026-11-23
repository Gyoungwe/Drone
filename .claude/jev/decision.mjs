/**
 * The one shape every Jev decision point answers with (paper §I-A, Table I): which question was asked,
 * the typed answer, the rule that produced it and how sure the rule is. Deterministic rules answer with
 * confidence 1; keyword heuristics and fallbacks say less. Every answer is appended to a local log so
 * the rules can be judged by data rather than by feel.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Git-ignored per-checkout state: decisions.jsonl, stored output chunks and per-session context marks. */
export const STATE_DIR = fileURLToPath(new URL("../jev-state/", import.meta.url));

export function decision(point, answer, rule, confidence = 1) {
	return { point, answer, rule, confidence };
}

export function record(stateDir, entry) {
	mkdirSync(stateDir, { recursive: true });
	const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
	appendFileSync(path.join(stateDir, "decisions.jsonl"), `${line}\n`);
}
