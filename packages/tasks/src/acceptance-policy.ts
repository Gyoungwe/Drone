/**
 * Pure task-acceptance registry and normalization policy.
 *
 * The `.pi` host owns event bridges and runtime slots. This module keeps the
 * registry data shape and deterministic validation independent of that host so
 * adapters can share one acceptance contract without importing `.pi` code.
 */

export const CORE_ACCEPTANCE_KINDS = ["file", "human_review"] as const;
export type CoreAcceptanceKind = (typeof CORE_ACCEPTANCE_KINDS)[number];

const CORE_FIELDS = ["kind", "path", "sha256"] as const;
const KIND = /^[a-z][a-z0-9_]{1,40}$/;
const FIELD = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;

export interface AcceptanceSchemaProperty {
	type: "string";
	minLength: 1;
	maxLength: 512;
	enum?: string[];
}

export interface AcceptanceInput {
	kind?: unknown;
	path?: unknown;
	sha256?: unknown;
	[key: string]: unknown;
}

export type AcceptanceRecord = Record<string, unknown>;

export interface AcceptanceMilestone {
	acceptance?: AcceptanceRecord | null;
	bound?: { fields?: unknown; [key: string]: unknown } | null;
	[key: string]: unknown;
}

export interface AcceptanceVerifierDefinition {
	fields?: readonly string[];
	evidenceKind?: string;
	operationVerifier?: string;
	label?: (acceptance: AcceptanceRecord) => unknown;
	verify?: (acceptance: AcceptanceRecord, context: unknown) => unknown;
	observe?: (event: unknown, details: unknown) => unknown;
	identify?: (event: unknown, details: unknown) => unknown;
	resolve?: (review: unknown, context: unknown) => unknown;
	consent?: (acceptance: AcceptanceRecord) => unknown;
	pending?: (milestone: AcceptanceMilestone) => unknown;
	acknowledgeError?: unknown;
}

export interface AcceptanceVerifier {
	readonly kind: string;
	readonly fields: readonly string[];
	readonly evidenceKind: string;
	readonly operationVerifier: string;
	readonly label: (acceptance: AcceptanceRecord) => unknown;
	readonly verify: ((acceptance: AcceptanceRecord, context: unknown) => unknown) | null;
	readonly observe: ((event: unknown, details: unknown) => unknown) | null;
	readonly resolve: ((review: unknown, context: unknown) => unknown) | null;
	readonly identify: ((event: unknown, details: unknown) => unknown) | null;
	readonly consent: ((acceptance: AcceptanceRecord) => unknown) | null;
	readonly pending: ((milestone: AcceptanceMilestone) => unknown) | null;
	readonly acknowledgeError: unknown;
}

export interface AcceptanceRegistry {
	readonly verifiers: Map<string, AcceptanceVerifier>;
	readonly kinds: string[];
	readonly properties: Record<string, AcceptanceSchemaProperty>;
}

export interface AcceptanceSchema {
	type: "object";
	properties: Record<string, AcceptanceSchemaProperty>;
	required: ["kind"];
	additionalProperties: false;
}

export type AcceptanceCleaner = (value: unknown, max?: number) => unknown;

const stringField: AcceptanceSchemaProperty = Object.freeze({
	type: "string",
	minLength: 1,
	maxLength: 512,
});

/** Create an isolated registry. A host may keep one registry per runtime. */
export function createAcceptanceRegistry(): AcceptanceRegistry {
	const kinds = [...CORE_ACCEPTANCE_KINDS];
	return {
		verifiers: new Map(),
		kinds,
		properties: {
			kind: { type: "string", enum: kinds, minLength: 1, maxLength: 512 },
			path: stringField,
			sha256: stringField,
		},
	};
}

/** Register one extension-owned verifier after validating its public contract. */
export function registerAcceptanceVerifier(
	registry: AcceptanceRegistry,
	kind: unknown,
	definition: AcceptanceVerifierDefinition = {},
): AcceptanceVerifier {
	if (typeof kind !== "string" || !KIND.test(kind))
		throw new Error(`Acceptance kind "${String(kind ?? "")}" must match ${KIND}`);
	if ((CORE_ACCEPTANCE_KINDS as readonly string[]).includes(kind))
		throw new Error(`Acceptance kind "${kind}" is owned by the host`);
	for (const fn of ["label", "verify", "observe", "resolve", "identify", "consent", "pending"] as const)
		if (definition[fn] !== undefined && typeof definition[fn] !== "function")
			throw new Error(`Acceptance verifier ${kind}.${fn} must be a function`);
	const fields = [...new Set(definition.fields || [])];
	for (const field of fields)
		if (typeof field !== "string" || !FIELD.test(field) || (CORE_FIELDS as readonly string[]).includes(field))
			throw new Error(`Acceptance verifier ${kind}: invalid field "${String(field)}"`);
	const verifier: AcceptanceVerifier = Object.freeze({
		kind,
		fields: Object.freeze(fields),
		evidenceKind: definition.evidenceKind || `${kind}-verified`,
		operationVerifier: definition.operationVerifier || `${kind}-record-not-scientific-proof`,
		label: definition.label || (() => kind),
		verify: definition.verify || null,
		observe: definition.observe || null,
		resolve: definition.resolve || null,
		identify: definition.identify || null,
		consent: definition.consent || null,
		pending: definition.pending || null,
		acknowledgeError: definition.acknowledgeError || null,
	});
	registry.verifiers.set(kind, verifier);
	if (!registry.kinds.includes(kind)) registry.kinds.push(kind);
	for (const field of fields) registry.properties[field] ??= stringField;
	return verifier;
}

/** Clear extension registrations while preserving the live schema objects. */
export function resetAcceptanceVerifiers(registry: AcceptanceRegistry): void {
	registry.verifiers.clear();
	registry.kinds.splice(0, registry.kinds.length, ...CORE_ACCEPTANCE_KINDS);
	for (const field of Object.keys(registry.properties))
		if (!(CORE_FIELDS as readonly string[]).includes(field)) delete registry.properties[field];
}

export function acceptanceVerifier(
	registry: AcceptanceRegistry,
	kind: unknown,
): AcceptanceVerifier | null {
	return typeof kind === "string" ? registry.verifiers.get(kind) || null : null;
}

export function acceptanceVerifiers(registry: AcceptanceRegistry): AcceptanceVerifier[] {
	return [...registry.verifiers.values()];
}

export function acceptanceKinds(registry: AcceptanceRegistry): string[] {
	return [...registry.kinds];
}

/** Return the task-plan schema while retaining live kind and field references. */
export function acceptanceSchema(registry: AcceptanceRegistry): AcceptanceSchema {
	return {
		type: "object",
		properties: registry.properties,
		required: ["kind"],
		additionalProperties: false,
	};
}

/** Keep core fields plus only fields declared by the selected verifier. */
export function normalizeAcceptance(
	registry: AcceptanceRegistry,
	input: AcceptanceInput | null | undefined,
	clean: AcceptanceCleaner,
	verifiers?: ReadonlyMap<string, AcceptanceVerifier>,
): AcceptanceRecord {
	const source = input || {};
	const kind = source.kind;
	const verifier = typeof kind === "string" ? (verifiers || registry.verifiers).get(kind) || null : null;
	const acceptance: AcceptanceRecord = {
		kind,
		path: clean(source.path, 512),
		sha256: /^[a-f0-9]{64}$/.test(typeof source.sha256 === "string" ? source.sha256 : "")
			? source.sha256
			: null,
	};
	for (const field of verifier?.fields || []) acceptance[field] = clean(source[field]);
	return acceptance;
}

/** Merge runtime-bound identity fields without mutating the approved contract. */
export function effectiveAcceptance(milestone: AcceptanceMilestone | null | undefined): AcceptanceRecord {
	const acceptance = milestone?.acceptance || {};
	const bound = milestone?.bound?.fields;
	return bound && typeof bound === "object" && !Array.isArray(bound)
		? { ...acceptance, ...(bound as Record<string, unknown>) }
		: { ...acceptance };
}

/** Describe a core or extension acceptance item for user-facing task cards. */
export function describeAcceptance(
	registry: AcceptanceRegistry,
	acceptance: AcceptanceRecord | null | undefined,
	verifier: AcceptanceVerifier | null = acceptanceVerifier(registry, acceptance?.kind),
): string {
	if (acceptance?.kind === "file") return `生成文件 ${acceptance.path || ""}`.trim();
	if (acceptance?.kind === "human_review") return "由你亲自确认完成";
	if (verifier) {
		try {
			return String(verifier.label(acceptance || {}) || verifier.kind);
		} catch {
			return verifier.kind;
		}
	}
	return `完成 ${acceptance?.kind || "未知"} 验收`;
}
