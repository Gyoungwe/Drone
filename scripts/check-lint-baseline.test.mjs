import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compare, countDiagnostics, updateBaseline } from "./check-lint-baseline.mjs";

const diag = (rule, path) => ({ category: `lint/${rule}`, location: { path } });

test("counts tracked rules per file and ignores others", () => {
	const counts = countDiagnostics({
		diagnostics: [
			diag("suspicious/noExplicitAny", "a.ts"),
			diag("suspicious/noExplicitAny", "a.ts"),
			diag("style/useConst", "a.ts"),
		],
	});
	assert.deepEqual(counts, { "suspicious/noExplicitAny\ta.ts": 2 });
});

test("reports growth, new files and shrinkage", () => {
	const { grown, shrunk } = compare({ "r\ta.ts": 2, "r\tb.ts": 1 }, { "r\ta.ts": 3, "r\tc.ts": 1 });
	assert.deepEqual(
		grown.map((g) => g.key),
		["r\ta.ts", "r\tc.ts"],
	);
	assert.deepEqual(
		shrunk.map((s) => s.key),
		["r\tb.ts"],
	);
});

function baselineFile(t, baseline) {
	const dir = mkdtempSync(join(tmpdir(), "lint-baseline-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "baseline.json");
	writeFileSync(path, `${JSON.stringify(baseline)}\n`);
	return path;
}

const readBaseline = (path) => JSON.parse(readFileSync(path, "utf8"));

test("--update records drops and removes entries that reached zero", (t) => {
	t.mock.method(console, "log", () => undefined);
	const path = baselineFile(t, { "r\ta.ts": 3, "r\tb.ts": 1 });
	assert.equal(updateBaseline(path, { "r\ta.ts": 2 }, ["--update"]), 0);
	assert.deepEqual(readBaseline(path), { "r\ta.ts": 2 });
});

test("--update refuses a rise or a new entry, lists them and writes nothing", (t) => {
	const errors = t.mock.method(console, "error", () => undefined);
	const baseline = { "r\ta.ts": 2, "r\tb.ts": 3 };
	const path = baselineFile(t, baseline);
	// b.ts drops, but a rise elsewhere must not let that drop through on its own.
	const current = { "r\ta.ts": 3, "r\tb.ts": 1, "r\tnew.ts": 1 };
	assert.equal(updateBaseline(path, current, ["--update"]), 1);
	assert.deepEqual(readBaseline(path), baseline);
	const output = errors.mock.calls.map((call) => call.arguments[0]).join("\n");
	assert.match(output, /a\.ts has 3 r \(baseline 2\)/);
	assert.match(output, /new\.ts has 1 r \(baseline 0\)/);
	assert.doesNotMatch(output, /b\.ts/);
});

test("--allow-moves accepts a rise or a new entry and lists what it accepted", (t) => {
	const logs = t.mock.method(console, "log", () => undefined);
	const path = baselineFile(t, { "r\told.ts": 2 });
	assert.equal(updateBaseline(path, { "r\tnew.ts": 2 }, ["--update", "--allow-moves"]), 0);
	assert.deepEqual(readBaseline(path), { "r\tnew.ts": 2 });
	const output = logs.mock.calls.map((call) => call.arguments[0]).join("\n");
	assert.match(output, /accepted as moved: new\.ts has 2 r \(baseline 0\)/);
});
