import { describe, expect, it } from "vitest";
import {
	filePreviewDirectory,
	parseDelimited,
	resourceFormat,
	sequencePreview,
	tablePreview,
} from "./resource-preview-format";

describe("bounded resource format previews", () => {
	it.each([
		["report.MD", "markdown"],
		["data.csv.gz", "table"],
		["calls.vcf.gz", "table"],
		["reads.fq.gz", "fastq"],
		["assembly.fna", "fasta"],
		["protein.faa", "fasta"],
		["notes.html", "html"],
		["analysis.R", "code"],
		["pipeline.nf", "code"],
		["Snakefile", "code"],
		["README", "text"],
		["result.json", "json"],
	])("classifies %s as %s", (name, kind) => {
		expect(resourceFormat(name).kind).toBe(kind);
		expect(resourceFormat(name).supported).toBe(true);
	});
	it.each(["data.bam", "data.cram", "data.bcf", "data.h5", "data.parquet", "archive.zip", "unknown.gz"])(
		"does not pretend %s is decodable text",
		(name) => expect(resourceFormat(name).supported).toBe(false),
	);
	it("retains Unix, Windows drive and UNC parents for relative report links", () => {
		expect(filePreviewDirectory("/report.md")).toBe("/");
		expect(filePreviewDirectory("C:\\report.md")).toBe("C:/");
		expect(filePreviewDirectory("C:\\a\\report.md")).toBe("C:/a");
		expect(filePreviewDirectory("\\\\server\\share\\report.md")).toBe("//server/share");
	});
	it("parses CSV quoted commas, embedded newlines, escaped quotes and CRLF", () => {
		const p = tablePreview('name,note\r\nalpha,"a,b"\r\nbeta,"one\ntwo ""quotes"""\r\n', "csv");
		expect(p.rows).toEqual([
			["alpha", "a,b"],
			["beta", 'one\ntwo "quotes"'],
		]);
		expect(p.warnings).toEqual([]);
	});
	it("keeps no-header TSV's first record and warns about an unfinished CSV quote", () => {
		expect(tablePreview("a\t1\nb\t2", "tsv", false).rows).toEqual([
			["a", "1"],
			["b", "2"],
		]);
		expect(parseDelimited('a,"unfinished', ",").incomplete).toBe(true);
	});
	it("bounds rows, columns and individual cells with explicit clipping", () => {
		expect(
			tablePreview(`id\n${Array.from({ length: 250 }, (_, i) => String(i)).join("\n")}`, "csv"),
		).toMatchObject({ clipped: true });
		expect(
			tablePreview(`id\n${Array.from({ length: 250 }, (_, i) => String(i)).join("\n")}`, "csv").rows,
		).toHaveLength(200);
		const columns = tablePreview(Array(65).fill("x").join("\t"), "tsv", false);
		expect(columns.headers).toHaveLength(60);
		expect(columns.clipped).toBe(true);
		const long = parseDelimited("x".repeat(3000), ",");
		expect(long.rows[0]?.[0]).toHaveLength(2000);
		expect(long.clipped).toBe(true);
	});
	it("keeps GTF literal quotes and GFF coordinates, excluding embedded FASTA", () => {
		const p = tablePreview(
			'##gff-version 3\nchr1\tx\tgene\t1\t12\t.\t+\t.\tgene_id "g1"; transcript_id "t1";\n##FASTA\n>chr1\nACGT',
			"gtf",
		);
		expect(p.headers[3]).toBe("start (1-based)");
		expect(p.rows).toHaveLength(1);
		expect(p.rows[0]?.[8]).toBe('gene_id "g1"; transcript_id "t1";');
		expect(p.warnings.join()).toContain("FASTA");
	});
	it("shows BED3 as three columns without inventing BED12 fields", () => {
		const p = tablePreview("track name=example\nchr1\t0\t12\nchr2\t5\t8", "bed");
		expect(p.headers).toEqual(["chrom", "start (0-based)", "end (exclusive)"]);
		expect(p.rows).toHaveLength(2);
		expect(p.metadata).toHaveLength(1);
	});
	it("uses VCF sample names verbatim and never infers missing ones", () => {
		const p = tablePreview(
			"##fileformat=VCFv4.3\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\n1\t7\t.\tA\tT\t.\tPASS\t.\tGT\t0/1",
			"vcf",
		);
		expect(p.headers[9]).toBe("S1");
		expect(p.rows[0]?.[1]).toBe("7");
		const missing = tablePreview("1\t7\t.\tA\tT", "vcf");
		expect(missing.headers[0]).toBe("列 1");
		expect(missing.warnings.join()).toContain("#CHROM");
		expect(tablePreview(`#CHROM\t${Array(61).fill("sample").join("\t")}`, "vcf").clipped).toBe(true);
	});
	it("does not treat a SAM quality string's opening quote as CSV quoting", () => {
		const row = 'read\t0\tchr1\t1\t60\t3M\t*\t0\t0\tACG\t"II';
		const p = tablePreview(`@HD\tVN:1.6\n${row}\n${row}`, "sam");
		expect(p.rows).toHaveLength(2);
		expect(p.rows[0]?.[10]).toBe('"II');
		expect(p.warnings).toEqual([]);
	});
	it("keeps only bounded FASTA snippets and labels clipping, without computing whole-file lengths", () => {
		const p = sequencePreview(`>seq1\n${"ACGT".repeat(200)}\n>seq2\nNNN\n`, "fasta");
		expect(p.records[0]).toMatchObject({ name: "seq1", length: 800 });
		expect(p.records[0]?.sequence).toHaveLength(600);
		expect(p.clipped).toBe(true);
		const many = sequencePreview(Array.from({ length: 25 }, (_, i) => `>seq${i}\nACG`).join("\n"), "fasta");
		expect(many.records).toHaveLength(20);
		expect(many.clipped).toBe(true);
	});
	it("parses multiline FASTQ including quality characters @ and + without guessing quality encoding", () => {
		const p = sequencePreview("@seq1\nACG\nTAC\n+seq1\n@+I\nIII\n@seq2\nAC\n+\nII\n", "fastq");
		expect(p.records).toHaveLength(2);
		expect(p.records[0]).toMatchObject({
			sequence: "ACGTAC",
			quality: "@+IIII",
			length: 6,
			warning: undefined,
		});
	});
	it("warns about incomplete FASTQ, missing FASTA titles and unexpected FASTQ line boundaries", () => {
		expect(sequencePreview("@x\nACGT\n+\nII", "fastq").records[0]?.warning).toBeTruthy();
		expect(sequencePreview("ACG\n", "fasta").warnings).not.toHaveLength(0);
		expect(sequencePreview("not-a-title\nACG", "fastq").records).toHaveLength(0);
	});
});
it.each([
	["x.r", "r"],
	["x.R", "r"],
	["x.py", "python"],
	["x.PY", "python"],
	["x.Py", "python"],
	["x.pyi", "python"],
	["x.PYW", "python"],
	[".Rprofile", "r"],
	["x.RSCRIPT", "r"],
])("case-insensitive script grammar for %s", (path, language) => {
	expect(resourceFormat(path)).toMatchObject({ kind: "code", language, supported: true });
});
