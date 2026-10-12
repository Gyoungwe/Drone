import type { ResourcePreviewResult } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../i18n", () => ({
	useT: () => (key: string) => key,
}));
vi.mock("../../api", () => ({ getPi: () => ({}) }));
vi.mock("../diff/ResourceCode", () => ({ ResourceCode: ({ text }: { text: string }) => `code:${text}` }));
vi.mock("../diff/ResourceTextPreview", () => ({ ResourceTextPreview: () => "text-preview" }));
vi.mock("../diff/FigureAnnotator", () => ({
	FigureAnnotator: ({ children }: { children: unknown }) => children,
}));
vi.stubGlobal("React", React);

import { PreviewHost } from "./PreviewHost";
import { hasSourceTab, registerPreviewRenderer, routePreview } from "./preview-registry";

const base = (over: Partial<ResourcePreviewResult>): ResourcePreviewResult => ({
	path: "/tmp/x",
	name: "x.txt",
	mimeType: "text/plain",
	size: 1,
	kind: "text",
	...over,
});

describe("PreviewHost routing", () => {
	it.each([
		[base({ kind: "image", name: "a.png" }), true, "image"],
		[base({ kind: "image", name: "a.png" }), false, "too-large"],
		[base({ kind: "pdf", name: "a.pdf" }), true, "pdf"],
		[base({ kind: "text", name: "a.csv", text: "a,b" }), false, "text"],
		[base({ kind: "binary", name: "a.zip" }), false, "binary"],
	])("routes %#", (result, hasSrc, view) => {
		expect(routePreview(result, hasSrc).view).toBe(view);
	});
	it("prefers a registered renderer for its previewKind", () => {
		registerPreviewRenderer("audio", ({ result }) => createElement("audio", { "data-name": result.name }));
		const result = base({ kind: "binary", name: "a.mp3", previewKind: "audio" });
		expect(routePreview(result, false)).toEqual({ view: "registered", kind: "audio" });
		const html = renderToStaticMarkup(
			createElement(PreviewHost, {
				result,
				src: null,
				mode: "preview",
				zoom: 1,
				imageError: false,
				onImageError: () => {},
				onNavigate: () => {},
				source: { href: "/tmp/a.mp3" },
			}),
		);
		expect(html).toContain('data-preview-kind="audio"');
		expect(html).toContain('data-name="a.mp3"');
	});
	it("source tab exists whenever text is present and renders code", () => {
		const result = base({ name: "a.json", text: '{"a":1}' });
		expect(hasSourceTab(result)).toBe(true);
		expect(hasSourceTab(base({ kind: "image" }))).toBe(false);
	});
	it("renders the binary hint", () => {
		const html = renderToStaticMarkup(
			createElement(PreviewHost, {
				result: base({ kind: "binary", name: "a.zip" }),
				src: null,
				mode: "preview",
				zoom: 1,
				imageError: false,
				onImageError: () => {},
				onNavigate: () => {},
				source: { href: "/tmp/a.zip" },
			}),
		);
		expect(html).toContain("resource.binaryHint");
	});
});
