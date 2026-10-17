import { describe, expect, it } from "vitest";
import { createZoteroWriteAdapter, ResearchWriteAdapterRegistry } from "../src/write-connectors";

describe("research write adapters", () => {
	it("prepares a bounded plan without performing a side effect", () => {
		const adapter = createZoteroWriteAdapter();
		const plan = adapter.prepare({
			adapterId: "zotero-write",
			targetRef: "library:123",
			action: "dry-run",
			payload: { title: "Bee brain paper", doi: "10.1000/bee", authors: ["A. Researcher"] },
		});
		expect(plan.sideEffect).toBe("none");
		expect(plan.requiresExplicitApproval).toBe(true);
		expect(adapter.writeEnabled).toBe(false);
	});

	it("fails closed when an authorized host port is missing", async () => {
		const adapter = createZoteroWriteAdapter();
		const plan = adapter.prepare({
			adapterId: "zotero-write",
			targetRef: "library:123",
			action: "prepare",
			payload: { title: "Bee brain paper" },
		});
		await expect(adapter.execute(plan, { approved: true })).rejects.toThrow("unavailable");
	});

	it("requires explicit approval and verifies a controlled fake write", async () => {
		let writes = 0;
		const adapter = createZoteroWriteAdapter({
			write: async ({ targetRef }) => {
				writes += 1;
				return { externalRef: `${targetRef}/ITEM1`, readBack: true };
			},
		});
		const plan = adapter.prepare({
			adapterId: "zotero-write",
			targetRef: "library:123",
			action: "prepare",
			payload: { title: "Bee brain paper" },
		});
		await expect(adapter.execute(plan, { approved: false })).rejects.toThrow("approval");
		const receipt = await adapter.execute(plan, { approved: true });
		expect(receipt).toMatchObject({
			status: "executed",
			readBack: "verified",
			externalRef: "library:123/ITEM1",
		});
		expect(writes).toBe(1);
	});

	it("rejects unknown adapter ids before registration", () => {
		const registry = new ResearchWriteAdapterRegistry([]);
		expect(registry.get("zotero-write")).toBeUndefined();
		expect(registry.list()).toEqual([]);
	});
});
