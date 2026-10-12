import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ActionSurface, trapFocusIndex } from "./ActionSurface";

vi.stubGlobal("React", React);

const render = (props: Record<string, unknown> = {}) =>
	renderToStaticMarkup(
		createElement(
			ActionSurface,
			{ ariaLabel: "确认", testId: "s", ...props } as never,
			createElement("button", { type: "button" }, "ok"),
		),
	);

it("puts dialog semantics on the panel, not the backdrop", () => {
	const html = render();
	expect(html).toMatch(/role="presentation"[^>]*data-testid="s-backdrop"/);
	expect(html).toMatch(/role="dialog"[^>]*aria-modal="true"[^>]*aria-label="确认"[^>]*data-testid="s"/);
});

it("maps tone and height variants", () => {
	expect(render({ tone: "danger" })).toContain('data-tone="danger"');
	expect(render({ tone: "danger" })).toContain("before:bg-err");
	expect(render({ height: "fit" })).toContain("items-start");
	expect(render()).toContain("items-stretch");
	expect(render({ width: "wide" })).toContain("560px");
});

it("respects reduced motion and keeps a visible focus ring", () => {
	const html = render();
	expect(html).toContain("motion-safe:animate-");
	expect(html).toContain("[&amp;_:focus-visible]:outline-2");
});

it("wraps focus at both ends and leaves middle moves to the browser", () => {
	expect(trapFocusIndex(0, -1, false)).toBe(-1);
	expect(trapFocusIndex(3, -1, false)).toBe(0);
	expect(trapFocusIndex(3, -1, true)).toBe(2);
	expect(trapFocusIndex(3, 2, false)).toBe(0);
	expect(trapFocusIndex(3, 0, true)).toBe(2);
	expect(trapFocusIndex(3, 1, false)).toBe(-1);
	expect(trapFocusIndex(3, 1, true)).toBe(-1);
});
