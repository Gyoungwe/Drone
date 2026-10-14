import { describe, expect, it } from "vitest";
import {
	assertResearchStatus,
	isResearchEvidenceGreen,
	isScientificClaimGreen,
	statusForValidationCapsule,
} from "./research-status";

describe("research status red lines", () => {
	it("keeps fixture validation separate from scientific claims", () => {
		const status = statusForValidationCapsule({ status: "validated" });
		expect(status).toMatchObject({
			evidenceState: "verified",
			claimState: "inferred",
			validationScope: "fixture",
			freshness: "fresh",
			scientificallyVerified: false,
		});
		expect(isResearchEvidenceGreen(status)).toBe(true);
		expect(isScientificClaimGreen(status)).toBe(false);
	});

	it.each(["partial", "stale", "unsupported", "unknown", "blocked"] as const)(
		"never marks %s evidence as green",
		(evidenceState) => {
			const status = {
				evidenceState,
				claimState: "supported" as const,
				validationScope: "scientific-review" as const,
				freshness: "fresh" as const,
				scientificallyVerified: false,
			};
			assertResearchStatus(status);
			expect(isResearchEvidenceGreen(status)).toBe(false);
			expect(isScientificClaimGreen(status)).toBe(false);
		},
	);

	it("requires explicit scientific review before a claim can be green", () => {
		const status = {
			evidenceState: "reproduced" as const,
			claimState: "supported" as const,
			validationScope: "scientific-review" as const,
			freshness: "fresh" as const,
			scientificallyVerified: true,
		};
		assertResearchStatus(status);
		expect(isScientificClaimGreen(status)).toBe(true);
	});

	it("rejects a scientific verification marker outside scientific review", () => {
		expect(() =>
			assertResearchStatus({
				evidenceState: "verified",
				claimState: "supported",
				validationScope: "real-data",
				freshness: "fresh",
				scientificallyVerified: true,
			}),
		).toThrow(/scientific verification/i);
	});
});
