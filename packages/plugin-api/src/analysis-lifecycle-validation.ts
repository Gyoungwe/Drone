import type {
	AnalysisLifecycleCapability,
	AnalysisLifecycleClock,
	AnalysisLifecycleCommand,
	AnalysisLifecycleComputeBinding,
	AnalysisLifecycleContext,
	AnalysisLifecycleEvent,
	AnalysisLifecycleGate,
	AnalysisLifecycleLedger,
	AnalysisLifecycleReadinessInput,
	AnalysisLifecycleResult,
	AnalysisLifecycleStage,
	AnalysisLifecycleStatus,
} from "./analysis-lifecycle.js";
import {
	assertAnalysisLifecycleLedger,
	assertAnalysisLifecycleResultShape,
} from "./analysis-lifecycle-record-validation.js";

const capabilities: Readonly<Record<AnalysisLifecycleStage, readonly AnalysisLifecycleCapability[]>> = {
	intake: ["analysis", "files"],
	design: ["analysis", "planning", "files"],
	readiness: ["analysis", "files", "coding"],
	execution: ["analysis", "files", "coding"],
	review: ["analysis", "visualization", "literature"],
	delivery: ["analysis", "visualization", "writing", "literature"],
	completed: ["writing", "visualization"],
};

function requireIntegrity(condition: boolean, detail: string): asserts condition {
	if (!condition) throw new Error(`Analysis lifecycle integrity: ${detail}`);
}

function equal(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	const a = left as Record<string, unknown>;
	const b = right as Record<string, unknown>;
	return (
		Object.keys(a).length === Object.keys(b).length &&
		Object.keys(a).every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
	);
}

function omit(value: object, keys: readonly string[]): object {
	return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function same(left: unknown, right: unknown, field: string): void {
	requireIntegrity(equal(left, right), `${field} changed outside the command`);
}

function newText(value: string, max: number): string {
	const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
	requireIntegrity(normalized.length > 0 && normalized.length <= max, "invalid new identity or text");
	return normalized;
}

function targetId(command: AnalysisLifecycleCommand): string {
	if (command.type !== "create" && command.type !== "fork-checkpoint") return command.id;
	const id = newText(command.type === "create" ? command.input.id : command.branch.id, 128);
	requireIntegrity(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id), "unsafe new analysis id");
	return id;
}

function edge(
	before: AnalysisLifecycleContext,
	after: AnalysisLifecycleContext,
	from: readonly AnalysisLifecycleStage[],
	stage: AnalysisLifecycleStage,
	status: AnalysisLifecycleStatus,
	resetCapabilities = true,
): void {
	requireIntegrity(
		from.includes(before.stage) && before.status !== "completed",
		"illegal source stage/status",
	);
	requireIntegrity(after.stage === stage && after.status === status, "illegal result stage/status");
	same(after.capabilities, resetCapabilities ? capabilities[stage] : before.capabilities, "capabilities");
}

function initial(
	command: Extract<AnalysisLifecycleCommand, { type: "create" | "fork-checkpoint" }>,
	after: AnalysisLifecycleContext,
): void {
	const input = command.type === "create" ? command.input : command.snapshot;
	same(after.question, newText(input.question, 512), "question");
	same(after.assay, newText(input.assay, 512), "assay");
	same(after.mode, input.mode, "mode");
	same(after.adapter, input.adapter, "adapter");
	same(
		after.branchOf,
		command.type === "fork-checkpoint"
			? {
					analysisId: command.snapshot.id,
					checkpointId: command.branch.checkpointId,
					workspace: command.branch.workspace,
				}
			: undefined,
		"branch origin",
	);
	requireIntegrity(after.stage === "intake" && after.status === "active", "new run must start in intake");
	same(after.capabilities, capabilities.intake, "capabilities");
	requireIntegrity(
		after.readiness === null && !after.publicationRequested,
		"new run inherited readiness/publication",
	);
	requireIntegrity(
		after.review === undefined && after.provenance === undefined,
		"new run inherited evidence",
	);
}

function readinessGates(
	input: AnalysisLifecycleReadinessInput,
	gates: readonly AnalysisLifecycleGate[],
): void {
	same(gates.slice(0, input.assessment.gates.length), input.assessment.gates, "assessment gates");
	const suffix = gates.slice(input.assessment.gates.length);
	const required: AnalysisLifecycleGate[] = [];
	if (!input.assessment.ok && input.assessment.gates.length === 0)
		required.push({
			code: "missing-data",
			severity: "block",
			message: "Adapter assessment failed without evidence",
			evidenceKey: "assessment",
		});
	if (!input.computeAuthorized)
		required.push({
			code: "compute-authorization-required",
			severity: "pause",
			message: "Compute execution is outside the approved task scope.",
			evidenceKey: "computeAuthorized",
		});
	if (input.destructiveOperation)
		required.push({
			code: "destructive-operation-requires-review",
			severity: "pause",
			message: "A destructive or overwrite operation requires human review.",
			evidenceKey: "destructiveOperation",
		});
	same(suffix, required, "host-fact gate suffix");
}

function bindingProvenance(binding: AnalysisLifecycleComputeBinding): object {
	return {
		adapter: binding.adapter,
		workflow: binding.workflow,
		method: binding.method,
		specSha256: binding.specSha256,
		adapterSnapshotSha256: binding.adapterSnapshotSha256,
		toolContractSha256: binding.toolContractSha256,
		...(binding.executionContext ? { executionContext: binding.executionContext } : {}),
		artifacts: binding.inputs,
		...(binding.lineage ? { lineage: binding.lineage } : {}),
		reproducibility: { status: "not-assessed", detail: "Execution and output evidence pending" },
	};
}

function readinessChange(
	before: AnalysisLifecycleContext,
	after: AnalysisLifecycleContext,
	command: Extract<AnalysisLifecycleCommand, { type: "assess-readiness" }>,
	previous: AnalysisLifecycleLedger,
	record: AnalysisLifecycleLedger,
): void {
	const { input } = command;
	requireIntegrity(input.mode === before.mode && input.assay === before.assay, "readiness identity mismatch");
	const assessment = after.readiness;
	requireIntegrity(assessment !== null, "readiness assessment missing");
	readinessGates(input, assessment.gates);
	same(assessment.warnings, input.assessment.warnings, "assessment warnings");
	requireIntegrity(assessment.ok === (assessment.gates.length === 0), "readiness gate outcome mismatch");
	requireIntegrity(
		assessment.inferentialClaimsAllowed === (input.assessment.inferentialClaimsAllowed && assessment.ok),
		"inferential claim mismatch",
	);
	const status = assessment.ok
		? "active"
		: assessment.gates.some((gate) => gate.severity === "block")
			? "blocked"
			: "paused";
	edge(before, after, ["design", "readiness"], "readiness", status);
	same(after.publicationRequested, input.publicationRequested === true, "publication intent");
	requireIntegrity(record.bindings !== undefined, "readiness must initialize bindings");
	same(
		omit(record.bindings, [after.id]),
		omit(previous.bindings === undefined ? {} : previous.bindings, [after.id]),
		"unrelated bindings",
	);
	const binding = assessment.ok ? command.binding : undefined;
	const returnedBinding = Object.hasOwn(record.bindings, after.id) ? record.bindings[after.id] : undefined;
	same(returnedBinding, binding, "compute binding");
	same(after.adapter, binding ? binding.adapter : before.adapter, "adapter");
	same(after.provenance, binding ? bindingProvenance(binding) : before.provenance, "provenance");
}

function transition(
	before: AnalysisLifecycleContext,
	after: AnalysisLifecycleContext,
	command: Exclude<AnalysisLifecycleCommand, { type: "create" | "fork-checkpoint" }>,
	previous: AnalysisLifecycleLedger,
	record: AnalysisLifecycleLedger,
): readonly [AnalysisLifecycleEvent["type"], string?] {
	const allowed = ["stage", "status", "capabilities", "events"];
	if (command.type === "assess-readiness")
		allowed.push("readiness", "publicationRequested", "adapter", "provenance");
	if (command.type === "finish-review") allowed.push("review", "provenance");
	same(omit(after, allowed), omit(before, allowed), "immutable or unrelated run fields");
	if (command.type !== "assess-readiness") same(record.bindings, previous.bindings, "bindings");
	switch (command.type) {
		case "record-design":
			edge(before, after, ["intake"], "design", "active");
			return ["design-recorded", command.detail ?? "design-recorded"];
		case "assess-readiness":
			readinessChange(before, after, command, previous, record);
			return ["readiness-assessed", after.readiness?.ok ? "ready" : "gated"];
		case "approve-execution":
			requireIntegrity(
				before.status === "active" && before.readiness?.ok === true,
				"readiness gate is closed",
			);
			edge(before, after, ["readiness"], "execution", "active");
			return ["execution-approved"];
		case "record-execution":
			requireIntegrity(before.status === "active", "execution is not active");
			edge(
				before,
				after,
				["execution"],
				command.result.ok ? "review" : "execution",
				command.result.ok ? "active" : "blocked",
				command.result.ok,
			);
			return ["execution-finished", command.result.detail ?? (command.result.ok ? "succeeded" : "failed")];
		case "finish-review":
			return reviewChange(before, after, command);
		case "complete":
			return completion(before, after, command);
		case "resume":
			requireIntegrity(before.status === "paused" && before.stage !== "readiness", "run cannot resume");
			edge(before, after, [before.stage], before.stage, "active", false);
			return ["resumed"];
	}
}

function reviewChange(
	before: AnalysisLifecycleContext,
	after: AnalysisLifecycleContext,
	command: Extract<AnalysisLifecycleCommand, { type: "finish-review" }>,
): readonly [AnalysisLifecycleEvent["type"], string?] {
	const { input } = command;
	requireIntegrity(before.status === "active", "review is not active");
	const passed = input.outputsVerified && input.review?.approved !== false;
	edge(before, after, ["review"], passed ? "delivery" : "review", passed ? "active" : "paused", passed);
	same(after.review, input.review === undefined ? before.review : input.review, "review");
	same(after.provenance, input.provenance === undefined ? before.provenance : input.provenance, "provenance");
	return ["review-finished", input.detail ?? (passed ? "verified" : "outputs-unverified")];
}

function completion(
	before: AnalysisLifecycleContext,
	after: AnalysisLifecycleContext,
	command: Extract<AnalysisLifecycleCommand, { type: "complete" }>,
): readonly [AnalysisLifecycleEvent["type"], string?] {
	requireIntegrity(before.status === "active", "delivery is not active");
	const paused = before.publicationRequested && command.input?.publicationApproved !== true;
	edge(
		before,
		after,
		["delivery"],
		paused ? "delivery" : "completed",
		paused ? "paused" : "completed",
		!paused,
	);
	return paused
		? ["paused", "publication-requires-review"]
		: ["delivered", command.input?.detail ?? "delivered"];
}

/** Checks a proposal before host persistence; approval booleans and events grant no authority. */
export function assertAnalysisLifecycleResult(
	before: AnalysisLifecycleLedger,
	command: AnalysisLifecycleCommand,
	clock: AnalysisLifecycleClock,
	result: unknown,
): asserts result is AnalysisLifecycleResult {
	assertAnalysisLifecycleLedger(before);
	assertAnalysisLifecycleResultShape(result);
	const id = targetId(command);
	same(omit(result.record.runs, [id]), omit(before.runs, [id]), "unrelated runs");
	const after = result.record.runs[id];
	requireIntegrity(after !== undefined && Object.hasOwn(result.record.runs, id), "target run missing");
	const previous = Object.hasOwn(before.runs, id) ? before.runs[id] : undefined;
	const creating = command.type === "create" || command.type === "fork-checkpoint";
	let expected: readonly [AnalysisLifecycleEvent["type"], string?];
	if (creating) {
		requireIntegrity(previous === undefined, "cannot replace an existing run");
		initial(command, after);
		same(result.record.bindings, before.bindings, "bindings");
		expected = ["created"];
	} else {
		requireIntegrity(previous !== undefined, "target did not exist");
		expected = transition(previous, after, command, before, result.record);
	}
	const prefix = previous === undefined ? [] : previous.events;
	same(after.events.slice(0, prefix.length), prefix, "event prefix");
	const [type, detail] = expected;
	const event = { type, at: clock.at, ...(detail ? { detail } : {}) };
	same(after.events.slice(prefix.length), [event], "appended event");
	same(result.events, [event], "result event suffix");
}
