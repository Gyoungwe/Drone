import assert from "node:assert/strict";
import test from "node:test";
import { findHostImportViolations } from "./check-host-independence.mjs";

test("allows the existing pi-analysis host adapter exception", () => {
	assert.deepEqual(
		findHostImportViolations("packages/backend/src/analysis-adapter.ts", 'import "@gyoungwe/pi-analysis";'),
		[],
	);
});

test("rejects an optional plugin import and identifies its package", () => {
	assert.deepEqual(
		findHostImportViolations(
			"packages/desktop/src/main/optional-adapter.ts",
			'import "@gyoungwe/pi-evidence";\nimport("@gyoungwe/desktop-ui-pack");',
		),
		[
			"packages/desktop/src/main/optional-adapter.ts: optional plugin import @gyoungwe/pi-evidence",
			"packages/desktop/src/main/optional-adapter.ts: optional plugin import @gyoungwe/desktop-ui-pack",
		],
	);
});
