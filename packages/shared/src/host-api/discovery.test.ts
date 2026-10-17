import { describe, expect, it } from "vitest";
import { DiscoveryContract } from "./discovery";

describe("DiscoveryContract", () => {
	it("keeps kernel close as a desktop method", () => {
		expect(DiscoveryContract.methods.closeKernelSession.access).toBe("desktop");
	});
});
