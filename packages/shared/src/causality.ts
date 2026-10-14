import { Type } from "typebox";

/** Additive lineage metadata. It is deliberately excluded from business hashes. */
export const CAUSALITY_SCHEMA_VERSION = 1 as const;
export type CausalitySchemaVersion = typeof CAUSALITY_SCHEMA_VERSION;

export type CausalId = string & { readonly __causalId: unique symbol };
export type RunAttemptId = string & { readonly __runAttemptId: unique symbol };

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const CausalEnvelopeSchema = Type.Object(
	{
		schemaVersion: Type.Literal(CAUSALITY_SCHEMA_VERSION),
		eventId: Type.String({ minLength: 1, maxLength: 128, pattern: SAFE_ID.source }),
		causationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: SAFE_ID.source })),
		runAttemptId: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: SAFE_ID.source })),
	},
	{ additionalProperties: false },
);

export interface CausalEnvelope {
	readonly schemaVersion: CausalitySchemaVersion;
	readonly eventId: CausalId;
	readonly causationId?: CausalId;
	readonly runAttemptId?: RunAttemptId;
}

export interface CausalContext {
	readonly runAttemptId?: RunAttemptId;
	readonly causationId?: CausalId;
}

export function causalId(value: string, label = "Causal ID"): CausalId {
	if (!SAFE_ID.test(value)) throw new Error(`${label} is invalid`);
	return value as CausalId;
}

export function runAttemptId(value: string): RunAttemptId {
	return causalId(value, "Run attempt ID") as unknown as RunAttemptId;
}

export function createCausalEnvelope(input: {
	readonly eventId: string;
	readonly causationId?: string;
	readonly runAttemptId?: string;
}): CausalEnvelope {
	const envelope = {
		schemaVersion: CAUSALITY_SCHEMA_VERSION,
		eventId: causalId(input.eventId, "Event ID"),
		...(input.causationId !== undefined ? { causationId: causalId(input.causationId, "Causation ID") } : {}),
		...(input.runAttemptId !== undefined ? { runAttemptId: runAttemptId(input.runAttemptId) } : {}),
	};
	assertCausalEnvelope(envelope);
	return envelope;
}

export function assertCausalEnvelope(value: unknown): asserts value is CausalEnvelope {
	if (!value || typeof value !== "object") throw new Error("Invalid causal envelope");
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).some(
			(key) => !["schemaVersion", "eventId", "causationId", "runAttemptId"].includes(key),
		)
	)
		throw new Error("Unexpected causal envelope field");
	if (record.schemaVersion !== CAUSALITY_SCHEMA_VERSION)
		throw new Error("Invalid causal envelope schemaVersion");
	if (typeof record.eventId !== "string") throw new Error("Invalid causal envelope eventId");
	causalId(record.eventId, "Event ID");
	if (record.causationId !== undefined) {
		if (typeof record.causationId !== "string") throw new Error("Invalid causal envelope causationId");
		causalId(record.causationId, "Causation ID");
		if (record.causationId === record.eventId) throw new Error("An event cannot cause itself");
	}
	if (record.runAttemptId !== undefined) {
		if (typeof record.runAttemptId !== "string") throw new Error("Invalid causal envelope runAttemptId");
		runAttemptId(record.runAttemptId);
	}
}

/** Derive one durable child record without changing the attempt correlation. */
export function childCausalEnvelope(
	parent: CausalEnvelope | CausalContext | undefined,
	input: { readonly eventId: string; readonly runAttemptId?: string },
): CausalEnvelope | undefined {
	if (!parent && !input.runAttemptId) return undefined;
	const parentEventId = parent && "eventId" in parent ? parent.eventId : parent?.causationId;
	return createCausalEnvelope({
		eventId: input.eventId,
		...(parentEventId ? { causationId: parentEventId } : {}),
		...((input.runAttemptId ?? parent?.runAttemptId)
			? { runAttemptId: input.runAttemptId ?? parent?.runAttemptId }
			: {}),
	});
}
