import { describe, expect, it } from "vitest";
import { deliveryContract, hasPaperCitation, requiresPaperEvidence } from "../src/source-delivery";

describe("source delivery", () => {
	it("requires bounded paper evidence for research prompts", () => {
		expect(requiresPaperEvidence("比较基因组研究方案")).toBe(true);
		expect(deliveryContract("你好")).toBeNull();
		expect(deliveryContract("继续", { researchContinuation: true })?.kind).toBe("research");
	});
	it("does not mistake a Wiki page for a paper citation", () => {
		expect(hasPaperCitation([{ path: "Wiki/wing.md" }])).toBe(false);
		expect(hasPaperCitation([{ path: "Library/Papers/wing.md", paperDois: ["10.1038/abc"] }])).toBe(true);
	});
});
