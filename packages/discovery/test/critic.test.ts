import { InquiryService, MemoryInquiryStorage } from "@drone/inquiry";
import { describe, expect, it } from "vitest";
import {
	CRITIC_ROLE,
	createMultiPathPlan,
	executeMultiPath,
	recordCriticQuestions,
	runCriticReview,
} from "../src";

describe("B5e critic and multi-path contracts", () => {
	it("keeps critic role read-only and requires an independent provider", async () => {
		expect(CRITIC_ROLE.canWrite).toBe(false);
		expect(CRITIC_ROLE.canShell).toBe(false);
		const blocked = await runCriticReview(
			{
				findingId: "finding-1",
				findingStatement: "effect",
				artifactIds: [],
				primaryProviderId: "provider-a",
			},
			{ providerId: "provider-a", review: async () => [] },
		);
		expect(blocked.status).toBe("needs-independent-provider");
		const result = await runCriticReview(
			{
				findingId: "finding-1",
				findingStatement: "effect",
				artifactIds: [],
				primaryProviderId: "provider-a",
			},
			{
				providerId: "provider-b",
				review: async () => [
					{
						checklistItem: "batch-effect",
						question: "Could batch explain this?",
						severity: "high",
						evidenceArtifactIds: [],
					},
				],
			},
		);
		expect(result.status).toBe("complete");
		const storage = new MemoryInquiryStorage("project-1");
		const records = await recordCriticQuestions(new InquiryService(storage), {
			projectId: "project-1",
			findingId: "finding-1",
			questions: result.questions,
		});
		expect(records[0]?.id).toBe("critic:finding-1:1");
	});

	it("runs five paths, records every attempt, and assigns robust/sensitive/unstable plus intent", async () => {
		const plan = createMultiPathPlan({
			id: "plan-1",
			findingId: "finding-1",
			intent: "confirmatory",
			priorRegistered: true,
			paths: Array.from({ length: 5 }, (_, index) => ({
				id: `path-${index + 1}`,
				description: "alternative",
				parameters: { threshold: index },
			})),
		});
		const attempts: string[] = [];
		const assessment = await executeMultiPath(
			plan,
			async (path) => {
				attempts.push(path.id);
				return {
					outcome: "succeeded",
					signature: "same",
					summary: "same direction",
					consistentWithReference: path.id !== "path-5",
				};
			},
			{ projectId: "project-1" },
		);
		expect(attempts).toHaveLength(5);
		expect(assessment.grade).toBe("robust");
		expect(assessment.label).toBe("confirmatory");
		expect(assessment.attemptCount).toBe(5);
	});
});
