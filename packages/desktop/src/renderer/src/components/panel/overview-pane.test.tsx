import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@drone/shared", () => ({
	collectDeliveries: () => [],
	deriveProcessLaneTurns: () => [],
}));
vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../../stores/sessions", () => ({
	useSessionsStore: (selector: (state: { cwd: string }) => unknown) => selector({ cwd: "/project" }),
}));
vi.mock("../../stores/transcript", () => ({
	selectTranscript: () => ({ messages: [], todos: [], reviewerFindings: [] }),
	useTranscriptStore: (selector: (state: Record<string, never>) => unknown) => selector({}),
}));
vi.mock("../../stores/subagents", () => ({
	summarizeRuns: () => ({ active: 0 }),
	useSubagentsStore: (selector: (state: { runsBySession: Record<string, never> }) => unknown) =>
		selector({ runsBySession: {} }),
}));
vi.mock("../chat/DeliveryCards", () => ({ DeliveryCards: () => null }));
vi.mock("./ContextUsageMeter", () => ({ ContextUsageMeter: () => <div data-testid="context-usage" /> }));
vi.mock("./EvidencePane", () => ({ EvidencePane: () => null }));
vi.mock("./ProcessPane", () => ({ ProcessPane: () => null }));
vi.mock("./ReviewerCard", () => ({ ReviewerCard: () => null }));
vi.mock("./SubagentsPane", () => ({ SubagentsPane: () => null }));
vi.mock("./SessionOverviewSections", () => ({
	DecisionsSection: () => null,
	SessionOverviewSections: () => <div data-testid="overview-sections" />,
}));

vi.stubGlobal("React", React);

import { OverviewPane } from "./OverviewPane";

describe("OverviewPane", () => {
	it("renders the data-driven shell without design fixture records", () => {
		const html = renderToStaticMarkup(createElement(OverviewPane, { sessionId: "session-1" }));

		expect(html).toContain('data-testid="overview-pane"');
		expect(html).toContain('data-testid="context-usage"');
		expect(html).toContain('data-testid="overview-sections"');
		expect(html).not.toContain("scVI");
		expect(html).not.toContain("Harmony");
		expect(html).not.toContain("105");
	});
});
