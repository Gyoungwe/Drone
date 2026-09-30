#!/usr/bin/env node
import { existsSync } from "node:fs";
/**
 * Ratcheting architecture guard for the package and Pi extension boundaries.
 *
 * The checker intentionally has no dependency on the TypeScript compiler. It is
 * run before build/typecheck in CI and reports source locations that need a
 * deliberate migration exception. Existing findings live in the baseline
 * fixture; new findings fail the check while fixed findings are reported so the
 * baseline can shrink over time.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const BASELINE_PATH = join(ROOT, "scripts/fixtures/architecture-baseline.json");
const SCAN_ROOTS = ["packages", ".pi"];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const SKIP_PARTS = new Set(["node_modules", "dist", "out", "coverage"]);

function toPosix(value) {
	return value.split(sep).join("/");
}
function displayPath(file) {
	return toPosix(relative(ROOT, file));
}
function lineNumber(text, offset) {
	return text.slice(0, offset).split("\n").length;
}
function addFinding(findings, rule, file, line, detail) {
	const normalized = detail.replace(/\s+/g, " ").trim();
	findings.push({ rule, file: displayPath(file), line, detail: normalized });
}
function canonical(finding) {
	return `${finding.rule}\t${finding.file}\t${finding.detail}`;
}

async function walk(dir, files = []) {
	const entries = await (await import("node:fs/promises")).readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (SKIP_PARTS.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			await walk(path, files);
			continue;
		}
		if (SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf(".")))) files.push(path);
	}
	return files;
}

function isRuntimeImport(line, text, offset) {
	// `import type ...` is explicitly permitted. Mixed imports are runtime
	// imports because their value bindings still execute at runtime.
	if (/^\s*import\s+type\b/.test(line)) return false;
	// Multiline type imports match on their closing `from` line. Look back to
	// the start of that import so the guard does not classify them as runtime
	// dependencies.
	const start = Math.max(0, text.lastIndexOf("import", offset));
	return !/\bimport\s+type\b/.test(text.slice(start, offset));
}

function scanFile(file, text, findings) {
	const rel = displayPath(file);
	const lines = text.split("\n");
	const isRenderer = /^packages\/desktop\/src\/(renderer|lan-web)\//.test(rel);
	const domain = rel.match(/^packages\/(knowledge|tasks|research)\//)?.[1];

	// R1: SDK value imports. Keep the check intentionally broad so a newly
	// added side-effect or dynamic import is caught as well.
	const sdkRe =
		/(?:from\s*["'](@earendil-works\/pi-[^"']+)["']|import\s*\(\s*["'](@earendil-works\/pi-[^"']+)["']\s*\)|require\s*\(\s*["'](@earendil-works\/pi-[^"']+)["']\s*\)|import\s*["'](@earendil-works\/pi-[^"']+)["'])/g;
	for (const match of text.matchAll(sdkRe)) {
		const offset = match.index ?? 0;
		const line = lines[lineNumber(text, offset) - 1] || "";
		if (!isRuntimeImport(line, text, offset)) continue;
		const specifier = match.slice(1).find(Boolean);
		const allowed = rel.startsWith("packages/backend/src/session-engine/");
		if (!allowed) addFinding(findings, "R1", file, lineNumber(text, offset), `runtime import ${specifier}`);
	}

	// R2: domain packages stay independent from host and SDK layers.
	if (domain) {
		const forbidden =
			/(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])(electron|@earendil-works\/pi-[^"']+|@drone\/(?:backend|desktop))(?=["'])/g;
		for (const match of text.matchAll(forbidden)) {
			const offset = match.index ?? 0;
			addFinding(findings, "R2", file, lineNumber(text, offset), `domain import ${match[1]}`);
		}
	}

	// R3: renderer/LAN may only cross package boundaries through shared.
	if (isRenderer) {
		const forbidden =
			/(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])(@drone\/(?!shared(?:["'/])|desktop(?:["'/]))[^"']+|electron|@earendil-works\/pi-[^"']+)(?=["'])/g;
		for (const match of text.matchAll(forbidden)) {
			const offset = match.index ?? 0;
			addFinding(findings, "R3", file, lineNumber(text, offset), `renderer import ${match[1]}`);
		}
	}

	// R4: process-global bridges are migration debt. Match only actual key
	// expressions (comments and docs do not count).
	const symbolRe = /Symbol\.for\(\s*["'](drone\.[^"']+)["']\s*\)/g;
	for (const match of text.matchAll(symbolRe)) {
		const offset = match.index ?? 0;
		addFinding(findings, "R4", file, lineNumber(text, offset), `global bridge ${match[1]}`);
	}

	// R5: a package source file must not reach into the .pi runtime through a
	// relative URL/import. Bare .pi references in comments and config are safe.
	const boundaryRe =
		/(?:from\s*["']|import\s*\(\s*["']|new\s+URL\(\s*["'])(\.\.?\/[^"'`\n]*\.pi\/[^"'`\n]*)(?:["'`])/g;
	for (const match of text.matchAll(boundaryRe)) {
		const offset = match.index ?? 0;
		addFinding(findings, "R5", file, lineNumber(text, offset), `relative .pi path ${match[1]}`);
	}

	// R6: keep domain dependencies acyclic.
	if (domain) {
		const imports =
			/(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])(@drone\/(knowledge|tasks|research))(?=["'/])/g;
		for (const match of text.matchAll(imports)) {
			const target = match[2];
			const forbidden =
				(domain === "knowledge" && target !== "knowledge") ||
				(domain === "tasks" && target === "research") ||
				(domain === "research" && target === "tasks");
			if (!forbidden) continue;
			const offset = match.index ?? 0;
			addFinding(findings, "R6", file, lineNumber(text, offset), `domain dependency ${domain} -> ${target}`);
		}
	}
}

async function scan() {
	const files = [];
	for (const root of SCAN_ROOTS) {
		const path = join(ROOT, root);
		if (existsSync(path)) await walk(path, files);
	}
	const findings = [];
	for (const file of files) scanFile(file, await readFile(file, "utf8"), findings);
	return findings.sort((a, b) => canonical(a).localeCompare(canonical(b)) || a.line - b.line);
}

async function loadBaseline() {
	if (!existsSync(BASELINE_PATH)) return [];
	const parsed = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
	if (Array.isArray(parsed)) return parsed;
	if (Array.isArray(parsed.findings)) return parsed.findings;
	throw new Error(`${displayPath(BASELINE_PATH)} must contain a findings array`);
}

const findings = await scan();
const baseline = await loadBaseline();
if (process.argv.includes("--update-baseline")) {
	await writeFile(BASELINE_PATH, `${JSON.stringify({ version: 1, findings }, null, 2)}\n`);
	console.log(`Updated ${displayPath(BASELINE_PATH)} with ${findings.length} findings.`);
	process.exit(0);
}
const baselineKeys = new Set(baseline.map(canonical));
const currentKeys = new Set(findings.map(canonical));
const added = findings.filter((finding) => !baselineKeys.has(canonical(finding)));
const removed = baseline.filter((finding) => !currentKeys.has(canonical(finding)));
if (removed.length) {
	console.warn(
		`Architecture baseline has ${removed.length} fixed finding(s); update it with --update-baseline.`,
	);
}
if (added.length) {
	console.error(`Architecture check failed: ${added.length} new violation(s).`);
	for (const finding of added)
		console.error(`- ${finding.rule} ${finding.file}:${finding.line} — ${finding.detail}`);
	process.exit(1);
}
console.log(`Architecture check passed (${findings.length} baseline finding(s), ${removed.length} fixed).`);
