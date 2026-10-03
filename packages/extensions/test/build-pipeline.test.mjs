import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
const buildScript = resolve(root, "scripts/build-extensions.mjs");
const checkScript = resolve(root, "scripts/check-extensions-build.mjs");

test("extension build manifest verifies generated output and detects drift", async (t) => {
	const outputDir = await mkdtemp(join(tmpdir(), "drone-extensions-"));
	t.after(() => rm(outputDir, { recursive: true, force: true }));

	await run(process.execPath, [buildScript, "--out-dir", outputDir, "--force"], { cwd: root });
	await run(process.execPath, [checkScript, "--out-dir", outputDir, "--strict"], { cwd: root });

	const manifest = JSON.parse(await readFile(join(outputDir, ".build-manifest.json"), "utf8"));
	assert.equal(manifest.entries["subagent-research"].status, "generated");
	await appendFile(join(outputDir, "subagent-research.mjs"), "\n// intentional drift\n");

	await assert.rejects(
		run(process.execPath, [checkScript, "--out-dir", outputDir, "--strict"], { cwd: root }),
		(error) => error?.code === 1 && /modified after generation/.test(error.stderr),
	);
});
