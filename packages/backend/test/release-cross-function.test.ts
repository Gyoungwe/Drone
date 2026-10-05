import { decisionRecord, InquiryService, MemoryInquiryStorage } from "@drone/inquiry";
import { evaluateMetacognitivePublication } from "@drone/knowledge/metacognitive-policy";
import { describe, expect, it } from "vitest";

const HASH = "a".repeat(64);

describe("v0.19 cross-function publication gate", () => {
	it("propagates a revoked decision to descendants and keeps both advisory warnings while blocking", async () => {
		const storage = new MemoryInquiryStorage("project-1");
		const service = new InquiryService(storage);
		await service.recordArtifact({
			id: "root",
			schemaVersion: 2,
			projectId: "project-1",
			location: "local",
			path: "Runs/run-1/report.md",
			bytes: 12,
			sha256: HASH,
			source: { kind: "task", id: "task-1" },
			purpose: "deliverable",
			status: "valid",
			parentIds: [],
			createdAt: "2026-10-05T00:00:00.000Z",
			updatedAt: "2026-10-05T00:00:00.000Z",
		});
		await service.recordArtifact({
			id: "child",
			schemaVersion: 2,
			projectId: "project-1",
			location: "local",
			path: "Runs/run-1/derived.md",
			bytes: 12,
			sha256: HASH,
			source: { kind: "run", id: "run-1" },
			purpose: "deliverable",
			status: "valid",
			parentIds: ["root"],
			createdAt: "2026-10-05T00:00:00.000Z",
			updatedAt: "2026-10-05T00:00:00.000Z",
		});
		await service.recordDecision(
			decisionRecord({
				id: "decision-1",
				projectId: "project-1",
				kind: "task-authorization",
				summary: "Authorized the run",
				affectedArtifactIds: ["root"],
			}),
		);
		await service.revokeDecision("decision-1", "Review requested");
		const snapshot = await storage.snapshot();
		expect(snapshot.artifacts.map((item) => item.status)).toEqual(["pending-review", "pending-review"]);

		const evaluation = evaluateMetacognitivePublication("Result [[Runs/run-1/report]]", {
			artifacts: [
				{
					path: "Runs/run-1/report.md",
					status: snapshot.artifacts[0]?.status,
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
