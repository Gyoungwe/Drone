import type { TrustRequest } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TrustDialog } from "./TrustDialog";

vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, unknown>) =>
		params ? `${key}:${Object.values(params).join(",")}` : key,
}));
vi.stubGlobal("React", React);

const request = (id: string): TrustRequest => ({
	id,
	cwd: "C:\\Projects\\DHX16",
	options: [{ key: "trust" }, { key: "deny" }],
});

it("renders nothing without a pending request", () => {
	expect(renderToStaticMarkup(createElement(TrustDialog, { requests: [], onRespond: vi.fn() }))).toBe("");
});

it("shows the folder as a warn-toned fit card with the safe choice first", () => {
	const html = renderToStaticMarkup(
		createElement(TrustDialog, { requests: [request("a")], onRespond: vi.fn() }),
	);
	expect(html).toContain('data-tone="warn"');
	expect(html).toContain("items-start");
	expect(html).toContain("C:\\Projects\\DHX16");
	expect(html.indexOf("trust.deny")).toBeLessThan(html.indexOf("trust.trust<"));
	expect(html).not.toContain("trust.queued");
});

it("tells the user how many trust requests are still queued", () => {
	const html = renderToStaticMarkup(
		createElement(TrustDialog, { requests: [request("a"), request("b")], onRespond: vi.fn() }),
	);
	expect(html).toContain("trust.queued:1");
});
