import { describe, expect, it } from "vitest";
import { looksLikeFileName, noteDisplayTitle } from "../src/note-title";

describe("noteDisplayTitle", () => {
	it("prefers the ingestion topic over a file-name heading", () => {
		const text = '---\ntype: paper\ntopic: "DHX16 在 pre-mRNA 剪接中的作用"\n---\n\n# PMC7022188.1.pdf\n';
		expect(noteDisplayTitle(text, "Library/Papers/pmc7022188-1-pdf-811427095c30c895.md")).toBe(
			"DHX16 在 pre-mRNA 剪接中的作用",
		);
	});
	it("uses frontmatter title only when the heading is a file name", () => {
		expect(noteDisplayTitle("---\ntitle: LoRA\n---\n# PMC123.pdf\n", "a.md")).toBe("LoRA");
		expect(noteDisplayTitle("---\ntitle: LoRA\n---\n# 低秩适配\n", "a.md")).toBe("低秩适配");
	});
	it("falls back to the heading, then the file name", () => {
		expect(noteDisplayTitle("# Attention\n", "Wiki/x.md")).toBe("Attention");
		expect(noteDisplayTitle("no heading", "Wiki/agent-design.md")).toBe("agent-design");
	});
	it("recognises file-name titles", () => {
		expect(looksLikeFileName("PMC7022188.1.pdf")).toBe(true);
		expect(looksLikeFileName("PMC7022188")).toBe(true);
		expect(looksLikeFileName("pmc7022188-1-pdf-811427095c30c895")).toBe(true);
		expect(looksLikeFileName("LoRA: Low-Rank Adaptation")).toBe(false);
		expect(looksLikeFileName("agent-design-principles")).toBe(false);
	});
});
