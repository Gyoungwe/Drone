// biome-ignore-all lint/performance/noDynamicNamespaceImportAccess: Conformance tests inspect schemas by exported name.
import assert from "node:assert/strict";
import test from "node:test";
import * as discovery from "../dist/p5-discovery.js";
import { Budget, Parameter, Question } from "../dist/p5-inquiry.js";
import { Hash, Id, resultEnvelope } from "../dist/p5-receipts.js";

// This frozen generator is independent of the implementation and preserves design section 3 verbatim.
// biome-ignore format: Preserve the frozen design generator verbatim.
function designGenerator() {
const O = (properties, required = Object.keys(properties)) => ({type:"object",properties,required,additionalProperties:false});
const A = (items, minItems = 0, maxItems = 10000) => ({type:"array",items,minItems,maxItems});
const E = (...values) => ({enum:values});
const C = value => ({const:value});
const R = name => ({$ref:`#/$defs/${name}`});
const U = (...anyOf) => ({anyOf});
const N = value => U(value,{type:"null"});
const S = {type:"string",minLength:1,maxLength:20000};
const Id = {type:"string",pattern:"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"};
const Hash = {type:"string",pattern:"^[a-f0-9]{64}$"};
const B = {type:"boolean"}, I = {type:"integer",minimum:0}, F = {type:"number"};
const Scalar = U({type:"string"},F,B,{type:"null"});
const d = {};
d.Parameter = O({name:S,value:Scalar});
d.Question = O({id:Id,findingId:Id,checklistItem:E("confounding","batch-effect","multiple-testing","data-leakage","circular-analysis","overclaiming"),question:S,severity:E("high","medium","low"),evidenceArtifactIds:A(Id)});
d.Budget = O({maxTokens:I,maxCost:N({type:"number",minimum:0}),timeoutMs:{type:"integer",minimum:1,maximum:86400000},maxOutputBytes:{type:"integer",minimum:1}});
d.CriticInput = O({requestId:Id,findingId:Id,findingStatement:S,artifactIds:A(Id),primaryRunReceiptRef:Id,profile:Id,budget:R("Budget")});
d.CriticResult = O({status:E("complete","blocked","needs-independent-provider"),provider:N(S),questions:A(R("Question"),0,64),modelReceiptRef:Id,journalVersion:N(Hash),inquiryReceiptRefs:A(Id)});
d.Path = O({id:Id,description:S,parameters:A(R("Parameter"))});
d.Metric = E("bixbench-regression","rediscovery-rate","inconsistency-interception-rate","confounder-detection-rate","clue-hit-rate","verification-time-ms","repeated-failure-count");
d.Case = O({id:Id,metric:R("Metric"),datasetId:Id,datasetRevision:S,datasetStatus:E("fixture","external","missing"),description:S});
d.ComputeItem = O({kind:C("compute"),preflightRef:Id});
d.ModelItem = O({kind:C("model"),profile:Id,prompt:S,resultKind:E("path-result","evaluation-observation")});
d.Item = O({id:Id,budget:R("Budget"),execution:U(R("ComputeItem"),R("ModelItem"))});
d.Multipath = O({kind:C("multipath"),planId:Id,findingId:Id,intent:E("exploratory","confirmatory"),priorRecordRef:N(Id),paths:A(R("Path"),5,10)});
d.Evaluation = O({kind:C("evaluation"),runId:Id,cases:A(R("Case"),1,64)});
d.BatchInput = O({requestId:Id,plan:U(R("Multipath"),R("Evaluation")),items:A(R("Item"),1,64)});
d.PathResult = O({outcome:E("succeeded","failed","blocked","unknown"),signature:Id,summary:S,artifactIds:A(Id),consistentWithReference:B});
d.Observation = O({value:F,passed:N(B),verificationTimeMs:N(I),evidence:A(Id)});
d.ItemResult = O({itemId:Id,status:E("pending","running","succeeded","failed","blocked","cancelled"),value:N(U(R("PathResult"),R("Observation"))),hostReceiptRef:N(Id)});
d.MetricResult = O({metric:R("Metric"),value:F,baseline:N(F),delta:N(F),passed:B,baselineAvailable:B,caseIds:A(Id)});
d.BatchResult = O({requestId:Id,status:E("accepted","running","complete","needs-data","blocked","cancelled","cleanup-failed"),batchReceiptRef:Id,items:A(R("ItemResult")),grade:N(E("robust","sensitive","unstable","unknown")),metrics:A(R("MetricResult")),journalVersion:N(Hash),inquiryReceiptRefs:A(Id)});
d.KernelExportInput = O({requestId:Id,kernelSessionId:Id});
const schema = name => ({$schema:"https://json-schema.org/draft/2020-12/schema",$defs:d,...R(name)});
return { d, schema };
}
const generator = designGenerator();
const schemaNames = Object.keys(generator.d).filter(
	(name) => !["Parameter", "Budget", "Question"].includes(name),
);
const dialect = "https://json-schema.org/draft/2020-12/schema";

function inlineReferences(node) {
	if (node === null || typeof node !== "object") return node;
	if (Array.isArray(node)) return Array.from(node, inlineReferences);
	if (Object.hasOwn(node, "$ref")) {
		const name = node.$ref.slice("#/$defs/".length);
		assert.ok(Object.hasOwn(generator.d, name), `Unknown design reference: ${name}`);
		return inlineReferences(generator.d[name]);
	}
	return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, inlineReferences(value)]));
}

function assertClosedTree(node, path) {
	assert.notEqual(typeof node, "function", path);
	if (node === null || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const [index, value] of node.entries()) assertClosedTree(value, `${path}[${index}]`);
		return;
	}
	assert.notDeepEqual(node, {}, `${path} must not be an empty schema`);
	assert.equal(Object.hasOwn(node, "$ref"), false, `${path} must inline references`);
	if (node.type === "object") {
		assert.equal(node.additionalProperties, false, path);
		assert.deepEqual(node.required.toSorted(), Object.keys(node.properties).toSorted(), path);
	}
	for (const [key, value] of Object.entries(node)) assertClosedTree(value, `${path}.${key}`);
}

for (const name of schemaNames) {
	test(`${name} exactly matches the inlined design definition`, () => {
		const { $schema: _expectedDialect, $defs: _definitions, ...definition } = generator.schema(name);
		const { $schema: actualDialect, ...actual } = discovery[name];
		assert.equal(actualDialect, dialect);
		assert.deepEqual(actual, inlineReferences(definition));
		assertClosedTree(discovery[name], name);
	});
}

test("the public surface contains only the requested schemas and the shared envelope helper", () => {
	assert.deepEqual(Object.keys(discovery).toSorted(), [...schemaNames, "resultEnvelope"].toSorted());
	assert.equal(discovery.resultEnvelope, resultEnvelope);
});

test("shared questions, budgets and parameters reuse the Inquiry definitions", () => {
	const { $schema: _questionDialect, ...question } = Question;
	const { $schema: _budgetDialect, ...budget } = Budget;
	const { $schema: _parameterDialect, ...parameter } = Parameter;
	assert.deepEqual(discovery.CriticResult.properties.questions.items, question);
	assert.deepEqual(discovery.CriticInput.properties.budget, budget);
	assert.deepEqual(discovery.Item.properties.budget, budget);
	assert.deepEqual(discovery.Path.properties.parameters.items, parameter);
});

test("execution has exactly compute and model branches with host-resolved references", () => {
	const { $schema: _computeDialect, ...compute } = discovery.ComputeItem;
	const { $schema: _modelDialect, ...model } = discovery.ModelItem;
	assert.deepEqual(discovery.Item.properties.execution, { anyOf: [compute, model] });
	assert.deepEqual(
		discovery.Item.properties.execution.anyOf.map((branch) => branch.properties.kind),
		[{ const: "compute" }, { const: "model" }],
	);
	assert.deepEqual(Object.keys(compute.properties), ["kind", "preflightRef"]);
	assert.equal(compute.properties.preflightRef, Id);
	assert.equal(model.properties.profile, Id);
	assert.equal(discovery.CriticInput.properties.profile, Id);
});

test("path, case, item and question arrays preserve the design bounds", () => {
	for (const [collection, minimum, maximum] of [
		[discovery.Multipath.properties.paths, 5, 10],
		[discovery.Evaluation.properties.cases, 1, 64],
		[discovery.BatchInput.properties.items, 1, 64],
		[discovery.CriticResult.properties.questions, 0, 64],
	]) {
		assert.equal(collection.minItems, minimum);
		assert.equal(collection.maxItems, maximum);
	}
});

test("metrics contain exactly the seven design values", () => {
	assert.deepEqual(discovery.Metric.enum, [
		"bixbench-regression",
		"rediscovery-rate",
		"inconsistency-interception-rate",
		"confounder-detection-rate",
		"clue-hit-rate",
		"verification-time-ms",
		"repeated-failure-count",
	]);
});

test("nullable result fields stay present and receipt fields remain host lookup references", () => {
	assert.deepEqual(discovery.CriticResult.properties.provider, {
		anyOf: [{ type: "string", minLength: 1, maxLength: 20000 }, { type: "null" }],
	});
	assert.deepEqual(discovery.BatchResult.properties.journalVersion, { anyOf: [Hash, { type: "null" }] });
	assert.deepEqual(discovery.ItemResult.properties.hostReceiptRef, { anyOf: [Id, { type: "null" }] });
	assert.equal(discovery.CriticInput.properties.primaryRunReceiptRef, Id);
	assert.equal(discovery.CriticResult.properties.modelReceiptRef, Id);
	assert.equal(discovery.BatchResult.properties.batchReceiptRef, Id);
	assert.deepEqual(Object.keys(discovery.KernelExportInput.properties), ["requestId", "kernelSessionId"]);
});
