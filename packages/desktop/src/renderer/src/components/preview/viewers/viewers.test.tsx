import type { ResourcePreviewResult } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../../diff/ResourceCode", () => ({ ResourceCode: ({ text }: { text: string }) => `code:${text}` }));
vi.mock("../../diff/ResourceMarkdown", () => ({
	ResourceMarkdown: ({ text }: { text: string }) => `md:${text}`,
}));
vi.stubGlobal("React", React);

import { previewRendererFor, routePreview } from "../preview-registry";
import "./index";
import { MediaViewer } from "./MediaViewer";
import { MermaidViewer } from "./MermaidViewer";
import { NotebookViewer } from "./NotebookViewer";

const r = (over: Partial<ResourcePreviewResult>): ResourcePreviewResult => ({
	path: "/x",
	name: "x",
	mimeType: "text/plain",
	size: 1,
	kind: "text",
	...over,
});

describe("P3 viewers", () => {
	it("registers notebook / mermaid / audio / video", () => {
		for (const k of ["notebook", "mermaid", "audio", "video"] as const)
			expect(previewRendererFor(k)).toBeTruthy();
		expect(routePreview(r({ name: "a.ipynb", previewKind: "notebook", text: "{}" }), false).view).toBe(
			"registered",
		);
	});
	it("renders notebook cells and outputs", () => {
		const text = JSON.stringify({
			cells: [
				{ cell_type: "markdown", source: "# Hi" },
				{
					cell_type: "code",
					execution_count: 1,
					source: "1+1",
					outputs: [{ output_type: "execute_result", data: { "text/plain": "2" } }],
				},
			],
		});
		const html = renderToStaticMarkup(createElement(NotebookViewer, { result: r({ text }), src: null }));
		expect(html).toContain("md:# Hi");
		expect(html).toContain("code:1+1");
		expect(html).toContain("[1]");
		expect(html).toContain(">2</pre>");
	});
	it("falls back with a notice on broken notebooks", () => {
		const html = renderToStaticMarkup(
			createElement(NotebookViewer, { result: r({ text: '{"cells": [' }), src: null }),
		);
		expect(html).toContain("resource.viewer.notebookParseFailed");
	});
	it("mermaid shows a loading state before the lazy renderer resolves", () => {
		const html = renderToStaticMarkup(
			createElement(MermaidViewer, { result: r({ text: "graph TD; A-->B" }), src: null }),
		);
		expect(html).toContain("resource.viewer.mermaidLoading");
	});
	it("media renders audio / video tags or the size notice", () => {
		expect(
			renderToStaticMarkup(
				createElement(MediaViewer, { result: r({ mimeType: "video/mp4" }), src: "data:video/mp4;base64,AA" }),
			),
		).toContain("<video");
		expect(
			renderToStaticMarkup(
				createElement(MediaViewer, {
					result: r({ mimeType: "audio/mpeg" }),
					src: "data:audio/mpeg;base64,AA",
				}),
			),
		).toContain("<audio");
		expect(
			renderToStaticMarkup(createElement(MediaViewer, { result: r({ mimeType: "audio/mpeg" }), src: null })),
		).toContain("resource.viewer.mediaTooLarge");
	});
});
