import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { verifyCoreMemoryArtifact, verifyPinnedCoreArtifact } from "./build-pi-core.mjs";
import { smokePinnedCore } from "./smoke-pi-core.mjs";

// Package metadata fixture, not a copy of the plugin's domain implementation.
async function artifactFixture(t) {
	const root = await mkdtemp(join(tmpdir(), "drone-core-artifact-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const packageRoot = join(root, "vendor/plugins/pi-core");
	const writeJson = (path, value) => writeFile(path, JSON.stringify(value));
	const outputs = {
		"dist/index.mjs":
			'"ask_user";"set_status";"todo";"deliver_files";"memory_save";"task_plan";"drone-doctor";"drone-example";',
		"dist/host.mjs": "export function makeMemorySaveTool() {}",
		"dist/index.d.ts": "export {};",
		"dist/host.d.ts": "export {};",
		"dist/memory.mjs": 'export const MEMORY_INDEX = "MEMORY.md"; export function writeMemory() {}',
		"dist/memory.d.ts": "export {};",
		"dist/tools/memory-save.mjs": 'export { makeMemorySaveTool } from "../index.mjs";',
		"dist/tools/memory-save.d.ts": "export {};",
	};
	for (const [path, bytes] of Object.entries(outputs)) {
		await mkdir(dirname(join(packageRoot, path)), { recursive: true });
		await writeFile(join(packageRoot, path), bytes);
	}
	await writeJson(join(root, "plugins.lock.json"), {
		plugins: [
			{ name: "@gyoungwe/pi-core", version: "0.2.0", commit: "candidate", tarballSha256: "packed-hash" },
		],
	});
	await writeJson(join(packageRoot, "package.json"), { name: "@gyoungwe/pi-core", version: "0.2.0" });
	await writeJson(join(packageRoot, "plugin.manifest.json"), { version: "0.2.0" });
	await writeJson(join(packageRoot, ".drone-fetch.json"), { commit: "candidate", sha256: "packed-hash" });
	const manifest = {
		outputs: Object.fromEntries(
			Object.entries(outputs).map(([path, bytes]) => [
				path,
				createHash("sha256").update(bytes).digest("hex"),
			]),
		),
	};
	const manifestPath = join(packageRoot, "build-manifest.json");
	await writeJson(manifestPath, manifest);
	return { root, packageRoot, manifest, manifestPath, writeJson };
}

test("core checks consume pinned artifacts without a host core source tree", async (t) => {
	const fixture = await artifactFixture(t);
	assert.equal((await verifyPinnedCoreArtifact(fixture.root)).version, "0.2.0");
	assert.equal((await smokePinnedCore(fixture.root)).tools.length, 8);
	assert.ok(
		(await verifyCoreMemoryArtifact(fixture.root)).packagePaths.every((path) =>
			path.startsWith("vendor/plugins/pi-core/dist/"),
		),
	);
});

test("core checks reject a missing lock entry and mismatched fetch receipt", async (t) => {
	const fixture = await artifactFixture(t);
	await fixture.writeJson(join(fixture.packageRoot, ".drone-fetch.json"), {
		commit: "other",
		sha256: "packed-hash",
	});
	await assert.rejects(verifyPinnedCoreArtifact(fixture.root), /source receipt differs/);
	await fixture.writeJson(join(fixture.root, "plugins.lock.json"), { plugins: [] });
	await assert.rejects(verifyPinnedCoreArtifact(fixture.root), /missing from plugins.lock/);
});

test("core checks reject runtime drift and missing public declaration files", async (t) => {
	const fixture = await artifactFixture(t);
	const hostPath = join(fixture.packageRoot, "dist/host.mjs");
	const host = await readFile(hostPath);
	await writeFile(hostPath, "// stale runtime");
	await assert.rejects(verifyPinnedCoreArtifact(fixture.root), /hash differs: dist\/host.mjs/);
	await writeFile(hostPath, host);
	await rm(join(fixture.packageRoot, "dist/host.d.ts"));
	await assert.rejects(verifyPinnedCoreArtifact(fixture.root), /ENOENT/);
});

test("core checks require declarations in the build receipt and confined output paths", async (t) => {
	const fixture = await artifactFixture(t);
	const declaration = fixture.manifest.outputs["dist/host.d.ts"];
	delete fixture.manifest.outputs["dist/host.d.ts"];
	await fixture.writeJson(fixture.manifestPath, fixture.manifest);
	await assert.rejects(verifyPinnedCoreArtifact(fixture.root), /omits public output: dist\/host.d.ts/);
	fixture.manifest.outputs["dist/host.d.ts"] = declaration;
	fixture.manifest.outputs["../outside"] = "hash";
	await fixture.writeJson(fixture.manifestPath, fixture.manifest);
	await assert.rejects(verifyPinnedCoreArtifact(fixture.root), /escapes package/);
});

test("memory acceptance rejects a hashed package that omits the save implementation", async (t) => {
	const fixture = await artifactFixture(t);
	const bytes = "export {};";
	await writeFile(join(fixture.packageRoot, "dist/memory.mjs"), bytes);
	fixture.manifest.outputs["dist/memory.mjs"] = createHash("sha256").update(bytes).digest("hex");
	await fixture.writeJson(fixture.manifestPath, fixture.manifest);
	await assert.rejects(verifyCoreMemoryArtifact(fixture.root), /memory save implementation/);
});
