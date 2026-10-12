import type { SearchItem } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../../api", () => ({ getPi: () => ({}) }));
vi.stubGlobal("React", React);

import { SearchPaletteView } from "./SearchPalette";

const items: SearchItem[] = [
	{ kind: "task", id: "1", title: "RNA-seq 差异分析", pinned: true, lastActive: 1 },
	{ kind: "project", id: "/p", title: "survey", pinned: false, lastActive: 2 },
];

describe("SearchPaletteView", () => {
	it("renders filters, kinds and pinned badges", () => {
		const html = renderToStaticMarkup(
			createElement(SearchPaletteView, { items, onPick: () => {}, onClose: () => {} }),
		);
		for (const f of ["all", "pinned", "project", "task"]) expect(html).toContain(`search.filter.${f}`);
		expect(html).toContain("RNA-seq 差异分析");
		expect(html).toContain("search.pinned");
		expect(html.match(/role="option"/g)).toHaveLength(2);
	});
	it("pinned filter only shows pinned items", () => {
		const html = renderToStaticMarkup(
			createElement(SearchPaletteView, {
				items,
				initialFilter: "pinned",
				onPick: () => {},
				onClose: () => {},
			}),
		);
		expect(html.match(/role="option"/g)).toHaveLength(1);
		expect(html).not.toContain("survey");
	});
});
