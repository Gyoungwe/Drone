import { type Code, type Failure, Hash, Id, Relative, type Result } from "./p5-receipts.js";

/**
 * D2 = A and D9 = A, decided 2026-11-18: 64 MiB decoded, 128 MiB serialized.
 * Mirror backend/src/services/evidence-attestation.ts:4 (CAPSULE_LIMIT) and
 * backend/src/services/analysis-evidence.ts:458 (CAPSULE_LIMIT * 2), under packages/.
 * There is no separate chunk cap: offset + decoded length must fit both the total
 * and declared object size; the complete serialized chunk message must fit 2x.
 */
export const STAGED_DECODED_LIMIT = 64 * 1024 * 1024;
export const STAGED_SERIALIZED_LIMIT = STAGED_DECODED_LIMIT * 2;
const size = { type: "integer", minimum: 0, maximum: STAGED_DECODED_LIMIT } as const;
const base64 = {
	type: "string",
	minLength: 4,
	maxLength: STAGED_SERIALIZED_LIMIT,
	pattern: "^[A-Za-z0-9+/]*={0,2}$",
} as const;
type Field = { type: "string"; pattern: string; minLength?: number; maxLength?: number } | typeof size;

function closed<const Properties extends Record<string, Field>>(properties: Properties) {
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		type: "object",
		properties,
		required: Object.keys(properties),
		additionalProperties: false,
	} as const;
}

/** Path is relative to the host-selected approved root, never a caller-selected root. */
export const StagedOpenInput = closed({ requestId: Id, path: Relative, bytes: size });
export const StagedChunkInput = closed({ fileRef: Id, offset: size, base64 });
export const StagedSealInput = closed({ fileRef: Id, bytes: size, sha256: Hash });
export const StagedRefInput = closed({ fileRef: Id });
/** Immutable host lookup metadata; a copied ref never grants consent or access. */
export const StagedRef = closed({ fileRef: Id, bytes: size, sha256: Hash });
export const StagedState = { enum: ["open", "sealed", "cancelled", "invalidated"] } as const;
export type StagedState = (typeof StagedState.enum)[number];
export type StagedOpenInput = { readonly requestId: Id; readonly path: Relative; readonly bytes: number };
export type StagedChunkInput = { readonly fileRef: Id; readonly offset: number; readonly base64: string };
export type StagedRefInput = { readonly fileRef: Id };
export type StagedRef = StagedRefInput & { readonly bytes: number; readonly sha256: Hash };
export type StagedSealInput = StagedRef;

/**
 * Host-owned validation context, never accepted from request JSON. B1 owns IO and
 * state transitions: open -> sealed or cancelled; cancellation aborts owned work.
 * Bind root/file identity/action to the actual caller, source generation and session.
 * Caller completion/switch, disable, reinstall, revocation or host restart invalidates
 * open AND sealed refs; no restored ref resumes work. Lookup/cancel use StagedRefInput.
 * sealedRanges are disjoint half-open accepted byte ranges; seal requires full coverage
 * and a fresh stable host hash/size readback. Validators neither write bytes nor grant access.
 */
export interface StagedValidationContext {
	readonly fileRef: Id;
	readonly state: StagedState;
	readonly bytes: number;
	readonly sha256: Hash | null;
	readonly sealedRanges: readonly { readonly offset: number; readonly bytes: number }[];
}
const failed = (code: Code): Failure => ({ status: "failed", code, receiptRef: null });

function input<Value>(value: unknown, schema: { properties: Record<string, Field> }): Result<Value> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return failed("INVALID_INPUT");
	const record = value as Record<string, unknown>;
	const fields = Object.keys(schema.properties);
	if (Object.keys(record).length !== fields.length || fields.some((key) => !Object.hasOwn(record, key)))
		return failed("INVALID_INPUT");
	for (const [key, field] of Object.entries(schema.properties)) {
		const item = record[key];
		if (field.type === "integer") {
			if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) return failed("INVALID_INPUT");
			if (item > field.maximum) return failed("LIMIT_EXCEEDED");
		} else {
			if (typeof item !== "string") return failed("INVALID_INPUT");
			// Only paths admit non-ASCII; avoid expanding large base64 payloads into arrays.
			const length = key === "path" ? [...item].length : item.length;
			if (field.minLength !== undefined && length < field.minLength) return failed("INVALID_INPUT");
			if (field.maxLength !== undefined && length > field.maxLength) return failed("LIMIT_EXCEEDED");
			if (!new RegExp(field.pattern).test(item))
				return failed(key === "path" ? "PATH_ESCAPE" : "INVALID_INPUT");
		}
	}
	return { status: "ok", value: value as Value };
}

function lifetime(fileRef: Id, context: StagedValidationContext): Failure | null {
	if (fileRef !== context.fileRef || context.state === "invalidated") return failed("SCOPE_CHANGED");
	if (context.state === "cancelled") return failed("CANCELLED");
	return null;
}

export function validateStagedOpen(value: unknown): Result<StagedOpenInput> {
	const parsed = input<StagedOpenInput>(value, StagedOpenInput);
	if (parsed.status === "ok" && /(^[A-Za-z]:|\0)/.test(parsed.value.path)) return failed("PATH_ESCAPE");
	return parsed;
}

/** serializedBytes is measured by the host on the entire wire message, including its envelope. */
export function validateStagedChunk(
	value: unknown,
	context: StagedValidationContext,
	serializedBytes: number,
): Result<StagedChunkInput> {
	const parsed = input<StagedChunkInput>(value, StagedChunkInput);
	if (parsed.status === "failed") return parsed;
	const chunk = parsed.value;
	const invalid = lifetime(chunk.fileRef, context);
	if (invalid) return invalid;
	if (context.state !== "open") return failed("STATE_CONFLICT");
	const encoded = chunk.base64;
	if (encoded.length % 4 !== 0 || !/([AQgw]==|[AEIMQUYcgkosw048]=|[A-Za-z0-9+/])$/.test(encoded))
		return failed("INVALID_INPUT");
	const bytes = (encoded.length / 4) * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
	const end = chunk.offset + bytes;
	if (serializedBytes > STAGED_SERIALIZED_LIMIT || end > STAGED_DECODED_LIMIT || end > context.bytes)
		return failed("LIMIT_EXCEEDED");
	if (context.sealedRanges.some((range) => chunk.offset < range.offset + range.bytes && end > range.offset))
		return failed("STATE_CONFLICT");
	return parsed;
}

export function validateStagedSeal(
	value: unknown,
	context: StagedValidationContext,
): Result<StagedSealInput> {
	const parsed = input<StagedSealInput>(value, StagedSealInput);
	if (parsed.status === "failed") return parsed;
	const seal = parsed.value;
	const invalid = lifetime(seal.fileRef, context);
	if (invalid) return invalid;
	if (seal.bytes !== context.bytes) return failed("STATE_CONFLICT");
	if (context.state === "sealed") return seal.sha256 === context.sha256 ? parsed : failed("STATE_CONFLICT");
	if (context.sealedRanges.reduce((total, range) => total + range.bytes, 0) !== seal.bytes)
		return failed("STATE_CONFLICT");
	return seal.sha256 === context.sha256 ? parsed : failed("READBACK_FAILED");
}

export function validateStagedRef(value: unknown, context: StagedValidationContext): Result<StagedRef> {
	const parsed = input<StagedRefInput>(value, StagedRefInput);
	if (parsed.status === "failed") return parsed;
	const invalid = lifetime(parsed.value.fileRef, context);
	if (invalid) return invalid;
	if (context.state !== "sealed") return failed("STATE_CONFLICT");
	if (context.sha256 === null) return failed("READBACK_FAILED");
	return { status: "ok", value: { fileRef: context.fileRef, bytes: context.bytes, sha256: context.sha256 } };
}
