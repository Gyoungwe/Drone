import { describe, expect, it } from "vitest";
import { latexOutline, typstOutline } from "./doc-outline";
import { parseObj, parseStl, projectMesh } from "./mesh-preview";
import { heatmapGrid, npyMatrix, parseNpy } from "./npy-preview";

function npy(descr: string, shape: number[], values: number[], fortran = false, bytes = 8): Uint8Array {
	const shapeText = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(", ")})`;
	let header = `{'descr': '${descr}', 'fortran_order': ${fortran ? "True" : "False"}, 'shape': ${shapeText}, }`;
	while ((10 + header.length + 1) % 64) header += " ";
	header += "\n";
	const out = new Uint8Array(10 + header.length + values.length * bytes);
	out.set([0x93, ...[..."NUMPY"].map((c) => c.charCodeAt(0)), 1, 0], 0);
	new DataView(out.buffer).setUint16(8, header.length, true);
	out.set(
		[...header].map((c) => c.charCodeAt(0)),
		10,
	);
	const view = new DataView(out.buffer);
	values.forEach((v, i) => {
		const o = 10 + header.length + i * bytes;
		if (descr.endsWith("f8")) view.setFloat64(o, v, true);
		else if (descr.endsWith("i4")) view.setInt32(o, v, true);
	});
	return out;
}

describe("npy", () => {
	it("parses float64 2D arrays in C and Fortran order", () => {
		const a = parseNpy(npy("<f8", [2, 3], [1, 2, 3, 4, 5, 6]));
		expect(a.shape).toEqual([2, 3]);
		expect(npyMatrix(a).at(1, 2)).toBe(6);
		const f = parseNpy(npy("<f8", [2, 3], [1, 4, 2, 5, 3, 6], true));
		expect(npyMatrix(f).at(1, 2)).toBe(6);
	});
	it("parses int32 1D and builds a heatmap grid", () => {
		const a = parseNpy(npy("<i4", [4], [0, 10, 20, 30], false, 4));
		const g = heatmapGrid(a, 2);
		expect(g.rows).toBe(1);
		expect(g.cols).toBe(2);
		expect([...g.cells]).toEqual([5, 25]);
		expect([g.min, g.max]).toEqual([5, 25]);
	});
	it("rejects non-npy and big-endian", () => {
		expect(() => parseNpy(new Uint8Array(20))).toThrow(/npy/);
		expect(() => parseNpy(npy(">f8", [1], [1]))).toThrow(/big-endian/);
	});
});

describe("mesh", () => {
	it("parses ASCII STL and OBJ (with quads)", () => {
		const stl =
			"solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid";
		const m = parseStl(new TextEncoder().encode(stl));
		expect(m.count).toBe(1);
		expect(m.bounds.max).toEqual([1, 1, 0]);
		const obj = parseObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n");
		expect(obj.count).toBe(2);
		expect(projectMesh(obj, 0.3, 0.2, 200)).toHaveLength(2);
	});
	it("parses binary STL", () => {
		const buf = new Uint8Array(84 + 50);
		const view = new DataView(buf.buffer);
		view.setUint32(80, 1, true);
		for (const [k, v] of [0, 0, 0, 2, 0, 0, 0, 2, 0].entries()) view.setFloat32(96 + k * 4, v, true);
		const m = parseStl(buf);
		expect(m.count).toBe(1);
		expect(m.bounds.max).toEqual([2, 2, 0]);
	});
});

describe("doc outline", () => {
	it("extracts latex headings, paragraphs and math", () => {
		const o = latexOutline(
			"\\title{My Paper}\n\\begin{document}\n\\section{Intro}\nHello \\textbf{world} % note\n\n\\subsection{Model}\n\\begin{equation}E=mc^2\\end{equation}\n\\end{document}",
		);
		expect(o.title).toBe("My Paper");
		expect(o.blocks).toEqual([
			{ kind: "heading", level: 1, text: "Intro" },
			{ kind: "paragraph", text: "Hello world" },
			{ kind: "heading", level: 2, text: "Model" },
			{ kind: "math", text: "E=mc^2" },
		]);
	});
	it("extracts typst headings and math", () => {
		const o = typstOutline(
			'#set document(title: "Notes")\n= Intro\nSome *bold* text\n\n== Eq\n$ a^2 + b^2 = c^2 $\n',
		);
		expect(o.title).toBe("Notes");
		expect(o.blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "heading", "math"]);
		expect(o.blocks[3]).toEqual({ kind: "math", text: "a^2 + b^2 = c^2" });
	});
});
