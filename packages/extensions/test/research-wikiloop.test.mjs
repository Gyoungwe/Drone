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
	const outputDir = await mkdtemp(join(tmpdir(), "drone-research-wikiloop-extension-"));
	t.after(() => rm(outputDir, { recursive: true, force: true }));
	await run(
		process.execPath,
		[resolve(root, "scripts/build-extensions.mjs"), "--out-dir", outputDir, "--force"],
		{
			cwd: root,
		},
	);
	return import(pathToFileURL(join(outputDir, "research-wikiloop.mjs")));
}

async function makeWorkspace(t) {
	const rootDir = await mkdtemp(join(tmpdir(), "drone-research-wikiloop-project-"));
	t.after(() => rm(rootDir, { recursive: true, force: true }));
	const cwd = join(rootDir, "project");
	await mkdir(join(cwd, ".pi"), { recursive: true });
	await writeFile(
		join(cwd, ".pi", "research-workspace.json"),
		JSON.stringify({
			resultsRoot: "./results",
			obsidianVault: "../vault",
			maxConcurrentSubagents: 3,
			timezone: "Asia/Shanghai",
			knowledgeProfile: "hybrid",
			knowledgeDepositMode: "verified",
			subagentMcpPolicy: "read-local",
		}),
	);
	return cwd;
}

test("research Wiki extension stays self-contained and preserves its three tools", async (t) => {
	const extension = await loadBuiltExtension(t);
	await makeWorkspace(t);
	const tools = [];
	const events = [];
	extension.default({
		events: { emit: (name, payload) => events.push({ name, payload }) },
		registerTool(definition) {
			tools.push(definition);
		},
	});
	assert.deepEqual(
		tools.map((tool) => tool.name),
		["research_wiki_navigate", "research_wiki_build", "research_wiki_status"],
	);
	assert.equal(tools[0].drone.readOnly, true);
	assert.equal(tools[0].drone.recoverySafe, true);
	assert.equal(tools[1].drone.subagent, "exclude");
	assert.deepEqual(
		events.map(({ name, payload }) => [name, payload.name]),
		[
			["drone:tool-manifest/v1", "research_wiki_navigate"],
			["drone:tool-manifest/v1", "research_wiki_build"],
			["drone:tool-manifest/v1", "research_wiki_status"],
		],
	);
});

test("research Wiki extension navigates, publishes, and records retrieval feedback", async (t) => {
	const extension = await loadBuiltExtension(t);
	const cwd = await makeWorkspace(t);
	const statusTool = [];
	extension.default({ registerTool: (definition) => statusTool.push(definition) });
	const statusBefore = await statusTool[2].execute("test", { project: "drone" }, undefined, undefined, {
		cwd,
	});
	assert.equal(statusBefore.details.configured, true);
	assert.equal(statusBefore.details.pages, 0);
	const built = await statusTool[1].execute(
		"test",
		{
			project: "drone",
			slug: "architecture-v2",
			title: "Architecture v2",
			content_markdown: "The architecture separates runtime ownership from extension policy.",
			source_refs: ["docs/architecture-v2-tasks.md"],
			validation_query: "runtime ownership",
		},
		undefined,
		undefined,
		{ cwd },
	);
	assert.equal(built.details.feedback.retrievable, true);
	assert.equal(built.details.feedback.after_rank, 1);
	const navigated = await statusTool[0].execute(
		"test",
		{ project: "drone", query: "runtime ownership", top_k: 1 },
		undefined,
		undefined,
		{ cwd },
	);
	assert.equal(navigated.details.hits[0].title, "Architecture v2");
	const statusAfter = await statusTool[2].execute("test", { project: "drone" }, undefined, undefined, {
		cwd,
	});
	assert.equal(statusAfter.details.pages, 1);
	assert.equal(statusAfter.details.feedback_events, 1);
});

test("application knowledge mode keeps the legacy Wiki writer disabled", async (t) => {
	const extension = await loadBuiltExtension(t);
	const cwd = await makeWorkspace(t);
	const appDir = await mkdtemp(join(tmpdir(), "drone-knowledge-dir-"));
	t.after(() => rm(appDir, { recursive: true, force: true }));
	const prior = process.env.DRONE_KNOWLEDGE_DIR;
	process.env.DRONE_KNOWLEDGE_DIR = appDir;
	try {
		await assert.rejects(
			extension.buildResearchWikiPage({
				cwd,
				project: "drone",
				slug: "blocked",
				title: "Blocked",
				content: "content",
				sourceRefs: ["source"],
				validationQuery: "content",
			}),
			/Application Wiki changes require research_propose_wiki_update/,
		);
	} finally {
		if (prior === undefined) delete process.env.DRONE_KNOWLEDGE_DIR;
		else process.env.DRONE_KNOWLEDGE_DIR = prior;
	}
});
