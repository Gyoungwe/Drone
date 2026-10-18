import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	DEFAULT_FIXTURE,
	loadMainlineFixture,
	resolveCitations,
	runMainlineEval,
	validateMainlineFixture,
} from "./eval-mainline.mjs";

test("mainline fixture is exactly 20 questions with two rounds each", async () => {
	const fixture = await loadMainlineFixture(DEFAULT_FIXTURE);
	assert.equal(fixture.questions.length, 20);
	assert.ok(fixture.questions.every((question) => question.rounds.length === 2));
	assert.equal(new Set(fixture.questions.map((question) => question.id)).size, 20);
});

test("offline faux-provider evaluation has no network calls and resolves every citation", async () => {
	const outputDir = await mkdtemp(join(tmpdir(), "drone-mainline-eval-"));
	const output = join(outputDir, "report.json");
	const previousFetch = globalThis.fetch;
	try {
		const report = await runMainlineEval({ output });
		assert.equal(report.mode, "offline-faux-provider");
		assert.deepEqual(report.metrics.questions, 20);
		assert.deepEqual(report.metrics.rounds, 40);
		assert.equal(report.metrics.localHitRate, 1);
		assert.equal(report.metrics.localAnswerRate, 1);
		assert.equal(report.metrics.networkCalls, 0);
		assert.equal(report.metrics.networkToolCalls, 0);
		assert.equal(report.metrics.citationResolvableRate, 1);
		assert.equal(report.provider.calls, 80);
		assert.ok(report.metrics.elapsedMs >= 0);
		assert.equal(report.rounds.filter((round) => round.localAnswer).length, 40);
		assert.equal(JSON.parse(await readFile(output, "utf8")).metrics.networkCalls, 0);
		assert.equal(globalThis.fetch, previousFetch, "network guard must be restored after evaluation");
	} finally {
		await rm(outputDir, { recursive: true, force: true });
	}
});

test("citation resolution counts unresolved paths instead of inflating local answers", () => {
	const localIndex = new Map([["Library/ok.md", { path: "Library/ok.md" }]]);
	assert.deepEqual(resolveCitations("a [[Library/ok.md]] b [[Library/missing.md]]", localIndex), {
		citations: [
			{ path: "Library/ok.md", resolved: true },
			{ path: "Library/missing.md", resolved: false },
		],
		resolved: 1,
	});
});

test("fixture validation rejects a question that does not have exactly two rounds", async () => {
	const fixture = await loadMainlineFixture(DEFAULT_FIXTURE);
	const invalid = structuredClone(fixture);
	invalid.questions[0].rounds.pop();
	assert.throws(() => validateMainlineFixture(invalid), /must have two rounds/);
});
