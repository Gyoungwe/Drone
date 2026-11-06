import assert from "node:assert/strict";
import { test } from "node:test";
import { compare, scanSource } from "./check-structure.mjs";

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
