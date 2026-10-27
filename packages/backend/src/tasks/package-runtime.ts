import type { DroneRuntime } from "@drone/shared";
import type { TaskAcceptanceDefinition, TaskAcceptanceHostPort } from "@gyoungwe/plugin-api/tasks";

type AcceptanceVerifier = {
	kind: string;
	fields: readonly string[];
	evidenceKind: string;
	operationVerifier: string;
	label: ((acceptance: Record<string, unknown>) => unknown) | null;
	verify: ((acceptance: Record<string, unknown>, context: unknown) => unknown) | null;
	observe: ((event: unknown, details: unknown) => unknown) | null;
	resolve: ((review: unknown, context: unknown) => unknown) | null;
	identify: ((event: unknown, details: unknown) => unknown) | null;
	consent: ((acceptance: Record<string, unknown>) => unknown) | null;
	pending: ((milestone: unknown) => unknown) | null;
	acknowledgeError: unknown;
};

const KIND = /^[a-z][a-z0-9_]{1,40}$/;
const FIELD = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;
const CORE_KINDS = new Set(["file", "human_review"]);
const CORE_FIELDS = new Set(["kind", "path", "sha256", "rootKind"]);
const FUNCTION_FIELDS = ["label", "verify", "observe", "resolve", "identify", "consent", "pending"] as const;

function acceptanceRegistry(runtime: DroneRuntime): { verifiers: Map<string, AcceptanceVerifier> } {
	const acceptance = runtime.tasks.acceptance as
		| { verifiers?: Map<string, AcceptanceVerifier>; [key: string]: unknown }
		| undefined;
	if (acceptance?.verifiers) return acceptance as { verifiers: Map<string, AcceptanceVerifier> };
	const next = { ...(acceptance ?? {}), verifiers: new Map<string, AcceptanceVerifier>() };
	runtime.tasks.acceptance = next;
	return next;
}

function registerAcceptanceVerifier(
	runtime: DroneRuntime,
	kind: string,
	definition: TaskAcceptanceDefinition,
): AcceptanceVerifier {
	if (!KIND.test(kind)) throw new Error(`Acceptance kind "${kind}" must match ${KIND}`);
	if (CORE_KINDS.has(kind)) throw new Error(`Acceptance kind "${kind}" is owned by the host`);
	for (const field of FUNCTION_FIELDS) {
		if (definition[field] !== undefined && typeof definition[field] !== "function")
			throw new Error(`Acceptance verifier ${kind}.${field} must be a function`);
	}
	const fields = [...new Set(Array.isArray(definition.fields) ? definition.fields : [])];
	for (const field of fields) {
		if (typeof field !== "string" || !FIELD.test(field) || CORE_FIELDS.has(field))
			throw new Error(`Acceptance verifier ${kind}: invalid field "${String(field)}"`);
	}
	const verifier = Object.freeze({
		kind,
		fields: Object.freeze(fields),
		evidenceKind: String(definition.evidenceKind || `${kind}-verified`),
		operationVerifier: String(definition.operationVerifier || `${kind}-record-not-scientific-proof`),
		label: (definition.label as AcceptanceVerifier["label"]) || (() => kind),
		verify: (definition.verify as AcceptanceVerifier["verify"]) || null,
		observe: (definition.observe as AcceptanceVerifier["observe"]) || null,
		resolve: (definition.resolve as AcceptanceVerifier["resolve"]) || null,
		identify: (definition.identify as AcceptanceVerifier["identify"]) || null,
		consent: (definition.consent as AcceptanceVerifier["consent"]) || null,
		pending: (definition.pending as AcceptanceVerifier["pending"]) || null,
		acknowledgeError: definition.acknowledgeError || null,
	});
	acceptanceRegistry(runtime).verifiers.set(kind, verifier);
	return verifier;
}

export function registerAcceptanceVerifierInRuntime(
	runtime: DroneRuntime,
	kind: string,
	definition: TaskAcceptanceDefinition,
): void {
	registerAcceptanceVerifier(runtime, kind, definition);
}

export function readAcceptanceVerifier(runtime: DroneRuntime, kind: string): unknown {
	return acceptanceRegistry(runtime).verifiers.get(kind) ?? null;
}

/** Expose the isolated host-owned task registry to an installed workbench. */
export function createTaskAcceptanceHost(runtime: DroneRuntime): TaskAcceptanceHostPort {
	return {
		contractVersion: 1,
		registerAcceptanceVerifier: (kind, definition) =>
			registerAcceptanceVerifierInRuntime(runtime, kind, definition),
		readAcceptanceVerifier: (kind) => readAcceptanceVerifier(runtime, kind),
	};
}
