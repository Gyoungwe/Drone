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

test("research Wiki extension keeps legacy navigation/build/status tools unregistered", async (t) => {
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
		[],
	);
	assert.deepEqual(events, []);
});

test("research Wiki extension navigates, publishes, and records retrieval feedback", async (t) => {
	const extension = await loadBuiltExtension(t);
	const cwd = await makeWorkspace(t);
	const statusBefore = await extension.researchWikiStatus({ cwd, project: "drone" });
	assert.equal(statusBefore.configured, true);
	assert.equal(statusBefore.pages, 0);
	const built = await extension.buildResearchWikiPage({
		cwd,
		project: "drone",
		slug: "architecture-v2",
		title: "Architecture v2",
		content: "The architecture separates runtime ownership from extension policy.",
		sourceRefs: ["docs/architecture-v2-tasks.md"],
		validationQuery: "runtime ownership",
	});
	assert.equal(built.feedback.retrievable, true);
	assert.equal(built.feedback.after_rank, 1);
	const navigated = await extension.navigateResearchWiki({
		cwd,
		project: "drone",
		query: "runtime ownership",
		topK: 1,
	});
	assert.equal(navigated.hits[0].title, "Architecture v2");
	const statusAfter = await extension.researchWikiStatus({ cwd, project: "drone" });
	assert.equal(statusAfter.pages, 1);
	assert.equal(statusAfter.feedback_events, 1);
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
