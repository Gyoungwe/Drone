import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createZoteroWriteAdapter, ResearchWriteAdapterRegistry } from "@drone/research";
import { JsonStore } from "../src/json-store";
import {
	emptyResearchWriteLedger,
	ResearchWriteService,
	type ResearchWriteLedger,
} from "../src/services/research-write";

describe("ResearchWriteService", () => {
	it("persists a prepare plan and blocks execution without explicit approval", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-write-"));
		const service = new ResearchWriteService({
			store: new JsonStore<ResearchWriteLedger>({
				path: join(root, "writes.json"),
				storageId: "test-research-writes",
				defaultValue: emptyResearchWriteLedger,
			}),
		});
		const plan = await service.prepare({
			adapterId: "zotero-write",
			targetRef: "library:123",
			action: "prepare",
			payload: { title: "Bee paper" },
		});
		expect(plan.status).toBe("ready");
		const blocked = await service.execute({ planId: plan.id, approved: false });
		expect(blocked).toMatchObject({ status: "blocked" });
		// A blocked attempt consumes the prepared plan; retries remain blocked until a new plan is prepared.
		expect(await service.execute({ planId: plan.id, approved: true })).toMatchObject({ status: "blocked" });
		const audit = await service.listAudit();
		expect(audit.filter((entry) => entry.status === "blocked")).toHaveLength(2);
		expect(audit.every((entry) => entry.planId === plan.id)).toBe(true);
	});

	it("fails closed and records the adapter failure", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-write-"));
		const service = new ResearchWriteService({
			store: new JsonStore<ResearchWriteLedger>({
				path: join(root, "writes.json"),
				storageId: "test-research-writes-fail",
				defaultValue: emptyResearchWriteLedger,
			}),
		});
		const plan = await service.prepare({
			adapterId: "zotero-write",
			targetRef: "library:123",
			action: "prepare",
			payload: { title: "Bee paper" },
		});
		const failed = await service.execute({ planId: plan.id, approved: true });
		expect(failed).toMatchObject({ status: "failed" });
		expect((await service.listAudit())[0]).toMatchObject({ status: "failed", approval: "explicit" });
	});

	it("reserves a plan before concurrent external writes", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-write-"));
		let writes = 0;
		const adapter = createZoteroWriteAdapter({
			write: async ({ targetRef }) => {
				writes += 1;
				await new Promise((resolve) => setTimeout(resolve, 25));
				return { externalRef: `${targetRef}/ITEM1`, readBack: true };
			},
		});
		const service = new ResearchWriteService({
			adapters: new ResearchWriteAdapterRegistry([adapter]),
			store: new JsonStore<ResearchWriteLedger>({
				path: join(root, "writes.json"),
				storageId: "test-research-write-concurrent",
				defaultValue: emptyResearchWriteLedger,
			}),
		});
		const plan = await service.prepare({
			adapterId: "zotero-write",
			targetRef: "library:123",
			action: "prepare",
			payload: { title: "Bee paper" },
		});
		const [first, second] = await Promise.all([
			service.execute({ planId: plan.id, approved: true }),
			service.execute({ planId: plan.id, approved: true }),
		]);
		expect([first.status, second.status].sort()).toEqual(["blocked", "executed"]);
		expect(writes).toBe(1);
		expect((await service.listAudit()).some((entry) => entry.status === "executing")).toBe(true);
	});

	it("revokes a plan before it can be executed", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-write-"));
		const service = new ResearchWriteService({
			store: new JsonStore<ResearchWriteLedger>({
				path: join(root, "writes.json"),
				storageId: "test-research-write-revoke",
				defaultValue: emptyResearchWriteLedger,
			}),
		});
		const plan = await service.prepare({
			adapterId: "zotero-write",
			targetRef: "library:123",
			action: "prepare",
			payload: { title: "Bee paper" },
		});
		expect(await service.revoke(plan.id)).toBe(true);
		expect(await service.execute({ planId: plan.id, approved: true })).toMatchObject({ status: "blocked" });
	});
});
