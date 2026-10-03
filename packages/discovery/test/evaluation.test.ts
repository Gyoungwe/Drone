import { describe, expect, it } from "vitest";
import {
	createBaseline,
	type DiscoveryEvaluationCase,
	MemoryBaselineStore,
	metricDescription,
	runEvaluation,
} from "../src";

describe("B5f evaluation and baselines", () => {
	it("records BixBench and human verification metrics with an explicit missing-data state", async () => {
		const store = new MemoryBaselineStore();
		await store.put(
			createBaseline({
				metric: "bixbench-regression",
				datasetId: "bixbench",
				datasetRevision: "fixture-1",
				value: 0.8,
				unit: "score",
				runId: "baseline-1",
				source: "fixture",
			}),
		);
		await store.put(
			createBaseline({
				metric: "verification-time-ms",
				datasetId: "clues",
				datasetRevision: "fixture-1",
				value: 100,
				unit: "milliseconds",
				runId: "baseline-2",
				source: "fixture",
			}),
		);
		const cases: DiscoveryEvaluationCase[] = [
			{
				id: "bix-1",
				metric: "bixbench-regression",
				datasetId: "bixbench",
				datasetRevision: "fixture-1",
				datasetStatus: "fixture",
				description: "closed analysis",
			},
			{
				id: "verify-1",
				metric: "verification-time-ms",
				datasetId: "clues",
				datasetRevision: "fixture-1",
				datasetStatus: "fixture",
				description: "human check",
			},
			{
				id: "rediscovery-external",
				metric: "rediscovery-rate",
				datasetId: "published-2026",
				datasetRevision: "external-1",
				datasetStatus: "missing",
				description: "requires public dataset",
			},
		];
		const run = await runEvaluation(
			cases,
			async (item) =>
				item.metric === "bixbench-regression" ? { value: 0.9 } : { value: 50, verificationTimeMs: 50 },
			store,
		);
		expect(run.status).toBe("needs-data");
		expect(run.metrics.find((metric) => metric.metric === "bixbench-regression")?.passed).toBe(true);
		expect(run.metrics.find((metric) => metric.metric === "verification-time-ms")?.passed).toBe(true);
		expect(run.missingData).toEqual(["rediscovery-external"]);
		expect(metricDescription("repeated-failure-count")).toContain("failure");
	});

	it("does not treat a failed or timed-out evaluator as a successful score", async () => {
		const store = new MemoryBaselineStore();
		const cases: DiscoveryEvaluationCase[] = [
			{
				id: "confounder-1",
				metric: "confounder-detection-rate",
				datasetId: "synthetic",
				datasetRevision: "1",
				datasetStatus: "fixture",
				description: "batch confounder",
			},
		];
		const run = await runEvaluation(
			cases,
			async () => {
				throw new Error("fixture failed");
			},
			store,
		);
		expect(run.status).toBe("blocked");
		expect(run.blockedCases).toEqual(["confounder-1"]);
		expect(run.metrics).toEqual([]);
	});
});
