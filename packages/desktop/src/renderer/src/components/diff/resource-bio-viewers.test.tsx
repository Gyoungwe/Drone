import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../i18n", () => ({
	useT: () => (key: string, params?: Record<string, string | number>) =>
		params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.stubGlobal("React", React);

import { AlignmentReader, alignmentRuler, TreeReader } from "./ResourceBioViewers";

describe("result viewer: trees and alignments", () => {
	it("draws a Newick tree with leaves, support labels and a scale bar", () => {
		const html = renderToStaticMarkup(createElement(TreeReader, { text: "((A:0.1,B:0.2)90:0.05,C:0.3);" }));
		expect(html).toContain('data-testid="resource-tree"');
		expect(html).toContain("&quot;leaves&quot;:3");
		expect(html.match(/class="resource-tree-leaf"/g)).toHaveLength(3);
		expect(html).toContain(">90</text>");
		expect(html).toContain("resource-tree-scale");
	});

	it("reports a parse error instead of drawing", () => {
		const html = renderToStaticMarkup(createElement(TreeReader, { text: "((A,B);" }));
		expect(html).toContain("resource.tree.parseFailed");
	});

	it("renders an alignment with coloured residues and conservation", () => {
		const html = renderToStaticMarkup(
			createElement(AlignmentReader, { text: ">a\nAC-T\n>b\nAG-T\n", ext: "fasta" }),
		);
		expect(html).toContain('data-testid="resource-alignment"');
		expect(html).toContain("res-nt-A");
		expect(html).toContain("res-gap");
		expect(html.match(/class="resource-conservation"/g)).toHaveLength(4);
	});

	it("places column numbers at every tenth column", () => {
		const ruler = alignmentRuler(0, 25);
		expect(ruler).toHaveLength(25);
		expect(ruler.slice(8, 10)).toBe("10");
		expect(ruler.slice(18, 20)).toBe("20");
		expect(alignmentRuler(120, 130).endsWith("130")).toBe(true);
	});
});
