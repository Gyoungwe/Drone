#!/usr/bin/env node
/**
 * Ratcheting structure guard (AGENTS.md hard limits):
 * - files over 400 lines,
 * - class inheritance other than Error subclasses,
 * - module-level `let`.
 *
 * Existing findings live in the baseline fixture. A file that newly crosses a
 * limit, or whose oversize line count / finding count grows, fails; a file that
 * improves asks for `--update` so the baseline only shrinks.
 *
 * `--update` records drops only: if a count would rise or a new entry appear it
 * lists them, writes nothing and fails. `--update --allow-moves` also accepts
 * those, for existing code that moved unchanged; explain its use in the PR
 * description.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main-module.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts/fixtures/structure-baseline.json");
const MAX_FILE_LINES = 400;
const SOURCE_RE = /\.(?:ts|tsx|mts|js|jsx|mjs|cjs)$/;
// Generated or vendored output is checked at its source.
const GENERATED_RE = /(?:^|\/)(?:dist|out|node_modules|fixtures)\/|^\.pi\/extensions\/[^/]+\.mjs$|\.d\.ts$/;

export function scanSource(text) {
	const findings = {};
	const lines = text.split("\n");
	const lineCount = text.endsWith("\n") ? lines.length - 1 : lines.length;
	if (lineCount > MAX_FILE_LINES) findings["file-lines"] = lineCount;
	const extendsCount = [...text.matchAll(/\bclass\s+\w+(?:<[^>{]*>)?\s+extends\s+([\w.]+)/g)].filter(
		([, base]) => !/(?:^|\.)\w*Error$/.test(base),
	).length;
	if (extendsCount > 0) findings["class-extends"] = extendsCount;
	const letCount = lines.filter((line) => /^(?:export\s+)?let\s/.test(line)).length;
	if (letCount > 0) findings["module-let"] = letCount;
	return findings;
}

export function compare(baseline, current) {
	const grown = [];
	const shrunk = [];
	for (const [key, count] of Object.entries(current)) {
		const allowed = baseline[key] ?? (key.startsWith("file-lines\t") ? MAX_FILE_LINES : 0);
		if (count > allowed) grown.push({ key, allowed, count });
	}
	for (const [key, allowed] of Object.entries(baseline)) {
		if ((current[key] ?? 0) < allowed) shrunk.push({ key, allowed, count: current[key] ?? 0 });
	}
	return { grown, shrunk };
}

function describeGrowth({ key, allowed, count }) {
	const [rule, file] = key.split("\t");
	return `${file} ${rule} is ${count} (allowed ${allowed})`;
}

/** Applies `--update` and returns the exit code; a refused update leaves the baseline untouched. */
export function updateBaseline(baselinePath, current, args) {
	const { grown } = compare(JSON.parse(readFileSync(baselinePath, "utf8")), current);
	if (grown.length > 0 && !args.includes("--allow-moves")) {
		for (const entry of grown) console.error(`structure: ${describeGrowth(entry)}; split or remove it`);
		console.error(
			"structure: not updated. --update only records drops; for existing code that moved unchanged, use --update --allow-moves and explain it in the PR description",
		);
		return 1;
	}
	for (const entry of grown) console.log(`structure: accepted as moved: ${describeGrowth(entry)}`);
	const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
	writeFileSync(baselinePath, `${JSON.stringify(sorted, null, "\t")}\n`);
	console.log(`structure baseline updated (${Object.keys(current).length} entries)`);
	return 0;
}

function scanRepository() {
	const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
		.split("\n")
		.filter((file) => SOURCE_RE.test(file) && !GENERATED_RE.test(file));
	const current = {};
	for (const file of files) {
		for (const [rule, count] of Object.entries(scanSource(readFileSync(join(ROOT, file), "utf8")))) {
			current[`${rule}\t${file}`] = count;
		}
	}
	return current;
}

if (isMainModule(import.meta.url)) {
	const current = scanRepository();
	const args = process.argv.slice(2);
	if (args.includes("--update")) process.exit(updateBaseline(BASELINE_PATH, current, args));
	const { grown, shrunk } = compare(JSON.parse(readFileSync(BASELINE_PATH, "utf8")), current);
	for (const entry of grown) console.error(`structure: ${describeGrowth(entry)}; split or remove it`);
	for (const { key, allowed, count } of shrunk) {
		const [rule, file] = key.split("\t");
		console.log(`structure: ${file} ${rule} dropped ${allowed} -> ${count}; run with --update`);
	}
	// Shrinking also fails so the baseline is lowered in the same change and cannot regrow.
	if (grown.length > 0 || shrunk.length > 0) process.exit(1);
	console.log("structure: no new findings");
}
