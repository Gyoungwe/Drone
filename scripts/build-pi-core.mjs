#!/usr/bin/env node
// pi-core is built in drone-plugins. The host only verifies the source-locked artifact.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const requiredOutputs = [
	"dist/index.mjs",
	"dist/host.mjs",
	"dist/index.d.ts",
	"dist/host.d.ts",
	"dist/memory.mjs",
	"dist/memory.d.ts",
	"dist/tools/memory-save.mjs",
	"dist/tools/memory-save.d.ts",
];

export async function verifyPinnedCoreArtifact(repoRoot = root) {
	const packageRoot = join(repoRoot, "vendor/plugins/pi-core");
	const lock = JSON.parse(await readFile(join(repoRoot, "plugins.lock.json"), "utf8"));
	const pinned = lock.plugins.find((entry) => entry.name === "@gyoungwe/pi-core");
	if (!pinned) throw new Error("Core package is missing from plugins.lock.json");
	const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	const manifest = JSON.parse(await readFile(join(packageRoot, "plugin.manifest.json"), "utf8"));
	if (pkg.name !== pinned.name || pkg.version !== pinned.version || manifest.version !== pinned.version)
		throw new Error("Core package identity/version differs from plugins.lock.json");
	const fetched = JSON.parse(await readFile(join(packageRoot, ".drone-fetch.json"), "utf8"));
	if (fetched.commit !== pinned.commit || fetched.sha256 !== pinned.tarballSha256)
		throw new Error("Core package source receipt differs from plugins.lock.json");
	const build = JSON.parse(await readFile(join(packageRoot, "build-manifest.json"), "utf8"));
	for (const path of requiredOutputs)
		if (!Object.hasOwn(build.outputs, path))
			throw new Error(`Core build manifest omits public output: ${path}`);
	for (const [path, expected] of Object.entries(build.outputs)) {
		const target = resolve(packageRoot, path);
		const rel = relative(packageRoot, target);
		if (isAbsolute(path) || !rel || rel === ".." || rel.startsWith(`..${sep}`))
			throw new Error(`Core output escapes package: ${path}`);
		const actual = createHash("sha256")
			.update(await readFile(target))
			.digest("hex");
		if (actual !== expected) throw new Error(`Core artifact hash differs: ${path}`);
	}
	return { packageRoot, version: pkg.version, outputs: Object.keys(build.outputs) };
}

/** Verify the installed plugin still owns memory writes and ships their public contract. */
export async function verifyCoreMemoryArtifact(repoRoot = root) {
	const artifact = await verifyPinnedCoreArtifact(repoRoot);
	const paths = ["dist/index.mjs", "dist/host.mjs", "dist/memory.mjs", "dist/tools/memory-save.mjs"];
	const [extension, host, memory, tool] = await Promise.all(
		paths.map((path) => readFile(join(artifact.packageRoot, path), "utf8")),
	);
	if (
		!extension.includes('"memory_save"') ||
		!host.includes("makeMemorySaveTool") ||
		!memory.includes("writeMemory") ||
		!memory.includes("MEMORY_INDEX") ||
		!tool.includes("makeMemorySaveTool")
	)
		throw new Error("Core memory save implementation or public tool contract is missing");
	return { version: artifact.version, packagePaths: paths.map((path) => `vendor/plugins/pi-core/${path}`) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const artifact = await verifyPinnedCoreArtifact();
	console.log(`Pinned pi-core ${artifact.version} artifacts verified (${artifact.outputs.length} outputs)`);
}
