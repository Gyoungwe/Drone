import { describe, expect, it } from "vitest";
import { autoTopicCandidate } from "../src/topic-candidate";

describe("topic candidate", () => {
	it("requires current read evidence and bounded summary size", () => {
		expect(autoTopicCandidate({ summary: "too short", sourcePaths: ["a.md"] })).toEqual({
			eligible: false,
			reason: "summary-too-short",
		});
		const summary = `# Wing development\n\n${"Evidence-backed summary. ".repeat(10)}`;
		const result = autoTopicCandidate({
			summary,
			resultSlug: "wing_20260930",
			sourcePaths: ["Library/Papers/a.md"],
		});
		expect(result.eligible).toBe(true);
		if (result.eligible) expect(result.input.path).toBe("Wiki/wing.md");
	});
});
