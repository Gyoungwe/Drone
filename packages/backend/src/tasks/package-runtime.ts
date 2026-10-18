import { createRequire } from "node:module";
import type { DroneRuntime } from "@drone/shared";

type AcceptanceDefinition = Record<string, unknown>;

type AcceptanceModule = {
	acceptanceVerifier: (kind: string) => unknown;
	registerAcceptanceVerifier: (kind: string, definition: AcceptanceDefinition) => unknown;
};

type RuntimeBridgeModule = {
	withRuntime: <T>(runtime: DroneRuntime, operation: () => T) => T;
};

// Keep the host adapter's runtime dependency on the compiled tasks package. A
// static TypeScript import would pull the deliberately permissive runtime
// sources into the backend strict typecheck; the package itself remains the
// implementation owner and this adapter only supplies the host runtime scope.
const require = createRequire(import.meta.url);
const acceptance = require("@drone/tasks/acceptance") as AcceptanceModule;
const runtimeBridge = require("@drone/tasks/runtime-bridge") as RuntimeBridgeModule;

export function registerAcceptanceVerifierInRuntime(
	runtime: DroneRuntime,
	kind: string,
	definition: AcceptanceDefinition,
): void {
	runtimeBridge.withRuntime(runtime, () => {
		acceptance.registerAcceptanceVerifier(kind, definition);
	});
}

export function readAcceptanceVerifier(runtime: DroneRuntime, kind: string): unknown {
	return runtimeBridge.withRuntime(runtime, () => acceptance.acceptanceVerifier(kind));
}
