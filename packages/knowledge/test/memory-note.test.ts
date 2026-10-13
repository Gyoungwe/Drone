import { expect, it } from "vitest";
import { memoryNoteMarkdown, memoryNoteSlug } from "../src/memory-note";

it("renders a typed memory note with provenance and related links", () => {
	const text = memoryNoteMarkdown(
		{
			id: 7,
			kind: "summary",
			title: "DESeq2 差异分析",
			body: "完成计数",
			sessionId: "s1",
			createdAt: Date.UTC(2026, 9, 13),
			files: ["deseq2.R", "deseq2.R"],
		},
		["Library/Papers/love2014.md"],
	);
	expect(text).toMatch(/^---\ntype: memory\n/);
	expect(text).toContain("memory_id: 7");
	expect(text).toContain("date: 2026-10-13");
	expect(text.match(/deseq2\.R/g)?.length).toBe(2);
	expect(text).toContain("[[Library/Papers/love2014]]");
	expect(memoryNoteSlug({ id: 7, title: "DESeq2 差异分析" })).toBe("deseq2-差异分析-m7");
});
