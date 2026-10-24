// Stage the official Node runtime after checking the committed release archive digest.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const resources = join(root, "packages/desktop/plugin-runtime");
const lock = JSON.parse(readFileSync(join(resources, "lock.json"), "utf8"));
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
export async function stagePluginRuntime(platform = process.platform, arch = process.arch, check = false) {
	const target = `${platform}-${arch}`;
	const digest = lock.archives[target];
	assert(digest, `Unsupported plugin runtime target: ${target}`);
	const dest = join(resources, target);
	const binary = join(dest, platform === "win32" ? "node.exe" : "node");
	const marker = join(dest, "runtime.json");
	const schemaSource = join(root, "node_modules/typebox");
	const schemaVersion = JSON.parse(readFileSync(join(schemaSource, "package.json"), "utf8")).version;
	assert.equal(schemaVersion, "1.3.7", "Pi schema peer must match the locked SDK family");
	if (!check) cpSync(schemaSource, join(dest, "schema"), { recursive: true });
	assert(existsSync(join(dest, "schema/build/index.mjs")), "Plugin schema peer is not staged");
	if (existsSync(marker)) {
		const receipt = JSON.parse(readFileSync(marker, "utf8"));
		if (
			receipt.version === lock.version &&
			receipt.archiveSha256 === digest &&
			existsSync(binary) &&
			sha(binary) === receipt.binarySha256
		)
			return dest;
	}
	assert(!check, `Plugin runtime missing or stale: ${target}`);
	const temp = mkdtempSync(join(tmpdir(), "drone-node-stage-"));
	try {
		const prefix = `node-v${lock.version}-${platform === "win32" ? "win" : platform}-${arch}`;
		const ext = platform === "win32" ? "zip" : "tar.gz";
		const response = await fetch(`https://nodejs.org/dist/v${lock.version}/${prefix}.${ext}`);
		assert(response.ok, `Node download HTTP ${response.status}`);
		const archive = join(temp, `runtime.${ext}`);
		writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
		assert.equal(sha(archive), digest, "Node release archive digest mismatch");
		if (platform === "win32") execFileSync("tar", ["-xf", archive, "-C", temp]);
		else execFileSync("tar", ["-xzf", archive, "-C", temp]);
		mkdirSync(dest, { recursive: true });
		copyFileSync(join(temp, prefix, platform === "win32" ? "node.exe" : "bin/node"), binary);
		chmodSync(binary, 0o755);
		copyFileSync(join(temp, prefix, "LICENSE"), join(dest, "LICENSE"));
		writeFileSync(
			marker,
			`${JSON.stringify(
				{ version: lock.version, target, archiveSha256: digest, binarySha256: sha(binary) },
				null,
				2,
			)}\n`,
		);
		return dest;
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}
if (import.meta.url === pathToFileURL(process.argv[1]).href)
	console.log(await stagePluginRuntime(process.platform, process.arch, process.argv.includes("--check")));
