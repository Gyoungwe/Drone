import { describe, expect, it } from "vitest";
import {
	alignmentPreview,
	columnConservation,
	isNucleotideAlignment,
	layoutTree,
	looksAligned,
	parseNewick,
	residueClass,
} from "./bio-preview-format";
import { resourceFormat } from "./resource-preview-format";

describe("newick", () => {
	it("parses names, branch lengths, quoted labels and support values", () => {
		const tree = parseNewick("((A:0.1,'B c':0.2)95:0.3,Homo_sapiens:0.4)root;");
		expect(tree.name).toBe("root");
		expect(tree.children).toHaveLength(2);
		expect(tree.children[0]).toMatchObject({ name: "95", length: 0.3 });
		expect(tree.children[0]?.children.map((child) => child.name)).toEqual(["A", "B c"]);
		expect(tree.children[1]).toMatchObject({ name: "Homo sapiens", length: 0.4 });
	});

	it("rejects malformed input", () => {
		expect(() => parseNewick("((A,B);")).toThrow(/expected "\)"/);
		expect(() => parseNewick("just text")).toThrow(/not a Newick/);
	});

	it("lays out leaves in order with cumulative branch lengths", () => {
		const layout = layoutTree(parseNewick("((A:1,B:2):1,C:1);"));
		expect(layout.leaves).toBe(3);
		expect(layout.hasLengths).toBe(true);
		expect(layout.depth).toBe(3);
		const byName = Object.fromEntries(layout.nodes.filter((n) => n.leaf).map((n) => [n.name, n]));
		expect(byName.A).toMatchObject({ x: 2, y: 0 });
		expect(byName.B).toMatchObject({ x: 3, y: 1 });
		expect(byName.C).toMatchObject({ x: 1, y: 2 });
		expect(layout.nodes[1]).toMatchObject({ leaf: false, y: 0.5 });
	});

	it("falls back to depth when there are no branch lengths", () => {
		const layout = layoutTree(parseNewick("((A,B),C);"));
		expect(layout.hasLengths).toBe(false);
		expect(layout.depth).toBe(2);
	});
});

describe("alignments", () => {
	it("reads interleaved Clustal and ignores the conservation line", () => {
		const parsed = alignmentPreview(
			"CLUSTAL W (1.83)\n\nseq1  ACGT-A 6\nseq2  ACGTTA 6\n      **** *\n\nseq1  GG\nseq2  GC\n",
			"aln",
		);
		expect(parsed.format).toBe("clustal");
		expect(parsed.records).toEqual([
			{ name: "seq1", sequence: "ACGT-AGG" },
			{ name: "seq2", sequence: "ACGTTAGC" },
		]);
		expect(parsed.warnings).toEqual([]);
	});

	it("reads Stockholm and interleaved PHYLIP", () => {
		const sto = alignmentPreview("# STOCKHOLM 1.0\n#=GF ID x\nA  MK-L\nB  MKVL\n//\n", "sto");
		expect(sto.records.map((r) => r.sequence)).toEqual(["MK-L", "MKVL"]);
		const phy = alignmentPreview(" 2 8\nalpha ACGT\nbeta  ACGA\n\nTTTT\nTTTA\n", "phy");
		expect(phy.format).toBe("phylip");
		expect(phy.records).toEqual([
			{ name: "alpha", sequence: "ACGTTTTT" },
			{ name: "beta", sequence: "ACGATTTA" },
		]);
	});

	it("detects aligned FASTA and warns on unequal lengths", () => {
		expect(looksAligned(">a\nAC-T\n>b\nACGT\n")).toBe(true);
		expect(looksAligned(">a\nACGT\n>b\nACGTA\n")).toBe(false);
		expect(alignmentPreview(">a\nAC-\n>b\nACGT\n", "fa").warnings[0]).toMatch(/长度不一致/);
	});

	it("scores conservation and colours residues", () => {
		const records = [
			{ name: "a", sequence: "AC-T" },
			{ name: "b", sequence: "AG-T" },
		];
		expect(columnConservation(records)).toEqual([1, 0.5, 0, 1]);
		expect(isNucleotideAlignment(records)).toBe(true);
		expect(residueClass("u", true)).toBe("nt-T");
		expect(residueClass("K", false)).toBe("aa-positive");
		expect(residueClass("-", false)).toBe("gap");
	});

	it("maps file extensions to the new viewers", () => {
		expect(resourceFormat("tree.nwk").kind).toBe("tree");
		expect(resourceFormat("run.treefile").kind).toBe("tree");
		expect(resourceFormat("msa.aln").kind).toBe("alignment");
		expect(resourceFormat("pfam.sto.gz").kind).toBe("alignment");
		expect(resourceFormat("supermatrix.phy").supported).toBe(true);
	});
});
