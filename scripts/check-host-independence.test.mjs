import assert from "node:assert/strict";
import test from "node:test";
import { findHostImportViolations } from "./check-host-independence.mjs";

test("allows pi-analysis only through the versioned host entry", () => {
	assert.deepEqual(
		findHostImportViolations(
			"packages/backend/src/services/analysis-task-controller.ts",
			'import "@gyoungwe/pi-analysis/host";',
		),
		[],
	);
});

test("rejects pi-analysis imports that bypass the host entry", () => {
	assert.deepEqual(
		findHostImportViolations(
			"packages/desktop/src/main/optional-adapter.ts",
			'import "@gyoungwe/pi-analysis";',
		),
		["packages/desktop/src/main/optional-adapter.ts: pi-analysis imports must use the versioned host entry"],
	);
});

test("rejects knowledge and research imports that bypass their host entries", () => {
	assert.deepEqual(
		findHostImportViolations(
			"packages/backend/src/legacy-adapter.ts",
			'import "@gyoungwe/pi-knowledge";\nimport("@gyoungwe/pi-research");',
		),
		[
			"packages/backend/src/legacy-adapter.ts: @gyoungwe/pi-knowledge imports must use the versioned host entry",
			"packages/backend/src/legacy-adapter.ts: @gyoungwe/pi-research imports must use the versioned host entry",
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
