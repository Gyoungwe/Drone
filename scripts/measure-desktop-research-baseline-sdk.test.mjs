import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	runFixtureChild,
	serveFixtureChild,
	withDesktopFixture,
} from "./measure-desktop-research-baseline.mts";
import {
	containedRealPath,
	toolNames,
	validateDesktopFixture,
	validateDesktopReport,
} from "./measure-desktop-research-baseline-contract.mts";
import { offlineModel } from "./measure-desktop-research-baseline-faux.mts";
import { installFixtureFetch } from "./measure-desktop-research-baseline-fixture.mts";
import {
	gatewayFetch,
	scenarioRuntime,
	withLiveConfig,
} from "./measure-desktop-research-baseline-provider.mts";
import { createDesktopSession, loadDesktopAssembly } from "./measure-desktop-research-baseline-sdk.mts";

const fixture = "fixtures/research-desktop-baseline.json";
const cli = "scripts/measure-desktop-research-baseline.mts";

function toolReply(ai, name, args) {
	return ai.fauxAssistantMessage([ai.fauxToolCall(name, args)], { stopReason: "toolUse" });
}

function usageModel(ai, fixture, boundary) {
	const setup = offlineModel(ai, []);
	const samples = boundary === "budget-exceeded" ? [499999, 1] : [null, 1];
	const messages = [
		toolReply(ai, "research_loop", {
			action: "start",
			mode: "deep_research",
			query: "Synthetic usage boundary",
			result_slug: "budget",
		}),
		ai.fauxAssistantMessage("The synthetic usage check finished."),
	];
	const observed = { beforeBoundary: null };
	function stream(model, context) {
		const output = ai.createAssistantMessageEventStream();
		const message = messages.shift();
		const input = samples.shift();
		if (!message || input === undefined) throw new Error("Unexpected boundary provider call");
		const send = async () => {
			if (input === 1) {
				const metadata = await readNativeRun(fixture, context.messages);
				observed.beforeBoundary = {
					status: metadata.status,
					billedTokens: metadata.slow_path.measured.billedTokens,
				};
			}
			const reply = {
				...message,
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: { ...message.usage, reported: input !== null, input: input ?? 0, totalTokens: input ?? 0 },
			};
			output.push({ type: "done", reason: reply.stopReason, message: reply });
		};
		void send().catch(() =>
			output.push({ type: "error", reason: "error", error: { ...message, stopReason: "error" } }),
		);
		return output;
	}
	return { model: { ...setup, provider: { ...setup.provider, stream, streamSimple: stream } }, observed };
}

async function readNativeRun(fixture, messages) {
	const started = messages.find(
		(message) => message.role === "toolResult" && message.toolName === "research_loop" && !message.isError,
	);
	const runDir = await containedRealPath(fixture.resultsRoot, started?.details?.run_dir);
	return JSON.parse(await readFile(join(runDir, "metadata.json"), "utf8"));
}

function repeatedModel(ai, fixture) {
	return offlineModel(ai, [
		toolReply(ai, "research_loop", {
			action: "start",
			mode: "deep_research",
			query: "Synthetic repeat boundary",
			result_slug: "repeat",
		}),
		toolReply(ai, "research_loop", { action: "record_local", query: "Synthetic repeat boundary" }),
		...Array.from({ length: 3 }, () =>
			toolReply(ai, "read", { path: join(fixture.workspace, "missing.md") }),
		),
		ai.fauxAssistantMessage("The synthetic record is still unavailable."),
	]);
}

async function probeBreaker(fixture) {
	const guard = installFixtureFetch(fixture.identities);
	try {
		const [sdk, ai, knowledge] = await Promise.all([
			import("@earendil-works/pi-coding-agent"),
			import("@earendil-works/pi-ai"),
			import("@gyoungwe/pi-knowledge/host"),
		]);
		const reason =
			fixture.scenario.id === "stall-loop"
				? "repeated-tool-loop"
				: fixture.scenario.id === "local-direct"
					? "budget-exceeded"
					: "quota-unconfirmable";
		const { model, observed } =
			reason === "repeated-tool-loop"
				? { model: repeatedModel(ai, fixture), observed: null }
				: usageModel(ai, fixture, reason);
		const assembly = await loadDesktopAssembly(sdk, fixture);
		const session = await createDesktopSession(sdk, fixture, assembly, ["research_loop", "read"], model);
		try {
			await session.bindExtensions({});
			await session.prompt("Check the synthetic interruption boundary.");
			const metadata = await readNativeRun(fixture, session.messages);
			return { status: metadata.status, receipt: metadata.breaker_receipt, observed };
		} finally {
			try {
				session.dispose();
			} finally {
				await knowledge.closeKnowledgeServices();
			}
		}
	} finally {
		try {
			guard.assertClean();
		} finally {
			guard.restore();
		}
	}
}

function breakerTests() {
	for (const [scenarioId, reason, limitKind] of [
		["local-direct", "budget-exceeded", "tokens"],
		["deep-research", "quota-unconfirmable", "unknown-quota"],
		["stall-loop", "repeated-tool-loop", "repeats"],
	])
		test(`loaded Desktop breaker preserves ${reason}`, async () => {
			const scenarios = validateDesktopFixture(JSON.parse(await readFile(fixture, "utf8"))).scenarios;
			const scenario = scenarios.find(({ id }) => id === scenarioId);
			const result = await withDesktopFixture(scenario, (prepared) =>
				runFixtureChild(prepared, import.meta.filename),
			);
			assert.equal(result.status, "stopped_by_breaker");
			assert.equal(result.receipt.reason, reason);
			assert.equal(result.receipt.limitKind, limitKind);
			assert.equal(result.receipt.limits.maxBilledTokens, 500000);
			if (reason === "budget-exceeded") {
				assert.deepEqual(result.observed.beforeBoundary, { status: "running", billedTokens: 499999 });
				assert.equal(result.receipt.measured.billedTokens, 500000);
			}
			if (reason === "quota-unconfirmable") {
				assert.equal(result.receipt.measured.usageReported, false);
				assert.equal(result.receipt.measured.unknownUsageSteps, 1);
			}
		});
}

async function assertScenarioReport() {
	const directory = await mkdtemp(join(tmpdir(), "desktop-report-test-"));
	try {
		const out = join(directory, "report.json");
		const args = [cli, "--mode", "offline-faux", "--fixture", fixture, "--out", out];
		execFileSync(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"] });
		const bytes = await readFile(out, "utf8");
		const report = validateDesktopReport(JSON.parse(bytes));
		assert.deepEqual(report.toolSet, [...toolNames]);
		assert.equal(report.modelConfig.baseUrl, null);
		assert.equal(report.policy.breakerUsageSource, "sdk-faux-estimate");
		const scenarios = validateDesktopFixture(JSON.parse(await readFile(fixture, "utf8"))).scenarios;
		const [local, deep, stall, write] = report.scenarios;
		for (const [index, scenario] of report.scenarios.entries()) {
			assert.equal(scenario.routeObserved, "deep_research");
			assert.deepEqual(
				scenario.toolCalls,
				scenarios[index].fauxCalls.map(({ name }) => name),
			);
			assert.equal(scenario.expectationMatched, true);
			assert.equal(scenario.cost, null);
			assert.equal(scenario.tokens.billedTotal, null);
			assert.equal(scenario.evidence.scientificallyVerified, false);
			assert.equal(scenario.networkViolations, 0);
		}
		for (const scenario of [local, deep, write]) {
			assert.equal(scenario.runStatus, "completed");
			assert.equal(scenario.evidence.gateStage, "answerable");
			assert.equal(scenario.evidence.answerable, true);
			assert.equal(scenario.evidence.boundSourceCount, 2);
			assert.equal(scenario.preflight.checked, true);
			assert.notEqual(scenario.publication.published, scenario.publication.rejected);
		}
		assert.equal(local.evidence.identityVerifiedNoteCount, 2);
		assert.equal(write.evidence.identityVerifiedNoteCount, 2);
		assert.equal(deep.evidence.archiveVerifiedCount, 2);
		assert.equal(deep.evidence.archivedTextRead, true);
		assert.equal(deep.evidence.publicationCheckedVaultCitationCount, 0);
		assert.equal(stall.runStatus, "stopped_by_breaker");
		assert.equal(stall.evidence.gateStage, "local_query_recorded");
		assert.equal(stall.evidence.gateStatus, "failed");
		assert.equal(stall.evidence.answerable, false);
		assert.equal(stall.evidence.boundSourceCount, 0);
		assert.equal(stall.stop.reason, "stalled");
		assert.equal(stall.stop.breakerReceipt.limitKind, "stall");
		assert.equal(stall.stop.breakerReceipt.limits.maxBilledTokens, 500000);
		assert.deepEqual(report.modelConfig.budgetEvidence, stall.stop.breakerReceipt);
		assert.equal(write.stop.reason, "completed-with-write-denied");
		assert.deepEqual(write.approvals, {
			requested: 1,
			denied: 1,
			approved: 0,
			depositExecuteEntered: 0,
			vaultUnchanged: true,
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function assertNoOverwrite() {
	const directory = await mkdtemp(join(tmpdir(), "desktop-existing-report-test-"));
	try {
		const out = join(directory, "report.json");
		const bytes = "Existing report bytes\n";
		await writeFile(out, bytes, { flag: "wx" });
		const args = [cli, "--mode", "offline-faux", "--fixture", fixture, "--out", out];
		assert.throws(() => execFileSync(process.execPath, args, { stdio: "pipe" }), /Output already exists/);
		assert.equal(await readFile(out, "utf8"), bytes);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function probeLiveRuntime(prepared, live) {
	const guard = installFixtureFetch(prepared.identities);
	const path = join(prepared.agentDir, "models.json");
	try {
		const sdk = await import("@earendil-works/pi-coding-agent");
		await assert.rejects(
			withLiveConfig(prepared, live, async () => {
				const config = await readFile(path, "utf8");
				assert.ok(!config.includes(live.apiKey), "Credential in provider config");
				assert.deepEqual(JSON.parse(config), {
					providers: {
						[live.provider]: {
							api: "openai-completions",
							baseUrl: live.baseUrl,
							models: [{ id: live.model, contextWindow: 1048576, input: ["text"], reasoning: false }],
						},
					},
				});
				const { modelRuntime, model } = await scenarioRuntime(sdk, prepared.agentDir, live);
				const auth = await readFile(join(prepared.agentDir, "auth.json"), "utf8");
				assert.ok(!auth.includes(live.apiKey), "Credential persisted to auth.json");
				globalThis.fetch = gatewayFetch(
					live.baseUrl,
					globalThis.fetch,
					async (input, init) => {
						assert.equal(String(input), `${live.baseUrl}/chat/completions`);
						assert.ok(
							new Headers(init.headers).get("authorization") === `Bearer ${live.apiKey}`,
							"Wrong runtime auth",
						);
						const chunk = {
							id: "synthetic",
							object: "chat.completion.chunk",
							created: 1,
							model: model.id,
							choices: [{ index: 0, delta: { content: "Synthetic output." }, finish_reason: "stop" }],
							usage: { prompt_tokens: 7, completion_tokens: 11 },
						};
						return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
							headers: { "Content-Type": "text/event-stream" },
						});
					},
					guard.violations,
				);
				const reply = await modelRuntime
					.streamSimple(model, { messages: [{ role: "user", content: "Synthetic probe.", timestamp: 0 }] })
					.result();
				assert.equal(reply.stopReason, "stop");
				assert.equal(reply.usage.input, 7);
				assert.equal(reply.usage.output, 11);
				throw new Error("Synthetic runtime failure");
			}),
			/Synthetic runtime failure/,
		);
		await assert.rejects(readFile(path), { code: "ENOENT" });
		guard.assertClean();
		return { cleaned: true };
	} finally {
		guard.restore();
	}
}

async function assertLiveRuntime() {
	const {
		scenarios: [scenario],
	} = validateDesktopFixture(JSON.parse(await readFile(fixture, "utf8")));
	const live = {
		provider: "magpie",
		model: "deepseek/deepseek-flash",
		thinkingLevel: "off",
		baseUrl: "http://localhost:3425/v1",
		apiKey: ["synthetic", "placeholder", process.pid].join("-"),
	};
	const result = await withDesktopFixture(scenario, (prepared) =>
		runFixtureChild(prepared, import.meta.filename, live),
	);
	assert.deepEqual(result, { cleaned: true });
}

if (process.send)
	serveFixtureChild((prepared, live) => (live ? probeLiveRuntime(prepared, live) : probeBreaker(prepared)));
else {
	breakerTests();
	test(
		"isolated live SDK runtime resolves config, streams mocked usage, and cleans up on failure",
		assertLiveRuntime,
	);
	test("Desktop v2 records four real offline SDK outcomes", assertScenarioReport);
	test("Desktop v2 does not overwrite an existing report", assertNoOverwrite);
}
