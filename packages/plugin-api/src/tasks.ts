import type { PluginNativeSession } from "./native";
/**
 * Host-neutral task/workbench contract.
 *
 * The installed task package owns acceptance semantics, registry instances and
 * native session registration. Published registry helpers remain for 1.x source
 * compatibility; the host does not substitute them for a missing task owner.  This module intentionally has no Drone, Electron or Pi SDK
 * dependency so native Pi and Desktop can share the same seam.
 */
import type { PluginRuntimeClient } from "./runtime";
export const TASK_HOST_CONTRACT_VERSION = 1 as const;
export type TaskHostContractVersion = typeof TASK_HOST_CONTRACT_VERSION;

export type TaskAcceptanceDefinition = Readonly<Record<string, unknown>>;

export interface TaskAcceptanceVerifier {
	readonly kind: string;
	readonly fields: readonly string[];
	readonly evidenceKind: string;
	readonly operationVerifier: string;
	readonly label: ((acceptance: Record<string, unknown>) => unknown) | null;
	readonly verify: ((acceptance: Record<string, unknown>, context: unknown) => unknown) | null;
	readonly observe: ((event: unknown, details: unknown) => unknown) | null;
	readonly resolve: ((review: unknown, context: unknown) => unknown) | null;
	readonly identify: ((event: unknown, details: unknown) => unknown) | null;
	readonly consent: ((acceptance: Record<string, unknown>) => unknown) | null;
	readonly pending: ((milestone: unknown) => unknown) | null;
	readonly acknowledgeError: unknown;
}

export interface TaskAcceptanceRegistry {
	readonly verifiers: Map<string, TaskAcceptanceVerifier>;
}

const ACCEPTANCE_KIND = /^[a-z][a-z0-9_]{1,40}$/;
const ACCEPTANCE_FIELD = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;
const CORE_KINDS = new Set(["file", "human_review"]);
const CORE_FIELDS = new Set(["kind", "path", "sha256", "rootKind"]);
const FUNCTION_FIELDS = ["label", "verify", "observe", "resolve", "identify", "consent", "pending"] as const;

/** Create an isolated registry for one host/runtime instance. */
export function createTaskAcceptanceRegistry(): TaskAcceptanceRegistry {
	return { verifiers: new Map() };
}

/** Validate and register one extension-owned acceptance verifier. */
export function registerTaskAcceptanceVerifier(
	registry: TaskAcceptanceRegistry,
	kind: string,
	definition: TaskAcceptanceDefinition,
): TaskAcceptanceVerifier {
	if (!ACCEPTANCE_KIND.test(kind)) throw new Error(`Acceptance kind "${kind}" must match ${ACCEPTANCE_KIND}`);
	if (CORE_KINDS.has(kind)) throw new Error(`Acceptance kind "${kind}" is owned by the host`);
	for (const field of FUNCTION_FIELDS) {
		if (definition[field] !== undefined && typeof definition[field] !== "function")
			throw new Error(`Acceptance verifier ${kind}.${field} must be a function`);
	}
	const fields = [...new Set(Array.isArray(definition.fields) ? definition.fields : [])];
	for (const field of fields) {
		if (typeof field !== "string" || !ACCEPTANCE_FIELD.test(field) || CORE_FIELDS.has(field))
			throw new Error(`Acceptance verifier ${kind}: invalid field "${String(field)}"`);
	}
	const verifier: TaskAcceptanceVerifier = Object.freeze({
		kind,
		fields: Object.freeze(fields),
		evidenceKind: String(definition.evidenceKind || `${kind}-verified`),
		operationVerifier: String(definition.operationVerifier || `${kind}-record-not-scientific-proof`),
		label: (definition.label as TaskAcceptanceVerifier["label"]) || (() => kind),
		verify: (definition.verify as TaskAcceptanceVerifier["verify"]) || null,
		observe: (definition.observe as TaskAcceptanceVerifier["observe"]) || null,
		resolve: (definition.resolve as TaskAcceptanceVerifier["resolve"]) || null,
		identify: (definition.identify as TaskAcceptanceVerifier["identify"]) || null,
		consent: (definition.consent as TaskAcceptanceVerifier["consent"]) || null,
		pending: (definition.pending as TaskAcceptanceVerifier["pending"]) || null,
		acknowledgeError: definition.acknowledgeError || null,
	});
	registry.verifiers.set(kind, verifier);
	return verifier;
}

export function readTaskAcceptanceVerifier(
	registry: TaskAcceptanceRegistry,
	kind: string,
): TaskAcceptanceVerifier | null {
	return registry.verifiers.get(kind) ?? null;
}

/** Model plan data; authorization and persistence remain host-owned. */
export interface TaskMilestoneInput {
	readonly id: string;
	readonly title: string;
	readonly dependsOn?: readonly string[];
	readonly acceptance: Readonly<Record<string, unknown>> & { readonly kind: string };
}

export interface TaskMilestoneAcceptanceCatalog {
	readonly kinds: readonly string[];
	readonly fields: Readonly<Record<string, readonly string[]>>;
}

export interface TaskPlanMilestone {
	readonly id: string;
	readonly title: string;
	readonly dependsOn: readonly string[];
	readonly acceptance: Readonly<Record<string, unknown>>;
	readonly state: "pending";
	readonly evidence: null;
}

export type TaskMilestoneNormalizer = (
	input: readonly TaskMilestoneInput[],
	catalog: TaskMilestoneAcceptanceCatalog,
) => readonly TaskPlanMilestone[];

export interface TaskAcceptanceHostPort {
	/** Session-scoped native registration from the same canonical owner as the Pi entrypoint. */
	readonly createNativeSession?: () => PluginNativeSession | Promise<PluginNativeSession>;
	readonly dispose?: () => Promise<void>;
	readonly contractVersion: TaskHostContractVersion;
	readonly registerAcceptanceVerifier: (kind: string, definition: TaskAcceptanceDefinition) => void;
	readonly readAcceptanceVerifier: (kind: string) => TaskAcceptanceVerifier | null;
	/** Optional host-owned workbench client. The host may use it for read-only status while the task plugin is installed. */
	readonly workbench?: PluginRuntimeClient;
	/** Installed task plugin owns milestone validation; absent means unavailable. */
	readonly normalizeMilestones?: TaskMilestoneNormalizer;
}

export interface TaskHostLoader {
	readonly contractVersion: TaskHostContractVersion;
	readonly load: (input?: { workbench?: PluginRuntimeClient }) => TaskAcceptanceHostPort;
}
