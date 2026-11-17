/** P5 design section 3 Discovery contracts. Host lookup references never convey authority. */
import { Budget, Parameter, Question } from "./p5-inquiry.js";
import { Hash, Id, resultEnvelope } from "./p5-receipts.js";

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
const number = { type: "number" } as const;
const boolean = { type: "boolean" } as const;
const { $schema: _budgetDialect, ...budget } = Budget;
const { $schema: _parameterDialect, ...parameter } = Parameter;
const { $schema: _questionDialect, ...question } = Question;

const criticInput = closedObject({
	requestId: Id,
	findingId: Id,
	findingStatement: text,
	artifactIds: array(Id),
	primaryRunReceiptRef: Id,
	profile: Id,
	budget,
});
const criticResult = closedObject({
	status: { enum: ["complete", "blocked", "needs-independent-provider"] },
	provider: nullable(text),
	questions: array(question, 0, 64),
	modelReceiptRef: Id,
	journalVersion: nullable(Hash),
	inquiryReceiptRefs: array(Id),
});
const path = closedObject({ id: Id, description: text, parameters: array(parameter) });
const metric = {
	enum: [
		"bixbench-regression",
		"rediscovery-rate",
		"inconsistency-interception-rate",
		"confounder-detection-rate",
		"clue-hit-rate",
		"verification-time-ms",
		"repeated-failure-count",
	],
} as const;
const evaluationCase = closedObject({
	id: Id,
	metric,
	datasetId: Id,
	datasetRevision: text,
	datasetStatus: { enum: ["fixture", "external", "missing"] },
	description: text,
});
const computeItem = closedObject({ kind: { const: "compute" }, preflightRef: Id });
const modelItem = closedObject({
	kind: { const: "model" },
	profile: Id,
	prompt: text,
	resultKind: { enum: ["path-result", "evaluation-observation"] },
});
const item = closedObject({ id: Id, budget, execution: { anyOf: [computeItem, modelItem] } });
const multipath = closedObject({
	kind: { const: "multipath" },
	planId: Id,
	findingId: Id,
	intent: { enum: ["exploratory", "confirmatory"] },
	priorRecordRef: nullable(Id),
	paths: array(path, 5, 10),
});
const evaluation = closedObject({
	kind: { const: "evaluation" },
	runId: Id,
	cases: array(evaluationCase, 1, 64),
});
const batchInput = closedObject({
	requestId: Id,
	plan: { anyOf: [multipath, evaluation] },
	items: array(item, 1, 64),
});
const pathResult = closedObject({
	outcome: { enum: ["succeeded", "failed", "blocked", "unknown"] },
	signature: Id,
	summary: text,
	artifactIds: array(Id),
	consistentWithReference: boolean,
});
const observation = closedObject({
	value: number,
	passed: nullable(boolean),
	verificationTimeMs: nullable(integer),
	evidence: array(Id),
});
const itemResult = closedObject({
	itemId: Id,
	status: { enum: ["pending", "running", "succeeded", "failed", "blocked", "cancelled"] },
	value: nullable({ anyOf: [pathResult, observation] }),
	hostReceiptRef: nullable(Id),
});
const metricResult = closedObject({
	metric,
	value: number,
	baseline: nullable(number),
	delta: nullable(number),
	passed: boolean,
	baselineAvailable: boolean,
	caseIds: array(Id),
});
const batchResult = closedObject({
	requestId: Id,
	status: {
		enum: ["accepted", "running", "complete", "needs-data", "blocked", "cancelled", "cleanup-failed"],
	},
	batchReceiptRef: Id,
	items: array(itemResult),
	grade: nullable({ enum: ["robust", "sensitive", "unstable", "unknown"] }),
	metrics: array(metricResult),
	journalVersion: nullable(Hash),
	inquiryReceiptRefs: array(Id),
});
const kernelExportInput = closedObject({ requestId: Id, kernelSessionId: Id });

export const CriticInput = schema(criticInput);
export const CriticResult = schema(criticResult);
export const Path = schema(path);
export const Metric = schema(metric);
export const Case = schema(evaluationCase);
export const ComputeItem = schema(computeItem);
export const ModelItem = schema(modelItem);
export const Item = schema(item);
export const Multipath = schema(multipath);
export const Evaluation = schema(evaluation);
export const BatchInput = schema(batchInput);
export const PathResult = schema(pathResult);
export const Observation = schema(observation);
export const ItemResult = schema(itemResult);
export const MetricResult = schema(metricResult);
export const BatchResult = schema(batchResult);
export const KernelExportInput = schema(kernelExportInput);

export interface CriticInput {
	readonly requestId: Id;
	readonly findingId: Id;
	readonly findingStatement: string;
	readonly artifactIds: readonly Id[];
	readonly primaryRunReceiptRef: Id;
	readonly profile: Id;
	readonly budget: Budget;
}
export interface CriticResult {
	readonly status: (typeof CriticResult.properties.status.enum)[number];
	readonly provider: string | null;
	readonly questions: readonly Question[];
	readonly modelReceiptRef: Id;
	readonly journalVersion: Hash | null;
	readonly inquiryReceiptRefs: readonly Id[];
}
export interface Path {
	readonly id: Id;
	readonly description: string;
	readonly parameters: readonly Parameter[];
}
export type Metric = (typeof Metric.enum)[number];
export interface Case {
	readonly id: Id;
	readonly metric: Metric;
	readonly datasetId: Id;
	readonly datasetRevision: string;
	readonly datasetStatus: (typeof Case.properties.datasetStatus.enum)[number];
	readonly description: string;
}
export interface ComputeItem {
	readonly kind: "compute";
	readonly preflightRef: Id;
}
export interface ModelItem {
	readonly kind: "model";
	readonly profile: Id;
	readonly prompt: string;
	readonly resultKind: (typeof ModelItem.properties.resultKind.enum)[number];
}
export interface Item {
	readonly id: Id;
	readonly budget: Budget;
	readonly execution: ComputeItem | ModelItem;
}
export interface Multipath {
	readonly kind: "multipath";
	readonly planId: Id;
	readonly findingId: Id;
	readonly intent: (typeof Multipath.properties.intent.enum)[number];
	readonly priorRecordRef: Id | null;
	readonly paths: readonly Path[];
}
export interface Evaluation {
	readonly kind: "evaluation";
	readonly runId: Id;
	readonly cases: readonly Case[];
}
export interface BatchInput {
	readonly requestId: Id;
	readonly plan: Multipath | Evaluation;
	readonly items: readonly Item[];
}
export interface PathResult {
	readonly outcome: (typeof PathResult.properties.outcome.enum)[number];
	readonly signature: Id;
	readonly summary: string;
	readonly artifactIds: readonly Id[];
	readonly consistentWithReference: boolean;
}
export interface Observation {
	readonly value: number;
	readonly passed: boolean | null;
	readonly verificationTimeMs: number | null;
	readonly evidence: readonly Id[];
}
export interface ItemResult {
	readonly itemId: Id;
	readonly status: (typeof ItemResult.properties.status.enum)[number];
	readonly value: PathResult | Observation | null;
	readonly hostReceiptRef: Id | null;
}
export interface MetricResult {
	readonly metric: Metric;
	readonly value: number;
	readonly baseline: number | null;
	readonly delta: number | null;
	readonly passed: boolean;
	readonly baselineAvailable: boolean;
	readonly caseIds: readonly Id[];
}
export interface BatchResult {
	readonly requestId: Id;
	readonly status: (typeof BatchResult.properties.status.enum)[number];
	readonly batchReceiptRef: Id;
	readonly items: readonly ItemResult[];
	readonly grade: (typeof BatchResult.properties.grade.anyOf)[0]["enum"][number] | null;
	readonly metrics: readonly MetricResult[];
	readonly journalVersion: Hash | null;
	readonly inquiryReceiptRefs: readonly Id[];
}
export interface KernelExportInput {
	readonly requestId: Id;
	readonly kernelSessionId: Id;
}
