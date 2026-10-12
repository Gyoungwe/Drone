import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { StatePanel } from "./StatePanel";

vi.stubGlobal("React", React);

it("announces loading politely and errors assertively; empty stays silent", () => {
	expect(renderToStaticMarkup(createElement(StatePanel, { kind: "loading", title: "加载中" }))).toMatch(
		/role="status"[^>]*aria-busy="true"/,
	);
	expect(renderToStaticMarkup(createElement(StatePanel, { kind: "error", title: "失败" }))).toContain(
		'role="alert"',
	);
	const empty = renderToStaticMarkup(createElement(StatePanel, { title: "暂无" }));
	expect(empty).not.toContain("role=");
	expect(empty).toContain('data-state="empty"');
});

it("renders hint and action slots", () => {
	const html = renderToStaticMarkup(
		createElement(StatePanel, {
			title: "暂无",
			hint: "去设置",
			action: createElement("button", { type: "button" }, "打开"),
		}),
	);
	expect(html).toContain("去设置");
	expect(html).toContain("打开");
});
