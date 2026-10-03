import { describe, expect, it } from "vitest";
import {
	buildKnowledgeSearchExpression,
	splitKnowledgeChunks,
	tokenizeKnowledgeText,
} from "../src/search-policy";

describe("knowledge search policy", () => {
	it("normalizes Latin text and emits Chinese unigram/bigram terms", () => {
		expect(tokenizeKnowledgeText("  Wg-Pathway  翼  ")).toEqual(["wg-pathway", "翼"]);
		expect(tokenizeKnowledgeText("翅膀发育")).toEqual(["翅", "翅膀", "膀", "膀发", "发", "发育", "育"]);
	});

	it("deduplicates and quotes terms for FTS5", () => {
		expect(buildKnowledgeSearchExpression('Wg Wg "wing margin"')).toBe('"wg" OR "wing" OR "margin"');
		expect(buildKnowledgeSearchExpression("翅膀")).toBe('"翅" OR "翅膀" OR "膀"');
	});

	it("rejects empty, punctuation-only and oversized queries", () => {
		expect(() => buildKnowledgeSearchExpression(" ")).toThrow("Query must contain");
		expect(() => buildKnowledgeSearchExpression("---")).toThrow("no searchable terms");
		expect(() => buildKnowledgeSearchExpression("x".repeat(2001))).toThrow("Query must contain");
	});

	it("splits semantic text without silently dropping long-note chunks", () => {
		expect(splitKnowledgeChunks("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
		expect(splitKnowledgeChunks("x".repeat(1000), 1)).toHaveLength(1000);
		expect(() => splitKnowledgeChunks("x", 0)).toThrow("chunk size");
	});
});
