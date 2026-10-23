import assert from "node:assert/strict";
import test from "node:test";
import { findHostImportViolations } from "./check-host-independence.mjs";

test("allows pi-analysis only in the registered host adapter facades", () => {
	assert.deepEqual(
		findHostImportViolations(
			"packages/backend/src/services/analysis-adapters/registry.ts",
			'import "@gyoungwe/pi-analysis";',
		),
		[],
	);
});

test("rejects pi-analysis imports outside the registered host adapter facades", () => {
	assert.deepEqual(
		findHostImportViolations(
			"packages/desktop/src/main/optional-adapter.ts",
			'import "@gyoungwe/pi-analysis";',
		),
		[
			"packages/desktop/src/main/optional-adapter.ts: pi-analysis migration exception is limited to registered host adapter files",
		],
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
