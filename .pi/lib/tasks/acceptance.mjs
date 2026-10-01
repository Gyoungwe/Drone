// @ts-nocheck
/**
 * Package-aware Pi adapter for acceptance verifiers.
 *
 * Development and backend tests use the typed package instance so the host and
 * extension share one registry. Packaged resources have no workspace
 * node_modules, so they fall back to the self-contained compiled copy.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let implementation;
try {
	implementation = await import(require.resolve("@drone/tasks/acceptance"));
} catch (error) {
	if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "MODULE_NOT_FOUND") throw error;
	implementation = await import("./acceptance-packaged.mjs");
}

export const {
	ACCEPTANCE_VERIFIER_EVENT,
	ACCEPTANCE_VERIFIER_REQUEST_EVENT,
	CORE_ACCEPTANCE_KINDS,
	acceptanceKinds,
	acceptanceSchema,
	acceptanceVerifier,
	acceptanceVerifiers,
	bindAcceptanceVerifierEvents,
	describeAcceptance,
	effectiveAcceptance,
	normalizeAcceptance,
	registerAcceptanceVerifier,
	resetAcceptanceVerifiers,
} = implementation;
