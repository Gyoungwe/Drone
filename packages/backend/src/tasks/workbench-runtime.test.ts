import { expect, it } from "vitest";
import { createWorkbenchHostPort } from "./workbench-runtime";

it("leaves operations unavailable instead of substituting a host task ledger", async () => {
	const port = createWorkbenchHostPort();
	await expect(port.client.invoke("status", {})).rejects.toThrow("Workbench operation unavailable: status");
	await expect(port.client.invoke("plan", { items: ["one"] })).rejects.toThrow(
		"Workbench operation unavailable: plan",
	);
	const unsubscribe = port.client.subscribe(() => {
		throw new Error("No host task engine may emit events");
	});
	unsubscribe();
});
