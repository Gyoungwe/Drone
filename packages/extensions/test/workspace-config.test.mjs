import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const extensionPath = resolve(import.meta.dirname, "../../../.pi/extensions/workspace-config.mjs");

async function loadExtension() {
	return import(`${pathToFileURL(extensionPath).href}?test=${Date.now()}-${Math.random()}`);
}

async function makeWorkspace(t) {
	const root = await mkdtemp(join(tmpdir(), "drone-workspace-config-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const cwd = join(root, "project");
	await mkdir(cwd, { recursive: true });
	return { root, cwd, vault: join(root, "vault") };
}

function register(extension, cwd) {
	const tools = new Map();
	const commands = new Map();
	const events = [];
	extension.registerWorkspaceConfig(
		{
			events: { emit: (name, payload) => events.push({ name, payload }) },
			registerTool: (tool) => tools.set(tool.name, tool),
			registerCommand: (name, command) => commands.set(name, command),
		},
		{ cwd },
	);
	return { tools, commands, events };
}

test("workspace extension registers status, vault and summary tools", async (t) => {
	const extension = await loadExtension();
	const { cwd } = await makeWorkspace(t);
	const registered = register(extension, cwd);
	assert.deepEqual(
		[...registered.tools.keys()],
		["research_workspace_status", "research_init_vault", "research_summarize_run"],
	);
	assert.equal(registered.commands.has("research-workspace"), true);
	assert.equal(registered.tools.get("research_workspace_status").drone.readOnly, true);
	assert.equal(registered.tools.get("research_summarize_run").drone.flow, "summary");
	assert.deepEqual(
		registered.events.map(({ name, payload }) => [name, payload.name]),
		[
			["drone:tool-manifest/v1", "research_workspace_status"],
			["drone:tool-manifest/v1", "research_init_vault"],
			["drone:tool-manifest/v1", "research_summarize_run"],
		],
	);
});

test("workspace configuration keeps paths project-local and saves atomically", async (t) => {
	const extension = await loadExtension();
	const { cwd } = await makeWorkspace(t);
	const config = await extension.saveWorkspaceConfig(cwd, {
		resultsRoot: "./artifacts",
		maxConcurrentSubagents: 2,
	});
	assert.equal(config.resultsRoot, join(cwd, "artifacts"));
	const saved = JSON.parse(await readFile(join(cwd, ".pi/research-workspace.json"), "utf8"));
	assert.deepEqual(saved, {
		resultsRoot: "./artifacts",
		obsidianVault: null,
		maxConcurrentSubagents: 2,
		timezone: "Asia/Shanghai",
		knowledgeProfile: "hybrid",
		knowledgeDepositMode: "verified",
		subagentMcpPolicy: "read-local",
	});
	assert.equal((await extension.loadWorkspaceConfig(cwd)).resultsRoot, join(cwd, "artifacts"));
});

test("vault initialization and evidence-gated summary stay inside configured roots", async (t) => {
	const extension = await loadExtension();
	const { cwd, vault } = await makeWorkspace(t);
	const initialized = await extension.initializeVault(vault, "project-a", "hybrid");
	await extension.saveWorkspaceConfig(cwd, { resultsRoot: "./results", obsidianVault: initialized.vault });
	const runDir = join(cwd, "results", "topic", "run-fixture");
	await mkdir(runDir, { recursive: true });
	await writeFile(
		join(runDir, "metadata.json"),
		JSON.stringify({
			project: "project-a",
			run_id: "run-fixture",
			result_slug: "topic",
			evidence_gate: {
				stage: "answerable",
				status: "ok",
				answerable: true,
				claim_refs: ["fixture"],
				claim_bindings: [
					{ claim: "fixture", relationship: "hypothesis", limitations: "fixture only", sources: [] },
				],
			},
		}),
	);
	const tools = register(extension, cwd).tools;
	const summary = await tools
		.get("research_summarize_run")
		.execute("summary", { run_dir: runDir, summary_markdown: "# Fixture summary" }, undefined, undefined, {
			cwd,
		});
	assert.equal(summary.details.summary_saved, true);
	assert.match(await readFile(summary.details.run, "utf8"), /Fixture summary/);
	assert.match(await readFile(summary.details.obsidian_note, "utf8"), /Fixture summary/);
	assert.match(await readFile(join(initialized.vault, "Projects/Index.md"), "utf8"), /project-a/);

	const outside = join(cwd, "outside");
	await mkdir(outside);
	const escaped = join(cwd, "results", "topic", "run-outside");
	await symlink(outside, escaped);
	await assert.rejects(
		tools
			.get("research_summarize_run")
			.execute("summary", { run_dir: escaped, summary_markdown: "no" }, undefined, undefined, { cwd }),
		/escapes results root/,
	);
});

test("child Pi hosts do not receive host-only vault tools", async (t) => {
	const extension = await loadExtension();
	const { cwd } = await makeWorkspace(t);
	const previous = process.env.PI_SUBAGENT_CHILD;
	process.env.PI_SUBAGENT_CHILD = "1";
	try {
		const registered = register(extension, cwd);
		assert.deepEqual([...registered.tools.keys()], ["research_workspace_status"]);
	} finally {
		if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = previous;
	}
});
