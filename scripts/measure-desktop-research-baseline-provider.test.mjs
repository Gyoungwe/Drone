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
const expectedConfig = {
	providers: {
		[provider]: {
			api: "openai-completions",
			baseUrl,
			models: [{ id: model, contextWindow: 1048576, input: ["text"], reasoning: false }],
		},
	},
};
const argv = (url) => [
	"--mode",
	"live-sdk",
	"--provider",
	provider,
	"--model",
	model,
	"--thinking",
	"off",
	"--base-url",
	url,
	"--fixture",
	fixture,
];
const deny = () => assert.fail("Rejected CLI reached the runner");

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

function completion(index, start) {
	const delta = start
		? {
				tool_calls: [
					{
						index: 0,
						id: "call_native_start",
						type: "function",
						function: {
							name: "research_loop",
							arguments: JSON.stringify({
								action: "start",
								mode: "deep_research",
								query: "Synthetic budget test",
							}),
						},
					},
				],
			}
		: { content: "Synthetic provider finished." };
	const chunk = { id: `synthetic-${index}`, object: "chat.completion.chunk", created: 1, model };
	return new Response(
		`data: ${JSON.stringify({
			...chunk,
			choices: [{ index: 0, delta, finish_reason: start ? "tool_calls" : "stop" }],
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
		return completion(calls++, prepared.scenario.id === "local-direct" && calls === 1);
	};
	const result = await runDesktopScenario(prepared, live, transport);
	assert.equal(globalThis.fetch, original);
	await assert.rejects(access(join(prepared.agentDir, "models.json")), { code: "ENOENT" });
	assert.ok(!JSON.stringify(result).includes(live.apiKey), "Credential in scenario result");
	return { ...result, config, calls };
}

function reportTest() {
	test("mocked live SDK reports observed usage, divergence and native budget with isolated config", async (context) => {
		const root = await mkdtemp(join(tmpdir(), "desktop-live-report-"));
		const out = join(root, "report.json"),
			sandboxes = [];
		const apiKey = placeholder();
		const logs = context.mock.method(console, "log", () => undefined);
		try {
			await runDesktopBaseline(
				[...argv(baseUrl), "--out", out],
				{ DRONE_BASELINE_API_KEY: apiKey, OPENAI_API_KEY: apiKey },
				async (prepared, live) => {
					sandboxes.push(prepared.agentDir);
					const result = await runFixtureChild(prepared, import.meta.filename, live);
					assert.equal(result.provider, provider);
					assert.equal(result.model, model);
					assert.deepEqual(JSON.parse(result.config), expectedConfig);
					assert.equal(result.calls, prepared.scenario.id === "local-direct" ? 2 : 1);
					return result;
				},
			);
			const body = await readFile(out, "utf8");
			assert.ok(!body.includes(apiKey), "Credential in report");
			assert.ok(
				!JSON.stringify(logs.mock.calls.map(({ arguments: args }) => args)).includes(apiKey),
				"Credential in logs",
			);
			const report = JSON.parse(body),
				[budget, voluntary] = report.scenarios;
			assert.equal(report.modelConfig.baseUrl, baseUrl);
			assert.equal(report.modelConfig.declaredContextWindow, 1048576);
			assert.deepEqual(report.modelConfig.budgetEvidence, budget.stop.breakerReceipt);
			assert.equal(budget.stop.breakerReceipt.measured.billedTokens, 500000);
			assert.equal(budget.stop.reason, "budget-exceeded");
			assert.equal(budget.tokens.billedTotal, 500000);
			assert.deepEqual(budget.toolCalls, ["research_loop"]);
			assert.equal(budget.routeObserved, "deep_research");
			assert.equal(voluntary.routeObserved, "unrouted");
			assert.equal(voluntary.stop.reason, "voluntary-stop");
			assert.equal(budget.expectationMatched, false);
			assert.equal(voluntary.expectationMatched, false);
		} finally {
			await rm(root, { recursive: true, force: true });
			for (const path of sandboxes) await assert.rejects(access(path), { code: "ENOENT" });
		}
	});
}

if (process.send) serveFixtureChild(mockScenario);
else {
	gatewayTests();
	reportTest();
}
