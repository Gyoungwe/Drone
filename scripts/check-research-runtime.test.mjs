import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");

function runNode(script, args = []) {
	return new Promise((resolveResult, reject) => {
		const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: "pipe" });
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		child.on("error", reject);
		child.on("close", (status) => resolveResult({ status, output }));
	});
}

test("research runtime guard removes stale pre-A5 compatibility resources", async () => {
	const legacyDir = join(root, ".pi/lib");
	await mkdir(legacyDir, { recursive: true });
	await writeFile(join(legacyDir, "__stale-test-only-module.mjs"), "// stale\n", "utf8");
	try {
		const cleanup = await runNode("scripts/build-research-runtime.mjs");
		assert.equal(cleanup.status, 0, cleanup.output);
		assert.match(cleanup.output, /removed legacy research runtime resources/);
		const check = await runNode("scripts/build-research-runtime.mjs", ["--check"]);
		assert.equal(check.status, 0, check.output);
		assert.match(check.output, /package-owned/);
	} finally {
		await rm(join(root, ".pi/lib"), { recursive: true, force: true });
	}
});
