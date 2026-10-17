import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AssistantMessage } from "./AssistantMessage";

vi.stubGlobal("React", React);

vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, string | number>) => {
		if (key === "message.runSummary") return `Ran ${params?.duration} · ${params?.count} steps`;
		if (key === "composer.mode.lead") return "Lead";
		if (key === "message.assistant") return "Assistant";
		if (key === "message.stepsSummary") return `${params?.count} steps`;
		return key;
	},
}));
vi.mock("../../stores/sessions", () => ({
	useSessionsStore: (selector: (state: { currentModel: { modelId: string } }) => unknown) =>
		selector({ currentModel: { modelId: "gpt-research" } }),
}));
vi.mock("./Markdown", () => ({ Markdown: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("./MetaGroup", () => ({ MetaGroup: () => null }));
vi.mock("./MemoryCitationRow", () => ({ MemoryCitationRow: () => null }));

it("renders the real model, answer mode and completed turn summary beside a long answer", () => {
	const longText = "同一条回答中的长文本。".repeat(200);
	const html = renderToStaticMarkup(
		<AssistantMessage
			text={longText}
			thinking=""
			tools={[]}
			metaInGroup
			mode="lead"
			turnTiming={{ turnIndex: 0, startedAt: 1_000, endedAt: 6_250 }}
		/>,
	);
	expect(html).toContain("gpt-research");
	expect(html).toContain("Lead");
	expect(html).toContain("Ran 5s · 0 steps");
	expect(html).toContain(longText.slice(0, 30));
});

it("does not invent timing when the transcript has no timing evidence", () => {
	const html = renderToStaticMarkup(
		<AssistantMessage text="回答" thinking="" tools={[]} metaInGroup mode="lead" />,
	);
	expect(html).not.toContain("Ran");
	expect(html).not.toContain("undefined");
});
