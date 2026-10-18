import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
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
	const stalePath = join(root, ".pi/lib/tasks/__stale-test-only-module.mjs");
	await writeFile(stalePath, "// stale compatibility artifact\n", "utf8");
	try {
		const result = await runNode("scripts/build-task-runtime.mjs", ["--check"]);
		assert.notEqual(result.status, 0, `stale task artifact unexpectedly passed:\n${result.output}`);
		assert.match(result.output, /__stale-test-only-module\.mjs/);
	} finally {
		await rm(stalePath, { force: true });
	}
});
