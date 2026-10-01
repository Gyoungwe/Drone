import { describe, expect, it } from "vitest";
import { InstitutionalService } from "./institutional";

describe("InstitutionalService", () => {
	it("rejects malformed access URLs before touching session state", async () => {
		await expect(new InstitutionalService().testAccess("not-a-url")).rejects.toThrow("Invalid URL");
	});
});
