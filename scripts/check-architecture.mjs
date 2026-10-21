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
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
	const isRenderer = /^packages\/desktop\/src\/renderer\//.test(rel);
	const isTest = /(?:^|\/)(?:test|tests)\//.test(rel) || /\.(?:test|spec)\.[^.]+$/.test(rel);
	const domain = rel.match(/^packages\/(knowledge|tasks|research)\//)?.[1];
	const knowledge = rel.startsWith("packages/knowledge/");
	const extension = rel.startsWith("packages/extensions/");
	const inquiry = rel.startsWith("packages/inquiry/");
	const compute = rel.startsWith("packages/compute/");

	// R1: SDK value imports. Keep the check intentionally broad so a newly
	// added side-effect or dynamic import is caught as well.
	const sdkRe =
		/(?:from\s*["'](@earendil-works\/pi-[^"']+)["']|import\s*\(\s*["'](@earendil-works\/pi-[^"']+)["']\s*\)|require\s*\(\s*["'](@earendil-works\/pi-[^"']+)["']\s*\)|import\s*["'](@earendil-works\/pi-[^"']+)["'])/g;
	for (const match of text.matchAll(sdkRe)) {
		const offset = match.index ?? 0;
		const line = lines[lineNumber(text, offset) - 1] || "";
		if (!isRuntimeImport(line, text, offset)) continue;
		const specifier = match.slice(1).find(Boolean);
		// Tests intentionally exercise the SDK boundary directly; production
		// runtime imports remain restricted to the session-engine gateway.
		const allowed = isTest || rel.startsWith("packages/backend/src/session-engine/");
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

	// P1: knowledge is a portable plugin domain. Its implementation may only
	// consume the public plugin contract (plus Node/npm dependencies), and host
	// consumers must use the single host entry while the source is migrated.
	if (knowledge) {
		const forbidden =
			/(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])(@drone\/[^"']+|electron|@earendil-works\/pi-[^"']+)(?=["'])/g;
		for (const match of text.matchAll(forbidden)) {
			const offset = match.index ?? 0;
			addFinding(findings, "R2", file, lineNumber(text, offset), `knowledge import ${match[1]}`);
		}
	}
	if (!knowledge && !extension) {
		const knowledgeImports =
			/(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])(@drone\/knowledge(?:\/[^"']*)?)(?=["'])/g;
		for (const match of text.matchAll(knowledgeImports)) {
			if (match[1] === "@drone/knowledge/host") continue;
			const offset = match.index ?? 0;
			addFinding(
				findings,
				"R10",
				file,
				lineNumber(text, offset),
				`knowledge host entry required: ${match[1]}`,
			);
		}
	}

	// R3: renderer may only cross package boundaries through shared.
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

	// R7: compute is a portable domain package. It may consume the shared
	// contract layer, but must not pull host implementations, Electron, or Pi.
	if (compute) {
		const forbidden =
			/(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])(@drone\/(?!shared(?:["'/]))[^"']+|electron|@earendil-works\/pi-[^"']+)(?=["'])/g;
		for (const match of text.matchAll(forbidden)) {
			const offset = match.index ?? 0;
			addFinding(findings, "R7", file, lineNumber(text, offset), `compute import ${match[1]}`);
		}
	}

	// R8: inquiry is a portable research-state domain. It may use the shared
	// contract layer, but host persistence and compute adapters belong to the
	// backend composition root.
	if (inquiry) {
		const forbidden =
			/(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])(@drone\/(?!shared(?:["'/]))[^"']+|electron|@earendil-works\/pi-[^"']+)(?=["'])/g;
		for (const match of text.matchAll(forbidden)) {
			const offset = match.index ?? 0;
			addFinding(findings, "R8", file, lineNumber(text, offset), `inquiry import ${match[1]}`);
		}
	}
	// R9 (UI 追平 U1): renderer 组件的 className 只用语义 token —— 禁止 Tailwind 调色板类
	// （red-600、amber-500…）和任意值 6 位 hex（text-[#c9d3f5]）。canvas/图表的数据配色常量不在此列。
	if (/^packages\/desktop\/src\/renderer\/.*\.tsx$/.test(rel) && !/\.test\.tsx$/.test(rel)) {
		const palette =
			/\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|divide|decoration|accent)-(?:red|rose|amber|yellow|orange|green|emerald|lime|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|slate|gray|zinc|neutral|stone)-\d{2,3}\b|-\[#[0-9a-fA-F]{6}\]/g;
		for (const match of text.matchAll(palette)) {
			const offset = match.index ?? 0;
			addFinding(findings, "R9", file, lineNumber(text, offset), `palette class ${match[0]}`);
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
	await scanPluginDist(findings);
	return findings.sort((a, b) => canonical(a).localeCompare(canonical(b)) || a.line - b.line);
}

/**
 * R8: installable Pi packages must be self-contained. Their generated dist
 * cannot import Electron, the Desktop/backend composition roots, or reach
 * outside the package with a ../../ import. Source packages are checked by the
 * normal rules above; this extra pass covers the emitted artifact that users
 * actually install.
 */
async function scanPluginDist(findings) {
	const packagesRoot = join(ROOT, "packages");
	if (!existsSync(packagesRoot)) return;
	for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^pi-/.test(entry.name)) continue;
		const dist = join(packagesRoot, entry.name, "dist");
		if (!existsSync(dist)) continue;
		const files = await walk(dist, []);
		for (const file of files) {
			const text = await readFile(file, "utf8");
			for (const match of text.matchAll(
				/(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])(electron|@drone\/(?:backend|desktop))(?=["'])/g,
			)) {
				const offset = match.index ?? 0;
				addFinding(findings, "R8", file, lineNumber(text, offset), `plugin dist host import ${match[1]}`);
			}
			for (const match of text.matchAll(
				/(?:from\s*["']|import\s*\(\s*["']|require\s*\(\s*["'])(\.\.\/\.\.)/g,
			)) {
				const offset = match.index ?? 0;
				addFinding(
					findings,
					"R8",
					file,
					lineNumber(text, offset),
					"plugin dist package-boundary ../../ import",
				);
			}
		}
	}
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
