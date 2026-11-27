import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	runDesktopBaseline,
	runFixtureChild,
	serveFixtureChild,
} from "./measure-desktop-research-baseline.mts";
import { gatewayFetch, validateBaseUrl } from "./measure-desktop-research-baseline-provider.mts";
import { runDesktopScenario } from "./measure-desktop-research-baseline-sdk.mts";

const baseUrl = "http://127.0.0.1:3425/v1";
const endpoint = `${baseUrl}/chat/completions`;
const provider = "magpie";
const model = "deepseek/deepseek-flash";
const fixture = "fixtures/research-desktop-baseline.json";
const placeholder = () => ["synthetic", "placeholder", process.pid].join("-");
const deniedRead = "Raw read outside the verified fixture read boundary";
const readInput = ({ workspace }) => ({ path: join(workspace, ".pi/research-workspace.json") });
const failure = (key) => new Error(`Synthetic failure ${key} ${key} ${"x".repeat(500)}`);
const expectedConfig = {
	providers: {
		[provider]: {
			api: "openai-completions",
			baseUrl,
			models: [{ id: model, contextWindow: 1048576, input: ["text"], reasoning: false }],
		},
	},
};
const argv = (url, thinking = "off") =>
	Object.entries({ mode: "live-sdk", provider, model, thinking, "base-url": url, fixture }).map(
		([key, value]) => `--${key}=${value}`,
	);
const deny = () => assert.fail("Rejected CLI reached the runner");
const runChild = (prepared, live) => runFixtureChild(prepared, import.meta.filename, live);

function gatewayTests() {
	test("CLI rejects invalid gateways before reading the key or running a fixture", async () => {
		const env = {
			get DRONE_BASELINE_API_KEY() {
				return assert.fail("Rejected CLI read credential");
			},
		};
		for (const url of [
			"https://example.com/v1",
			"http://example.com:80/v1",
			"http://127.1:80/",
			"http://2130706433:80/",
			"http://0x7f000001:80/",
			"http://%6cocalhost:80/",
			"http://[::1]:80/",
			"http://x@localhost:80/",
			"http://127.0.0.1/",
			"http://127.0.0.1:0/",
			"http://127.0.0.1:03425/v1",
			"http://localhost:65536/",
			"http://localhost:9.5/",
			"http://localhost:80/v1?",
			"http://localhost:80/v1#",
			"http://localhost:80\\v1",
		])
			await assert.rejects(
				runDesktopBaseline([...argv(url), "--out", "/unused"], env, deny),
				/只允许本机网关/,
			);
		await assert.rejects(
			runDesktopBaseline(
				["--mode", "offline-faux", "--fixture", fixture, "--out", "/unused", "--base-url", baseUrl],
				env,
				deny,
			),
			/--base-url.*live-sdk/,
		);
		await assert.rejects(
			runDesktopBaseline([...argv(baseUrl), "--out", "/unused"], {}, deny),
			/DRONE_BASELINE_API_KEY/,
		);
		assert.equal(validateBaseUrl("http://localhost:80/v1"), "http://localhost:80/v1");
		assert.equal(validateBaseUrl("http://127.0.0.1:65535/"), "http://127.0.0.1:65535/");
	});
	test("gateway fetch refuses redirects without sending a second request", async () => {
		const violations = [],
			requests = [];
		const fetch = gatewayFetch(
			baseUrl,
			deny,
			async (input, init) => {
				requests.push([String(input), init.redirect]);
				return Response.redirect("https://example.com/remote", 307);
			},
			violations,
		);
		await assert.rejects(fetch(endpoint, { method: "POST", redirect: "follow" }), /redirect/i);
		assert.deepEqual(requests, [[endpoint, "manual"]]);
		assert.equal(violations.length, 1);
	});
}

function completion(index, tool) {
	const delta = tool
		? { tool_calls: [{ index: 0, id: "call_native_tool", type: "function", function: tool }] }
		: { content: "Synthetic provider finished." };
	const chunk = { id: `synthetic-${index}`, object: "chat.completion.chunk", created: 1, model };
	return new Response(
		`data: ${JSON.stringify({
			...chunk,
			choices: [{ index: 0, delta, finish_reason: tool ? "tool_calls" : "stop" }],
		})}\n\ndata: ${JSON.stringify({
			...chunk,
			choices: [],
			usage: { prompt_tokens: index === 0 ? 7 : 499980, completion_tokens: index === 0 ? 11 : 2 },
		})}\n\ndata: [DONE]\n\n`,
		{
			headers: { "Content-Type": "text/event-stream" },
		},
	);
}

async function mockScenario(prepared, live) {
	if (!live) {
		prepared.scenario.fauxCalls.unshift({ name: "read", input: readInput(prepared) });
		return runDesktopScenario(prepared);
	}
	if (live.thinkingLevel === "minimal") throw failure(live.apiKey);
	const start = { action: "start", mode: "deep_research", query: "Synthetic budget test" };
	const tools = {
		"local-direct": { name: "research_loop", arguments: JSON.stringify(start) },
		"deep-research": { name: "read", arguments: JSON.stringify(readInput(prepared)) },
	};
	let calls = 0;
	let config;
	const original = globalThis.fetch;
	const transport = async (input, init) => {
		assert.equal(String(input), endpoint);
		assert.equal(init.redirect, "manual");
		assert.ok(
			new Headers(init.headers).get("authorization") === `Bearer ${live.apiKey}`,
			"Wrong runtime auth",
		);
		assert.equal(process.env.OPENAI_API_KEY, undefined);
		const request = JSON.parse(init.body);
		assert.equal(request.model, model);
		assert.equal(request.tools.length, 10);
		config = await readFile(join(prepared.agentDir, "models.json"), "utf8");
		assert.ok(!config.includes(live.apiKey), "Credential in provider config");
		if (prepared.scenario.id === "deep-research" && calls === 1)
			assert.ok(request.messages.findLast(({ role }) => role === "tool")?.content.includes(deniedRead));
		const tool = calls === 0 ? tools[prepared.scenario.id] : undefined;
		return completion(calls++, tool);
	};
	const result = await runDesktopScenario(prepared, live, transport);
	assert.equal(globalThis.fetch, original);
	await assert.rejects(access(join(prepared.agentDir, "models.json")), { code: "ENOENT" });
	assert.ok(!JSON.stringify(result).includes(live.apiKey), "Credential in scenario result");
	return { ...result, config, calls };
}

async function reportPath(context) {
	const root = await mkdtemp(join(tmpdir(), "desktop-live-report-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	return join(root, "report.json");
}

async function assertLiveFailures(context) {
	const out = await reportPath(context);
	const apiKey = placeholder();
	const logs = ["log", "error"].map((method) => context.mock.method(console, method, () => undefined));
	const expected = `local-direct: ${failure("<redacted>").message}`.slice(0, 500);
	const args = [...argv(baseUrl, "minimal"), "--out", out];
	for (const run of [runChild, () => Promise.reject(failure(apiKey))])
		await assert.rejects(runDesktopBaseline(args, { DRONE_BASELINE_API_KEY: apiKey }, run), (error) => {
			assert.ok(error.message === expected && error.stack === undefined, "Expected a redacted message only");
			return true;
		});
	await assert.rejects(access(out), { code: "ENOENT" });
	assert.ok(logs.every(({ mock }) => mock.callCount() === 0));
}

async function assertOfflineDenial(context) {
	const out = await reportPath(context);
	const offline = ["--mode=offline-faux", `--fixture=${fixture}`, `--out=${out}`];
	await assert.rejects(runDesktopBaseline(offline, {}, runChild), new RegExp(deniedRead));
	await assert.rejects(access(out), { code: "ENOENT" });
}

async function assertLiveReport(context) {
	const out = await reportPath(context);
	const apiKey = placeholder();
	const env = { DRONE_BASELINE_API_KEY: apiKey, OPENAI_API_KEY: apiKey };
	const logs = context.mock.method(console, "log", () => undefined);
	await runDesktopBaseline([...argv(baseUrl), "--out", out], env, async (prepared, live) => {
		context.after(() => assert.rejects(access(prepared.agentDir), { code: "ENOENT" }));
		const result = await runChild(prepared, live);
		assert.equal(result.provider, provider);
		assert.equal(result.model, model);
		assert.deepEqual(JSON.parse(result.config), expectedConfig);
		const calls = ["local-direct", "deep-research"].includes(prepared.scenario.id) ? 2 : 1;
		assert.equal(result.calls, calls);
		return result;
	});
	const body = await readFile(out, "utf8");
	assert.ok(!body.includes(apiKey), "Credential in report");
	const logged = logs.mock.calls.map(({ arguments: args }) => args);
	assert.ok(!JSON.stringify(logged).includes(apiKey), "Credential in logs");
	const report = JSON.parse(body);
	const [budget, voluntary] = report.scenarios;
	assert.equal(report.modelConfig.baseUrl, baseUrl);
	assert.equal(report.modelConfig.declaredContextWindow, 1048576);
	assert.deepEqual(report.modelConfig.budgetEvidence, budget.stop.breakerReceipt);
	assert.equal(budget.stop.breakerReceipt.measured.billedTokens, 500000);
	assert.equal(budget.stop.reason, "budget-exceeded");
	assert.equal(budget.tokens.billedTotal, 500000);
	assert.deepEqual(budget.toolCalls, ["research_loop"]);
	assert.equal(budget.routeObserved, "deep_research");
	assert.equal(voluntary.routeObserved, "unrouted");
	assert.equal(voluntary.blockedReads, 1);
	assert.equal(voluntary.stop.reason, "voluntary-stop");
	assert.equal(budget.expectationMatched, false);
	assert.equal(voluntary.expectationMatched, false);
}

if (process.send) serveFixtureChild(mockScenario);
else {
	gatewayTests();
	test("mocked live SDK reports usage, read denials and budget with isolated config", assertLiveReport);
	test("live child and runner failures expose only a bounded redacted message", assertLiveFailures);
	test("offline read denials still fail the scenario", assertOfflineDenial);
}
