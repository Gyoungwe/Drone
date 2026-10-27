import { describe, expect, it } from "vitest";
import { createDroneRuntime } from "../runtime";
import { createWorkbenchHostPort } from "./workbench-runtime";

describe("workbench host runtime", () => {
	it("routes declared operations and forwards runtime change events", async () => {
		const runtime = createDroneRuntime();
		const calls: unknown[] = [];
		const port = createWorkbenchHostPort(runtime, {
			status: () => ({ state: "idle" }),
			plan: (input) => {
				calls.push(input);
				return { accepted: input.items.length };
			},
		});
		const events: unknown[] = [];
		const unsubscribe = port.client.subscribe((event) => events.push(event));

		await expect(port.client.invoke("status", {})).resolves.toEqual({ state: "idle" });
		await expect(port.client.invoke("plan", { items: ["read"] })).resolves.toEqual({ accepted: 1 });
		runtime.events.emit("drone:workbench/changed/v1", { revision: 3 });
		expect(calls).toEqual([{ items: ["read"] }]);
		expect(events).toEqual([{ type: "changed", revision: 3 }]);
		unsubscribe();
		await runtime.dispose();
	});

	it("fails closed for missing handlers and malformed input", async () => {
		const runtime = createDroneRuntime();
		const port = createWorkbenchHostPort(runtime, { plan: () => null });
		await expect(port.client.invoke("status", {})).rejects.toThrow("Workbench operation unavailable: status");
		await expect(port.client.invoke("plan", { items: [1] })).rejects.toThrow(
			"Workbench operation unavailable: plan",
		);
		await runtime.dispose();
	});
});
