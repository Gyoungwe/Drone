#!/usr/bin/env node
/**
 * Pre-commit guard (AGENTS.md hard limits):
 * - generated output and source are committed separately,
 * - no new `.skip(` and no new or longer test timeouts,
 * - retired glue stays retired in the staged snapshot.
 * Bypass with `git commit --no-verify` and say why in the PR description.
 */
import { execFileSync } from "node:child_process";
import process from "node:process";
import {
	allowsLegacyKnowledge,
	isGlueSource,
	LEGACY_KNOWLEDGE_FILE,
	STRUCTURE_BASELINE_FILE,
	scanGlueSource,
} from "./check-structure.mjs";
import { isMainModule } from "./is-main-module.mjs";

const GENERATED_RE = /(?:^|\/)dist\/|^\.pi\/extensions\/|(?:^|\/)\.?build-manifest\.json$/;
const TEST_FILE_RE = /(?:^|\/)(?:test|tests)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIP_RE = /\b(?:it|test|describe|suite)\.skip\s*\(|\{\s*skip:\s*true/;
const TIMEOUT_RE = /\b(?:timeout|testTimeout|hookTimeout)\s*:|\.setTimeout\(\s*\d|--test-timeout/;

export function checkStaged(paths, addedLines) {
	const problems = [];
	const generated = paths.filter((path) => GENERATED_RE.test(path));
	if (generated.length > 0 && generated.length < paths.length) {
		problems.push(`generated files are staged with source; commit them separately (${generated.join(", ")})`);
	}
	for (const { file, text } of addedLines) {
		if (GENERATED_RE.test(file)) continue;
		if (SKIP_RE.test(text)) problems.push(`${file}: new skipped test: ${text.trim()}`);
		if (TEST_FILE_RE.test(file) && TIMEOUT_RE.test(text)) {
			problems.push(`${file}: new or changed test timeout: ${text.trim()}`);
		}
	}
	return problems;
}

export function parseAddedLines(diff) {
	const added = [];
	let file = "";
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) file = line.slice(4).replace(/^b\//, "");
		else if (line.startsWith("+")) added.push({ file, text: line.slice(1) });
	}
	return added;
}

function stagedGlueProblems(git, paths) {
	const tracked = git("ls-files", "-z", "--", STRUCTURE_BASELINE_FILE, LEGACY_KNOWLEDGE_FILE).split("\0");
	const hasBaseline = tracked.includes(STRUCTURE_BASELINE_FILE);
	const hasLegacyKnowledge = tracked.includes(LEGACY_KNOWLEDGE_FILE);
	const readStaged = (file) => git("cat-file", "blob", `:${file}`);
	const baseline = hasBaseline ? JSON.parse(readStaged(STRUCTURE_BASELINE_FILE)) : {};
	const legacyKnowledgeAllowed = allowsLegacyKnowledge(baseline);
	const files = new Set(paths.filter(isGlueSource));
	const problems = [];
	if (hasBaseline && legacyKnowledgeAllowed && !hasLegacyKnowledge) {
		problems.push(
			`${LEGACY_KNOWLEDGE_FILE} was removed. Run node scripts/check-structure.mjs --update and stage ${STRUCTURE_BASELINE_FILE}`,
		);
	}
	if (!legacyKnowledgeAllowed && hasLegacyKnowledge) files.add(LEGACY_KNOWLEDGE_FILE);
	for (const file of files) {
		for (const { line, detail } of scanGlueSource(file, readStaged(file), legacyKnowledgeAllowed)) {
			problems.push(`${file}:${line} ${detail}`);
		}
	}
	return problems;
}

if (isMainModule(import.meta.url)) {
	const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
	const paths = git("diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR").split("\0").slice(0, -1);
	const problems = checkStaged(
		paths,
		parseAddedLines(git("diff", "--cached", "--unified=0", "--diff-filter=ACMR")),
	);
	problems.push(...stagedGlueProblems(git, paths));
	for (const problem of problems) console.error(`pre-commit: ${problem}`);
	if (problems.length > 0) {
		console.error("pre-commit: fix these, or bypass with --no-verify and explain why in the PR description");
		process.exit(1);
	}
}
