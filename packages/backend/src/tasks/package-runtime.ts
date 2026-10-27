import type { DroneRuntime } from "@drone/shared";
import {
	createTaskAcceptanceRegistry,
	readTaskAcceptanceVerifier,
	registerTaskAcceptanceVerifier,
	type TaskAcceptanceDefinition,
	type TaskAcceptanceHostPort,
	type TaskAcceptanceRegistry,
} from "@gyoungwe/plugin-api/tasks";

function acceptanceRegistry(runtime: DroneRuntime): TaskAcceptanceRegistry {
	const acceptance = runtime.tasks.acceptance as
		| (TaskAcceptanceRegistry & { [key: string]: unknown })
		| undefined;
	if (acceptance?.verifiers) return acceptance;
	const next = { ...(acceptance ?? {}), ...createTaskAcceptanceRegistry() };
	runtime.tasks.acceptance = next;
	return next as TaskAcceptanceRegistry;
}

function registerAcceptanceVerifier(
	runtime: DroneRuntime,
	kind: string,
	definition: TaskAcceptanceDefinition,
): void {
	registerTaskAcceptanceVerifier(acceptanceRegistry(runtime), kind, definition);
}

export function registerAcceptanceVerifierInRuntime(
	runtime: DroneRuntime,
	kind: string,
	definition: TaskAcceptanceDefinition,
): void {
	registerAcceptanceVerifier(runtime, kind, definition);
}

export function readAcceptanceVerifier(runtime: DroneRuntime, kind: string) {
	return readTaskAcceptanceVerifier(acceptanceRegistry(runtime), kind);
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
