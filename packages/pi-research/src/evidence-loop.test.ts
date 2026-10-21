import { describe, expect, it } from "vitest";
import { citationUri, pageRange } from "./evidence-loop";

describe("PDF page citation markers", () => {
	it("finds the pages actually present in a read excerpt", () => {
		expect(pageRange("[[page:5]] methods\n[[page:6]] results")).toEqual({ start: 5, end: 6 });
		expect(pageRange("plain text")).toBeUndefined();
	});

	it("adds a page fragment only when a page was read", () => {
		expect(citationUri("file.pdf", { start: 5, end: 6 })).toBe("file.pdf#page=5");
		expect(citationUri("note.md", undefined)).toBe("note.md");
	});
});
