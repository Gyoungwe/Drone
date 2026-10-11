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

it("shows one compact first-run guide with environment setup and a visible example", () => {
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	const html = renderToStaticMarkup(createElement(FirstRunGuide));
	expect(html).toContain('data-testid="first-run-guide"');
	expect(html).toContain('data-testid="first-run-knowledge"');
	expect(html).toContain('data-testid="first-run-zotero"');
	expect(html).toContain('data-testid="first-run-compute"');
	expect(html).toContain('data-testid="first-run-example"');
});

it("stays quiet after the user has dismissed it", () => {
	vi.stubGlobal("localStorage", { getItem: () => "1", setItem: vi.fn() });
	expect(renderToStaticMarkup(createElement(FirstRunGuide))).toBe("");
});
