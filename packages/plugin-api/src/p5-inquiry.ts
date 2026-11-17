/** P5 design section 3 Inquiry contracts. Receipt references never convey host origin or authority. */
import { Hash, Id, Relative, resultEnvelope, Time } from "./p5-receipts.js";

export { resultEnvelope };

const dialect = "https://json-schema.org/draft/2020-12/schema";

function closedObject<const Properties extends { readonly [key: string]: object }>(properties: Properties) {
	return {
		type: "object",
		properties,
		required: Object.keys(properties),
		additionalProperties: false,
	} as const;
}

function array<const Items extends object>(items: Items, minItems = 0, maxItems = 10000) {
	return { type: "array", items, minItems, maxItems } as const;
}

function nullable<const Schema extends object>(schema: Schema) {
	return { anyOf: [schema, { type: "null" }] } as const;
}

function schema<const Definition extends object>(definition: Definition) {
	return { $schema: dialect, ...definition } as const;
}

const text = { type: "string", minLength: 1, maxLength: 20000 } as const;
const integer = { type: "integer", minimum: 0 } as const;
const boolean = { type: "boolean" } as const;
const scalar = {
	anyOf: [{ type: "string" }, { type: "number" }, boolean, { type: "null" }],
} as const;
const parameter = closedObject({ name: text, value: scalar });
const budget = closedObject({
	maxTokens: integer,
	maxCost: nullable({ type: "number", minimum: 0 }),
	timeoutMs: { type: "integer", minimum: 1, maximum: 86400000 },
	maxOutputBytes: { type: "integer", minimum: 1 },
});
const question = closedObject({
	id: Id,
	findingId: Id,
	checklistItem: {
		enum: [
			"confounding",
			"batch-effect",
			"multiple-testing",
			"data-leakage",
			"circular-analysis",
			"overclaiming",
		],
	},
	question: text,
	severity: { enum: ["high", "medium", "low"] },
	evidenceArtifactIds: array(Id),
});
const attempt = closedObject({
	id: Id,
	hypothesisIds: array(Id),
	parameters: array(parameter),
	artifactIds: array(Id),
	resultSummary: text,
	outcome: { enum: ["running", "succeeded", "failed", "blocked", "unknown"] },
	enteredReport: boolean,
	startedAt: Time,
	finishedAt: nullable(Time),
	executionReceiptRef: Id,
});
const record = {
	anyOf: [
		closedObject({ kind: { const: "critic-question" }, value: question }),
		closedObject({ kind: { const: "path-attempt" }, value: attempt }),
	],
} as const;
const recordInput = closedObject({ requestId: Id, projectId: Id, records: array(record, 1, 64) });
const recordCommit = closedObject({
	recordIds: array(Id, 1, 64),
	stateVersion: Hash,
	authority: { const: "plugin-asserted-or-imported" },
	hostReceiptRefs: array(Id, 1),
});
const collectInput = closedObject({
	after: nullable(Id),
	limit: { type: "integer", minimum: 1, maximum: 64 },
});
const factArtifact = closedObject({
	id: Id,
	path: Relative,
	bytes: integer,
	sha256: Hash,
	parentIds: array(Id),
	purpose: { enum: ["input", "draft", "intermediate", "deliverable", "evidence"] },
});
const fact = closedObject({
	id: Id,
	sequence: integer,
	kind: { enum: ["compute", "local-execution", "decision", "task-accepted"] },
	entityId: Id,
	at: Time,
	status: {
		enum: [
			"created",
			"submitted",
			"running",
			"succeeded",
			"failed",
			"cancelled",
			"blocked",
			"partial",
			"unknown",
			"accepted",
		],
	},
	artifactRefs: array(factArtifact),
	runReceiptRef: nullable(Id),
	decisionKind: nullable({
		enum: [
			"task-authorization",
			"workflow-repair",
			"subagent-dispatch",
			"compute-submit",
			"zotero-write",
			"rebind",
		],
	}),
	summary: text,
	basis: array(Id),
});
const factsResult = closedObject({ cursor: nullable(Id), facts: array(fact, 0, 64) });
const collectResult = closedObject({
	cursor: nullable(Id),
	projectedRecordIds: array(Id),
	stateVersion: Hash,
	hostReceiptRefs: array(Id),
	authority: { const: "host-observed" },
});
const rerunInput = closedObject({
	requestId: Id,
	artifactId: Id,
	profile: Id,
	preflightRef: Id,
	budget,
});
const rerunResult = closedObject({
	requestId: Id,
	rerunId: Id,
	jobId: nullable(Id),
	status: { enum: ["submitted", "running", "reproduced", "superseded", "failed"] },
	previousSha256: Hash,
	resultArtifactId: nullable(Id),
	sha256: nullable(Hash),
	errorCode: nullable(text),
	hostReceiptRefs: array(Id),
	stateVersion: Hash,
});
const computeRerunInput = closedObject({
	requestId: Id,
	sourceRunReceiptRef: Id,
	artifactId: Id,
	expectedSha256: Hash,
	profile: Id,
	preflightRef: Id,
	budget,
});
const computeRerunResult = closedObject({
	requestId: Id,
	jobId: nullable(Id),
	status: { enum: ["absent", "accepted", "running", "succeeded", "failed", "cancelled", "outcome-unknown"] },
	artifacts: array(factArtifact),
	receiptRef: Id,
});

export const Scalar = schema(scalar);
export const Parameter = schema(parameter);
export const Budget = schema(budget);
export const Question = schema(question);
export const Attempt = schema(attempt);
export const Record = schema(record);
export const RecordInput = schema(recordInput);
export const RecordCommit = schema(recordCommit);
export const CollectInput = schema(collectInput);
export const FactArtifact = schema(factArtifact);
export const Fact = schema(fact);
export const FactsResult = schema(factsResult);
export const CollectResult = schema(collectResult);
export const RerunInput = schema(rerunInput);
export const RerunResult = schema(rerunResult);
export const ComputeRerunInput = schema(computeRerunInput);
export const ComputeRerunResult = schema(computeRerunResult);

export type Scalar = string | number | boolean | null;
export interface Parameter {
	readonly name: string;
	readonly value: Scalar;
}
export interface Budget {
	readonly maxTokens: number;
	readonly maxCost: number | null;
	readonly timeoutMs: number;
	readonly maxOutputBytes: number;
}
export interface Question {
	readonly id: Id;
	readonly findingId: Id;
	readonly checklistItem: (typeof Question.properties.checklistItem.enum)[number];
	readonly question: string;
	readonly severity: (typeof Question.properties.severity.enum)[number];
	readonly evidenceArtifactIds: readonly Id[];
}
export interface Attempt {
	readonly id: Id;
	readonly hypothesisIds: readonly Id[];
	readonly parameters: readonly Parameter[];
	readonly artifactIds: readonly Id[];
	readonly resultSummary: string;
	readonly outcome: (typeof Attempt.properties.outcome.enum)[number];
	readonly enteredReport: boolean;
	readonly startedAt: Time;
	readonly finishedAt: Time | null;
	readonly executionReceiptRef: Id;
}
export type Record =
	| { readonly kind: "critic-question"; readonly value: Question }
	| { readonly kind: "path-attempt"; readonly value: Attempt };
export interface RecordInput {
	readonly requestId: Id;
	readonly projectId: Id;
	readonly records: readonly Record[];
}
export interface RecordCommit {
	readonly recordIds: readonly Id[];
	readonly stateVersion: Hash;
	readonly authority: "plugin-asserted-or-imported";
	readonly hostReceiptRefs: readonly Id[];
}
export interface CollectInput {
	readonly after: Id | null;
	readonly limit: number;
}
export interface FactArtifact {
	readonly id: Id;
	readonly path: Relative;
	readonly bytes: number;
	readonly sha256: Hash;
	readonly parentIds: readonly Id[];
	readonly purpose: (typeof FactArtifact.properties.purpose.enum)[number];
}
export interface Fact {
	readonly id: Id;
	readonly sequence: number;
	readonly kind: (typeof Fact.properties.kind.enum)[number];
	readonly entityId: Id;
	readonly at: Time;
	readonly status: (typeof Fact.properties.status.enum)[number];
	readonly artifactRefs: readonly FactArtifact[];
	readonly runReceiptRef: Id | null;
	readonly decisionKind: (typeof Fact.properties.decisionKind.anyOf)[0]["enum"][number] | null;
	readonly summary: string;
	readonly basis: readonly Id[];
}
export interface FactsResult {
	readonly cursor: Id | null;
	readonly facts: readonly Fact[];
}
export interface CollectResult {
	readonly cursor: Id | null;
	readonly projectedRecordIds: readonly Id[];
	readonly stateVersion: Hash;
	readonly hostReceiptRefs: readonly Id[];
	readonly authority: "host-observed";
}
export interface RerunInput {
	readonly requestId: Id;
	readonly artifactId: Id;
	readonly profile: Id;
	readonly preflightRef: Id;
	readonly budget: Budget;
}
export interface RerunResult {
	readonly requestId: Id;
	readonly rerunId: Id;
	readonly jobId: Id | null;
	readonly status: (typeof RerunResult.properties.status.enum)[number];
	readonly previousSha256: Hash;
	readonly resultArtifactId: Id | null;
	readonly sha256: Hash | null;
	readonly errorCode: string | null;
	readonly hostReceiptRefs: readonly Id[];
	readonly stateVersion: Hash;
}
export interface ComputeRerunInput {
	readonly requestId: Id;
	readonly sourceRunReceiptRef: Id;
	readonly artifactId: Id;
	readonly expectedSha256: Hash;
	readonly profile: Id;
	readonly preflightRef: Id;
	readonly budget: Budget;
}
export interface ComputeRerunResult {
	readonly requestId: Id;
	readonly jobId: Id | null;
	readonly status: (typeof ComputeRerunResult.properties.status.enum)[number];
	readonly artifacts: readonly FactArtifact[];
	readonly receiptRef: Id;
}
