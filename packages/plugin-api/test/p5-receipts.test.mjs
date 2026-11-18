import assert from "node:assert/strict";
import test from "node:test";
import {
	Code,
	Failure,
	FileReadback,
	Hash,
	Id,
	Receipt,
	ReceiptInput,
	Relative,
	RequestInput,
	resultEnvelope,
	Scope,
	Time,
	validateP5Failure,
	validateP5Receipt,
} from "../dist/p5-receipts.js";

const dialect = "https://json-schema.org/draft/2020-12/schema";
const requiredKeys = [
	"receiptRef",
	"requestId",
	"operation",
	"inputSha256",
	"scope",
	"category",
	"decision",
	"status",
	"at",
	"resultSha256",
	"readback",
	"parentReceiptRef",
];
const codes = [
	"PROVIDER_ABSENT",
	"PROVIDER_DISABLED",
	"PROVIDER_UNAVAILABLE",
	"PROVIDER_INCOMPATIBLE",
	"PROVIDER_AMBIGUOUS",
	"HOST_UNSUPPORTED",
	"INVALID_INPUT",
	"DENIED",
	"SCOPE_CHANGED",
	"STATE_CONFLICT",
	"READBACK_FAILED",
	"OUTCOME_UNKNOWN",
	"CANCELLED",
	"CLEANUP_FAILED",
	"INDEPENDENT_PROVIDER_REQUIRED",
	"BUDGET_EXHAUSTED",
	"MODEL_UNAVAILABLE",
	"REPLAY_EXECUTION_UNAVAILABLE",
	"VERIFY_ONLY",
	"LIMIT_EXCEEDED",
	"PATH_ESCAPE",
	"DUPLICATE_CONFLICT",
	"PERSISTENCE_PENDING",
];

function closed(properties) {
	return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const integer = { type: "integer", minimum: 0 };
const usageSchema = {
	...closed({
		state: { enum: ["known", "unknown"] },
		metered: { type: "boolean" },
		inputTokens: { anyOf: [integer, { type: "null" }] },
		outputTokens: { anyOf: [integer, { type: "null" }] },
		cacheReadTokens: { anyOf: [integer, { type: "null" }] },
		cacheWriteTokens: { anyOf: [integer, { type: "null" }] },
		cost: {
			anyOf: [
				closed({ amountMicros: integer, currency: { type: "string", pattern: "^[A-Z]{3}$", maxLength: 3 } }),
				{ type: "null" },
			],
		},
	}),
	required: ["state", "metered", "inputTokens", "outputTokens", "cost"],
	anyOf: [
		{ properties: { state: { const: "unknown" } } },
		{ properties: { inputTokens: integer, outputTokens: integer } },
	],
};

test("Receipt keeps the 12 required keys and permits optional usage", () => {
	assert.deepEqual(Receipt.required, requiredKeys);
	assert.deepEqual(Object.keys(Receipt.properties), [...requiredKeys, "usage"]);
});

test("common schemas preserve the design scalars and closed shapes", () => {
	assert.deepEqual(Id, { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" });
	assert.deepEqual(Hash, { type: "string", pattern: "^[a-f0-9]{64}$" });
	assert.deepEqual(Time, { type: "string", format: "date-time" });
	assert.deepEqual(Relative, {
		type: "string",
		minLength: 1,
		maxLength: 1024,
		pattern: "^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))[^/]+(?:/[^/]+)*$",
	});
	const text = { type: "string", minLength: 1, maxLength: 20000 };
	assert.deepEqual(
		Scope,
		closed({
			workspaceId: text,
			sessionId: text,
			callerSourceHash: Hash,
			providerSourceHash: Hash,
		}),
	);
	assert.deepEqual(
		FileReadback,
		closed({ path: Relative, sha256: Hash, bytes: { type: "integer", minimum: 0 } }),
	);
	assert.deepEqual(RequestInput, { $schema: dialect, ...closed({ requestId: Id }) });
	assert.deepEqual(ReceiptInput, { $schema: dialect, ...closed({ receiptRef: Id }) });
	assert.deepEqual(Code.enum, codes);
});

test("Receipt and Failure use the exact design fields and result envelope", () => {
	const { usage: optionalUsage, ...requiredProperties } = Receipt.properties;
	assert.deepEqual(optionalUsage, usageSchema);
	const withoutUsage = { ...Receipt, properties: requiredProperties };
	assert.deepEqual(withoutUsage, {
		$schema: dialect,
		...closed({
			receiptRef: Id,
			requestId: Id,
			operation: { type: "string", minLength: 1, maxLength: 20000 },
			inputSha256: Hash,
			scope: Scope,
			category: {
				anyOf: [
					{ enum: ["application-state-write", "compute-preflight", "background-model-spend"] },
					{ type: "null" },
				],
			},
			decision: { enum: ["approved", "denied", "not-required"] },
			status: { enum: ["accepted", "succeeded", "failed", "cancelled", "cleanup-failed", "outcome-unknown"] },
			at: Time,
			resultSha256: { anyOf: [Hash, { type: "null" }] },
			readback: { type: "array", items: FileReadback, minItems: 0, maxItems: 10000 },
			parentReceiptRef: { anyOf: [Id, { type: "null" }] },
		}),
	});
	assert.deepEqual(Failure, {
		$schema: dialect,
		...closed({
			status: { const: "failed" },
			code: Code,
			receiptRef: { anyOf: [Id, { type: "null" }] },
		}),
	});
	assert.deepEqual(resultEnvelope(Receipt), {
		$schema: dialect,
		anyOf: [closed({ status: { const: "ok" }, value: Receipt }), Failure],
	});
});

const hash = "a".repeat(64);
function receipt() {
	return {
		receiptRef: "receipt-1",
		requestId: "request-1",
		operation: "evidence.freezeRecorded",
		inputSha256: hash,
		scope: {
			workspaceId: "workspace-1",
			sessionId: "session-1",
			callerSourceHash: hash,
			providerSourceHash: hash,
		},
		category: "application-state-write",
		decision: "approved",
		status: "accepted",
		at: "2026-11-18T01:30:00Z",
		resultSha256: null,
		readback: [{ path: "receipts/result.json", sha256: hash, bytes: 42 }],
		parentReceiptRef: null,
	};
}

function rejected(validate, value) {
	const result = validate(value);
	assert.equal(result.ok, false);
	assert.ok(result.errors.length > 0);
	assert.ok(result.errors.every((error) => typeof error === "string" && error.length > 0));
}

test("receipt validation accepts complete receipts without mutating them", () => {
	const value = receipt();
	const original = structuredClone(value);
	assert.deepEqual(validateP5Receipt(value), { ok: true });
	assert.deepEqual(validateP5Receipt(value), { ok: true });
	assert.deepEqual(value, original);
	assert.deepEqual(validateP5Receipt({ ...value, category: null, parentReceiptRef: "receipt-parent" }), {
		ok: true,
	});
	assert.deepEqual(
		validateP5Receipt({
			...value,
			scope: { ...value.scope, workspaceId: ".opaque", sessionId: "s".repeat(129) },
		}),
		{ ok: true },
	);
});

for (const [label, patch] of [
	["top-level extra property", { grant: "not-authority" }],
	["scope extra property", { scope: { ...receipt().scope, approval: "not-authority" } }],
	["readback extra property", { readback: [{ ...receipt().readback[0], content: "not-a-wire-field" }] }],
	["negative bytes", { readback: [{ ...receipt().readback[0], bytes: -1 }] }],
	["fractional bytes", { readback: [{ ...receipt().readback[0], bytes: 0.5 }] }],
	["unknown category", { category: "other" }],
	["unknown decision", { decision: "maybe" }],
	["unknown status", { status: "complete" }],
	["empty operation", { operation: "" }],
	["overlong operation", { operation: "x".repeat(20001) }],
	["empty scope identity", { scope: { ...receipt().scope, workspaceId: "" } }],
	["invalid scope", { scope: null }],
	["invalid readback entry", { readback: [null] }],
	["non-array readback", { readback: {} }],
	["too many readbacks", { readback: Array(10001).fill(receipt().readback[0]) }],
]) {
	test(`receipt rejects ${label}`, () => rejected(validateP5Receipt, { ...receipt(), ...patch }));
}

for (const key of ["category", "resultSha256", "parentReceiptRef"]) {
	test(`receipt rejects missing nullable ${key}`, () => {
		const value = receipt();
		delete value[key];
		rejected(validateP5Receipt, value);
	});
}

for (const key of ["receiptRef", "requestId", "parentReceiptRef"]) {
	for (const invalid of [".hidden", "x".repeat(129)]) {
		test(`receipt rejects invalid ${key}: ${invalid.length} characters`, () => {
			rejected(validateP5Receipt, { ...receipt(), [key]: invalid });
		});
	}
}

for (const invalid of ["A".repeat(64), "a".repeat(63)]) {
	for (const key of ["inputSha256", "resultSha256"]) {
		test(`receipt rejects ${key} hash ${invalid.slice(0, 1)}/${invalid.length}`, () => {
			rejected(validateP5Receipt, { ...receipt(), [key]: invalid });
		});
	}
	for (const key of ["callerSourceHash", "providerSourceHash"]) {
		test(`receipt rejects scope ${key} hash ${invalid.slice(0, 1)}/${invalid.length}`, () => {
			const value = receipt();
			rejected(validateP5Receipt, { ...value, scope: { ...value.scope, [key]: invalid } });
		});
	}
	test(`receipt rejects readback hash ${invalid.slice(0, 1)}/${invalid.length}`, () => {
		const value = receipt();
		value.readback[0].sha256 = invalid;
		rejected(validateP5Receipt, value);
	});
}

for (const path of [
	"/absolute",
	"..",
	"../escape",
	"nested/../escape",
	"nested\\file",
	".",
	"nested/./file",
	"",
	"x".repeat(1025),
]) {
	test(`receipt rejects invalid readback path: ${path.slice(0, 30)}`, () => {
		const value = receipt();
		value.readback[0].path = path;
		rejected(validateP5Receipt, value);
	});
}

for (const at of ["not-a-time", "2026-02-30T01:30:00Z", "2026-11-18T24:00:00Z", "2026-11-18T01:30:00"]) {
	test(`receipt rejects invalid date-time: ${at}`, () => {
		rejected(validateP5Receipt, { ...receipt(), at });
	});
}

test("receipt accepts design limits and relative filenames containing dots", () => {
	const value = receipt();
	value.receiptRef = "x".repeat(128);
	value.operation = "😀".repeat(20000);
	value.readback = Array(10000).fill({ path: "nested/file..json", bytes: 0, sha256: hash });
	value.at = "2024-02-29T09:30:00.123+08:00";
	assert.deepEqual(validateP5Receipt(value), { ok: true });
});

test("failure validation accepts every design code and nullable reference", () => {
	for (const code of codes) {
		assert.deepEqual(validateP5Failure({ status: "failed", code, receiptRef: null }), { ok: true });
		assert.deepEqual(validateP5Failure({ status: "failed", code, receiptRef: "receipt-1" }), { ok: true });
	}
});

for (const [label, value] of [
	["unknown Code", { status: "failed", code: "UNKNOWN", receiptRef: null }],
	["status other than failed", { status: "ok", code: "DENIED", receiptRef: null }],
	["missing nullable receiptRef", { status: "failed", code: "DENIED" }],
	["extra property", { status: "failed", code: "DENIED", receiptRef: null, grant: "not-authority" }],
	["leading dot Id", { status: "failed", code: "DENIED", receiptRef: ".hidden" }],
	["overlong Id", { status: "failed", code: "DENIED", receiptRef: "x".repeat(129) }],
]) {
	test(`failure rejects ${label}`, () => rejected(validateP5Failure, value));
}

for (const [label, patch] of [
	["denial with non-failed status", { decision: "denied", readback: [] }],
	["denial with readback", { decision: "denied", status: "failed" }],
	["denial with result hash", { decision: "denied", status: "failed", resultSha256: hash, readback: [] }],
	["success without result hash", { status: "succeeded" }],
	["denied success", { decision: "denied", status: "succeeded", resultSha256: hash, readback: [] }],
]) {
	test(`receipt rejects ${label}`, () => rejected(validateP5Receipt, { ...receipt(), ...patch }));
}

for (const status of ["failed", "cancelled", "outcome-unknown"]) {
	test(`receipt rejects a result hash for ${status}`, () => {
		rejected(validateP5Receipt, { ...receipt(), status, resultSha256: hash });
		assert.deepEqual(validateP5Receipt({ ...receipt(), status }), { ok: true });
	});
}

test("receipt accepts denial without invocation and successful approved or unrequired actions", () => {
	const value = receipt();
	assert.deepEqual(validateP5Receipt({ ...value, decision: "denied", status: "failed", readback: [] }), {
		ok: true,
	});
	for (const decision of ["approved", "not-required"]) {
		assert.deepEqual(validateP5Receipt({ ...value, decision, status: "succeeded", resultSha256: hash }), {
			ok: true,
		});
	}
	assert.deepEqual(validateP5Receipt({ ...value, status: "cleanup-failed" }), { ok: true });
	assert.deepEqual(validateP5Receipt({ ...value, status: "accepted", resultSha256: hash }), { ok: true });
});

const usage = {
	state: "known",
	metered: true,
	inputTokens: 12,
	outputTokens: 3,
	cost: { amountMicros: 250, currency: "USD" },
};

test("usage is a closed public schema and preserves known, unmetered and unknown metadata", async () => {
	assert.deepEqual((await import("../dist/p5-receipts.js")).Usage, usageSchema);
	for (const metadata of [
		usage,
		{ ...usage, cacheReadTokens: 100, cacheWriteTokens: 10 },
		{ ...usage, cacheReadTokens: null, cacheWriteTokens: null },
		{ ...usage, metered: false, inputTokens: 0, outputTokens: 0, cost: { ...usage.cost, amountMicros: 0 } },
		{ state: "unknown", metered: true, inputTokens: null, outputTokens: null, cost: null },
	]) {
		const value = { ...receipt(), status: "succeeded", resultSha256: hash, usage: metadata };
		const original = structuredClone(value);
		assert.deepEqual(validateP5Receipt(value), { ok: true });
		assert.deepEqual(value, original);
	}
});

for (const patch of [
	{ state: "other" },
	{ metered: "yes" },
	{ inputTokens: -1 },
	{ inputTokens: null },
	{ outputTokens: 0.5 },
	{ outputTokens: null },
	...["cacheReadTokens", "cacheWriteTokens"].flatMap((field) =>
		[-1, 0.5, "12"].map((value) => ({ [field]: value })),
	),
	{ inputTokens: "12" },
	{ prompt: "synthetic text" },
	{ response: "synthetic text" },
	{ authority: true },
	{ cost: { ...usage.cost, content: "synthetic text" } },
	...[-1, 0.5].map((amountMicros) => ({ cost: { ...usage.cost, amountMicros } })),
	...["usd", "US", "USDD", "U1D", "USD\n"].map((currency) => ({ cost: { ...usage.cost, currency } })),
]) {
	test(`receipt rejects invalid usage ${JSON.stringify(patch)}`, () => {
		rejected(validateP5Receipt, { ...receipt(), usage: { ...usage, ...patch } });
	});
}
