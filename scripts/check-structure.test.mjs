import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compare, scanSource, updateBaseline } from "./check-structure.mjs";

test("flags long files, non-Error extends and module-level let", () => {
	// Built from parts so this file does not trip the check it tests.
	const ext = "ext" + "ends";
	const text = `${"x\n".repeat(401)}class A ${ext} B {}\nclass E ${ext} Error {}\nclass F ${ext} errors.HttpError {}\nlet a = 1;\nexport let b = 2;\nfunction f() {\n\tlet c = 3;\n}\n`;
	assert.deepEqual(scanSource(text), { "file-lines": 409, "class-extends": 1, "module-let": 2 });
	assert.deepEqual(scanSource("const a = 1;\n"), {});
});

test("new long files fail above the limit; baselined ones may not grow", () => {
	const { grown, shrunk } = compare(
		{ "file-lines\told.ts": 500, "module-let\tgone.ts": 1 },
		{ "file-lines\told.ts": 501, "file-lines\tnew.ts": 401 },
	);
	assert.deepEqual(
		grown.map((g) => g.key),
		["file-lines\told.ts", "file-lines\tnew.ts"],
	);
	assert.deepEqual(
		shrunk.map((s) => s.key),
		["module-let\tgone.ts"],
	);
});

function baselineFile(t, baseline) {
	const dir = mkdtempSync(join(tmpdir(), "structure-baseline-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "baseline.json");
	writeFileSync(path, `${JSON.stringify(baseline)}\n`);
	return path;
}

const readBaseline = (path) => JSON.parse(readFileSync(path, "utf8"));

test("--update records drops and removes entries that reached zero", (t) => {
	t.mock.method(console, "log", () => undefined);
	const path = baselineFile(t, { "file-lines\ta.ts": 500, "module-let\tb.ts": 1 });
	assert.equal(updateBaseline(path, { "file-lines\ta.ts": 450 }, ["--update"]), 0);
	assert.deepEqual(readBaseline(path), { "file-lines\ta.ts": 450 });
});

test("--update refuses a rise or a new entry, lists them and writes nothing", (t) => {
	const errors = t.mock.method(console, "error", () => undefined);
	const baseline = { "file-lines\ta.ts": 500, "module-let\tb.ts": 3 };
	const path = baselineFile(t, baseline);
	// b.ts drops, but a rise elsewhere must not let that drop through on its own.
	const current = { "file-lines\ta.ts": 501, "module-let\tb.ts": 1, "file-lines\tnew.ts": 401 };
	assert.equal(updateBaseline(path, current, ["--update"]), 1);
	assert.deepEqual(readBaseline(path), baseline);
	const output = errors.mock.calls.map((call) => call.arguments[0]).join("\n");
	assert.match(output, /a\.ts file-lines is 501 \(allowed 500\)/);
	assert.match(output, /new\.ts file-lines is 401 \(allowed 400\)/);
	assert.doesNotMatch(output, /b\.ts/);
});

test("--allow-moves accepts a rise or a new entry and lists what it accepted", (t) => {
	const logs = t.mock.method(console, "log", () => undefined);
	const path = baselineFile(t, { "module-let\told.ts": 2 });
	assert.equal(updateBaseline(path, { "module-let\tnew.ts": 2 }, ["--update", "--allow-moves"]), 0);
	assert.deepEqual(readBaseline(path), { "module-let\tnew.ts": 2 });
	const output = logs.mock.calls.map((call) => call.arguments[0]).join("\n");
	assert.match(output, /accepted as moved: new\.ts module-let is 2 \(allowed 0\)/);
});
