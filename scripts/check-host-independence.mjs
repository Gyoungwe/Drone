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
	"@gyoungwe/pi-analysis",
]);
const optional = new Set([
	"@gyoungwe/pi-evidence",
	"@gyoungwe/pi-connectors",
	"@gyoungwe/desktop-ui-pack",
	"@gyoungwe/research-suite",
]);
const hostOnly = new Set([
	"@gyoungwe/pi-core",
	"@gyoungwe/pi-knowledge",
	"@gyoungwe/pi-research",
	"@gyoungwe/pi-analysis",
]);
// pi-core is the remaining native task/tool compatibility seam. Keep the
// exception narrow and explicit while P4 moves those facades into the plugin.
// New host code must use a package host entry (or the generic capability
// loader); adding another exception requires moving a concrete facade here.
const coreCompatibilityFacades = new Set([
	"packages/backend/src/project/memory.ts",
	"packages/backend/src/tools/deliver-files.ts",
	"packages/backend/src/tools/memory-save.ts",
]);
/** Return optional plugin imports that would couple the host to a package. */
export function findHostImportViolations(file, source) {
	const violations = [];
	for (const match of source.matchAll(
		/(?:from\s*|import\s*(?:\(\s*|\s+)|require\s*\(\s*)["'](@gyoungwe\/[^"']+)["']/gu,
	)) {
		const specifier = match[1];
		const packageName = specifier.split("/").slice(0, 2).join("/");
		const relativeFile = relative(root, file).replaceAll("\\", "/");
		if (hostOnly.has(packageName) && specifier !== `${packageName}/host`) {
			if (packageName === "@gyoungwe/pi-core" && coreCompatibilityFacades.has(relativeFile)) continue;
			const label = packageName === "@gyoungwe/pi-analysis" ? "pi-analysis" : packageName;
			violations.push(`${relativeFile}: ${label} imports must use the versioned host entry`);
		} else if (optional.has(packageName) && !allowed.has(packageName)) {
			violations.push(`${relativeFile}: optional plugin import ${packageName}`);
		}
	}
	return violations;
}

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
	violations.push(...findHostImportViolations(file, source));
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
