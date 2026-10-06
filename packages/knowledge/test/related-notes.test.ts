import { describe, expect, it } from "vitest";
import { appendRelatedLinks } from "../src/related-notes";

describe("appendRelatedLinks", () => {
	it("adds a related-notes section with wiki links and skips links already in the text", () => {
		const text = appendRelatedLinks("See [[Library/Papers/a]].", [
			"Library/Papers/a.md",
			"Library/Software/b.md",
		]);
		expect(text).toContain("## 相关笔记\n- [[Library/Software/b]]");
		expect(text.match(/Library\/Papers\/a/g)).toHaveLength(1);
		expect(appendRelatedLinks("plain", [])).toBe("plain");
	});
});
