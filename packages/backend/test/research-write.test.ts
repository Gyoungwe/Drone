import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
		const audit = await service.listAudit();
		expect(audit.some((entry) => entry.status === "blocked" && entry.approval === "missing")).toBe(true);
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
