import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ProcessBlock } from "./ProcessBlock";

vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, unknown>) =>
		params ? `${key}:${Object.values(params).join(",")}` : key,
}));
vi.stubGlobal("React", React);

const seg = (working: boolean) =>
	({ working, stages: 3, tools: 9, subagents: 0, stopped: false, latestStage: { text: "s" } }) as never;
const kids = ["a", "b", "c", "d", "e"].map((k) => createElement("p", { key: k }, `row-${k}`));

it("while running shows only the latest two rows and folds the rest", () => {
	const html = renderToStaticMarkup(createElement(ProcessBlock, { segment: seg(true), children: kids }));
	expect(html).toContain("process.earlier:3");
	expect(html).not.toContain("row-a");
	expect(html).toContain("row-d");
	expect(html).toContain("row-e");
});
