import type { PluginRuntimeClient } from "@gyoungwe/plugin-api/runtime";

/** Host adapter for the optional pi-workbench desktop runtime. */
export type WorkbenchPluginClient = Pick<PluginRuntimeClient, "invoke">;

/**
 * Forward the workbench state entry through the standard plugin operation
 * contract. Discovery, approval, scope and persistence stay with the host
 * runtime; this package only knows the versioned operation names.
 */
export function createWorkbenchPluginPort(client: WorkbenchPluginClient) {
	return Object.freeze({
		status: () => client.invoke("status", {}),
		plan: (items: readonly string[]) => client.invoke("plan", { items: [...items] }),
		todo: (input: { id: string; state: "pending" | "in_progress" | "completed" | "blocked" }) =>
			client.invoke("todo", input),
		memorySave: (input: { title: string; body: string }) => client.invoke("memorySave", input),
		persist: () => client.invoke("persist", {}),
	});
}
