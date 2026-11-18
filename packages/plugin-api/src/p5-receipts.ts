/** P5 design section 3 wire contracts. Receipt references never convey authority. */
const dialect = "https://json-schema.org/draft/2020-12/schema";

function closedObject<const Properties extends Record<string, object>>(properties: Properties) {
	return {
		type: "object",
		properties,
		required: Object.keys(properties),
		additionalProperties: false,
	} as const;
}

function nullable<const Schema extends object>(schema: Schema) {
	return { anyOf: [schema, { type: "null" }] } as const;
}

const text = { type: "string", minLength: 1, maxLength: 20000 } as const;
export const Id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" } as const;
export const Hash = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;
export const Time = { type: "string", format: "date-time" } as const;
export const Relative = {
	type: "string",
	minLength: 1,
	maxLength: 1024,
	pattern: "^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))[^/]+(?:/[^/]+)*$",
} as const;

export const Scope = closedObject({
	workspaceId: text,
	sessionId: text,
	callerSourceHash: Hash,
	providerSourceHash: Hash,
});
export const FileReadback = closedObject({
	path: Relative,
	sha256: Hash,
	bytes: { type: "integer", minimum: 0 },
});
const nonNegativeInteger = { type: "integer", minimum: 0 } as const;
export const Usage = {
	...closedObject({
		state: { enum: ["known", "unknown"] },
		metered: { type: "boolean" },
		inputTokens: nullable(nonNegativeInteger),
		outputTokens: nullable(nonNegativeInteger),
		cost: nullable(
			closedObject({
				amountMicros: nonNegativeInteger,
				currency: { type: "string", pattern: "^[A-Z]{3}$", maxLength: 3 },
			}),
		),
	}),
	anyOf: [
		{ properties: { state: { const: "unknown" } } },
		{ properties: { inputTokens: nonNegativeInteger, outputTokens: nonNegativeInteger } },
	],
} as const;
const receiptSchema = {
	$schema: dialect,
	...closedObject({
		receiptRef: Id,
		requestId: Id,
		operation: text,
		inputSha256: Hash,
		scope: Scope,
		category: nullable({ enum: ["application-state-write", "compute-preflight", "background-model-spend"] }),
		decision: { enum: ["approved", "denied", "not-required"] },
		status: { enum: ["accepted", "succeeded", "failed", "cancelled", "cleanup-failed", "outcome-unknown"] },
		at: Time,
		resultSha256: nullable(Hash),
		readback: { type: "array", items: FileReadback, minItems: 0, maxItems: 10000 },
		parentReceiptRef: nullable(Id),
	}),
} as const;
export const Receipt = {
	...receiptSchema,
	properties: { ...receiptSchema.properties, usage: Usage },
} as const;
export const RequestInput = { $schema: dialect, ...closedObject({ requestId: Id }) } as const;
export const ReceiptInput = { $schema: dialect, ...closedObject({ receiptRef: Id }) } as const;
export const Code = {
	enum: [
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
	],
} as const;
export const Failure = {
	$schema: dialect,
	...closedObject({ status: { const: "failed" }, code: Code, receiptRef: nullable(Id) }),
} as const;

export function resultEnvelope<const ValueSchema extends object>(valueSchema: ValueSchema) {
	return {
		$schema: dialect,
		anyOf: [closedObject({ status: { const: "ok" }, value: valueSchema }), Failure],
	} as const;
}

export type Id = string;
export type Hash = string;
export type Time = string;
export type Relative = string;
export interface Scope {
	readonly workspaceId: string;
	readonly sessionId: string;
	readonly callerSourceHash: Hash;
	readonly providerSourceHash: Hash;
}
export interface FileReadback {
	readonly path: Relative;
	readonly sha256: Hash;
	readonly bytes: number;
}
export interface Receipt {
	readonly receiptRef: Id;
	readonly requestId: Id;
	readonly operation: string;
	readonly inputSha256: Hash;
	readonly scope: Scope;
	readonly category: "application-state-write" | "compute-preflight" | "background-model-spend" | null;
	readonly decision: "approved" | "denied" | "not-required";
	readonly status: "accepted" | "succeeded" | "failed" | "cancelled" | "cleanup-failed" | "outcome-unknown";
	readonly at: Time;
	readonly resultSha256: Hash | null;
	readonly readback: readonly FileReadback[];
	readonly parentReceiptRef: Id | null;
	readonly usage?: Usage;
}
export type Usage = {
	readonly metered: boolean;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly cost: { readonly amountMicros: number; readonly currency: string } | null;
} & (
	| { readonly state: "known"; readonly inputTokens: number; readonly outputTokens: number }
	| { readonly state: "unknown" }
);
export interface RequestInput {
	readonly requestId: Id;
}
export interface ReceiptInput {
	readonly receiptRef: Id;
}
export type Code = (typeof Code.enum)[number];
export interface Failure {
	readonly status: "failed";
	readonly code: Code;
	readonly receiptRef: Id | null;
}
export type Result<Value> = { readonly status: "ok"; readonly value: Value } | Failure;

export type P5Validation = { ok: true } | { ok: false; errors: string[] };
type Check = (value: unknown, path: string, errors: string[]) => void;
type Fields = Readonly<Record<string, Check>>;

function shape(
	value: unknown,
	fields: Fields,
	path: string,
	errors: string[],
	required: readonly string[] = Object.keys(fields),
): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		errors.push(`${path} must be an object`);
		return;
	}
	const record = value as Record<string, unknown>;
	for (const [key, check] of Object.entries(fields)) {
		if (!Object.hasOwn(record, key)) {
			if (required.includes(key)) errors.push(`${path}.${key} is required`);
		} else check(record[key], `${path}.${key}`, errors);
	}
	for (const key of Object.keys(record)) {
		if (!Object.hasOwn(fields, key)) errors.push(`${path}.${key} is not allowed`);
	}
}

function check(predicate: (value: unknown) => boolean, description: string): Check {
	return (value, path, errors) => {
		if (!predicate(value)) errors.push(`${path} must be ${description}`);
	};
}

function matching(pattern: string): Check {
	const expression = new RegExp(pattern);
	return check((value) => typeof value === "string" && expression.test(value), "a matching string");
}

function boundedString(minimum: number, maximum: number): Check {
	return check((value) => {
		if (typeof value !== "string") return false;
		const length = [...value].length;
		return length >= minimum && length <= maximum;
	}, `a string of ${minimum} to ${maximum} characters`);
}

function oneOf(values: readonly unknown[]): Check {
	return check((value) => values.includes(value), "a declared value");
}

function nullOr(validate: Check): Check {
	return (value, path, errors) => {
		if (value !== null) validate(value, path, errors);
	};
}

function dateTime(value: unknown): boolean {
	if (typeof value !== "string") return false;
	const parts =
		/^(\d{4})-(\d{2})-(\d{2})[tT](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[zZ]|([+-])(\d{2}):(\d{2}))$/.exec(
			value,
		);
	if (!parts) return false;
	const [, year, month, day, hour, minute, second, sign, offsetHour, offsetMinute] = parts;
	const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
	const days = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	const maxDay = days[Number(month)];
	if (maxDay === undefined || Number(day) < 1 || Number(day) > maxDay) return false;
	if (Number(hour) > 23 || Number(minute) > 59) return false;
	if (sign && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
	if (Number(second) < 60) return true;
	const offset = sign ? (sign === "+" ? 1 : -1) * (Number(offsetHour) * 60 + Number(offsetMinute)) : 0;
	const utcMinute = (((Number(hour) * 60 + Number(minute) - offset) % 1440) + 1440) % 1440;
	return Number(second) === 60 && utcMinute === 1439;
}

const id = matching(Id.pattern);
const hash = matching(Hash.pattern);
const string = boundedString(text.minLength, text.maxLength);
const scopeFields: Fields = {
	workspaceId: string,
	sessionId: string,
	callerSourceHash: hash,
	providerSourceHash: hash,
};
const relativePattern = matching(Relative.pattern);
const relativeLength = boundedString(Relative.minLength, Relative.maxLength);
const fileFields = {
	path: (value, path, errors) => {
		relativeLength(value, path, errors);
		relativePattern(value, path, errors);
	},
	sha256: hash,
	bytes: check(
		(value) => typeof value === "number" && Number.isInteger(value) && value >= 0,
		"a non-negative integer",
	),
} satisfies Fields;

function readbacks(value: unknown, path: string, errors: string[]): void {
	if (!Array.isArray(value)) {
		errors.push(`${path} must be an array`);
		return;
	}
	if (value.length > Receipt.properties.readback.maxItems) errors.push(`${path} exceeds 10000 entries`);
	for (const [index, entry] of value.entries()) shape(entry, fileFields, `${path}[${index}]`, errors);
}

const receiptFields: Fields = {
	receiptRef: id,
	requestId: id,
	operation: string,
	inputSha256: hash,
	scope: (value, path, errors) => shape(value, scopeFields, path, errors),
	category: nullOr(oneOf(Receipt.properties.category.anyOf[0].enum)),
	decision: oneOf(Receipt.properties.decision.enum),
	status: oneOf(Receipt.properties.status.enum),
	at: check(dateTime, "an RFC 3339 date-time"),
	resultSha256: nullOr(hash),
	readback: readbacks,
	parentReceiptRef: nullOr(id),
	usage: (value, path, errors) => shape(value, usageFields, path, errors),
};

const count = fileFields.bytes;
const costFields: Fields = {
	amountMicros: count,
	currency: check(
		(value) => typeof value === "string" && value.length === 3 && /^[A-Z]{3}$/.test(value),
		"a three-letter uppercase currency code",
	),
};
const usageFields: Fields = {
	state: oneOf(Usage.properties.state.enum),
	metered: oneOf([true, false]),
	inputTokens: nullOr(count),
	outputTokens: nullOr(count),
	cost: nullOr((value, path, errors) => shape(value, costFields, path, errors)),
};

export function validateP5Receipt(value: unknown): P5Validation {
	const errors: string[] = [];
	shape(value, receiptFields, "receipt", errors, Receipt.required);
	if (errors.length > 0) return { ok: false, errors };
	const receipt = value as Receipt;
	if (
		receipt.usage?.state === "known" &&
		(receipt.usage.inputTokens === null || receipt.usage.outputTokens === null)
	)
		errors.push("Known usage requires non-null token counts");
	if (receipt.decision === "denied") {
		if (receipt.status !== "failed" || receipt.resultSha256 !== null || receipt.readback.length !== 0)
			errors.push("A denied receipt must fail with a null resultSha256 and empty readback");
	} else if (receipt.status === "succeeded") {
		if (receipt.resultSha256 === null) errors.push("A succeeded receipt requires a resultSha256");
	} else if (
		["failed", "cancelled", "outcome-unknown"].includes(receipt.status) &&
		receipt.resultSha256 !== null
	) {
		errors.push("A failed, cancelled or outcome-unknown receipt requires a null resultSha256");
	}
	return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateP5Failure(value: unknown): P5Validation {
	const errors: string[] = [];
	shape(
		value,
		{ status: oneOf(["failed"]), code: oneOf(Code.enum), receiptRef: nullOr(id) },
		"failure",
		errors,
	);
	return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
