import { describe, expect, it } from "vitest";
import { noteDisplayText } from "./note-display";

describe("noteDisplayText", () => {
	it("hides frontmatter and a duplicated managed header", () => {
		const raw =
			"---\ntype: wiki\nstatus: unverified\n---\n\n# Attention\n\n<!-- pi-agent:managed:start -->\n---\ntype: wiki\n---\n\n# Attention\n\n正文\n<!-- pi-agent:managed:end -->\n\n## Human review\n";
		expect(noteDisplayText(raw)).toBe("# Attention\n\n正文\n\n## Human review\n");
	});

	it("leaves a normal note intact apart from its frontmatter", () => {
		expect(noteDisplayText("---\na: 1\n---\n# T\n\n## Section\n\ntext")).toBe("# T\n\n## Section\n\ntext");
	});

	it("keeps a different first heading under the title", () => {
		expect(noteDisplayText("# Run 1\n\n# LoRA 总结\n\n正文")).toBe("# Run 1\n\n# LoRA 总结\n\n正文");
	});
});
