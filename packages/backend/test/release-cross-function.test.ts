import { evaluateMetacognitivePublication } from "@gyoungwe/pi-knowledge/host";
import { describe, expect, it } from "vitest";

const HASH = "a".repeat(64);

describe("v0.19 cross-function publication gate", () => {
	it("blocks revoked pending-review artifacts while preserving both advisory warnings", () => {
		const evaluation = evaluateMetacognitivePublication("Result [[Runs/run-1/report]]", {
			artifacts: [
				{
					path: "Runs/run-1/report.md",
					status: "pending-review",
					sha256: HASH,
					currentSha256: HASH,
					reproducibility: "not-reproducible",
				},
			],
		});
		const reviewerWarnings = [{ code: "reviewer-warning", severity: "high" }];
		const warnings = [...evaluation.warnings, ...reviewerWarnings];
		expect(warnings.map((item) => item.code)).toEqual(["artifact-not-reproducible", "reviewer-warning"]);
		expect(evaluation.ok).toBe(false);
		expect(evaluation.failures).toContainEqual(expect.objectContaining({ code: "artifact-pending-review" }));
	});
});
