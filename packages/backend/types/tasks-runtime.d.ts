import type { DroneRuntime } from "@drone/shared";

declare module "@drone/tasks/acceptance" {
	export function acceptanceVerifier(kind: string): unknown;
	export function registerAcceptanceVerifier(kind: string, definition: Record<string, unknown>): unknown;
}

declare module "@drone/tasks/runtime-bridge" {
	export function withRuntime<T>(runtime: DroneRuntime, operation: () => T): T;
}

export {};
