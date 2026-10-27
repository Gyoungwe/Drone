import assert from "node:assert/strict";
import test from "node:test";
import {
	createTaskAcceptanceRegistry,
	readTaskAcceptanceVerifier,
	registerTaskAcceptanceVerifier,
	TASK_HOST_CONTRACT_VERSION,
} from "../dist/tasks.js";

test("task host contract is versioned and dependency-free", () => {
	assert.equal(TASK_HOST_CONTRACT_VERSION, 1);
});

test("task acceptance registry is host-owned and validates extension declarations", () => {
	const registry = createTaskAcceptanceRegistry();
	const verifier = registerTaskAcceptanceVerifier(registry, "lab_sample", {
		fields: ["sampleId"],
		label: (acceptance) => `sample ${acceptance.sampleId}`,
	});
	assert.equal(verifier.kind, "lab_sample");
	assert.equal(readTaskAcceptanceVerifier(registry, "lab_sample"), verifier);
	assert.throws(() => registerTaskAcceptanceVerifier(registry, "file", {}), /owned by the host/);
	assert.throws(() => registerTaskAcceptanceVerifier(registry, "bad-kind!", {}), /must match/);
});
