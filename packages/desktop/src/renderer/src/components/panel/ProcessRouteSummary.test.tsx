import type { TurnRoute } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProcessRouteSummary } from "./ProcessRouteSummary";

vi.mock("../../i18n", () => ({
	useI18nStore: (selector: (state: { language: string }) => unknown) => selector({ language: "zh" }),
	useT: () => (key: string, params?: Record<string, string | number>) =>
		key === "panel.processRoute.stepCount" ? `${params?.current}/${params?.total} 步` : key,
}));
vi.stubGlobal("React", React);

const route: TurnRoute = {
	utterance: "继续处理当前任务",
	intake: "continuation",
	capabilities: ["research"],
	topics: [],
	direction: null,
	stage: null,
	contract: null,
	primary: null,
	reason: null,
	unavailableStage: null,
	comparison: false,
	academic: false,
	keptCheckpoint: true,
	deferPhrase: true,
	visiblePrimary: false,
	landing: "host-gate",
	host: {
		reason: "stage-budget",
		state: "waiting_user",
		stageCalls: 48,
		calls: 76,
		progressCount: 46,
		stageStartProgress: 16,
		stageLimited: true,
		hasProgress: true,
		pendingReview: true,
		reviewLinked: false,
		deferredReviews: 0,
		releasedStage: false,
	},
};

it("shows the current processing node and compact progress", () => {
	const html = renderToStaticMarkup(createElement(ProcessRouteSummary, { route }));
	expect(html).toContain('data-testid="process-route-summary"');
	expect(html).toContain('data-route-status="blocked"');
	expect(html).toContain('data-testid="process-route-progress"');
	expect(html).toContain('data-testid="process-route-current"');
	expect(html).toContain(">工具</span>");
	expect(html).toContain("5/6 步");
	expect(html).not.toContain("当前需要关注");
});
