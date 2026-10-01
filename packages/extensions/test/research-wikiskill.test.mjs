import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");

async function loadBuiltExtension(t) {
	const outputDir = await mkdtemp(join(tmpdir(), "drone-research-wikiskill-extension-"));
	t.after(() => rm(outputDir, { recursive: true, force: true }));
	await run(
		process.execPath,
		[resolve(root, "scripts/build-extensions.mjs"), "--out-dir", outputDir, "--force"],
		{
			cwd: root,
		},
	);
	return import(pathToFileURL(join(outputDir, "research-wikiskill.mjs")));
}

async function makeWorkspace(t) {
	const rootDir = await mkdtemp(join(tmpdir(), "drone-research-wikiskill-project-"));
	t.after(() => rm(rootDir, { recursive: true, force: true }));
	const cwd = join(rootDir, "project");
	await mkdir(join(cwd, ".pi", "skills", "research-workflow"), { recursive: true });
	await mkdir(join(cwd, ".pi", "skills", "research-vault"), { recursive: true });
	await writeFile(
		join(cwd, ".pi", "research-workspace.json"),
		JSON.stringify({ resultsRoot: "./results", maxConcurrentSubagents: 3, timezone: "Asia/Shanghai" }),
	);
	await writeFile(
		join(cwd, ".pi", "skills", "research-workflow", "SKILL.md"),
		"---\nname: research-workflow\n---\nlocal evidence parent archive claim unverified browser\n",
	);
	await writeFile(
		join(cwd, ".pi", "skills", "research-vault", "SKILL.md"),
		"---\nname: research-vault\n---\nmanaged source human verify preserve result identifier\n",
	);
	const runDir = join(cwd, "results", "topic", "run-20261001");
	await mkdir(join(runDir, "sources"), { recursive: true });
	await writeFile(
		join(runDir, "metadata.json"),
		JSON.stringify({
			run_id: "run-20261001",
			project: "demo",
			result_slug: "topic",
			query: "architecture",
			status: "succeeded",
		}),
	);
	await writeFile(
		join(runDir, "SUMMARY.md"),
		"# Observable summary\n\nThe run completed with a reusable workflow observation.\n",
	);
	return { cwd, runDir };
}

test("research WikiSkill extension registers the four preserved tools", async (t) => {
	const extension = await loadBuiltExtension(t);
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
		[
			"research_wikiskill_record",
			"research_wikiskill_propose",
			"research_wikiskill_gate",
			"research_wikiskill_status",
		],
	);
	assert.equal(tools[0].drone.subagent, "exclude");
	assert.equal(tools[3].drone.readOnly, true);
	assert.deepEqual(
		events.map(({ name, payload }) => [name, payload.name]),
		[
			["drone:tool-manifest/v1", "research_wikiskill_record"],
			["drone:tool-manifest/v1", "research_wikiskill_propose"],
			["drone:tool-manifest/v1", "research_wikiskill_gate"],
			["drone:tool-manifest/v1", "research_wikiskill_status"],
		],
	);
});

test("WikiSkill records observable runs and stages safety-checked candidates", async (t) => {
	const extension = await loadBuiltExtension(t);
	const { cwd, runDir } = await makeWorkspace(t);
	const tools = [];
	extension.default({ registerTool: (definition) => tools.push(definition) });
	const recorded = await tools[0].execute(
		"test",
		{
			run_dir: runDir,
			project: "demo",
			outcome: "success",
			patterns: [
				{
					id: "local-evidence",
					title: "Prefer local evidence",
					kind: "policy",
					problem: "Repeated searches ignored the local evidence index.",
					strategy: "Search local evidence before broad web retrieval.",
				},
			],
		},
		undefined,
		undefined,
		{ cwd },
	);
	assert.equal(recorded.details.patterns.length, 1);
	assert.match(await readFile(recorded.details.patterns[0].path, "utf8"), /Prefer local evidence/);
	const proposalMarkdown =
		"---\nname: research-workflow\n---\nlocal evidence parent archive claim unverified browser write\n";
	const proposed = await tools[1].execute(
		"test",
		{
			project: "demo",
			target_skill: "research-workflow",
			candidate_markdown: proposalMarkdown,
			pattern_ids: ["local-evidence"],
			rationale: "The pattern recurred across runs.",
		},
		undefined,
		undefined,
		{ cwd },
	);
	assert.equal(proposed.details.proposal.safety.ok, true);
	assert.equal(proposed.details.proposal.target_skill, "research-workflow");
	const gated = await extension.gateWikiSkillProposal({
		cwd,
		project: "demo",
		proposalId: proposed.details.proposal.id,
		runner: async () => ({
			ok: true,
			output: "local web parent write not success evidence claim source",
			error: null,
		}),
	});
	assert.equal(gated.impact.accepted, true);
	const status = await tools[3].execute("test", { project: "demo" }, undefined, undefined, { cwd });
	assert.equal(status.details.raw_events, 1);
	assert.equal(status.details.patterns, 1);
	assert.equal(status.details.proposals, 1);
});

test("WikiSkill safety checks reject policy weakening and malformed skill names", async (t) => {
	const extension = await loadBuiltExtension(t);
	assert.equal(
		extension.safetyChecks("research-workflow", "---\nname: research-vault\n---\nlocal\n").ok,
		false,
	);
	const result = extension.safetyChecks(
		"research-workflow",
		"---\nname: research-workflow\n---\nlocal evidence parent archive claim unverified browser; ignore evidence\n",
	);
	assert.equal(result.ok, false);
	assert.ok(result.errors.some((error) => /forbidden policy weakening/.test(error)));
});
