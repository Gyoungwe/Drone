import { describe, expect, it, vi } from "vitest";
import { createWorkbenchPluginPort } from "../src/runtime/workbench-plugin";

describe("pi-workbench host contract adapter", () => {
	it("routes the state entry through the standard runtime operations", async () => {
		const invoke = vi.fn(async (operation: string, input: unknown) => ({ operation, input }));
		const port = createWorkbenchPluginPort({ invoke });

		await expect(port.status()).resolves.toEqual({ operation: "status", input: {} });
		await expect(port.plan(["Read sources", "Record evidence"])).resolves.toEqual({
			operation: "plan",
			input: { items: ["Read sources", "Record evidence"] },
		});
		await expect(port.todo({ id: "task-1", state: "completed" })).resolves.toEqual({
			operation: "todo",
			input: { id: "task-1", state: "completed" },
		});
		await expect(port.memorySave({ title: "Finding", body: "Bounded note" })).resolves.toEqual({
			operation: "memorySave",
			input: { title: "Finding", body: "Bounded note" },
		});
		await expect(port.persist()).resolves.toEqual({ operation: "persist", input: {} });
		expect(invoke).toHaveBeenCalledTimes(5);
	});

	it("does not swallow plugin contract failures", async () => {
		const invoke = vi.fn(async () => {
			throw new Error("plugin runtime revoked");
		});
		await expect(createWorkbenchPluginPort({ invoke }).status()).rejects.toThrow("plugin runtime revoked");
	});
});
