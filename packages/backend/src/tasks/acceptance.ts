import type { DroneRuntime } from "@drone/shared";
import { registerAcceptanceVerifierInRuntime } from "./package-runtime";

/** Versioned event names shared with the first-party .pi acceptance registry. */
export const ACCEPTANCE_VERIFIER_EVENT = "drone:acceptance-verifier/v1" as const;
export const ACCEPTANCE_VERIFIER_REQUEST_EVENT = "drone:acceptance-verifier/request/v1" as const;

export interface VersionedEventBus {
	on(event: string, listener: (payload: unknown) => void): unknown;
	emit?(event: string, payload?: unknown): unknown;
}

type Registration = {
	version: 1;
	kind: string;
	definition: Record<string, unknown>;
};

function acceptRegistration(runtime: DroneRuntime, payload: unknown): void {
	if (!payload || typeof payload !== "object") return;
	const registration = payload as Partial<Registration>;
	if (
		registration.version !== 1 ||
		typeof registration.kind !== "string" ||
		!registration.kind ||
		!registration.definition ||
		typeof registration.definition !== "object"
	)
		return;
	// The package runtime owns the verifier registry. Scope registration to the
	// host runtime so backend collection and first-party .pi extensions resolve
	// the same per-host registry instead of maintaining a second raw Map.
	registerAcceptanceVerifierInRuntime(runtime, registration.kind, registration.definition);
}

/**
 * Collect extension-owned acceptance definitions into the host runtime.
 *
 * First-party extensions load before the inline host factory. The request event
 * causes already-loaded extensions to replay their declarations, while the
 * runtime announcement also triggers a replay for hosts that subscribed late.
 */
export function bindAcceptanceVerifierEvents(
	events: VersionedEventBus | undefined,
	runtime: DroneRuntime,
): () => void {
	if (!events?.on) return () => {};
	events.on(ACCEPTANCE_VERIFIER_EVENT, (payload) => acceptRegistration(runtime, payload));
	void events.emit?.(ACCEPTANCE_VERIFIER_REQUEST_EVENT, { version: 1 });
	return () => {};
}
