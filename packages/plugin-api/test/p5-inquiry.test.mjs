// biome-ignore-all lint/performance/noDynamicNamespaceImportAccess: Conformance tests inspect schemas by exported name.
import assert from "node:assert/strict";
import test from "node:test";
import * as inquiry from "../dist/p5-inquiry.js";
import { Id, Relative, resultEnvelope } from "../dist/p5-receipts.js";

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
const Time = {type:"string",format:"date-time"};
const B = {type:"boolean"}, I = {type:"integer",minimum:0}, F = {type:"number"};
const Scalar = U({type:"string"},F,B,{type:"null"});
const Relative = {type:"string",minLength:1,maxLength:1024,pattern:"^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))[^/]+(?:/[^/]+)*$"};
const d = {};
d.Parameter = O({name:S,value:Scalar});
d.Question = O({id:Id,findingId:Id,checklistItem:E("confounding","batch-effect","multiple-testing","data-leakage","circular-analysis","overclaiming"),question:S,severity:E("high","medium","low"),evidenceArtifactIds:A(Id)});
d.Attempt = O({id:Id,hypothesisIds:A(Id),parameters:A(R("Parameter")),artifactIds:A(Id),resultSummary:S,outcome:E("running","succeeded","failed","blocked","unknown"),enteredReport:B,startedAt:Time,finishedAt:N(Time),executionReceiptRef:Id});
d.Record = U(O({kind:C("critic-question"),value:R("Question")}),O({kind:C("path-attempt"),value:R("Attempt")}));
d.RecordInput = O({requestId:Id,projectId:Id,records:A(R("Record"),1,64)});
d.RecordCommit = O({recordIds:A(Id,1,64),stateVersion:Hash,authority:C("plugin-asserted-or-imported"),hostReceiptRefs:A(Id,1)});
d.Budget = O({maxTokens:I,maxCost:N({type:"number",minimum:0}),timeoutMs:{type:"integer",minimum:1,maximum:86400000},maxOutputBytes:{type:"integer",minimum:1}});
d.CollectInput = O({after:N(Id),limit:{type:"integer",minimum:1,maximum:64}});
d.FactArtifact = O({id:Id,path:Relative,bytes:I,sha256:Hash,parentIds:A(Id),purpose:E("input","draft","intermediate","deliverable","evidence")});
d.Fact = O({id:Id,sequence:I,kind:E("compute","local-execution","decision","task-accepted"),entityId:Id,at:Time,status:E("created","submitted","running","succeeded","failed","cancelled","blocked","partial","unknown","accepted"),artifactRefs:A(R("FactArtifact")),runReceiptRef:N(Id),decisionKind:N(E("task-authorization","workflow-repair","subagent-dispatch","compute-submit","zotero-write","rebind")),summary:S,basis:A(Id)});
d.FactsResult = O({cursor:N(Id),facts:A(R("Fact"),0,64)});
d.CollectResult = O({cursor:N(Id),projectedRecordIds:A(Id),stateVersion:Hash,hostReceiptRefs:A(Id),authority:C("host-observed")});
d.RerunInput = O({requestId:Id,artifactId:Id,profile:Id,preflightRef:Id,budget:R("Budget")});
d.RerunResult = O({requestId:Id,rerunId:Id,jobId:N(Id),status:E("submitted","running","reproduced","superseded","failed"),previousSha256:Hash,resultArtifactId:N(Id),sha256:N(Hash),errorCode:N(S),hostReceiptRefs:A(Id),stateVersion:Hash});
d.ComputeRerunInput = O({requestId:Id,sourceRunReceiptRef:Id,artifactId:Id,expectedSha256:Hash,profile:Id,preflightRef:Id,budget:R("Budget")});
d.ComputeRerunResult = O({requestId:Id,jobId:N(Id),status:E("absent","accepted","running","succeeded","failed","cancelled","outcome-unknown"),artifacts:A(R("FactArtifact")),receiptRef:Id});
const schema = name => ({$schema:"https://json-schema.org/draft/2020-12/schema",$defs:d,...R(name)});
return { d, Scalar, schema };
}
const generator = designGenerator();
const schemaNames = ["Scalar", ...Object.keys(generator.d)];
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
		const expected = name === "Scalar" ? generator.Scalar : generator.schema(name);
		const { $schema: _expectedDialect, $defs: _definitions, ...definition } = expected;
		const { $schema: actualDialect, ...actual } = inquiry[name];
		assert.equal(actualDialect, dialect);
		assert.deepEqual(actual, inlineReferences(definition));
		assertClosedTree(inquiry[name], name);
	});
}

test("the public surface contains only the requested schemas and the shared envelope helper", () => {
	assert.deepEqual(Object.keys(inquiry).toSorted(), [...schemaNames, "resultEnvelope"].toSorted());
	assert.equal(inquiry.resultEnvelope, resultEnvelope);
});

test("asserted records and host-observed collection retain distinct authority constants", () => {
	assert.deepEqual(inquiry.RecordCommit.properties.authority, { const: "plugin-asserted-or-imported" });
	assert.deepEqual(inquiry.CollectResult.properties.authority, { const: "host-observed" });
	assert.equal(inquiry.Record.anyOf.length, 2);
	assert.deepEqual(
		inquiry.Record.anyOf.map((branch) => branch.properties.kind),
		[{ const: "critic-question" }, { const: "path-attempt" }],
	);
});

test("record, collection, fact and timeout limits preserve the design bounds", () => {
	const records = inquiry.RecordInput.properties.records;
	assert.equal(records.minItems, 1);
	assert.equal(records.maxItems, 64);
	assert.deepEqual(inquiry.CollectInput.properties.limit, { type: "integer", minimum: 1, maximum: 64 });
	assert.equal(inquiry.FactsResult.properties.facts.minItems, 0);
	assert.equal(inquiry.FactsResult.properties.facts.maxItems, 64);
	assert.deepEqual(inquiry.Budget.properties.timeoutMs, {
		type: "integer",
		minimum: 1,
		maximum: 86400000,
	});
});

test("receipt fields remain Id lookups and artifact paths reuse the confined relative schema", () => {
	assert.deepEqual(inquiry.Attempt.properties.executionReceiptRef, Id);
	assert.deepEqual(inquiry.Fact.properties.runReceiptRef, { anyOf: [Id, { type: "null" }] });
	assert.deepEqual(inquiry.ComputeRerunInput.properties.sourceRunReceiptRef, Id);
	assert.deepEqual(inquiry.ComputeRerunResult.properties.receiptRef, Id);
	for (const name of ["RecordCommit", "CollectResult", "RerunResult"]) {
		assert.deepEqual(inquiry[name].properties.hostReceiptRefs.items, Id);
	}
	assert.equal(inquiry.FactArtifact.properties.path, Relative);
});
