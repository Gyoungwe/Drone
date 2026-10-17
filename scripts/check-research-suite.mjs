#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "..");
const packageRoot = join(root, "packages/research-suite");
const exec = promisify(execFile);
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
assert.equal(manifest.name, "@drone/research-suite");
assert.deepEqual(manifest.bundleDependencies, [
	"@drone/pi-core",
	"@drone/pi-knowledge",
	"@drone/pi-research",
]);
assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
	"@drone/pi-core",
	"@drone/pi-knowledge",
	"@drone/pi-research",
]);
assert.equal(manifest.peerDependencies["@earendil-works/pi-coding-agent"], ">=1.1.0 <2.0.0");
assert.deepEqual(manifest.pi.extensions, [
	"./node_modules/@drone/pi-core/dist/index.mjs",
	"./node_modules/@drone/pi-knowledge/dist/index.mjs",
	"./node_modules/@drone/pi-research/dist/index.mjs",
]);
for (const path of ["README.md", "prompts/research-suite.md"]) await stat(join(packageRoot, path));
for (const packageName of ["pi-core", "pi-knowledge", "pi-research"]) {
	const packageDir = join(root, "packages", packageName);
	await stat(join(packageDir, "dist/index.mjs"));
	await stat(join(packageDir, "package.json"));
}

// npm does not bundle workspace symlinks. Stage the three already-built package
// tarballs into a clean package directory, then pack the suite and assert that
// npm really embeds all dependencies. This is the same shape an external
// release job uses and does not modify the repository or publish anything.
const staging = await mkdtemp(join(tmpdir(), "drone-research-suite-gate-"));
try {
	const packageTarballs = new Map();
	const npmEnv = {
		...process.env,
		npm_config_cache: join(staging, "npm-cache"),
		npm_config_logs: join(staging, "npm-logs"),
	};
	await mkdir(npmEnv.npm_config_cache, { recursive: true });
	await mkdir(npmEnv.npm_config_logs, { recursive: true });
	for (const packageName of ["pi-core", "pi-knowledge", "pi-research"]) {
		const destination = join(staging, "packages");
		await mkdir(destination, { recursive: true });
		const packed = JSON.parse(
			(
				await exec(
					"npm",
					["pack", `./packages/${packageName}`, "--json", "--pack-destination", destination],
					{ cwd: root, env: npmEnv },
				)
			).stdout,
		);
		packageTarballs.set(packageName, join(destination, packed[0].filename));
	}
	const stagedPackage = join(staging, "suite");
	await mkdir(join(stagedPackage, "prompts"), { recursive: true });
	await writeFile(join(stagedPackage, "package.json"), await readFile(join(packageRoot, "package.json")));
	await writeFile(join(stagedPackage, "README.md"), await readFile(join(packageRoot, "README.md")));
	await writeFile(
		join(stagedPackage, "prompts/research-suite.md"),
		await readFile(join(packageRoot, "prompts/research-suite.md")),
	);
	for (const [packageName, tarball] of packageTarballs) {
		const target = join(stagedPackage, "node_modules/@drone", packageName);
		await mkdir(target, { recursive: true });
		await exec("tar", ["-xzf", tarball, "-C", target, "--strip-components=1"]);
	}
	const destination = join(staging, "suite-tarball");
	await mkdir(destination, { recursive: true });
	const packedSuite = JSON.parse(
		(
			await exec("npm", ["pack", "./suite", "--json", "--pack-destination", destination], {
				cwd: staging,
				env: npmEnv,
			})
		).stdout,
	);
	const bundled = new Set(packedSuite[0]?.bundled || []);
	for (const packageName of ["@drone/pi-core", "@drone/pi-knowledge", "@drone/pi-research"])
		assert(bundled.has(packageName), `research-suite tarball omitted bundled dependency ${packageName}`);
	console.log(`research-suite manifest gate passed (3 bundled packages, ${bundled.size} bundled entries)`);
} finally {
	await rm(staging, { recursive: true, force: true });
}
