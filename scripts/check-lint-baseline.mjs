#!/usr/bin/env node
/**
 * Ratcheting lint guard for rules too widespread to enable outright.
 *
 * Counts biome diagnostics per file and rule, and compares them with the
 * baseline fixture: a file whose count grows (or a new file with findings)
 * fails; a file whose count drops asks for `--update` so the baseline only
 * shrinks.
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
const BASELINE_PATH = join(ROOT, "scripts/fixtures/lint-baseline.json");
const RULES = [
	"suspicious/noExplicitAny",
	"style/noNonNullAssertion",
	"suspicious/noEmptyBlockStatements",
	"complexity/noExcessiveLinesPerFunction",
];

export function countDiagnostics(report) {
	const counts = {};
	for (const diagnostic of report.diagnostics) {
		const rule = diagnostic.category.replace(/^lint\//, "");
		if (!RULES.includes(rule)) continue;
		const key = `${rule}\t${diagnostic.location.path}`;
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}

export function compare(baseline, current) {
	const grown = [];
	const shrunk = [];
	for (const [key, count] of Object.entries(current)) {
		const allowed = baseline[key] ?? 0;
		if (count > allowed) grown.push({ key, allowed, count });
	}
	for (const [key, allowed] of Object.entries(baseline)) {
		if ((current[key] ?? 0) < allowed) shrunk.push({ key, allowed, count: current[key] ?? 0 });
	}
	return { grown, shrunk };
}

function runBiome() {
	const args = [
		"lint",
		...RULES.map((rule) => `--only=${rule}`),
		"--reporter=json",
		"--max-diagnostics=none",
		".",
	];
	try {
		return execFileSync(join(ROOT, "node_modules/.bin/biome"), args, {
			cwd: ROOT,
			encoding: "utf8",
			maxBuffer: 256 * 1024 * 1024,
		});
	} catch (error) {
		// biome exits non-zero when it reports errors; the JSON report is still on stdout.
		if (typeof error.stdout === "string" && error.stdout.startsWith("{")) return error.stdout;
		throw error;
	}
}

function sorted(counts) {
	return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function describeGrowth({ key, allowed, count }) {
	const [rule, file] = key.split("\t");
	return `${file} has ${count} ${rule} (baseline ${allowed})`;
}

/** Applies `--update` and returns the exit code; a refused update leaves the baseline untouched. */
export function updateBaseline(baselinePath, current, args) {
	const { grown } = compare(JSON.parse(readFileSync(baselinePath, "utf8")), current);
	if (grown.length > 0 && !args.includes("--allow-moves")) {
		for (const entry of grown) console.error(`lint baseline: ${describeGrowth(entry)}; fix the new ones`);
		console.error(
			"lint baseline: not updated. --update only records drops; for existing code that moved unchanged, use --update --allow-moves and explain it in the PR description",
		);
		return 1;
	}
	for (const entry of grown) console.log(`lint baseline: accepted as moved: ${describeGrowth(entry)}`);
	writeFileSync(baselinePath, `${JSON.stringify(sorted(current), null, "\t")}\n`);
	console.log(`lint baseline updated (${Object.keys(current).length} file/rule entries)`);
	return 0;
}

if (isMainModule(import.meta.url)) {
	const current = countDiagnostics(JSON.parse(runBiome()));
	const args = process.argv.slice(2);
	if (args.includes("--update")) process.exit(updateBaseline(BASELINE_PATH, current, args));
	const { grown, shrunk } = compare(JSON.parse(readFileSync(BASELINE_PATH, "utf8")), current);
	for (const entry of grown) console.error(`lint baseline: ${describeGrowth(entry)}; fix the new ones`);
	for (const { key, allowed, count } of shrunk) {
		const [rule, file] = key.split("\t");
		console.log(`lint baseline: ${file} ${rule} dropped ${allowed} -> ${count}; run with --update`);
	}
	// Shrinking also fails so the baseline is lowered in the same change and cannot regrow.
	if (grown.length > 0 || shrunk.length > 0) process.exit(1);
	console.log("lint baseline: no new findings");
}
