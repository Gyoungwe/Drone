import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as runtime from "../dist/runtime.js";

const clock = { at: "2026-11-17T12:00:00.000Z" };
const validate = (...args) => runtime.assertAnalysisLifecycleResult(...args);
const command = { type: "record-design", id: "run-1" };
const identity = { id: "assembly", version: "1.0.0" };

function run(stage = "intake", status = "active") {
	return {
		version: 1,
		id: "run-1",
		question: "Assemble reads",
		assay: "assembly",
		mode: "exploratory",
		stage,
		status,
		capabilities: ["analysis", "files"],
		readiness: null,
		publicationRequested: false,
		events: [{ type: "created", at: "2026-11-16T12:00:00.000Z" }],
	};
}

function ledger(target = run()) {
	return { version: 1, runs: { "run-1": target, other: { ...run(), id: "other" } } };
}

function proposal(before, patch = {}, event = { type: "design-recorded", detail: "design-recorded" }) {
	const next = structuredClone(before);
	const appended = { ...event, at: clock.at };
	next.runs["run-1"] = {
		...next.runs["run-1"],
		stage: "design",
		capabilities: ["analysis", "planning", "files"],
		...patch,
		events: [...next.runs["run-1"].events, appended],
	};
	return { record: next, events: [appended] };
}

function rejects(before, request, result) {
	assert.throws(() => validate(before, request, clock, result), /Analysis lifecycle/);
}

test("accepts a detached target-only result without mutating any argument", () => {
	const before = ledger();
	const result = proposal(before);
	const snapshots = structuredClone([before, command, clock, result]);
	validate(before, command, clock, result);
	assert.deepEqual([before, command, clock, result], snapshots);
});

test("existing identities and text stay verbatim when resuming a historical record", () => {
	const target = {
		...run("delivery", "paused"),
		id: "legacy id",
		question: "  Old   question  ",
		assay: " old assay ",
	};
	const before = { version: 1, runs: { "legacy id": target } };
	const event = { type: "resumed", at: clock.at };
	const result = {
		record: {
			version: 1,
			runs: { "legacy id": { ...target, status: "active", events: [...target.events, event] } },
		},
		events: [event],
	};
	validate(before, { type: "resume", id: "legacy id" }, clock, result);
});

for (const invalid of [null, [], {}, { record: {}, events: [] }, { record: ledger(), events: [] }]) {
	test(`rejects an invalid plugin result: ${JSON.stringify(invalid)}`, () =>
		rejects(ledger(), command, invalid));
}

function setPath(value, path, replacement) {
	const parts = path.split(".");
	const key = parts.pop();
	const parent = parts.reduce((current, part) => current[part], value);
	parent[key] = replacement;
}

const tampering = [
	["record.runs.run-1.id", "renamed"],
	["record.runs.run-1.question", "Different question"],
	["record.runs.run-1.assay", "rna-seq"],
	["record.runs.run-1.mode", "inferential"],
	["record.runs.run-1.branchOf", { analysisId: "x", checkpointId: "c", workspace: "/branch" }],
	["record.runs.run-1.adapter", identity],
	["record.runs.run-1.publicationRequested", true],
	["record.runs.run-1.readiness", { ok: true, inferentialClaimsAllowed: true, gates: [], warnings: [] }],
	["record.runs.run-1.review", { approved: true, detail: "forged", limitations: [] }],
	["record.runs.other.question", "Overwritten"],
	["record.runs.added", { ...run(), id: "added" }],
	["record.bindings", {}],
	["record.runs.run-1.events.0.detail", "rewritten"],
	["events", []],
	["events.0", { type: "design-recorded", at: clock.at, detail: "different" }],
	["events.0.type", "delivered"],
	["events.0.at", "2025-01-01T00:00:00Z"],
	["events.0.detail", "forged"],
	["record.runs.run-1.capabilities", ["files", "planning", "analysis"]],
	["record.runs.run-1.status", "blocked"],
	["record.runs.run-1.stage", "delivery"],
];
for (const [path, replacement] of tampering) {
	test(`rejects ${path} tampering`, () => {
		const before = ledger();
		const result = proposal(before);
		setPath(result, path, replacement);
		rejects(before, command, result);
	});
}

test("rejects deletions and event count changes", () => {
	for (const mutate of [
		(r) => {
			delete r.record.runs.other;
		},
		(r) => {
			r.record.runs["run-1"].events.shift();
		},
		(r) => {
			r.record.runs["run-1"].events.push({ ...r.events[0] });
		},
	]) {
		const before = ledger();
		const result = proposal(before);
		mutate(result);
		rejects(before, command, result);
	}
});

test("rejects a missing target and illegal incoming stage", () => {
	const before = ledger();
	rejects(before, { ...command, id: "absent" }, proposal(before));
	for (const [stage, status] of [
		["design", "active"],
		["intake", "completed"],
	]) {
		const current = ledger(run(stage, status));
		rejects(current, command, proposal(current));
	}
});

for (const publicationApproved of [undefined, false, true]) {
	test(`complete follows the current host publication decision: ${publicationApproved}`, () => {
		const before = ledger({ ...run("delivery"), publicationRequested: true });
		const request = { type: "complete", id: "run-1", input: { publicationApproved } };
		const delivered = proposal(
			before,
			{
				stage: "completed",
				status: "completed",
				capabilities: ["writing", "visualization"],
			},
			{ type: "delivered", detail: "delivered" },
		);
		const paused = proposal(
			before,
			{
				stage: "delivery",
				status: "paused",
				capabilities: before.runs["run-1"].capabilities,
			},
			{ type: "paused", detail: "publication-requires-review" },
		);
		validate(before, request, clock, publicationApproved === true ? delivered : paused);
		rejects(before, request, publicationApproved === true ? paused : delivered);
	});
}

test("stored approval values and execution events cannot forge publication completion", () => {
	const before = ledger({
		...run("delivery"),
		publicationRequested: true,
		review: { approved: true, detail: "Review passed", limitations: [] },
		events: [{ type: "execution-approved", at: clock.at }],
	});
	const forged = proposal(
		before,
		{
			stage: "completed",
			status: "completed",
			capabilities: ["writing", "visualization"],
		},
		{ type: "delivered", detail: "delivered" },
	);
	rejects(before, { type: "complete", id: "run-1" }, forged);
});

const approvedReview = { approved: true, detail: "Checked", limitations: [], modelStatus: "unavailable" };
const rejectedReview = { approved: false, detail: "Rejected", limitations: [] };
const ready = { ok: true, inferentialClaimsAllowed: false, gates: [], warnings: [] };
const edges = [
	[
		"approve-execution",
		{},
		{ ...run("readiness"), readiness: ready },
		"execution",
		"active",
		["analysis", "files", "coding"],
		"execution-approved",
	],
	[
		"record-execution",
		{ result: { ok: true } },
		run("execution"),
		"review",
		"active",
		["analysis", "visualization", "literature"],
		"execution-finished",
		"succeeded",
	],
	[
		"record-execution",
		{ result: { ok: false } },
		run("execution"),
		"execution",
		"blocked",
		["analysis", "files"],
		"execution-finished",
		"failed",
	],
	[
		"finish-review",
		{ input: { outputsVerified: true, review: approvedReview } },
		run("review"),
		"delivery",
		"active",
		["analysis", "visualization", "writing", "literature"],
		"review-finished",
		"verified",
	],
	[
		"finish-review",
		{ input: { outputsVerified: true, review: rejectedReview } },
		run("review"),
		"review",
		"paused",
		["analysis", "files"],
		"review-finished",
		"outputs-unverified",
	],
	[
		"finish-review",
		{ input: { outputsVerified: false } },
		run("review"),
		"review",
		"paused",
		["analysis", "files"],
		"review-finished",
		"outputs-unverified",
	],
	[
		"complete",
		{},
		run("delivery"),
		"completed",
		"completed",
		["writing", "visualization"],
		"delivered",
		"delivered",
	],
	["resume", {}, run("delivery", "paused"), "delivery", "active", ["analysis", "files"], "resumed"],
];
for (const [type, input, target, stage, status, capabilities, eventType, detail] of edges) {
	test(`checks ${type} edge to ${stage}/${status}`, () => {
		const before = ledger(target);
		const request = { type, id: "run-1", ...input };
		const event = { type: eventType, ...(detail === undefined ? {} : { detail }) };
		const review = request.type === "finish-review" ? request.input.review : undefined;
		const result = proposal(before, { stage, status, capabilities, ...(review ? { review } : {}) }, event);
		validate(before, request, clock, result);
		const changed = structuredClone(result);
		changed.record.runs["run-1"].status = status === "active" ? "blocked" : "active";
		rejects(before, request, changed);
		if (status === "paused" || status === "blocked") {
			changed.record.runs["run-1"].stage = "delivery";
			changed.record.runs["run-1"].capabilities = ["analysis", "visualization", "writing", "literature"];
			rejects(before, request, changed);
		}
		if (review) {
			const forged = structuredClone(result);
			forged.record.runs["run-1"].review.detail = "Changed";
			rejects(before, request, forged);
		}
	});
}

test("resume refuses readiness and non-paused source records", () => {
	for (const stage of ["readiness", "delivery"]) {
		const before = ledger(run(stage, stage === "readiness" ? "paused" : "active"));
		rejects(before, { type: "resume", id: "run-1" }, proposal(before, { stage }, { type: "resumed" }));
	}
});

test("create normalizes only new fields and cannot overwrite an existing target", () => {
	const before = { version: 1, runs: {} };
	const request = {
		type: "create",
		input: { id: " run-1 ", question: "Assemble  reads", assay: "assembly", mode: "exploratory" },
	};
	const created = { ...run(), events: [{ type: "created", at: clock.at }] };
	const result = { record: { version: 1, runs: { "run-1": created } }, events: created.events };
	validate(before, request, clock, result);
	rejects(ledger(), request, {
		...result,
		record: { ...ledger(), runs: { ...ledger().runs, "run-1": created } },
	});
	const changed = structuredClone(result);
	changed.record.runs["run-1"].question = "Changed";
	rejects(before, request, changed);
});

test("new lifecycle types are assignable to current shared records without widening the old contract", () => {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const file = resolve(root, "test/analysis-lifecycle-fixture.ts");
	const source = `
import type { AnalysisLifecycleContext, AnalysisLifecycleLedger, AnalysisLifecyclePort } from "@gyoungwe/plugin-api/analysis-lifecycle";
import type { AnalysisLifecycleHostLoader } from "@gyoungwe/plugin-api/runtime";
import type { AnalysisContext, AnalysisGateCode, AnalysisHostPort } from "@gyoungwe/plugin-api";
import type { AnalysisContext as SharedContext } from "../../shared/src/analysis-orchestration";
declare const current: SharedContext;
const next: AnalysisLifecycleContext = current;
const old: AnalysisContext = next;
declare const port: AnalysisLifecyclePort;
const record: AnalysisLifecycleLedger = port.empty();
const loader: AnalysisLifecycleHostLoader = { contractVersion: 1, load: () => port };
// @ts-expect-error Lifecycle gates do not widen the existing scientific vocabulary.
const gate: AnalysisGateCode = "publication-requires-review";
declare const oldHost: AnalysisHostPort;
// @ts-expect-error Existing host contracts do not acquire a mandatory lifecycle port.
oldHost.lifecycle;
void old; void record; void loader; void gate;
`;
	const options = {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		types: [],
	};
	const host = ts.createCompilerHost(options);
	const original = host.getSourceFile;
	host.getSourceFile = (name, language, ...rest) =>
		name === file ? ts.createSourceFile(name, source, language, true) : original(name, language, ...rest);
	const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
	assert.equal(
		diagnostics.length,
		0,
		ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCurrentDirectory: () => root,
			getCanonicalFileName: (name) => name,
			getNewLine: () => "\n",
		}),
	);
});

test("fork copies scientific identity only and checks the host branch origin", () => {
	const before = ledger({ ...run("delivery"), adapter: identity, review: approvedReview });
	const snapshot = before.runs["run-1"];
	const branchOf = { analysisId: snapshot.id, checkpointId: "checkpoint-1", workspace: "/branch" };
	const request = {
		type: "fork-checkpoint",
		snapshot,
		branch: { id: "branch-1", checkpointId: branchOf.checkpointId, workspace: branchOf.workspace },
	};
	const branch = {
		...run(),
		id: "branch-1",
		adapter: identity,
		branchOf,
		events: [{ type: "created", at: clock.at }],
	};
	const result = {
		record: { ...before, runs: { ...before.runs, "branch-1": branch } },
		events: branch.events,
	};
	validate(before, request, clock, result);
	for (const patch of [
		{ review: snapshot.review },
		{ publicationRequested: true },
		{ branchOf: { ...branchOf, workspace: "/other" } },
	]) {
		const changed = structuredClone(result);
		Object.assign(changed.record.runs["branch-1"], patch);
		rejects(before, request, changed);
	}
});
