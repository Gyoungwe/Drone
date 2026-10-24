#!/usr/bin/env node
// Research is built by drone-plugins; the host verifies the pinned fetched artifact.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageRoot = join(root, "vendor/plugins/pi-research");
const lock = JSON.parse(await readFile(join(root, "plugins.lock.json"), "utf8"));
const pinned = lock.plugins.find((entry) => entry.name === "@gyoungwe/pi-research");
if (!pinned) throw new Error("Research package is missing from plugins.lock.json");
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (manifest.version !== pinned.version)
	throw new Error("Research package version differs from plugins.lock.json");
const build = JSON.parse(await readFile(join(packageRoot, "build-manifest.json"), "utf8"));
for (const [path, expected] of Object.entries(build.outputs)) {
	const actual = createHash("sha256")
		.update(await readFile(join(packageRoot, path)))
		.digest("hex");
	if (actual !== expected) throw new Error(`Research artifact hash differs: ${path}`);
}
await readFile(join(packageRoot, "dist/host.mjs"));
await readFile(join(packageRoot, "skills/research-workflow/SKILL.md"));
console.log(`Pinned pi-research ${manifest.version} artifacts verified`);
