import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { FirstRunGuide } from "./FirstRunGuide";

vi.mock("../../i18n", () => ({
	useT: () => (key: string) => key,
	useI18nStore: (selector: (state: { language: string }) => unknown) => selector({ language: "zh" }),
}));
vi.stubGlobal("React", React);

afterEach(() => {
	vi.unstubAllGlobals();
});

it("starts with one clear choice instead of showing every setup surface", () => {
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	const html = renderToStaticMarkup(createElement(FirstRunGuide));
	expect(html).toContain('data-testid="first-run-guide"');
	expect(html).toContain('data-testid="first-run-example"');
	expect(html).toContain('data-testid="first-run-setup"');
	expect(html).not.toContain('data-testid="first-run-knowledge"');
});

it("stays quiet after the user has dismissed it", () => {
	vi.stubGlobal("localStorage", { getItem: () => "1", setItem: vi.fn() });
	expect(renderToStaticMarkup(createElement(FirstRunGuide))).toBe("");
});
