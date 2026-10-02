import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InquiryService } from "./inquiry";

describe("backend inquiry composition adapter", () => {
	it("stays disabled without a configured root", () => {
		const service = new InquiryService();
		expect(service.enabled).toBe(false);
		expect(service.storage).toBeUndefined();
		service.dispose();
	});

	it("instantiates the SQLite domain service only when configured", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-backend-inquiry-"));
		try {
			const service = new InquiryService({ inquiryDir: root, projectId: "project-1" });
			expect(service.enabled).toBe(true);
			expect(service.storage?.path).toBe(join(root, "ledger.sqlite"));
			expect(service.domain?.storage.projectId).toBe("project-1");
			service.dispose();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("requires an explicit project id for a configured root", () => {
		expect(() => new InquiryService({ inquiryDir: "/tmp/drone-inquiry" })).toThrow("inquiryProjectId");
	});
});
