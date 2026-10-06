import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const extensionPath = resolve(import.meta.dirname, "../../../.pi/extensions/source-archive.mjs");

async function setup(t) {
	const cwd = await mkdtemp(join(tmpdir(), "drone-methods-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const runDir = join(cwd, "results", "de", "run-1");
	await mkdir(runDir, { recursive: true });
	await writeFile(join(runDir, "metadata.json"), JSON.stringify({ query: "q" }));
	const extension = await import(`${pathToFileURL(extensionPath).href}?test=${Date.now()}-${Math.random()}`);
	const tools = new Map();
	extension.default({
		events: { emit() {}, on() {} },
		on() {},
		registerTool: (tool) => tools.set(tool.name, tool),
	});
	return { cwd, runDir, tool: tools.get("research_methods") };
}

test("research_methods writes METHODS.md only after the user approves", async (t) => {
	const { cwd, runDir, tool } = await setup(t);
	assert.ok(tool, "research_methods is registered");

	const facts = await tool.execute(
		"1",
		{ run_dir: "results/de/run-1", action: "facts" },
		undefined,
		undefined,
		{ cwd },
	);
	assert.equal(facts.details.query, "q");
	assert.ok(facts.details.gaps.length > 0);

	const prompts = [];
	const decline = {
		cwd,
		hasUI: true,
		ui: { select: async (title, options) => (prompts.push(title), options[1]) },
	};
	const declined = await tool.execute(
		"2",
		{ run_dir: "results/de/run-1", action: "save", text: "Draft A" },
		undefined,
		undefined,
		decline,
	);
	assert.equal(declined.details.saved, false);
	assert.match(prompts[0], /Draft A/);
	await assert.rejects(readFile(join(runDir, "METHODS.md"), "utf8"));

	const approve = { cwd, hasUI: true, ui: { select: async (_title, options) => options[0] } };
	const saved = await tool.execute(
		"3",
		{ run_dir: "results/de/run-1", action: "save", text: "Draft B" },
		undefined,
		undefined,
		approve,
	);
	assert.equal(saved.details.saved, true);
	assert.match(await readFile(join(runDir, "METHODS.md"), "utf8"), /Draft B/);

	await assert.rejects(
		tool.execute("4", { run_dir: "results/de/run-1", action: "save", text: "x" }, undefined, undefined, {
			cwd,
			hasUI: false,
		}),
		/confirmation/,
	);
});
