import assert from "node:assert/strict";
import test from "node:test";
import * as runtime from "../dist/runtime.js";

const clock = { at: "2026-11-17T12:00:00.000Z" };
const validate = (...args) => runtime.assertAnalysisLifecycleResult(...args);
const command = { type: "resume", id: "run-1" };
const identity = { id: "assembly", version: "1.0.0" };
const lineage = { schemaVersion: 1, eventId: "event:1", causationId: "event:0", runAttemptId: "attempt:1" };
const artifact = {
	artifactId: "artifact-1",
	versionId: "version-1",
	path: "inputs/reads.fa",
	sha256: "a".repeat(64),
	bytes: 12,
	role: "input",
	accessLevel: "restricted",
	parentVersionIds: ["version-0"],
	producedByJobId: "job-0",
};
const executionContext = {
	schemaVersion: 1,
	revision: "revision-1",
	observedAt: clock.at,
	source: "host",
	values: { tool: "assembler", threads: 2, container: true, unknown: null },
};
const binding = {
	jobId: "job-1",
	specSha256: "b".repeat(64),
	adapter: identity,
	workflow: { id: "workflow", version: "1" },
	method: { id: "method", version: "1" },
	adapterSnapshotSha256: "c".repeat(64),
	toolContractSha256: "d".repeat(64),
	executionContext,
	requiredOutputs: ["contigs.fa"],
	inputs: [artifact],
	lineage,
};

function provenance() {
	return {
		adapter: binding.adapter,
		workflow: binding.workflow,
		method: binding.method,
		specSha256: binding.specSha256,
		adapterSnapshotSha256: binding.adapterSnapshotSha256,
		toolContractSha256: binding.toolContractSha256,
		executionContext,
		artifacts: [artifact],
		lineage,
		reproducibility: {
			status: "recorded",
			detail: "Environment captured",
			environmentFingerprint: "env-1",
			checkpointId: "checkpoint-1",
		},
	};
}

// Field-for-field synthetic copy of the current runs.json envelope and its nested record shapes.
function currentRecord() {
	return structuredClone({
		version: 1,
		runs: {
			"run-1": {
				version: 1,
				id: "run-1",
				question: "Assemble reads",
				assay: "assembly",
				mode: "exploratory",
				adapter: identity,
				branchOf: { analysisId: "original", checkpointId: "checkpoint-0", workspace: "/synthetic/branch" },
				stage: "delivery",
				status: "paused",
				capabilities: ["analysis", "visualization", "writing", "literature"],
				readiness: { ok: true, inferentialClaimsAllowed: false, gates: [], warnings: ["Exploratory only"] },
				review: {
					approved: true,
					detail: "Checked",
					limitations: ["Exploratory"],
					reportPath: "review.md",
					checks: [{ id: "outputs", passed: true, detail: "Present" }],
					modelStatus: "unavailable",
				},
				provenance: provenance(),
				publicationRequested: true,
				events: [
					{ type: "created", at: "2026-11-16T12:00:00.000Z" },
					{ type: "paused", at: clock.at, detail: "publication-requires-review" },
				],
			},
		},
		bindings: { "run-1": structuredClone(binding) },
	});
}

function resumed(before) {
	const record = structuredClone(before);
	const event = { type: "resumed", at: clock.at };
	record.runs["run-1"].status = "active";
	record.runs["run-1"].events.push(event);
	return { record, events: [event] };
}

test("accepts every current optional field without dropping, filling or rewriting values", () => {
	const before = currentRecord();
	const result = resumed(before);
	const original = structuredClone(result);
	validate(before, command, clock, result);
	assert.deepEqual(result, original);
	const { status, events, ...unchanged } = result.record.runs["run-1"];
	assert.deepEqual(
		{ ...unchanged, status: "paused", events: before.runs["run-1"].events },
		before.runs["run-1"],
	);
	assert.deepEqual(result.record.bindings, before.bindings);
});

test("accepts old minimal v1 records with all optional fields absent", () => {
	const before = currentRecord();
	delete before.bindings;
	for (const field of ["adapter", "branchOf", "review", "provenance"]) delete before.runs["run-1"][field];
	before.runs["run-1"].readiness = null;
	const result = resumed(before);
	validate(before, command, clock, result);
	assert.equal(Object.hasOwn(result.record, "bindings"), false);
	for (const field of ["adapter", "branchOf", "review", "provenance"])
		assert.equal(Object.hasOwn(result.record.runs["run-1"], field), false);
});

function setPath(value, path, replacement) {
	const parts = path.split(".");
	const key = parts.pop();
	const parent = parts.reduce((current, part) => current[part], value);
	parent[key] = replacement;
}

const invalidFields = [
	["version", 2],
	["runs.run-1.version", 2],
	["runs.run-1.id", "wrong-key"],
	["runs.run-1.stage", "unknown"],
	["runs.run-1.status", "unknown"],
	["runs.run-1.mode", "unknown"],
	["runs.run-1.question", null],
	["runs.run-1.adapter.version", 1],
	["runs.run-1.adapter.extra", true],
	["runs.run-1.branchOf.workspace", 1],
	["runs.run-1.capabilities.0", "shell"],
	["runs.run-1.readiness.ok", "true"],
	["runs.run-1.readiness.warnings.0", false],
	[
		"runs.run-1.readiness.gates",
		[{ code: "unknown", severity: "block", message: "gate", evidenceKey: "key" }],
	],
	["runs.run-1.review.approved", 1],
	["runs.run-1.review.limitations.0", null],
	["runs.run-1.review.checks.0.passed", "true"],
	["runs.run-1.review.modelStatus", "verified"],
	["runs.run-1.provenance.reproducibility.status", "approved"],
	["runs.run-1.provenance.extra", true],
	["runs.run-1.provenance.artifacts.0.bytes", Number.NaN],
	["runs.run-1.provenance.artifacts.0.bytes", Infinity],
	["runs.run-1.provenance.artifacts.0.role", "unknown"],
	["runs.run-1.provenance.artifacts.0.accessLevel", "internal"],
	["runs.run-1.provenance.artifacts.0.parentVersionIds.0", 1],
	["runs.run-1.provenance.artifacts.0.producedByJobId", false],
	["runs.run-1.provenance.executionContext.schemaVersion", 2],
	["runs.run-1.provenance.executionContext.source", "plugin"],
	["runs.run-1.provenance.executionContext.values.threads", Infinity],
	["runs.run-1.provenance.executionContext.values.nested", {}],
	["runs.run-1.provenance.lineage.schemaVersion", 2],
	["runs.run-1.provenance.lineage.eventId", "../bad"],
	["runs.run-1.provenance.lineage.causationId", "event:1"],
	["runs.run-1.provenance.lineage.runAttemptId", "x".repeat(129)],
	["runs.run-1.publicationRequested", "true"],
	["runs.run-1.events.0.type", "published"],
	["runs.run-1.events.0.at", 1],
	["runs.run-1.events.0.detail", undefined],
	["bindings.run-1.jobId", 42],
	["bindings.run-1.inputs.0.extra", true],
	["bindings.run-1.lineage.eventId", "bad id"],
	["bindings.run-1.requiredOutputs.0", false],
];
for (const [path, replacement] of invalidFields) {
	test(`refuses invalid v1 field ${path}: ${String(replacement)}`, () => {
		const before = currentRecord();
		// Corrupt both snapshots to isolate recursive validation from the change allowlist.
		setPath(before, path, replacement);
		assert.throws(() => validate(before, command, clock, resumed(before)), /Analysis lifecycle/);
	});
}

test("refuses missing required fields, unknown fields and non-JSON records", () => {
	for (const alter of [
		(r) => {
			delete r.runs["run-1"].events;
		},
		(r) => {
			r.extra = true;
		},
		(r) => {
			r.runs["run-1"].grant = true;
		},
		(r) => {
			r.runs["run-1"].adapter = new Date();
		},
		(r) => {
			r.bindings.orphan = binding;
		},
		(r) => {
			r.runs["run-1"].capabilities = new Array(2);
		},
	]) {
		const before = currentRecord();
		const result = resumed(before);
		alter(result.record);
		assert.throws(() => validate(before, command, clock, result), /Analysis lifecycle/);
	}
	const before = currentRecord();
	for (const extra of [{ grant: true }, { contractVersion: 1 }]) {
		assert.throws(
			() => validate(before, command, clock, { ...resumed(before), ...extra }),
			/Analysis lifecycle/,
		);
	}
});

test("unrelated and target binding changes are refused outside readiness", () => {
	const before = currentRecord();
	before.runs.other = { ...structuredClone(before.runs["run-1"]), id: "other" };
	before.bindings.other = structuredClone(binding);
	for (const id of ["run-1", "other"]) {
		const result = resumed(before);
		result.record.bindings[id].jobId = "forged-job";
		assert.throws(() => validate(before, command, clock, result), /Analysis lifecycle/);
	}
});

function readinessProposal(before, assessment, suppliedBinding) {
	const record = structuredClone(before);
	const target = record.runs["run-1"];
	target.stage = "readiness";
	target.status = assessment.ok ? "active" : "blocked";
	target.capabilities = ["analysis", "files", "coding"];
	target.readiness = assessment;
	target.publicationRequested = false;
	const event = { type: "readiness-assessed", at: clock.at, detail: assessment.ok ? "ready" : "gated" };
	target.events.push(event);
	record.bindings = {};
	if (assessment.ok && suppliedBinding) {
		record.bindings["run-1"] = structuredClone(suppliedBinding);
		target.adapter = suppliedBinding.adapter;
		target.provenance = {
			...provenance(),
			reproducibility: { status: "not-assessed", detail: "Execution and output evidence pending" },
		};
	}
	return { record, events: [event] };
}

for (const ok of [false, true]) {
	for (const suppliedBinding of [undefined, binding]) {
		test(`readiness checks binding/provenance fidelity: ok=${ok}, binding=${!!suppliedBinding}`, () => {
			const before = currentRecord();
			before.runs["run-1"].stage = "design";
			before.runs["run-1"].status = "active";
			const assessment = {
				ok,
				inferentialClaimsAllowed: false,
				gates: ok
					? []
					: [{ code: "missing-data", severity: "block", message: "Missing reads", evidenceKey: "reads" }],
				warnings: [],
			};
			const request = {
				type: "assess-readiness",
				id: "run-1",
				input: { mode: "exploratory", assay: "assembly", assessment, computeAuthorized: true },
				...(suppliedBinding ? { binding: suppliedBinding } : {}),
			};
			const result = readinessProposal(before, assessment, suppliedBinding);
			validate(before, request, clock, result);
			const forged = structuredClone(result);
			forged.record.bindings["run-1"] = { ...binding, jobId: "forged-job" };
			assert.throws(() => validate(before, request, clock, forged), /Analysis lifecycle/);
			const alteredProvenance = structuredClone(result);
			alteredProvenance.record.runs["run-1"].provenance.specSha256 = "f".repeat(64);
			assert.throws(() => validate(before, request, clock, alteredProvenance), /Analysis lifecycle/);
		});
	}
}

test("exports the version and validator through runtime and the new subpath", async () => {
	assert.equal(runtime.ANALYSIS_LIFECYCLE_CONTRACT_VERSION, 1);
	const subpath = await import("@gyoungwe/plugin-api/analysis-lifecycle");
	assert.equal(subpath.assertAnalysisLifecycleResult, runtime.assertAnalysisLifecycleResult);
	assert.equal(subpath.ANALYSIS_LIFECYCLE_CONTRACT_VERSION, 1);
});

const hostFactGates = [
	{
		code: "missing-data",
		severity: "block",
		message: "Adapter assessment failed without evidence",
		evidenceKey: "assessment",
	},
	{
		code: "compute-authorization-required",
		severity: "pause",
		message: "Compute execution is outside the approved task scope.",
		evidenceKey: "computeAuthorized",
	},
	{
		code: "destructive-operation-requires-review",
		severity: "pause",
		message: "A destructive or overwrite operation requires human review.",
		evidenceKey: "destructiveOperation",
	},
];

test("readiness preserves the host assessment and checks every host-fact gate", () => {
	const before = currentRecord();
	before.runs["run-1"].stage = "design";
	delete before.bindings;
	const assessment = { ok: false, inferentialClaimsAllowed: true, gates: [], warnings: ["Keep"] };
	const request = {
		type: "assess-readiness",
		id: "run-1",
		input: {
			mode: "exploratory",
			assay: "assembly",
			assessment,
			computeAuthorized: false,
			destructiveOperation: true,
			publicationRequested: true,
		},
	};
	const result = readinessProposal(before, {
		...assessment,
		inferentialClaimsAllowed: false,
		gates: hostFactGates,
	});
	result.record.runs["run-1"].publicationRequested = true;
	validate(before, request, clock, result);
	for (const [path, replacement] of [
		["readiness.gates", []],
		["readiness.gates.0.message", "Changed"],
		["readiness.ok", true],
		["readiness.inferentialClaimsAllowed", true],
		["readiness.warnings", []],
		["publicationRequested", false],
	]) {
		const forged = structuredClone(result);
		setPath(forged.record.runs["run-1"], path, replacement);
		assert.throws(() => validate(before, request, clock, forged), /Analysis lifecycle/);
	}
	for (const key of ["assay", "mode"]) {
		const changed = structuredClone(request);
		changed.input[key] = key === "assay" ? "other" : "inferential";
		assert.throws(() => validate(before, changed, clock, result), /Analysis lifecycle/);
	}
});

test("malformed plugin review and provenance fail shape validation before integrity checks", () => {
	const before = currentRecord();
	before.runs["run-1"].stage = "review";
	before.runs["run-1"].status = "active";
	for (const [path, replacement] of [
		["review.approved", "true"],
		["provenance.artifacts.0.bytes", Infinity],
		["provenance.executionContext.values.extra", {}],
		["provenance.lineage.eventId", "bad id"],
	]) {
		const input = {
			outputsVerified: true,
			review: { approved: true, detail: "Checked", limitations: [] },
			provenance: structuredClone(provenance()),
		};
		const result = resumed(before);
		Object.assign(result.record.runs["run-1"], {
			stage: "delivery",
			review: structuredClone(input.review),
			provenance: structuredClone(input.provenance),
		});
		const event = { type: "review-finished", at: clock.at, detail: "verified" };
		result.events = [event];
		result.record.runs["run-1"].events = [...before.runs["run-1"].events, event];
		setPath(result.record.runs["run-1"], path, replacement);
		assert.throws(
			() => validate(before, { type: "finish-review", id: "run-1", input }, clock, result),
			/Analysis lifecycle result must contain only a v1 record and event array/,
		);
	}
});
