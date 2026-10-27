import type { DroneRuntime } from "@drone/shared";
import type { PluginRuntimeChangedEvent, PluginRuntimeClient } from "@gyoungwe/plugin-api/runtime";

export const WORKBENCH_HOST_CONTRACT_VERSION = 1 as const;
export type WorkbenchOperation = "status" | "plan" | "todo" | "memorySave" | "persist";

export interface WorkbenchOperationHandlers {
	status?: () => unknown | Promise<unknown>;
	plan?: (input: { items: readonly string[] }) => unknown | Promise<unknown>;
	todo?: (input: {
		id: string;
		state: "pending" | "in_progress" | "completed" | "blocked";
	}) => unknown | Promise<unknown>;
	memorySave?: (input: { title: string; body: string }) => unknown | Promise<unknown>;
	persist?: () => unknown | Promise<unknown>;
}

export interface WorkbenchHostPort {
	readonly contractVersion: typeof WORKBENCH_HOST_CONTRACT_VERSION;
	readonly client: PluginRuntimeClient;
}

const unavailable = (operation: string): never => {
	throw new Error(`Workbench operation unavailable: ${operation}`);
};

function validInput(operation: WorkbenchOperation, input: unknown): boolean {
	if (operation === "status" || operation === "persist") return !!input && typeof input === "object";
	if (!input || typeof input !== "object") return false;
	if (operation === "plan") {
		const items = (input as { items?: unknown }).items;
		return Array.isArray(items) && items.every((item) => typeof item === "string") && items.length <= 64;
	}
	if (operation === "memorySave") {
		const value = input as { title?: unknown; body?: unknown };
		return typeof value.title === "string" && typeof value.body === "string";
	}
	const value = input as { id?: unknown; state?: unknown };
	return (
		typeof value.id === "string" &&
		(value.state === "pending" ||
			value.state === "in_progress" ||
			value.state === "completed" ||
			value.state === "blocked")
	);
}

/**
 * Create the host-owned client consumed by the standard workbench plugin port.
 * The default has no handlers: an uninstalled/disabled workbench therefore
 * fails closed instead of silently falling back to a host-owned task ledger.
 */
export function createWorkbenchHostPort(
	runtime: DroneRuntime,
	handlers: WorkbenchOperationHandlers = {},
): WorkbenchHostPort {
	const listeners = new Set<(event: PluginRuntimeChangedEvent) => void>();
	const client: PluginRuntimeClient = {
		invoke: async (operation, input, signal) => {
			signal?.throwIfAborted();
			if (!Object.hasOwn(handlers, operation) || !validInput(operation as WorkbenchOperation, input))
				return unavailable(operation);
			let result: unknown;
			switch (operation as WorkbenchOperation) {
				case "status":
					if (!handlers.status) return unavailable(operation);
					result = await handlers.status();
					break;
				case "plan":
					if (!handlers.plan) return unavailable(operation);
					result = await handlers.plan(input as { items: readonly string[] });
					break;
				case "todo":
					if (!handlers.todo) return unavailable(operation);
					result = await handlers.todo(
						input as Parameters<NonNullable<WorkbenchOperationHandlers["todo"]>>[0],
					);
					break;
				case "memorySave":
					if (!handlers.memorySave) return unavailable(operation);
					result = await handlers.memorySave(input as { title: string; body: string });
					break;
				case "persist":
					if (!handlers.persist) return unavailable(operation);
					result = await handlers.persist();
					break;
				default:
					return unavailable(operation);
			}
			signal?.throwIfAborted();
			return result;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	const unsubscribe = runtime.events.on("drone:workbench/changed/v1", (payload) => {
		if (!payload || typeof payload !== "object") return;
		const revision = (payload as { revision?: unknown }).revision;
		if (!Number.isSafeInteger(revision) || (revision as number) < 0) return;
		for (const listener of listeners) listener({ type: "changed", revision: revision as number });
	});
	runtime.registerDisposable?.({
		dispose: async () => {
			unsubscribe();
			listeners.clear();
		},
	});
	return Object.freeze({ contractVersion: WORKBENCH_HOST_CONTRACT_VERSION, client });
}
