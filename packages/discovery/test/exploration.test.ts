import { InquiryService, MemoryInquiryStorage } from "@drone/inquiry";
import { describe, expect, it } from "vitest";
import {
	computeSurprise,
	createExplorationMilestone,
	ExplorationBudgetError,
	ExplorationBudgetLedger,
	generateCompetitiveExplanations,
	rankDiscriminatingTests,
	rankExplorationCandidates,
	recordDiscoveryToInquiry,
	validateCompetitiveExplanations,
} from "../src";

describe("B5d exploration contracts", () => {
	it("uses surprise for ranking only and preserves credibility", () => {
		const prior = {
			direction: "positive" as const,
			magnitude: 1,
			confidence: 0.8,
			recordedAt: "2026-01-01T00:00:00.000Z",
		};
		const posterior = {
			direction: "negative" as const,
			magnitude: 3,
			confidence: 0.3,
			recordedAt: "2026-01-01T00:01:00.000Z",
		};
		expect(computeSurprise(prior, posterior)).toBeGreaterThan(0.5);
		const candidates = rankExplorationCandidates([
			{
				id: "a",
				statement: "cheap",
				surprise: 0.9,
				estimatedCost: 5,
				expectedExplanationsExcluded: 1,
				credibility: 0.2,
			},
			{
				id: "b",
				statement: "useful",
				surprise: 0.1,
				estimatedCost: 1,
				expectedExplanationsExcluded: 1,
				credibility: 0.9,
			},
		]);
		expect(candidates[0]?.id).toBe("b");
		expect(candidates.find((item) => item.id === "a")?.credibility).toBe(0.2);
	});

	it("requires three explanations including a technical alternative", () => {
		const explanations = generateCompetitiveExplanations("unexpected separation");
		expect(explanations).toHaveLength(3);
		expect(validateCompetitiveExplanations(explanations)).toEqual([]);
		expect(validateCompetitiveExplanations(explanations.slice(0, 2))).toContain(
			"at least three competing explanations are required",
		);
		const tests = rankDiscriminatingTests([
			{
				id: "slow",
				explanationIds: ["explanation-technical"],
				expectedExplanationsExcluded: 1,
				estimatedCost: 4,
				description: "inspect batch",
			},
			{
				id: "fast",
				explanationIds: ["explanation-technical"],
				expectedExplanationsExcluded: 1,
				estimatedCost: 1,
				description: "check labels",
			},
		]);
		expect(tests[0]?.id).toBe("fast");
	});

	it("keeps exploration budget independent and records discovery through the Inquiry-compatible port", async () => {
		const milestone = createExplorationMilestone({
			id: "milestone-1",
			projectId: "project-1",
			hypothesisId: "hypothesis-1",
			prior: { direction: "positive", confidence: 0.5, recordedAt: "2026-01-01T00:00:00.000Z" },
			budget: { maxExecutions: 2, maxWallTimeMs: 100, maxOutputBytes: 1000, maxCostUnits: 2 },
		});
		expect(milestone.independentCallBudget).toBe(true);
		const budget = new ExplorationBudgetLedger(milestone.budget);
		budget.reserve({ executions: 1, wallTimeMs: 10, outputBytes: 10, costUnits: 1 });
		expect(() => budget.reserve({ executions: 2, wallTimeMs: 0, outputBytes: 0, costUnits: 0 })).toThrow(
			ExplorationBudgetError,
		);
		const storage = new MemoryInquiryStorage("project-1");
		await recordDiscoveryToInquiry(new InquiryService(storage), {
			projectId: "project-1",
			questionId: "question-1",
			attemptId: "attempt-1",
			statement: "Unexpected separation",
			prior: milestone.prior,
			explanations: generateCompetitiveExplanations("Unexpected separation"),
			testsPlanned: ["test-1"],
		});
		const snapshot = await storage.snapshot();
		expect(snapshot.questions[0]?.competingExplanations).toHaveLength(3);
		expect(snapshot.attempts[0]?.outcome).toBe("running");
	});
});
