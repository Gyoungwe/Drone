import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createEventBus } from "@earendil-works/pi-coding-agent";

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
	const bus = createEventBus();
	bus.on("drone:tool-manifest/v1", (payload) => events.push({ name: "drone:tool-manifest/v1", payload }));
	const pi = {
		events: bus,
		on() {},
		getAllTools: () => [...tools.values()],
		registerTool: (tool) => tools.set(tool.name, tool),
		registerCommand: (name, command) => commands.set(name, command),
	};
	extension.registerWorkspaceConfig(pi, { cwd });
	return { tools, commands, events, pi };
}

test("workspace extension leaves summary unavailable without the research delivery owner", async (t) => {
	const extension = await loadExtension();
	const { cwd } = await makeWorkspace(t);
	const registered = register(extension, cwd);
	assert.deepEqual([...registered.tools.keys()], ["research_workspace_status", "research_init_vault"]);
	assert.equal(registered.commands.has("research-workspace"), true);
	assert.equal(registered.tools.get("research_workspace_status").drone.readOnly, true);
	assert.equal(registered.tools.has("research_summarize_run"), false);
	assert.deepEqual(
		registered.events.map(({ name, payload }) => [name, payload.name]),
		[
			["drone:tool-manifest/v1", "research_workspace_status"],
			["drone:tool-manifest/v1", "research_init_vault"],
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

test("research summary rejects a hand-written answerable gate and linked paths before writing", async (t) => {
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
	const { tools, pi } = register(extension, cwd);
	const research = await import(
		pathToFileURL(resolve(import.meta.dirname, "../../../.pi/extensions/research-loop.mjs")).href
	);
	research.default(pi);
	await assert.rejects(
		tools
			.get("research_summarize_run")
			.execute("summary", { run_dir: runDir, summary_markdown: "# Fixture summary" }, undefined, undefined, {
				cwd,
			}),
		/fresh completion/,
	);
	await assert.rejects(readFile(join(runDir, "SUMMARY.md")), { code: "ENOENT" });

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
