import { describe, expect, it } from "vitest";
import {
	createDefaultResearchWriteAdapters,
	createProtocolsBookmarkWriteAdapter,
	createWebdavWriteAdapter,
	createZoteroWriteAdapter,
	ResearchWriteAdapterRegistry,
} from "../src/write-connectors";

const payload = { title: "Bee brain paper", doi: "10.1000/bee", authors: ["A. Researcher"] };

describe("research write adapters", () => {
	it("prepares bounded plans without performing a side effect", () => {
		const adapter = createZoteroWriteAdapter();
		const plan = adapter.prepare({
			adapterId: "zotero-write",
			targetRef: "library:123",
			action: "dry-run",
			payload,
		});
		expect(plan.sideEffect).toBe("none");
		expect(plan.requiresExplicitApproval).toBe(true);
		expect(adapter.writeEnabled).toBe(false);
	});

	it("registers the remaining reversible third-party adapters fail-closed by default", () => {
		const adapters = createDefaultResearchWriteAdapters();
		expect(adapters.map((adapter) => adapter.id)).toEqual([
			"protocols-bookmark-write",
			"webdav-write",
			"zotero-write",
		]);
		expect(adapters.filter((adapter) => adapter.supportsDelete).map((adapter) => adapter.id)).toEqual([
			"protocols-bookmark-write",
			"webdav-write",
		]);
		expect(adapters.every((adapter) => adapter.writeEnabled === false)).toBe(true);
	});

	it("requires explicit approval before any authorized port is called", async () => {
		let writes = 0;
		const adapter = createWebdavWriteAdapter({
			write: async () => {
				writes += 1;
				return { externalRef: "/research/marker.md", readBack: true, deleted: true };
			},
		});
		const plan = adapter.prepare({
			adapterId: "webdav-write",
			targetRef: "/research/marker.md",
			action: "prepare",
			payload,
		});
		await expect(adapter.execute(plan, { approved: false })).rejects.toThrow("approval");
		expect(writes).toBe(0);
	});

	it("requires create → readback → delete closure for WebDAV", async () => {
		const adapter = createWebdavWriteAdapter({
			write: async ({ targetRef }) => ({
				externalRef: targetRef,
				readBack: true,
				deleted: true,
			}),
		});
		const plan = adapter.prepare({
			adapterId: "webdav-write",
			targetRef: "/research/marker.md",
			action: "prepare",
			payload,
		});
		await expect(adapter.execute(plan, { approved: true })).resolves.toMatchObject({
			status: "executed",
			readBack: "verified",
			deleted: "verified",
			externalRef: "/research/marker.md",
		});
	});

	it("rejects a reversible port that cannot prove deletion", async () => {
		const adapter = createProtocolsBookmarkWriteAdapter({
			write: async ({ targetRef }) => ({
				externalRef: targetRef,
				readBack: true,
				deleted: false,
			}),
		});
		const plan = adapter.prepare({
			adapterId: "protocols-bookmark-write",
			targetRef: "protocols.io.example-marker",
			action: "prepare",
			payload,
		});
		await expect(adapter.execute(plan, { approved: true })).rejects.toThrow("delete closure");
	});

	it("fails closed when an authorized host port is missing", async () => {
		const adapter = createZoteroWriteAdapter();
		const plan = adapter.prepare({
			adapterId: "zotero-write",
			targetRef: "library:123",
			action: "prepare",
			payload,
		});
		await expect(adapter.execute(plan, { approved: true })).rejects.toThrow("unavailable");
	});

	it("rejects unknown adapter ids before registration", () => {
		const registry = new ResearchWriteAdapterRegistry([]);
		expect(registry.get("zotero-write")).toBeUndefined();
		expect(registry.list()).toEqual([]);
	});
});
