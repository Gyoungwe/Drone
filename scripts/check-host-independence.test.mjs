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

test("rejects pi-core imports that bypass the versioned host entry", () => {
	assert.deepEqual(
		findHostImportViolations(
			"packages/backend/src/tools/memory-save.ts",
			'export * from "@gyoungwe/pi-core/host";',
		),
		[],
	);
	assert.deepEqual(
		findHostImportViolations(
			"packages/backend/src/services/new-task-service.ts",
			'import "@gyoungwe/pi-core/tools/todo";',
		),
		[
			"packages/backend/src/services/new-task-service.ts: @gyoungwe/pi-core imports must use the versioned host entry",
		],
	);
});

test("project memory consumers use the versioned pi-core host entry", () => {
	assert.deepEqual(
		findHostImportViolations(
			"packages/backend/src/project/trust-loader.ts",
			'import { memoryIndexPrompt } from "@gyoungwe/pi-core/host";',
		),
		[],
	);
});

test("status tools use the versioned pi-core host entry directly", () => {
	assert.deepEqual(
		findHostImportViolations(
			"packages/backend/src/session-engine/extensions.ts",
			'import { makeStatusTool } from "@gyoungwe/pi-core/host";',
		),
		[],
	);
});

test("todo tools use the versioned pi-core host entry directly", () => {
	assert.deepEqual(
		findHostImportViolations(
			"packages/backend/src/session-engine/extensions.ts",
			'import { makeTodoTool } from "@gyoungwe/pi-core/host";',
		),
		[],
	);
});
