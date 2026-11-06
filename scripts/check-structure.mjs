#!/usr/bin/env node
/**
 * Ratcheting structure guard (AGENTS.md hard limits):
 * - files over 400 lines,
 * - `class X extends Y` for anything other than Error subclasses,
 * - module-level `let`.
 *
 * Existing findings live in the baseline fixture. A file that newly crosses a
 * limit, or whose oversize line count / finding count grows, fails; a file that
 * improves asks for `--update` so the baseline only shrinks.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

if (import.meta.url === `file://${process.argv[1]}`) {
	const current = scanRepository();
	if (process.argv.includes("--update")) {
		const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
		writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, "\t")}\n`);
		console.log(`structure baseline updated (${Object.keys(current).length} entries)`);
		process.exit(0);
	}
	const { grown, shrunk } = compare(JSON.parse(readFileSync(BASELINE_PATH, "utf8")), current);
	for (const { key, allowed, count } of grown) {
		const [rule, file] = key.split("\t");
		console.error(`structure: ${file} ${rule} is ${count} (allowed ${allowed}); split or remove it`);
	}
	for (const { key, allowed, count } of shrunk) {
		const [rule, file] = key.split("\t");
		console.log(`structure: ${file} ${rule} dropped ${allowed} -> ${count}; run with --update`);
	}
	// Shrinking also fails so the baseline is lowered in the same change and cannot regrow.
	if (grown.length > 0 || shrunk.length > 0) process.exit(1);
	console.log("structure: no new findings");
}
