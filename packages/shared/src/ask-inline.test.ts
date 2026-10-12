import { describe, expect, it } from "vitest";
import type { AskRequest } from "./ask";
import {
	answerSummary,
	buildInlineResponse,
	emptyDrafts,
	isInlineAsk,
	missingRequired,
	pickByNumber,
} from "./ask-inline";

const req: AskRequest = {
	id: "r",
	sessionId: "s",
	toolCallId: "t",
	questions: [
		{
			id: "q1",
			label: "参考基因组",
			prompt: "用哪个？",
			type: "single",
			required: true,
			options: [
				{ value: "hg38", label: "GRCh38", recommended: true },
				{ value: "hg19", label: "GRCh37" },
			],
			recommendation: { value: "hg38", reason: "新" },
		},
		{
			id: "q2",
			label: "附加分析",
			prompt: "选几项",
			type: "multi",
			required: false,
			options: [
				{ value: "gsea", label: "GSEA" },
				{ value: "go", label: "GO 富集" },
			],
		},
	],
};

describe("inline ask (P9)", () => {
	it("routes simple asks inline and complex ones to the drawer", () => {
		expect(isInlineAsk(req)).toBe(true);
		expect(isInlineAsk({ ...req, proposal: { proposalHash: "h" } })).toBe(false);
		expect(isInlineAsk({ ...req, kind: "authorization" })).toBe(false);
		const preview = structuredClone(req);
		if (preview.questions[0]) preview.questions[0].options[0] = { value: "x", label: "x", preview: "..." };
		expect(isInlineAsk(preview)).toBe(false);
	});
	it("number keys pick single / toggle multi", () => {
		const [q1, q2] = req.questions;
		if (!q1 || !q2) throw new Error();
		expect(pickByNumber(q1, ["hg19"], 1)).toEqual(["hg38"]);
		expect(pickByNumber(q2, ["gsea"], 2)).toEqual(["gsea", "go"]);
		expect(pickByNumber(q2, ["gsea", "go"], 1)).toEqual(["go"]);
		expect(pickByNumber(q2, [], 9)).toEqual([]);
	});
	it("reports missing required answers, skipping does not count", () => {
		const drafts = emptyDrafts(req);
		expect(missingRequired(req, drafts).map((q) => q.id)).toEqual(["q1"]);
		drafts.q1 = { values: [], custom: "T2T-CHM13", skipped: false };
		expect(missingRequired(req, drafts)).toEqual([]);
	});
	it("builds the response and a summary line", () => {
		const drafts = emptyDrafts(req);
		drafts.q1 = { values: ["hg38"], custom: "", skipped: false };
		drafts.q2 = { values: ["go"], custom: "再加 KEGG", skipped: false };
		const response = buildInlineResponse(req, drafts);
		expect(response).toMatchObject({
			kind: "answer",
			answers: {
				q1: { values: ["hg38"], recommendation: { value: "hg38" } },
				q2: { values: ["go"], customText: "再加 KEGG" },
			},
		});
		expect(answerSummary(req, response)).toBe("GRCh38；GO 富集、再加 KEGG");
		drafts.q2 = { values: ["go"], custom: "", skipped: true };
		expect(Object.keys((buildInlineResponse(req, drafts) as { answers: object }).answers)).toEqual(["q1"]);
	});
});
