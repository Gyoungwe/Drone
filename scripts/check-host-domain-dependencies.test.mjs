import assert from "node:assert/strict";
import test from "node:test";
import { inspectHostDependencies, trackedRuntimeDependencies } from "./check-host-domain-dependencies.mjs";

test("rejects tracked entries absent from runtime dependencies", () => {
	const tracked = new Set(["@drone/tasks"]);
	const result = inspectHostDependencies({ dependencies: { "@drone/shared": "*" } }, tracked);
	assert.equal(result.ok, false);
	assert.deepEqual(result.staleTrackedDependencies, ["@drone/tasks"]);
});

test("rejects pi-knowledge as a runtime dependency", () => {
	const result = inspectHostDependencies({ dependencies: { "@gyoungwe/pi-knowledge": "*" } });
	assert.equal(result.ok, false);
	assert.deepEqual(result.unexpectedRuntimeDomainDependencies, ["@gyoungwe/pi-knowledge"]);
});

test("ignores domain packages in devDependencies", () => {
	const result = inspectHostDependencies({
		dependencies: { "@drone/shared": "*" },
		devDependencies: {
			"@drone/discovery": "*",
			"@gyoungwe/pi-analysis": "*",
			"@gyoungwe/pi-knowledge": "*",
		},
	});
	assert.equal(result.ok, true);
});

test("tracks no runtime domain dependencies after P6 PR-A", () => {
	assert.equal(trackedRuntimeDependencies.size, 0);
});

test("rejects a newly introduced pi package without a migration seam", () => {
	const result = inspectHostDependencies({ dependencies: { "@gyoungwe/pi-new-domain": "*" } });
	assert.equal(result.ok, false);
	assert.deepEqual(result.unexpectedRuntimeDomainDependencies, ["@gyoungwe/pi-new-domain"]);
});

test("rejects optional UI and connector packages in host runtime dependencies", () => {
	const result = inspectHostDependencies({
		dependencies: {
			"@gyoungwe/pi-analysis": "*",
			"@gyoungwe/desktop-ui-pack": "*",
		},
	});
	assert.equal(result.ok, false);
	assert.deepEqual(result.optionalPluginRuntimeDependencies, [
		"@gyoungwe/pi-analysis",
		"@gyoungwe/desktop-ui-pack",
	]);
});
