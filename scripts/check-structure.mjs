#!/usr/bin/env node
/**
 * Ratcheting structure guard (AGENTS.md hard limits):
 * - files over 400 lines,
 * - class inheritance other than Error subclasses,
 * - module-level `let`,
 * - retired IPC, shared wildcard re-exports across packages, and legacy filenames.
 *
 * Existing findings live in the baseline fixture. A file that newly crosses a
 * limit, or whose oversize line count / finding count grows, fails; a file that
 * improves asks for `--update` so the baseline only shrinks.
 *
 * `--update` records drops only: if a count would rise or a new entry appear it
 * lists them, writes nothing and fails. `--update --allow-moves` also accepts
 * those, for existing code that moved unchanged; explain its use in the PR
 * description.
 * Legacy knowledge has one implicit allowance. Its removal records a zero
 * in the baseline so future scans can detect resurrection in shallow checkouts.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isMainModule } from "./is-main-module.mjs";

export const STRUCTURE_BASELINE_FILE = "scripts/fixtures/structure-baseline.json";
export const LEGACY_KNOWLEDGE_FILE = "packages/plugin-api/src/legacy-knowledge.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, STRUCTURE_BASELINE_FILE);
const LEGACY_KNOWLEDGE_KEY = `legacy-file\t${LEGACY_KNOWLEDGE_FILE}`;
const SHARED_SOURCE = "packages/shared/src/";
const GLUE_ROOTS = [SHARED_SOURCE, "packages/plugin-api/src/"];
const RETIRED_IPC_RE = /^packages\/shared\/src\/ipc\.(?:ts|mts|mjs|js|tsx)$/;
const MAX_FILE_LINES = 400;
const SOURCE_RE = /\.(?:ts|tsx|mts|js|jsx|mjs|cjs)$/;
// Generated or vendored output is checked at its source.
const GENERATED_RE = /(?:^|\/)(?:dist|out|node_modules|fixtures)\/|^\.pi\/extensions\/[^/]+\.mjs$|\.d\.ts$/;

export function isGlueSource(file) {
	return GLUE_ROOTS.some((root) => file.startsWith(root)) && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file);
}

export function allowsLegacyKnowledge(baseline) {
	return baseline[LEGACY_KNOWLEDGE_KEY] !== 0;
}

function forbiddenLegacyName(file, legacyKnowledgeAllowed) {
	const name = file.slice(file.lastIndexOf("/") + 1);
	if (name.startsWith("p5-")) return false;
	return name.startsWith("legacy-") && !(file === LEGACY_KNOWLEDGE_FILE && legacyKnowledgeAllowed);
}

function scanSharedBarrels(file, text) {
	if (!text.includes("*")) return [];
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
	const findings = [];
	for (const statement of source.statements) {
		if (!ts.isExportDeclaration(statement)) continue;
		if (statement.exportClause && !ts.isNamespaceExport(statement.exportClause)) continue;
		const specifier = statement.moduleSpecifier;
		if (!specifier || !ts.isStringLiteral(specifier) || /^\.\.?\//.test(specifier.text)) continue;
		const { line } = source.getLineAndCharacterOfPosition(statement.getStart(source));
		findings.push({
			rule: "G5-barrel",
			line: line + 1,
			detail: `cross-package wildcard re-export ${specifier.text}`,
		});
	}
	return findings;
}

export function scanGlueSource(file, text, legacyKnowledgeAllowed) {
	const findings = [];
	if (RETIRED_IPC_RE.test(file)) {
		findings.push({
			rule: "G5-ipc",
			line: 1,
			detail: "retired IPC module. Use packages/shared/src/host-api/",
		});
	}
	if (forbiddenLegacyName(file, legacyKnowledgeAllowed)) {
		findings.push({ rule: "G5-legacy", line: 1, detail: "legacy-* source filename is reserved" });
	}
	if (file.startsWith(SHARED_SOURCE)) findings.push(...scanSharedBarrels(file, text));
	return findings;
}

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
	const limits = Object.hasOwn(current, LEGACY_KNOWLEDGE_KEY)
		? { [LEGACY_KNOWLEDGE_KEY]: 1, ...baseline }
		: baseline;
	const grown = [];
	const shrunk = [];
	for (const [key, count] of Object.entries(current)) {
		const allowed = limits[key] ?? (key.startsWith("file-lines\t") ? MAX_FILE_LINES : 0);
		if (count > allowed) grown.push({ key, allowed, count });
	}
	for (const [key, allowed] of Object.entries(limits)) {
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

function gitFiles(...args) {
	return execFileSync("git", ["ls-files", "-z", ...args], { cwd: ROOT, encoding: "utf8" })
		.split("\0")
		.slice(0, -1);
}

function scanRepository(legacyKnowledgeAllowed) {
	const untracked = gitFiles("--others", "--exclude-standard", "--", ...GLUE_ROOTS).filter(isGlueSource);
	const files = new Set([...gitFiles(), ...untracked]);
	const current = {};
	const problems = [];
	for (const file of files) {
		const glue = isGlueSource(file);
		const structure = SOURCE_RE.test(file) && !GENERATED_RE.test(file);
		if (!glue && !structure) continue;
		const path = join(ROOT, file);
		if (!existsSync(path)) continue; // Stop also checks deletions that are not staged yet.
		const text = readFileSync(path, "utf8");
		if (glue) {
			for (const { line, detail } of scanGlueSource(file, text, legacyKnowledgeAllowed)) {
				problems.push(`${file}:${line} ${detail}`);
			}
		}
		if (!structure) continue;
		for (const [rule, count] of Object.entries(scanSource(text))) {
			current[`${rule}\t${file}`] = count;
		}
	}
	if (!existsSync(join(ROOT, LEGACY_KNOWLEDGE_FILE))) current[LEGACY_KNOWLEDGE_KEY] = 0;
	return { current, problems };
}

if (isMainModule(import.meta.url)) {
	const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
	const { current, problems } = scanRepository(allowsLegacyKnowledge(baseline));
	for (const problem of problems) console.error(`structure: ${problem}`);
	if (problems.length > 0) process.exit(1);
	const args = process.argv.slice(2);
	if (args.includes("--update")) process.exit(updateBaseline(BASELINE_PATH, current, args));
	const { grown, shrunk } = compare(baseline, current);
	for (const entry of grown) console.error(`structure: ${describeGrowth(entry)}; split or remove it`);
	for (const { key, allowed, count } of shrunk) {
		const [rule, file] = key.split("\t");
		console.log(`structure: ${file} ${rule} dropped ${allowed} -> ${count}; run with --update`);
	}
	// Shrinking also fails so the baseline is lowered in the same change and cannot regrow.
	if (grown.length > 0 || shrunk.length > 0) process.exit(1);
	console.log("structure: no new findings");
}
