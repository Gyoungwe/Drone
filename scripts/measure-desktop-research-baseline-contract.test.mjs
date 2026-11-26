import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { Create } from "typebox/value";
import * as c from "./measure-desktop-research-baseline-contract.mts";
import * as fx from "./measure-desktop-research-baseline-fixture.mts";
import { readJson, saveReport, sha256, tokensFor } from "./research-baseline-io.mts";

const ref = (name) => `\${${name}}`;
const data = JSON.parse(
	await readFile(new URL("../fixtures/research-desktop-baseline.json", import.meta.url), "utf8"),
);
async function scratch(context) {
	const directory = await mkdtemp(join(tmpdir(), "T564-desktop-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}
async function prepared(context, index = 1) {
	return fx.prepareDesktopFixture(await scratch(context), c.validateDesktopFixture(data).scenarios[index]);
}

test("v2 fixture pins ten tools, four scenarios and nested line-2 bindings", () => {
	const fixture = c.validateDesktopFixture(data);
	assert.deepEqual(fixture.toolSet, [...c.toolNames]);
	assert.equal(fixture.scenarios.length, 4);
	for (const scenario of fixture.scenarios) {
		assert.equal(scenario.fauxRepeat, 1);
		assert.ok(scenario.finalDraft);
	}
	const binding = fixture.scenarios[0].fauxCalls.find(({ input }) => input.action === "complete").input
		.claim_bindings[0];
	assert.equal(binding.sources[0].start_line, 2);
	assert.equal(binding.sources[0].end_line, 2);
});

test("invalid paths, identity, tools, quotes and unknown refs fail before report creation", async (context) => {
	const out = join(await scratch(context), "report.json");
	const mutations = [
		(f) => Object.assign(f.scenarios[0].files, { "../escape.md": "escape" }),
		(f) => Object.assign(f.scenarios[0].files, { "vault/Wiki/../../escape.md": "escape" }),
		(f) => Object.assign(f.scenarios[0].files, { "/tmp/escape.md": "escape" }),
		(f) => Object.assign(f.toolSet, { 0: "bash" }),
		(f) => Object.assign(f.scenarios[0].fauxCalls[0], { name: "research_setup_obsidian" }),
		(f) => Object.assign(f.scenarios[0].identities.ABCDEFGH, { doi: "10.1038/fixtureb" }),
		(f) => Object.assign(f.scenarios[0].identities, { IJKLMNOP: f.scenarios[0].identities.ABCDEFGH }),
		(f) => Object.assign(f.scenarios[0].files, { "vault/Library/Papers/amberwing-north.md": "changed" }),
		(f) => Object.assign(f.scenarios[0].fauxCalls[6].input, { zotero_key: "IJKLMNOP" }),
		(f) =>
			Object.assign(f.scenarios[0].fauxCalls[8].input.claim_bindings[0].sources[0], { quote: "invented" }),
		(f) => Object.assign(f.scenarios[1].fauxCalls[4].input, { run_dir: ref("details.run_dir") }),
		(f) => Object.assign(f.scenarios[1].fauxCalls[4].input, { run_dir: `${ref("runDir")}/../../escape` }),
		(f) =>
			f.scenarios[0].fauxCalls.unshift({ name: "research_source_status", input: { run_dir: ref("runDir") } }),
		(f) => Object.assign(f.scenarios[0], { id: "stall-loop" }),
	];
	for (const mutate of mutations) {
		const fixture = structuredClone(data);
		mutate(fixture);
		await assert.rejects(async () => {
			await saveReport(out, c.validateDesktopFixture(fixture));
		});
		await assert.rejects(readFile(out), { code: "ENOENT" });
	}
});

test("finite references require successful start/helper details and contained real paths", async (context) => {
	const fixture = await prepared(context),
		refs = c.createResultReferences(fixture.resultsRoot);
	assert.throws(() => refs.resolve(ref("runDir")), /Missing/);
	assert.throws(() => c.resolveReferences(ref("runDir.path"), new Map()), /Unknown/);
	const run = join(fixture.resultsRoot, "winterglass/run-actual");
	await mkdir(run, { recursive: true });
	const call = { name: "research_loop", input: { action: "start" } };
	const details = { run_dir: run, metadata: { status: "running" }, evidence_gate: { stage: "created" } };
	await refs.observe(call, { isError: true, details });
	assert.throws(() => refs.resolve(ref("runDir")), /Missing/);
	await refs.observe(call, { isError: false, details });
	const acquired = await fx.acquireFixtureArchive(fixture, run, "winterglass calibration");
	await refs.observe(
		{ name: "baseline_search_external", input: { run_dir: run } },
		{ isError: false, details: acquired },
	);
	assert.deepEqual(refs.resolve({ path: ref("archiveFirstPath"), run_dir: ref("runDir") }), {
		path: acquired.archiveFirstPath,
		run_dir: run,
	});
	assert.throws(
		() =>
			c.validateResolvedInput(
				"read",
				{ path: acquired.archiveFirstPath },
				Type.Object({ path: Type.Number() }),
			),
		/Invalid/,
	);
	assert.throws(() => c.validateResolvedInput("bash", {}, Type.Object({})), /allowlist/);
	await assert.rejects(
		refs.observe(call, { isError: false, details: { ...details, run_dir: fixture.vault } }),
		/outside/,
	);
	const link = join(fixture.resultsRoot, "linked");
	await symlink(fixture.vault, link);
	await assert.rejects(
		refs.observe(call, { isError: false, details: { ...details, run_dir: link } }),
		/outside|symbolic/,
	);
});

test("fixture setup leaves sibling roots and no successful runtime receipts", async (context) => {
	const fixture = await prepared(context, 0);
	assert.equal(resolve(fixture.workspace, ".."), resolve(fixture.vault, ".."));
	assert.equal(resolve(fixture.app, ".."), resolve(fixture.vault, ".."));
	assert.deepEqual(await readdir(fixture.app), []);
	assert.deepEqual(await readdir(fixture.resultsRoot), []);
	assert.deepEqual(await readJson(join(fixture.workspace, ".pi/research-workspace.json")), {
		resultsRoot: fixture.resultsRoot,
		knowledgeProjectId: "baseline-project",
	});
	assert.equal(fixture.resources.length, 9);
	for (const resource of fixture.resources)
		assert.equal(sha256(await readFile(resource.path)), resource.sha256);
	await assert.rejects(fx.setupDesktopFixture(fixture), /Ticket B/);
	let setups = 0;
	await fx.setupDesktopFixture(fixture, async (request) => {
		setups++;
		assert.deepEqual(request.input, {
			path: fixture.vault,
			project: "baseline-project",
			profile: "hybrid",
			deposit_mode: "verified",
			subagent_mcp: "none",
		});
		return { vault: fixture.vault, project: "baseline-project", bindingRevision: 1, indexReady: true };
	});
	assert.equal(setups, 1);
	await assert.rejects(
		fx.setupDesktopFixture(fixture, async () => ({
			vault: fixture.workspace,
			project: "wrong",
			bindingRevision: 0,
			indexReady: false,
		})),
		/Invalid/,
	);
});

test("fixture-copy archive uses actual hashes/sizes and rejects altered bytes and links", async (context) => {
	const fixture = await prepared(context),
		run = join(fixture.resultsRoot, "winterglass/run-actual");
	await mkdir(run, { recursive: true });
	assert.deepEqual(await readdir(run), []);
	const acquired = await fx.acquireFixtureArchive(fixture, run, "winterglass calibration");
	const manifest = await readJson(join(run, "sources/download-manifest.json"));
	assert.equal(manifest.version, 1);
	assert.equal(acquired.acquisition, "fixture-copy");
	for (const item of manifest.items) {
		const bytes = await readFile(item.path);
		assert.equal(item.sha256, sha256(bytes));
		assert.equal(item.size_bytes, bytes.byteLength);
		assert.equal(item.status, "downloaded");
	}
	await fx.assertFixtureArchive(fixture, run);
	await fx.assertFixtureRead(fixture, acquired.archiveFirstPath, run);
	await assert.rejects(
		fx.assertFixtureRead(fixture, join(fixture.vault, "Wiki/calibration-inventory.md"), run),
		/read/,
	);
	await assert.rejects(
		fx.acquireFixtureArchive(fixture, fixture.vault, "winterglass calibration"),
		/outside/,
	);
	await assert.rejects(fx.acquireFixtureArchive(fixture, run, "unknown"), /query/);
	await writeFile(manifest.items[0].path, "altered");
	await assert.rejects(fx.assertFixtureArchive(fixture, run), /bytes|hash/);
	await writeFile(manifest.items[0].path, fixture.scenario.files["sources/archive/winterglass-first.md"]);
	manifest.items[0].size_bytes++;
	await writeFile(join(run, "sources/download-manifest.json"), JSON.stringify(manifest));
	await assert.rejects(fx.assertFixtureArchive(fixture, run), /size/);
	manifest.items[0].size_bytes--;
	manifest.items[0].path = join(fixture.vault, "Wiki/calibration-inventory.md");
	await writeFile(join(run, "sources/download-manifest.json"), JSON.stringify(manifest));
	await assert.rejects(fx.assertFixtureArchive(fixture, run), /path|outside/);
	const second = join(fixture.resultsRoot, "winterglass/run-linked");
	await mkdir(second);
	await symlink(fixture.vault, join(second, "sources"));
	await assert.rejects(
		fx.acquireFixtureArchive(fixture, second, "winterglass calibration"),
		/outside|symbolic/,
	);
});
test("report validates native budget provenance, offline nulls and denial invariants", async (context) => {
	const receipt = {
		id: "observed-stall",
		reason: "stalled",
		limitKind: "stall",
		limits: { maxBilledTokens: 500000 },
		measured: { steps: 7 },
	};
	const scenarios = c.categories.map((scenarioId) => ({
		...Create(Type.Omit(c.observationSchema, ["toolSet"])),
		scenarioId,
		toolSet: [...c.toolNames],
		usage: [null],
		tokens: tokensFor([null]),
		cost: null,
	}));
	scenarios[2].stop = { reason: "stalled", breakerReceipt: receipt };
	const report = {
		...Create(Type.Omit(c.reportSchema, ["toolSet", "assembly", "scenarios", "modelConfig"])),
		toolSet: [...c.toolNames],
		scenarios,
		assembly: {
			artifacts: c.artifactNames.map((name) => ({ path: `.pi/extensions/${name}`, sha256: "0".repeat(64) })),
			resources: [{ path: "SKILL.md", sha256: "0".repeat(64) }],
		},
		modelConfig: {
			provider: "faux",
			model: "faux-1",
			thinkingLevel: "off",
			contextWindow: 1,
			baseUrl: null,
			breakerBudget: { maxBilledTokens: 500000 },
			budgetEvidence: structuredClone(receipt),
		},
	};
	assert.equal(c.validateDesktopReport(report), report);
	assert.throws(() => c.validateDesktopObservation({ toolSet: ["bash"] }), /Invalid/);
	const out = join(await scratch(context), "invalid.json");
	const mutations = [
		(r) => Object.assign(r.scenarios[0].toolSet, { 0: "bash" }),
		(r) => Object.assign(r.modelConfig.budgetEvidence.limits, { maxBilledTokens: 1 }),
		(r) => Object.assign(r.modelConfig.budgetEvidence, { id: "unobserved" }),
		(r) => r.scenarios[0].usage.push({ input: 1 }),
		(r) => Object.assign(r.scenarios[0], { cost: 0 }),
		(r) => Object.assign(r.scenarios[0].approvals, { depositExecuteEntered: 1 }),
		(r) => Object.assign(r.scenarios[0].approvals, { requested: 1, denied: 0 }),
		(r) => Object.assign(r.scenarios[0].publication, { published: true, rejected: true }),
	];
	for (const mutate of mutations) {
		const invalid = structuredClone(report);
		mutate(invalid);
		await assert.rejects(async () => {
			await saveReport(out, c.validateDesktopReport(invalid));
		});
		await assert.rejects(readFile(out), { code: "ENOENT" });
	}
});
