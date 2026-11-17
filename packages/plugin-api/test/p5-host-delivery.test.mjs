import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as inquiry from "../dist/p5-inquiry.js";

const inquiryModule = fileURLToPath(new URL("../dist/p5-inquiry.js", import.meta.url));
const declarations = readFileSync(new URL("../dist/p5-inquiry.d.ts", import.meta.url), "utf8");
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

// Captured from the base build before adding the type-only delivery contract.
const baseExports = [
	"Attempt",
	"Budget",
	"CollectInput",
	"CollectResult",
	"ComputeRerunInput",
	"ComputeRerunResult",
	"Fact",
	"FactArtifact",
	"FactsResult",
	"Parameter",
	"Question",
	"Record",
	"RecordCommit",
	"RecordInput",
	"RerunInput",
	"RerunResult",
	"Scalar",
	"resultEnvelope",
];

// biome-ignore format: Preserve the frozen design generator lines verbatim.
function designGenerator() {
const O = (properties, required = Object.keys(properties)) => ({type:"object",properties,required,additionalProperties:false});
const A = (items, minItems = 0, maxItems = 10000) => ({type:"array",items,minItems,maxItems});
const E = (...values) => ({enum:values});
const R = name => ({$ref:`#/$defs/${name}`});
const U = (...anyOf) => ({anyOf});
const N = value => U(value,{type:"null"});
const S = {type:"string",minLength:1,maxLength:20000};
const Id = {type:"string",pattern:"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"};
const Hash = {type:"string",pattern:"^[a-f0-9]{64}$"};
const Time = {type:"string",format:"date-time"};
const I = {type:"integer",minimum:0};
const Relative = {type:"string",minLength:1,maxLength:1024,pattern:"^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))[^/]+(?:/[^/]+)*$"};
const d = {};
d.CollectInput = O({after:N(Id),limit:{type:"integer",minimum:1,maximum:64}});
d.FactArtifact = O({id:Id,path:Relative,bytes:I,sha256:Hash,parentIds:A(Id),purpose:E("input","draft","intermediate","deliverable","evidence")});
d.Fact = O({id:Id,sequence:I,kind:E("compute","local-execution","decision","task-accepted"),entityId:Id,at:Time,status:E("created","submitted","running","succeeded","failed","cancelled","blocked","partial","unknown","accepted"),artifactRefs:A(R("FactArtifact")),runReceiptRef:N(Id),decisionKind:N(E("task-authorization","workflow-repair","subagent-dispatch","compute-submit","zotero-write","rebind")),summary:S,basis:A(Id)});
d.FactsResult = O({cursor:N(Id),facts:A(R("Fact"),0,64)});
return d;
}

const design = designGenerator();

function inlineReferences(node) {
	if (node === null || typeof node !== "object") return node;
	if (Array.isArray(node)) return node.map(inlineReferences);
	if (Object.hasOwn(node, "$ref")) return inlineReferences(design[node.$ref.slice("#/$defs/".length)]);
	return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, inlineReferences(value)]));
}

function compileFixture(t, source) {
	const directory = mkdtempSync(join(tmpdir(), "drone-host-delivery-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(join(directory, "fixture.ts"), source);
	writeFileSync(
		join(directory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				noEmit: true,
				strict: true,
				module: "ESNext",
				moduleResolution: "Bundler",
				target: "ES2023",
				types: [],
			},
			files: ["fixture.ts"],
		}),
	);
	return spawnSync(process.execPath, [tsc, "--project", join(directory, "tsconfig.json"), "--noEmit"], {
		encoding: "utf8",
	});
}

test("host delivery adds no runtime exports or changes to the frozen fact schemas", () => {
	assert.deepEqual(Object.keys(inquiry).toSorted(), baseExports);
	assert.deepEqual(inquiry.CollectInput, {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		...inlineReferences(design.CollectInput),
	});
	assert.deepEqual(inquiry.Fact, {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		...inlineReferences(design.Fact),
	});
	assert.deepEqual(inquiry.FactsResult, {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		...inlineReferences(design.FactsResult),
	});
});

test("delivery declarations reuse fact data and keep host identity outside payload properties", () => {
	const names = [
		"HostFactDeliveryHandle",
		"HostFactDelivery",
		"HostFactDeliveryAcknowledgement",
		"HostFactDeliveryOwner",
		"HostFactDeliveryBinding",
		"HostFactDeliveryLifecycle",
	];
	for (const name of names) {
		const declaration = declarations.match(new RegExp(`export interface ${name}\\b[^}]*\\}`, "u"));
		assert.ok(declaration, `${name} must be declared`);
		assert.doesNotMatch(
			declaration[0],
			/\b(?:origin|producer|attestation|grant|token|credential|path|kind)\??\s*:/u,
		);
	}
	assert.match(declarations, /export interface HostFactDelivery extends FactsResult\s*\{/u);
	assert.match(declarations, /readonly handle: HostFactDeliveryHandle;/u);
	assert.match(declarations, /readonly __hostDeliveryHandle: unique symbol;/u);
});

test("acknowledgement and the bind, delivery, unsubscribe and drain contract compile", (t) => {
	const result = compileFixture(
		t,
		`
import type {
  FactsResult, HostFactDelivery, HostFactDeliveryAcknowledgement, HostFactDeliveryHandle,
  HostFactDeliveryLifecycle, HostFactDeliveryOwner,
} from ${JSON.stringify(inquiryModule)};
import type { Id } from ${JSON.stringify(fileURLToPath(new URL("../dist/p5-receipts.js", import.meta.url)))};
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type PayloadKeys = Assert<Equal<keyof HostFactDelivery, keyof FactsResult | "handle">>;
type Cursor = Assert<Equal<HostFactDeliveryAcknowledgement["cursor"], Id>>;
declare const lifecycle: HostFactDeliveryLifecycle;
declare const owner: HostFactDeliveryOwner;
declare const batch: HostFactDelivery;
const handle: HostFactDeliveryHandle = batch.handle;
const facts: FactsResult = batch;
const committed: HostFactDeliveryAcknowledgement = { cursor: "fact:2" };
// @ts-expect-error An acknowledgement must name a consumed fact ID.
const pending: HostFactDeliveryAcknowledgement = { cursor: null };
const binding = lifecycle.bind(owner);
const acknowledged: Promise<HostFactDeliveryAcknowledgement> = owner.deliver(batch);
binding.unsubscribe();
const drained: Promise<void> = binding.drain();
// @ts-expect-error The delivery handle cannot be replaced by a plugin.
batch.handle = handle;
// @ts-expect-error Delivered facts are immutable.
batch.facts.push(batch.facts[0]);
// @ts-expect-error Acknowledged cursors are immutable.
committed.cursor = "fact:3";
`,
	);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("plugin object literals cannot construct an opaque host delivery handle", (t) => {
	const result = compileFixture(
		t,
		`
import type { HostFactDeliveryHandle } from ${JSON.stringify(inquiryModule)};
const missingBrand: HostFactDeliveryHandle = {};
const inventedBrand: HostFactDeliveryHandle = { __hostDeliveryHandle: Symbol() };
`,
	);
	assert.equal(result.status, 2, result.stdout + result.stderr);
	assert.match(result.stdout, /error TS2741: Property '__hostDeliveryHandle' is missing/u);
	assert.match(result.stdout, /error TS2322: Type 'symbol' is not assignable to type 'unique symbol'/u);
});

test("native operations retain exactly the two SDK events", () => {
	const native = readFileSync(new URL("../dist/native.d.ts", import.meta.url), "utf8");
	const operation = native.match(/export interface PluginNativeOperation\s*\{([^}]+)\}/u);
	assert.ok(operation);
	assert.equal(
		operation[1].match(/readonly event:\s*([^;]+);/u)?.[1],
		'"message_start" | "tool_execution_end"',
	);
});
