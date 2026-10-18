import type { DroneRuntime } from "@drone/shared";
import { acceptanceVerifier, registerAcceptanceVerifier } from "@drone/tasks/acceptance";
import { withRuntime } from "@drone/tasks/runtime-bridge";

type AcceptanceDefinition = Record<string, unknown>;

export function registerAcceptanceVerifierInRuntime(
	runtime: DroneRuntime,
	kind: string,
	definition: AcceptanceDefinition,
): void {
	withRuntime(runtime, () => registerAcceptanceVerifier(kind, definition));
}

export function readAcceptanceVerifier(runtime: DroneRuntime, kind: string): unknown {
	return withRuntime(runtime, () => acceptanceVerifier(kind));
}
