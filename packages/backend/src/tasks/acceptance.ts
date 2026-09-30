import type { DroneRuntime } from "@drone/shared";

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
	definition: unknown;
};

function acceptRegistration(runtime: DroneRuntime, payload: unknown): void {
	if (!payload || typeof payload !== "object") return;
	const registration = payload as Partial<Registration>;
	if (registration.version !== 1 || typeof registration.kind !== "string" || !registration.kind) return;
	let acceptance = runtime.tasks.acceptance;
	if (!acceptance) {
		acceptance = { verifiers: new Map() };
		runtime.tasks.acceptance = acceptance;
	}
	let verifiers = acceptance.verifiers;
	if (!verifiers) {
		verifiers = new Map();
		acceptance.verifiers = verifiers;
	}
	verifiers.set(registration.kind, registration.definition);
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
