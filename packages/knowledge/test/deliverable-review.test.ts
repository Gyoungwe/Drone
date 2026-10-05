import { describe, expect, it, vi } from "vitest";
import { BackgroundReviewer, reviewDeliverable, selectReviewerProvider } from "../src/deliverable-review";

const hash = "a".repeat(64);

describe("deliverable reviewer", () => {
	it.each([
		[
			"untraceable-number",
			{ body: "结果为 99.5。", artifacts: [{ path: "report.md", text: "n=12", numbers: [{ value: 12 }] }] },
		],
		[
			"figure-code-mismatch",
			{
				deliverables: [{ id: "fig-1", kind: "figure", sha256: hash, attemptId: "attempt-1" }],
				attempts: [
					{
						id: "attempt-1",
						artifactIds: ["fig-1"],
						outputs: [{ artifactId: "fig-1", sha256: "b".repeat(64) }],
					},
				],
			},
		],
		["citation-without-receipt", { body: "见来源 [[Sources/paper]]。" }],
	] as const)("marks %s", (code, snapshot) => {
		expect(reviewDeliverable(snapshot).findings.map((item) => item.code)).toContain(code);
	});

	it("marks a figure without an attempt and accepts a clean snapshot", () => {
		const missingAttempt = reviewDeliverable({
			deliverables: [{ id: "fig-1", kind: "image", sha256: hash }],
		}).findings;
		expect(missingAttempt).toHaveLength(1);
		expect(missingAttempt[0]?.code).toBe("figure-code-mismatch");

		const clean = reviewDeliverable({
			body: "结论已经记录，引用 [[Sources/paper]]。",
			artifacts: [{ path: "report.md", text: "n=12", numbers: [{ value: 12 }], receiptId: "read-1" }],
			readReceipts: [{ path: "Sources/paper.md", hash, text: "结论已经记录。" }],
			deliverables: [{ id: "fig-1", kind: "figure", sha256: hash, attemptId: "attempt-1" }],
			attempts: [
				{ id: "attempt-1", artifactIds: ["fig-1"], outputs: [{ artifactId: "fig-1", sha256: hash }] },
			],
		}).findings;
		expect(clean).toEqual([]);
	});

	it("checks citation paths projected through metacognitive findings", () => {
		expect(
			reviewDeliverable({
				findings: [{ id: "f1", text: "evidence", label: "validation", citationPaths: ["Sources/paper"] }],
				readReceipts: [{ path: "Sources/paper.md", hash }],
			}).findings,
		).toEqual([]);
	});

	it("caches the same content hash and does not call the reviewer twice", async () => {
		const review = vi.fn(async () => []);
		const reviewer = new BackgroundReviewer({ review });
		const snapshot = { body: "交付物" };
		await reviewer.reviewOnce({ sessionId: "s1", snapshot, trigger: "deliverable-write" });
		await reviewer.reviewOnce({ sessionId: "s1", snapshot, trigger: "publication-projection" });
		expect(review).toHaveBeenCalledTimes(1);
	});

	it("schedules without blocking the caller", async () => {
		let calls = 0;
		const reviewer = new BackgroundReviewer({
			review: () => {
				calls += 1;
				return [];
			},
		});
		reviewer.schedule({ sessionId: "s1", snapshot: { body: "queued" }, trigger: "deliverable-write" });
		expect(calls).toBe(0);
		await vi.waitFor(() => expect(calls).toBe(1));
	});

	it("returns a timeout finding without throwing and enforces the session budget", async () => {
		const hanging = () => new Promise<never>(() => {});
		const reviewer = new BackgroundReviewer({ review: hanging, timeoutMs: 5, maxPerSession: 1 });
		const timedOut = await reviewer.reviewOnce({
			sessionId: "s1",
			snapshot: { body: "x" },
			trigger: "publication-projection",
		});
		expect(timedOut.findings[0]?.code).toBe("review-timeout");
		const budget = await reviewer.reviewOnce({
			sessionId: "s1",
			snapshot: { body: "y" },
			trigger: "deliverable-write",
		});
		expect(budget.findings[0]?.code).toBe("review-budget-exhausted");
	});

	it("selects a different provider when available and marks the fallback", () => {
		expect(selectReviewerProvider("main", [{ provider: "main" }, { provider: "review" }])).toEqual({
			provider: "review",
			independent: true,
		});
		expect(selectReviewerProvider("main", [{ provider: "main" }])).toMatchObject({
			provider: "main",
			independent: false,
			nonIndependentReason: "非独立审稿：没有配置其他 provider。",
		});
	});

	it("marks model findings as non-independent on the provider fallback", async () => {
		const reviewer = new BackgroundReviewer({
			mainProvider: "main",
			providers: [{ provider: "main" }],
			modelReview: async () => [
				{
					id: "model-1",
					code: "citation-without-receipt",
					severity: "medium",
					location: { kind: "body" },
					detail: "model finding",
					suggestion: "read source",
					handled: false,
				},
			],
		});
		const result = await reviewer.reviewOnce({
			sessionId: "s1",
			snapshot: { body: "clean" },
			trigger: "deliverable-write",
		});
		expect(result.findings).toContainEqual(
			expect.objectContaining({
				independent: false,
				nonIndependentReason: "非独立审稿：没有配置其他 provider。",
			}),
		);
	});
});
