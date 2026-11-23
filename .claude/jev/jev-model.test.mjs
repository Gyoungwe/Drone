import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCore, routeCommand, squeezable } from "./command-route.mjs";
import { apiKey, askJev, JEV_ENDPOINT, redact } from "./jev-client.mjs";
import { SCRIPT_QUESTIONS } from "./jev-questions.mjs";
import { inspectScript, scriptTarget, scriptVerdict } from "./script-inspect.mjs";
import { taskHint } from "./task-route.mjs";

const noul = (value) => ({ type: "noul", noul: value });
const allNouls = (value, overrides = {}) =>
	Object.fromEntries(Object.keys(SCRIPT_QUESTIONS).map((id) => [id, noul(overrides[id] ?? value)]));
const fakeFetch =
	(status, body, calls = []) =>
	async (url, init) => {
		calls.push({ url, init });
		return { ok: status < 400, status, json: async () => body };
	};

describe("jev client", () => {
	it("reads the key from the environment first, then the Keychain", () => {
		assert.equal(
			apiKey({ TYPESAFE_API_KEY: "k1" }, () => assert.fail("no Keychain call")),
			"k1",
		);
		if (process.platform === "darwin") {
			assert.equal(
				apiKey({}, () => ({ status: 0, stdout: "k2\n" })),
				"k2",
			);
			assert.equal(
				apiKey({}, () => ({ status: 44, stdout: "" })),
				null,
			);
		}
	});

	it("sends state and questions with the bearer key and returns typed answers", async () => {
		const calls = [];
		const body = { model: "jev-1.14.0", answers: { q: noul(0.9) }, usage: { input_tokens: 12 } };
		const result = await askJev(
			{ s: 1 },
			{ q: { type: "noul", instructions: "?" } },
			{ key: "k", fetch: fakeFetch(200, body, calls) },
		);
		assert.equal(result.answers.q.noul, 0.9);
		assert.equal(calls[0].url, JEV_ENDPOINT);
		assert.equal(calls[0].init.headers.Authorization, "Bearer k");
		assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)), ["model", "state", "questions"]);
	});

	it("turns HTTP errors and missing answers into errors, never answers", async () => {
		const q = { q: { type: "noul", instructions: "?" } };
		await assert.rejects(askJev({}, q, { key: "k", fetch: fakeFetch(429, {}) }), /HTTP 429/);
		await assert.rejects(askJev({}, q, { key: "k", fetch: fakeFetch(200, { answers: {} }) }), /missing: q/);
		await assert.rejects(askJev({}, q, { key: null }), /no TypeSafe key/);
	});

	it("redacts credential-looking values before text leaves the machine", () => {
		assert.equal(redact("API_KEY=abc123 rest"), "API_KEY=[redacted] rest");
		assert.equal(redact('token: "xyz"'), 'token: "[redacted]"');
		assert.match(redact("Bearer sk-ant-0123456789abcdefghij"), /\[redacted\]/);
		assert.equal(redact("npm run build"), "npm run build");
	});
});

describe("script inspection", () => {
	it("finds the script a command runs", () => {
		assert.equal(scriptTarget("cd x && node tmp/fix.mjs --dry", "/w").file, "/w/tmp/fix.mjs");
		assert.equal(scriptTarget("bash ./scripts/go.sh", "/w").label, "./scripts/go.sh");
		assert.equal(scriptTarget("npm run relock", "/w").npmScript, "relock");
		assert.equal(scriptTarget("git status", "/w"), null);
	});

	it("asks Jev once per script content and reuses the answer", async () => {
		const store = new Map();
		let asked = 0;
		const deps = {
			readFile: () => "console.log(1)",
			ask: async () => {
				asked += 1;
				return { answers: allNouls(0.02) };
			},
			cache: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
			redact,
		};
		assert.equal((await inspectScript("node a.mjs", "/w", deps)).cached, false);
		assert.equal((await inspectScript("node a.mjs", "/w", deps)).cached, true);
		assert.equal(asked, 1);
		const [key] = store.keys();
		const { rewrites_git_history: _dropped, ...older } = store.get(key);
		store.set(key, older);
		assert.equal(
			(await inspectScript("node a.mjs", "/w", deps)).cached,
			false,
			"answers from before a new question",
		);
		assert.equal(asked, 2);
	});

	it("stays silent on harmless scripts and asks on risky ones, never allow or deny", () => {
		assert.equal(scriptVerdict(allNouls(0.02)), null);
		for (const id of [
			"publishes_release",
			"rewrites_git_history",
			"changes_outside_repo",
			"reads_credentials",
		]) {
			const verdict = scriptVerdict(allNouls(0.02, { [id]: 0.95 }));
			assert.equal(verdict?.answer, "ask", id);
			assert.equal(verdict.point, "permission");
		}
		const any = [0, 0.3, 0.5, 0.7, 1].map((v) => scriptVerdict(allNouls(v)));
		assert.ok(any.every((v) => v === null || v.answer === "ask"));
	});
});

describe("task routing", () => {
	const choice = (kind, p) => ({ type: "choice", choice: kind, confidence: p, probabilities: { [kind]: p } });
	const all = () => true;

	it("names the skills of a confident kind that the checkout has", () => {
		const { entry, text } = taskHint(choice("plugin_change", 0.9), all);
		assert.equal(entry.answer, "plugin_change");
		assert.match(text, /drone-plugin-dev/);
		assert.equal(taskHint(choice("slimming", 0.9), () => false).text, null);
	});

	it("names nothing when Jev is unsure or there is no code work", () => {
		assert.equal(taskHint(choice("plugin_change", 0.4), all).entry.answer, "unsure");
		assert.equal(taskHint(choice("no_code", 0.99), all).text, null);
	});
});

describe("hand trims on check commands", () => {
	it("takes over a trailing tail or head and keeps other pipes out", () => {
		assert.equal(squeezable("npx vitest run a.test.ts 2>&1 | tail -30"), true);
		assert.equal(squeezable("npm run typecheck | head -n 40"), true);
		assert.equal(squeezable("npx vitest run | grep FAIL"), false);
		assert.equal(checkCore("cd x && npm test 2>&1 | tail -5"), "cd x && npm test");
		assert.equal(routeCommand("npm test | tail -5", "/r.mjs"), "node '/r.mjs' -- 'npm test'");
	});
});
