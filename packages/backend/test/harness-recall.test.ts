import { describe, expect, it } from "vitest";
import { recallFromBranch, redactRecall } from "../src/session-engine/harness/recall";

describe("harness recall", () => {
	it("returns bounded known entries and excludes arbitrary private extension state", () => {
		const hits = recallFromBranch(
			[
				{ type: "custom", id: "secret", customType: "private-memory", data: { text: "ignore me" } },
				{
					type: "custom_message",
					id: "task",
					customType: "drone-task-status",
					content: "Report is in docs/report.md",
					timestamp: "2026-10-05",
				},
				{
					type: "message",
					id: "user",
					message: { role: "user", content: [{ type: "text", text: "Report" }] },
				},
			],
			"report",
			6,
			"session-1",
		);
		expect(hits).toHaveLength(2);
		expect(hits[0]?.sourceId).toContain("session-1/");
		expect(hits[0]?.hash).toHaveLength(64);
		expect(hits.every((hit) => hit.excerpt.length <= 900)).toBe(true);
	});
	it("redacts credentials and URL query strings", () => {
		const text = redactRecall("token: sk-1234567890123456 https://example.com/a?secret=1");
		expect(text).toContain("[redacted token]");
		expect(text).not.toContain("secret=1");
	});
});
