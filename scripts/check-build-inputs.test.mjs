import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

async function failsAfterDependencyEdit(path, check) {
	const original = await readFile(path, "utf8");
	try {
		await appendFile(path, "\n// dependency drift test\n");
		const result = await check();
		assert.notEqual(result.status, 0, `${path} drift unexpectedly passed:\n${result.output}`);
	} finally {
		await writeFile(path, original, "utf8");
	}
}

test("extension build check detects transitive dependency drift", async () => {
	const outDir = await mkdtemp(join(tmpdir(), "drone-extension-inputs-"));
	try {
		const built = await runNode("scripts/build-extensions.mjs", ["--force", "--out-dir", outDir]);
		assert.equal(built.status, 0, built.output);
		await failsAfterDependencyEdit(
			join(root, "packages/extensions/src/internal/knowledge-extension.ts"),
			() => runNode("scripts/check-extensions-build.mjs", ["--out-dir", outDir]),
		);
	} finally {
		await rm(outDir, { recursive: true, force: true });
	}
});

test("knowledge, tasks and research checks detect dependency drift", async () => {
	await failsAfterDependencyEdit(join(root, "packages/knowledge/src/wiki-review.ts"), () =>
		runNode("scripts/build-knowledge-runtime.mjs", ["--check"]),
	);
	await failsAfterDependencyEdit(join(root, "packages/tasks/src/runtime/acceptance.ts"), () =>
		runNode("packages/tasks/scripts/build-runtime.mjs", ["--check"]),
	);
	await failsAfterDependencyEdit(join(root, "packages/research/src/literature-receipt.ts"), () =>
		runNode("scripts/build-research-runtime.mjs", ["--check"]),
	);
});
