import { describe, expect, it } from "vitest";
import { DiscoveryContract } from "./discovery";

describe("DiscoveryContract", () => {
	it("keeps projections read-only for LAN and kernel close desktop-only", () => {
		expect(DiscoveryContract.methods.listCriticReviews.access).toBe("lan-read");
		expect(DiscoveryContract.methods.listMultipathAssessments.access).toBe("lan-read");
		expect(DiscoveryContract.methods.listExplorationPlans.access).toBe("lan-read");
		expect(DiscoveryContract.methods.listEvaluations.access).toBe("lan-read");
		expect(DiscoveryContract.methods.closeKernelSession.access).toBe("desktop");
	});
});
