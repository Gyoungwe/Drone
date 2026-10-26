import assert from "node:assert/strict";
import test from "node:test";
import { inspectHostDependencies } from "./check-host-domain-dependencies.mjs";

test("accepts the explicitly tracked migration dependencies", () => {
	const result = inspectHostDependencies({
		dependencies: {
			"@drone/tasks": "*",
			"@gyoungwe/pi-knowledge": "*",
		},
	});
	assert.equal(result.ok, true);
	assert.deepEqual(result.optionalPluginRuntimeDependencies, []);
	assert.deepEqual(result.unexpectedRuntimeDomainDependencies, []);
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
