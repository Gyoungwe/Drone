import type { ResourcePreviewResult } from "@drone/shared";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../../diff/ResourceCode", () => ({ ResourceCode: () => null }));
vi.mock("../../diff/ResourceMarkdown", () => ({ ResourceMarkdown: () => null }));
vi.stubGlobal("React", React);

import { previewRendererFor } from "../preview-registry";
import { DocOutlineViewer } from "./DocOutlineViewer";
import "./index";
import { MeshViewer } from "./MeshViewer";
import { NpyViewer, viridis } from "./NpyViewer";

const r = (over: Partial<ResourcePreviewResult>): ResourcePreviewResult => ({
	path: "/x",
	name: "x",
	mimeType: "application/octet-stream",
	size: 1,
	kind: "binary",
	...over,
});
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function npyBytes(): Uint8Array {
	let header = "{'descr': '<f8', 'fortran_order': False, 'shape': (2, 2), }";
	while ((10 + header.length + 1) % 64) header += " ";
	header += "\n";
	const out = new Uint8Array(10 + header.length + 32);
	out.set([0x93, 78, 85, 77, 80, 89, 1, 0]);
	new DataView(out.buffer).setUint16(8, header.length, true);
	out.set(
		[...header].map((c) => c.charCodeAt(0)),
		10,
	);
	const view = new DataView(out.buffer);
	[1, 2, 3, 4].forEach((v, i) => {
		view.setFloat64(10 + header.length + i * 8, v, true);
	});
	return out;
}

describe("P4 viewers", () => {
	it("registers array / mesh / typst / latex", () => {
		for (const k of ["array", "mesh", "typst", "latex"] as const) expect(previewRendererFor(k)).toBeTruthy();
	});
	it("draws an npy heatmap with a colour scale", () => {
		const html = renderToStaticMarkup(
			createElement(NpyViewer, { result: r({ name: "a.npy", data: b64(npyBytes()) }), src: null }),
		);
		expect(html.match(/<rect/g)).toHaveLength(4);
		expect(html).toContain("resource.viewer.npySummary");
		expect(viridis(0)).toBe("rgb(68,1,84)");
		expect(viridis(1)).toBe("rgb(253,231,37)");
	});
	it("shows a parse error for corrupt npy", () => {
		const html = renderToStaticMarkup(createElement(NpyViewer, { result: r({ data: "AAAA" }), src: null }));
		expect(html).toContain("resource.viewer.npyFailed");
	});
	it("renders an OBJ mesh as shaded polygons", () => {
		const obj = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 0 0 1\nf 1 2 3 4\nf 1 2 5\n";
		const html = renderToStaticMarkup(
			createElement(MeshViewer, {
				result: r({ name: "m.obj", data: Buffer.from(obj).toString("base64") }),
				src: null,
			}),
		);
		expect(html.match(/<polygon/g)).toHaveLength(3);
	});
	it("outlines latex", () => {
		const html = renderToStaticMarkup(
			createElement(DocOutlineViewer, {
				result: r({
					kind: "text",
					name: "p.tex",
					previewKind: "latex",
					text: "\\section{Intro}\nHi\n\\[x^2\\]",
				}),
				src: null,
			}),
		);
		expect(html).toContain("<h2");
		expect(html).toContain("Intro");
		expect(html).toContain("x^2");
		expect(html).toContain("resource.viewer.latexNote");
	});
});
