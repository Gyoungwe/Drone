import assert from "node:assert/strict";
import test from "node:test";
import * as evidence from "../dist/p5-evidence.js";
import * as receipts from "../dist/p5-receipts.js";

// biome-ignore format: Preserve the verbatim section 3 design generator and selected definitions.
function designDefinitions() {
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
// biome-ignore lint/correctness/noUnusedVariables: Preserve the normative generator helpers.
const Scalar = U({type:"string"},F,B,{type:"null"});
const Relative = {type:"string",minLength:1,maxLength:1024,pattern:"^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))[^/]+(?:/[^/]+)*$"};
const d = {};
d.Identity = O({id:Id,version:S});
d.Gate = O({code:E("scientific-ambiguity","missing-data","missing-biological-replicates","reference-mismatch","unsupported-method"),severity:E("pause","block"),message:S,evidenceKey:S});
d.Readiness = O({ok:B,inferentialClaimsAllowed:B,gates:A(R("Gate")),warnings:A(S)});
d.Plan = O({format:C("drone-analysis-evidence-plan"),version:C(1),analysis:R("Identity"),adapter:R("Identity"),adapterSnapshotSha256:Hash,method:R("Identity"),requiredOutputs:A(Relative,1),readiness:R("Readiness"),execution:C("host-required"),evidence:C("host-supplied")});
d.PlanInput = O({plan:R("Plan")});
d.ValidatedPlan = O({plan:R("Plan"),planSha256:Hash});
d.Context = O({version:C(1),id:Id,question:S,assay:S,mode:E("exploratory","inferential"),adapter:R("Identity")});
d.AdapterPlan = O({method:R("Identity"),requiredOutputs:A(Relative,1),assessment:R("Readiness"),adapterSnapshotSha256:Hash});
d.PreparationInput = O({context:R("Context"),adapterPlan:R("AdapterPlan")});
d.OverviewInput = O({analysisId:Id});
d.CapabilityInput = O({analysisId:Id,capabilityId:Id});
d.CheckpointSummary = O({checkpointId:Hash,analysisId:Id,createdAt:Time,fileCount:I});
d.Overview = O({checkpoints:A(R("CheckpointSummary")),branches:A(Id),executableReplay:C("unavailable"),receipts:A(Id)});
d.Capability = O({capabilityId:Id,checkpointIds:A(Hash),verification:E("unverified","matched","mismatched"),executableReplay:C("unavailable")});
d.Access = O({artifactId:Id,versionId:Id,accessLevel:E("public","restricted","private")});
d.FreezeInput = O({requestId:Id,analysisId:Id,runReceiptRef:Id,plan:R("Plan"),access:A(R("Access"),1)});
d.ImportInput = O({requestId:Id,sourceFileRef:Id,expectedSha256:Hash});
d.ForkInput = O({requestId:Id,checkpointId:Hash,branchId:Id});
d.EvidenceExportInput = O({requestId:Id,checkpointId:Hash,audience:E("public","restricted","private"),destination:Relative});
d.Output = O({path:Relative,bytes:I,sha256:Hash});
d.VerifyInput = O({checkpointId:Hash,environmentFingerprint:N(S),outputs:A(R("Output"))});
d.Verification = O({status:E("reproduced","failed"),detail:S,outputChecks:A(O({path:Relative,matched:B})),environmentMatched:B,comparisonOnly:C(true)});
d.FileReadback = O({path:Relative,sha256:Hash,bytes:I});
d.EvidenceCommit = O({checkpointId:Hash,branchId:N(Id),stateVersion:Hash,hostReceiptRefs:A(Id,1)});
d.BundleCommit = O({files:A(R("FileReadback"),1,2),receiptRef:Id,cleanup:E("complete","failed"),stateVersion:N(Hash)});
d.ExportSource = U(O({kind:C("text"),text:{type:"string"}}),O({kind:C("staged-file"),fileRef:Id}));
d.ExportFile = O({path:Relative,mediaType:E("text/x-python","text/x-r","application/x-ipynb+json","application/json"),source:R("ExportSource"),sha256:Hash,bytes:I});
d.BundleInput = O({requestId:Id,files:A(R("ExportFile"),1,2)});
return d;
}

const definitions = designDefinitions();
const { resultEnvelope, ...schemas } = evidence;
const dialect = "https://json-schema.org/draft/2020-12/schema";

function inlineReferences(node) {
	if (Array.isArray(node)) return node.map(inlineReferences);
	if (node === null || typeof node !== "object") return node;
	if ("$ref" in node) {
		const name = node.$ref.slice("#/$defs/".length);
		assert.ok(Object.hasOwn(definitions, name), `Missing design definition: ${name}`);
		return inlineReferences(definitions[name]);
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
	assert.notDeepEqual(node, {}, `Empty schema at ${path}`);
	if (node.type === "object") {
		assert.equal(node.additionalProperties, false, path);
		assert.deepEqual(node.required, Object.keys(node.properties), path);
	}
	for (const [key, value] of Object.entries(node)) assertClosedTree(value, `${path}.${key}`);
}

test("exports exactly the 27 requested schemas and the shared result envelope", () => {
	const expected = Object.keys(definitions).filter((name) => name !== "FileReadback");
	assert.equal(expected.length, 27);
	assert.deepEqual(Object.keys(schemas).sort(), expected.sort());
	assert.equal(resultEnvelope, receipts.resultEnvelope);
});

for (const [name, definition] of Object.entries(definitions)) {
	if (name === "FileReadback") continue;
	test(`${name} exactly transcribes the design with all references inlined`, () => {
		const { $schema, ...actual } = schemas[name];
		assert.equal($schema, dialect);
		assert.deepEqual(actual, inlineReferences(definition));
	});
}

for (const [name, schema] of Object.entries(schemas)) {
	test(`${name} is a closed tree without functions or empty schemas`, () => {
		assertClosedTree(schema, name);
	});
}

test("replay remains unavailable and verification only compares metadata", () => {
	assert.deepEqual(evidence.Overview.properties.executableReplay, { const: "unavailable" });
	assert.deepEqual(evidence.Capability.properties.executableReplay, { const: "unavailable" });
	assert.deepEqual(evidence.Verification.properties.comparisonOnly, { const: true });
});

test("nullable fields remain required and allow explicit null", () => {
	for (const [schema, key] of [
		[evidence.VerifyInput, "environmentFingerprint"],
		[evidence.EvidenceCommit, "branchId"],
		[evidence.BundleCommit, "stateVersion"],
	]) {
		assert.ok(schema.required.includes(key));
		assert.deepEqual(schema.properties[key].anyOf[1], { type: "null" });
	}
});

test("reuses the receipt scalars and file readback schema", () => {
	assert.equal(evidence.Identity.properties.id, receipts.Id);
	assert.equal(evidence.Plan.properties.adapterSnapshotSha256, receipts.Hash);
	assert.equal(evidence.CheckpointSummary.properties.createdAt, receipts.Time);
	assert.equal(evidence.ExportFile.properties.path, receipts.Relative);
	assert.deepEqual(evidence.BundleCommit.properties.files.items, receipts.FileReadback);
	assert.equal(evidence.BundleCommit.properties.files.items, receipts.FileReadback);
});

test("shared result envelopes retain closed success and failure branches", () => {
	const envelope = resultEnvelope(evidence.BundleCommit);
	assert.equal(envelope.$schema, dialect);
	assert.equal(envelope.anyOf[0].properties.value, evidence.BundleCommit);
	assert.equal(envelope.anyOf[1], receipts.Failure);
	assertClosedTree(envelope, "BundleCommit result");
});
