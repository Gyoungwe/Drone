import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	buildKnowledgeDeposit,
	createResearchRunSummary,
	depositResearchKnowledge,
} from "../src/run-summary";

const source = "Library/Papers/example.md";
const hash = createHash("sha256").update("source").digest("hex");
const base = {
	project: "rna-project",
	resultSlug: "rna-20261003",
	query: "Compare two RNA workflows",
	runId: "run-20261003010101-abcd",
	summary: "Evidence-backed summary of the observed workflow and its limits.",
	findings: [
		{
			text: "The tested workflow completed the bounded fixture.",
			citations: [{ path: source, hash, receiptRef: "read-1" }],
		},
	],
	readReceipts: [{ path: source, hash, receiptRef: "read-1", startLine: 1, endLine: 4 }],
	evidenceGate: { stage: "answerable", status: "ok", answerable: true, claimRefs: ["claim-1"] },
};

describe("research run summary", () => {
	it("requires an answerable gate and current-turn citation receipts", () => {
		expect(() =>
			createResearchRunSummary({
				...base,
				evidenceGate: { stage: "claims_bound", status: "ok", answerable: false },
			}),
		).toThrow("answerable");
		expect(() =>
			createResearchRunSummary({
				...base,
				findings: [{ text: "x", citations: [{ path: source, hash: "b".repeat(64), receiptRef: "read-2" }] }],
			}),
		).toThrow("matching");
	});
	it("normalizes bounded citations and produces a navigation-only deposit", () => {
		const summary = createResearchRunSummary(base);
		const deposit = buildKnowledgeDeposit(summary);
		expect(summary.answerable).toBe(true);
		expect(summary.navigationOnly).toBe(true);
		expect(summary.sources).toEqual([{ path: source, hash, receiptRef: "read-1" }]);
		expect(summary.runHash).toMatch(/^[a-f0-9]{64}$/);
		expect(deposit.topic.sources).toEqual([{ path: source, hash }]);
		expect(deposit.wikiCandidate.eligible).toBe(true);
		if (deposit.wikiCandidate.eligible) expect(deposit.wikiCandidate.input.source_paths).toEqual([source]);
	});
	it("is deterministic for the same evidence", () => {
		expect(createResearchRunSummary(base).runHash).toBe(createResearchRunSummary(base).runHash);
	});
	it("deposits the navigation projection through the host topic-memory port", async () => {
		const summary = createResearchRunSummary(base);
		const calls: unknown[] = [];
		const result = await depositResearchKnowledge(
			{
				record: async (input, expectedRevision) => {
					calls.push({ input, expectedRevision });
					return { classification: "new" };
				},
			},
			summary,
			7,
		);
		expect(result).toEqual({ classification: "new" });
		expect(calls[0]).toMatchObject({
			expectedRevision: 7,
			input: { topicId: summary.topicId, runHash: expect.stringMatching(/^[a-f0-9]{64}$/), proposalIds: [] },
		});
	});
});
