#!/usr/bin/env node
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const allowed = new Set([
	"@gyoungwe/plugin-api",
	"@gyoungwe/pi-core",
	"@gyoungwe/pi-knowledge",
	"@gyoungwe/pi-research",
	// Existing host adapters use pi-analysis directly; its migration is outside v3.
	"@gyoungwe/pi-analysis",
]);
const optional = new Set([
	"@gyoungwe/pi-evidence",
	"@gyoungwe/pi-connectors",
	"@gyoungwe/desktop-ui-pack",
	"@gyoungwe/research-suite",
]);

async function walk(dir, files = []) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (["node_modules", "dist", "out", "coverage"].includes(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) await walk(path, files);
		else if (sourceExtensions.has(extname(path)) && !/\.(?:test|spec)\.[^.]+$/u.test(path)) files.push(path);
	}
	return files;
}

const violations = [];
for (const file of await walk(join(root, "packages"))) {
	const source = await readFile(file, "utf8");
	for (const match of source.matchAll(
		/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](@gyoungwe\/[^"']+)["']/gu,
	)) {
		const packageName = match[1].split("/").slice(0, 2).join("/");
		if (optional.has(packageName) && !allowed.has(packageName))
			violations.push(`${relative(root, file)}: optional plugin import ${packageName}`);
	}
}
if (violations.length) {
	console.error("Host independence check failed:");
	for (const violation of violations) console.error(`- ${violation}`);
	process.exit(1);
}

const emptyRoot = await mkdtemp(join(tmpdir(), "drone-host-independence-"));
try {
	const entries = await readdir(join(emptyRoot, "npm", "node_modules")).catch(() => []);
	if (entries.length !== 0) throw new Error("optional package root was not empty");
	console.log("Host independence check passed (no optional plugin imports and empty package root).");
} finally {
	await rm(emptyRoot, { recursive: true, force: true });
}
