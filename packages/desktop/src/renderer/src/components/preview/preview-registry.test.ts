import { describe, expect, it } from "vitest";
import { pdfPageFromFragment } from "./preview-registry";

describe("PDF citation fragments", () => {
	it("accepts positive page fragments and rejects malformed values", () => {
		expect(pdfPageFromFragment("page=5")).toBe(5);
		expect(pdfPageFromFragment("page=0")).toBeUndefined();
		expect(pdfPageFromFragment("section=methods")).toBeUndefined();
	});
});
