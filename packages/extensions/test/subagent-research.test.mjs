import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");

async function loadBuiltExtension(t) {
	const outputDir = await mkdtemp(join(tmpdir(), "drone-subagent-extension-"));
	t.after(() => rm(outputDir, { recursive: true, force: true }));
	await run(
		process.execPath,
		[resolve(root, "scripts/build-extensions.mjs"), "--out-dir", outputDir, "--force"],
		{ cwd: root },
	);
	return import(pathToFileURL(join(outputDir, "subagent-research.mjs")));
}

test("subagent policy extension is self-contained and preserves role validation", async (t) => {
	const extension = await loadBuiltExtension(t);
	const project = await mkdtemp(join(tmpdir(), "drone-subagent-project-"));
	t.after(() => rm(project, { recursive: true, force: true }));
	await mkdir(join(project, ".pi"), { recursive: true });
	await writeFile(
		join(project, ".pi", "research-workspace.json"),
		JSON.stringify({ resultsRoot: "./results", maxConcurrentSubagents: 2 }),
	);
	const tools = [];
	const commands = [];
	extension.default({
		registerTool(definition) {
			tools.push(definition);
		},
		registerCommand(name, definition) {
			commands.push({ name, definition });
		},
	});
	assert.deepEqual(
		tools.map((tool) => tool.name),
		["research_subagent_policy"],
	);
	assert.deepEqual(
		commands.map((command) => command.name),
		["research-subagents"],
	);
	const scout = await tools[0].execute("test", { role: "scout" }, undefined, undefined, { cwd: project });
	assert.equal(scout.details.max_concurrent_subagents, 2);
	assert.equal(scout.details.run_dir_allowed, true);
	const validRun = join(project, "results", "question", "run-20261001");
	const analyst = await tools[0].execute(
		"test",
		{ role: "analyst", run_dir: validRun },
		undefined,
		undefined,
		{ cwd: project },
	);
	assert.equal(analyst.details.run_dir_allowed, true);
	await assert.rejects(
		tools[0].execute("test", { role: "analyst", run_dir: join(project, "results", "run-escape") }),
		/run_dir directly inside the configured results root/,
	);
});

test("subagent policy extension reports unknown roles", async (t) => {
	const extension = await loadBuiltExtension(t);
	const tools = [];
	extension.default({
		registerTool(definition) {
			tools.push(definition);
		},
		registerCommand() {},
	});
	await assert.rejects(tools[0].execute("test", { role: "unknown" }), /unknown research subagent role/);
});
