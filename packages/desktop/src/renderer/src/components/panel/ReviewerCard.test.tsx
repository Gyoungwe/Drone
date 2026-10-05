import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, string | number>) =>
		params ? `${key}:${Object.values(params).join(",")}` : key,
}));

import { ReviewerCard } from "./ReviewerCard";

const finding = {
	id: "f1",
	code: "untraceable-number" as const,
	severity: "high" as const,
	location: { kind: "body" as const, line: 4, paragraph: 2 },
	detail: "数字没有来源",
	suggestion: "补充回执",
	handled: false,
};

describe("ReviewerCard", () => {
	it("renders a collapsed actionable review card", () => {
		const html = renderToStaticMarkup(createElement(ReviewerCard, { finding }));
		expect(html).toContain('data-testid="reviewer-card"');
		expect(html).toContain("untraceable-number");
		expect(html).toContain("补充回执");
		expect(html).not.toContain(" open");
	});

	it("shows the non-independent marker when model fallback is used", () => {
		const html = renderToStaticMarkup(
			createElement(ReviewerCard, {
				finding: {
					...finding,
					code: "citation-without-receipt",
					severity: "medium",
					nonIndependentReason: "非独立审稿",
				},
			}),
		);
		expect(html).toContain("非独立审稿");
	});
});
