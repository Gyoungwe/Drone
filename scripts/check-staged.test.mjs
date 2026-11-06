import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStaged, parseAddedLines } from "./check-staged.mjs";

test("generated output mixed with source fails; alone it passes", () => {
	assert.equal(checkStaged(["src/a.ts", ".pi/extensions/x.mjs"], []).length, 1);
	assert.deepEqual(checkStaged([".pi/extensions/x.mjs", "packages/p/dist/i.js"], []), []);
	assert.deepEqual(checkStaged(["src/a.ts"], []), []);
});

test("new skips and test timeouts fail", () => {
	const added = parseAddedLines(
		// Split so this file does not trip the hook it tests.
		[
			"+++ b/src/a.test.ts",
			"+it" + ".skip('x', () => {});",
			"+test('y', { time" + "out: 20000 }, () => {});",
			"+++ b/src/b.ts",
			"+const time" + "out: number = 5;",
		].join("\n"),
	);
	assert.deepEqual(
		checkStaged(["src/a.test.ts", "src/b.ts"], added).map((p) => p.split(":")[0]),
		["src/a.test.ts", "src/a.test.ts"],
	);
});
