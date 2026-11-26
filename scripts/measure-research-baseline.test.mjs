import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";
import { measureResearchBaseline } from "./measure-research-baseline.mts";

const root = resolve(import.meta.dirname, "..");
const entry = join(import.meta.dirname, "measure-research-baseline.mts");
const fixture = join(root, "fixtures/research-wiring-baseline.json");
const fixtureData = JSON.parse(await readFile(fixture, "utf8"));
const categories = ["local-direct", "deep-research", "stall-loop", "external-write"];
const run = promisify(execFile);
const live = { mode: "live-sdk", provider: "fixture-provider", model: "fixture-model", thinking: "low" };

async function scratch(context) {
	const path = await mkdtemp(join(root, ".t507-test-"));
	context.after(() => rm(path, { recursive: true, force: true }));
	return path;
}

test("offline CLI writes a pinned v1 report from four faux SDK sessions", async (context) => {
	const out = join(await scratch(context), "report.json");
	await run(process.execPath, [entry, "--mode", "offline-faux", "--fixture", fixture, "--out", out]);
	const report = JSON.parse(await readFile(out, "utf8"));
	const skill = await readFile(join(root, ".pi/skills/research-workflow/SKILL.md"));
	assert.equal(report.kind, "drone.research.baseline");
	assert.equal(report.schemaVersion, 1);
	assert.equal(report.mode, "offline-faux");
	assert.ok(report.runId);
	assert.equal(new Date(report.generatedAt).toISOString(), report.generatedAt);
	assert.match(report.repoState.droneCommit, /^[a-f0-9]{40}$/);
	assert.match(report.repoState.pluginsCommit, /^[a-f0-9]{40}$/);
	assert.equal(report.repoState.piSdkVersion, "1.1.0");
	assert.equal(report.repoState.researchSkillSha256, createHash("sha256").update(skill).digest("hex"));
	assert.equal(report.repoState.researchSkillBytes, skill.byteLength);
	assert.deepEqual(report.toolSet, [...fixtureData.toolSet].sort());
	assert.equal(report.replaySummary, null);
	assert.deepEqual(
		report.scenarios.map((scenario) => scenario.scenarioId),
		categories,
	);
	assert.deepEqual(Object.keys(report.aggregate), categories);
	const [local, deep, stall, externalWrite] = report.scenarios;
	assert.equal(local.steps.externalCalls, 0);
	assert.equal(local.approvals.requested, 0);
	assert.equal(local.evidence.verifiedCitationCount, 2);
	assert.equal(deep.steps.externalCalls, 1);
	assert.equal(deep.evidence.gateStage, "answerable");
	assert.equal(deep.evidence.originalSourceRead, true);
	assert.equal(stall.stop.reason, "publication-tool-limit");
	assert.equal(stall.evidence.answerable, false);
	assert.deepEqual(externalWrite.approvals, {
		requested: 1,
		approved: 0,
		denied: 1,
		writeEffectsAttempted: 0,
		unexpectedWriteRequests: 0,
	});
	for (const scenario of report.scenarios) {
		assert.equal(scenario.evidence.scientificallyVerified, false);
		assert.deepEqual(scenario.tokens, {
			firstTurnInput: null,
			cumulativeInput: null,
			cumulativeOutput: null,
			cacheRead: null,
			cacheWrite: null,
			reasoning: null,
			billedTotal: null,
			usageReported: false,
			reportedFields: [],
			unknownUsageSteps: scenario.steps.llmTurns,
		});
		assert.ok(scenario.tokens.unknownUsageSteps > 0);
		assert.equal(report.aggregate[scenario.category].meanCumulativeInputTokens, null);
	}
});

function observation(overrides = {}) {
	return {
		contextWindow: 128_000,
		toolSet: fixtureData.toolSet,
		toolCalls: [],
		usage: [null],
		evidence: {
			gateStage: "not-started",
			answerable: false,
			citationCount: 0,
			verifiedCitationCount: 0,
			originalSourceRead: false,
		},
		routeObserved: "unrouted",
		stopReason: "completed",
		elapsedMs: 1,
		writeEffectsAttempted: 0,
		...overrides,
	};
}

test("mocked live mode keeps measured zeros, nulls incomplete totals, and flags unexpected deposits", async (context) => {
	const directory = await scratch(context);
	const out = join(directory, "live.json");
	const visited = [];
	const report = await measureResearchBaseline({ ...live, out }, async (scenario, config) => {
		visited.push(scenario.id);
		assert.deepEqual(config, {
			mode: live.mode,
			provider: live.provider,
			model: live.model,
			thinkingLevel: "low",
		});
		if (scenario.id === "local-direct") {
			return observation({
				toolCalls: ["research_deposit_research_note"],
				usage: [
					{ input: 0, output: 4, cacheRead: 11, cacheWrite: 2 },
					{ input: 10, output: 9, cacheRead: 0, cacheWrite: 1, reasoning: 3 },
				],
			});
		}
		return observation({ usage: [{ input: 7 }, null] });
	});
	assert.deepEqual(visited, categories);
	assert.equal(report.mode, "live-sdk");
	assert.deepEqual(report.modelConfig, {
		provider: live.provider,
		model: live.model,
		thinkingLevel: "low",
		contextWindow: 128_000,
		evapMode: "off",
	});
	assert.deepEqual(JSON.parse(await readFile(out, "utf8")), report);
	const [local, deep] = report.scenarios;
	assert.equal(local.tokens.firstTurnInput, 0);
	assert.equal(local.tokens.billedTotal, 26);
	assert.equal(local.tokens.reasoning, null);
	assert.equal(local.approvals.denied, 1);
	assert.equal(local.approvals.unexpectedWriteRequests, 1);
	assert.equal(report.aggregate["local-direct"].unexpectedWriteRequests, 1);
	assert.deepEqual(deep.tokens, {
		firstTurnInput: 7,
		cumulativeInput: null,
		cumulativeOutput: null,
		cacheRead: null,
		cacheWrite: null,
		reasoning: null,
		billedTotal: null,
		usageReported: true,
		reportedFields: ["input"],
		unknownUsageSteps: 1,
	});
});

test("replay summaries project aggregate fields without replay session paths", async (context) => {
	const directory = await scratch(context);
	const replay = join(directory, "replay.json");
	await writeFile(
		replay,
		JSON.stringify({
			config: { name: "mono-p8k-t60-w128k" },
			aggregate: {
				sessions: 4,
				sessionsT1: 3,
				sessionsT2: 2,
				sessionsT3: 1,
				cacheWriteMeanPerStep: 14.5,
				plateauSlopeRatio: null,
			},
			sessions: [{ file: "private/session.jsonl" }],
		}),
	);
	const report = await measureResearchBaseline(
		{ ...live, out: join(directory, "baseline.json"), "replay-summary": replay },
		async () => observation(),
	);
	assert.deepEqual(report.replaySummary, {
		config: "mono-p8k-t60-w128k",
		sessions: 4,
		t1Sessions: 3,
		t2Sessions: 2,
		t3Sessions: 1,
		cacheWriteMeanPerStep: 14.5,
		plateauSlopeRatio: null,
	});
});

test("invalid scenarios fail before dispatch or output creation", async (context) => {
	const directory = await scratch(context);
	const invalidFixture = join(directory, "fixture.json");
	const out = join(directory, "report.json");
	const options = { ...live, fixture: invalidFixture, out };
	const runner = async () => assert.fail("an invalid scenario was dispatched");
	const invalid = structuredClone(fixtureData);
	invalid.scenarios[0].files["../escape.md"] = "outside the workspace";
	await writeFile(invalidFixture, JSON.stringify(invalid));
	await assert.rejects(measureResearchBaseline(options, runner), /Invalid scenario fixture/);
	const duplicate = structuredClone(fixtureData);
	duplicate.scenarios[0].id = "stall-loop";
	await writeFile(invalidFixture, JSON.stringify(duplicate));
	await assert.rejects(measureResearchBaseline(options, runner), /Invalid scenario order or ID/);
	await assert.rejects(readFile(out), { code: "ENOENT" });
});

test("invalid scenario output never publishes a partial report", async (context) => {
	const out = join(await scratch(context), "report.json");
	await assert.rejects(
		measureResearchBaseline({ ...live, out }, async (scenario) =>
			observation(scenario.id === "deep-research" ? { writeEffectsAttempted: 1 } : {}),
		),
		/Invalid output for deep-research/,
	);
	await assert.rejects(readFile(out), { code: "ENOENT" });
});

test("existing output is preserved", async (context) => {
	const out = join(await scratch(context), "report.json");
	await writeFile(out, "previous report\n");
	await assert.rejects(
		measureResearchBaseline({ ...live, out }, async () => observation()),
		{ code: "EEXIST" },
	);
	assert.equal(await readFile(out, "utf8"), "previous report\n");
});
