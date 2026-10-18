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

test("task compatibility check detects stale legacy runtime modules", async () => {
	const legacyDir = join(root, ".pi/lib/tasks");
	const stalePath = join(legacyDir, "__stale-test-only-module.mjs");
	await mkdir(legacyDir, { recursive: true });
	await writeFile(stalePath, "// stale compatibility artifact\n", "utf8");
	try {
		const result = await runNode("scripts/build-task-runtime.mjs");
		assert.equal(result.status, 0, `stale task artifact cleanup failed:\n${result.output}`);
		const check = await runNode("scripts/build-task-runtime.mjs", ["--check"]);
		assert.equal(check.status, 0, `clean task runtime unexpectedly failed:\n${check.output}`);
		assert.match(
			result.output,
			/(?:removed legacy tasks runtime resources|tasks runtime resources are package-owned)/,
		);
	} finally {
		await rm(join(root, ".pi/lib"), { recursive: true, force: true });
	}
});
