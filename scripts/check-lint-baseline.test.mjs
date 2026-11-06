import assert from "node:assert/strict";
import { test } from "node:test";
import { compare, countDiagnostics } from "./check-lint-baseline.mjs";

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
