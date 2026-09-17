import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { TEXT_PREVIEW_BYTES } from "@drone/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { previewLocalFile, resolveResourcePath } from "./file-preview";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "drone-resource-preview-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});
async function fixture(name: string, value: string | Buffer) {
	const path = join(root, name);
	await writeFile(path, value);
	return path;
}
describe("local bounded file reads without Electron or scientific validation", () => {
	it("reads literal percent/CJK paths and file URLs without double decoding", async () => {
		const path = await fixture("报告 #100%20 (1).md", "# 报告\n内容");
		expect(resolveResourcePath(path)).toBe(path);
		expect((await previewLocalFile(path)).text).toBe("# 报告\n内容");
		expect((await previewLocalFile(pathToFileURL(path).href)).path).toBe(path);
	});
	it("resolves a relative encoded link from the file's own directory", async () => {
		const path = await fixture("data space.csv", "a,b\n1,2");
		expect((await previewLocalFile("./data%20space.csv", root)).path).toBe(path);
	});
	it.each(["https://example.org/a", "javascript:alert(1)", "data:text/plain,x", "a\u0000b"])(
		"rejects nonlocal target %s",
		async (target) => {
			await expect(previewLocalFile(target, root)).rejects.toThrow();
		},
	);
	it("does not preview a directory or missing file", async () => {
		await expect(previewLocalFile(root)).rejects.toThrow("not a file");
		await expect(previewLocalFile(join(root, "missing.md"))).rejects.toThrow();
	});
	it("caps a large text file at 128 KiB", async () => {
		const path = await fixture("huge.fa", ">seq\n" + "A".repeat(TEXT_PREVIEW_BYTES * 4));
		const p = await previewLocalFile(path);
		expect(p.truncated).toBe(true);
		expect(Buffer.byteLength(p.text || "")).toBe(TEXT_PREVIEW_BYTES);
		expect(p.size).toBeGreaterThan(TEXT_PREVIEW_BYTES);
	});
	it("decodes UTF-8 and BOM UTF-16LE/BE scientific tables", async () => {
		for (const [name, bytes, encoding] of [
			["utf8.tsv", Buffer.from("\ufeff样本\t数量\n甲\t2"), "UTF-8"],
			[
				"le.tsv",
				Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("样本\t数量\n甲\t2", "utf16le")]),
				"UTF-16LE",
			],
			[
				"be.tsv",
				Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from("样本\t数量\n甲\t2", "utf16le").swap16()]),
				"UTF-16BE",
			],
		] as const) {
			const p = await previewLocalFile(await fixture(name, bytes));
			expect(p.text).toBe("样本\t数量\n甲\t2");
			expect(p.encoding).toBe(encoding);
		}
	});
	it("does not decode unknown binary or null-bearing mislabeled text, including gzip", async () => {
		for (const [name, bytes] of [
			["x.bam", Buffer.from("BAM\x01")],
			["x.csv", Buffer.from("a\u0000b")],
			["x.csv.gz", gzipSync(Buffer.from("a\u0000b"))],
		] as const) {
			const p = await previewLocalFile(await fixture(name, bytes));
			expect(p.kind).toBe("binary");
			expect(p.text).toBeUndefined();
		}
	});
	it("streams gzip and concatenated/BGZF-style members without extracting files", async () => {
		const bytes = Buffer.concat([gzipSync(">a\nACG\n"), gzipSync(">b\nTTT\n")]);
		const p = await previewLocalFile(await fixture("sequences.fa.gz", bytes));
		expect(p).toMatchObject({
			kind: "text",
			compression: "gzip",
			truncated: false,
			text: ">a\nACG\n>b\nTTT\n",
		});
		expect(await readdir(root)).toEqual(["sequences.fa.gz"]);
	});
	it("stops high-expansion gzip at the decompressed budget", async () => {
		const p = await previewLocalFile(await fixture("large.fastq.gz", gzipSync("A".repeat(8 * 1024 * 1024))));
		expect(p.truncated).toBe(true);
		expect(p.text).toHaveLength(TEXT_PREVIEW_BYTES);
		expect(await readdir(root)).toEqual(["large.fastq.gz"]);
	});
	it("caps compressed scanning even for a huge optional gzip filename header", async () => {
		const gzip = gzipSync("a,b\n1,2\n"),
			header = Buffer.from(gzip.subarray(0, 10));
		header[3] = 8;
		const p = await previewLocalFile(
			await fixture(
				"large-header.csv.gz",
				Buffer.concat([header, Buffer.alloc(3 * 1024 * 1024, 65), Buffer.from([0]), gzip.subarray(10)]),
			),
		);
		expect(p).toMatchObject({ kind: "text", compression: "gzip", truncated: true, text: "" });
	});
	it("rejects malformed gzip instead of showing compressed garbage", async () => {
		await expect(previewLocalFile(await fixture("bad.csv.gz", "not gzip"))).rejects.toThrow("Cannot decode");
	});
	it("rejects an incomplete small gzip stream and a bad checksum", async () => {
		const bytes = gzipSync("x,y\n1,2");
		await expect(
			previewLocalFile(await fixture("cut.csv.gz", bytes.subarray(0, bytes.length - 6))),
		).rejects.toThrow("Cannot decode");
		bytes[bytes.length - 8] = ((bytes[bytes.length - 8] || 0) + 1) % 256;
		await expect(previewLocalFile(await fixture("crc.csv.gz", bytes))).rejects.toThrow("Cannot decode");
	});
	it("keeps images/PDF bounded and SVG available as both image and source", async () => {
		const svg = await previewLocalFile(
			await fixture("chart.svg", '<svg xmlns="http://www.w3.org/2000/svg"><text>chart</text></svg>'),
		);
		expect(svg.kind).toBe("image");
		expect(svg.text).toContain("chart");
		expect(svg.data).toBeTruthy();
		const big = await previewLocalFile(await fixture("big.pdf", Buffer.alloc(16 * 1024 * 1024 + 1)));
		expect(big).toMatchObject({ kind: "pdf", truncated: true });
		expect(big.data).toBeUndefined();
		const small = await previewLocalFile(await fixture("x.pdf", "%PDF-1.4\n"));
		expect(small.kind).toBe("pdf");
		expect(small.data).toBeTruthy();
	});
});
it.each(["lower.r","upper.R","lower.py","upper.PY","mixed.Py",".Rprofile","stub.PYI"])("reads %s as bounded source, never executes it",async(name)=>{
 const source="# SCRIPT_READ_ONLY\nprint(1)\n";const path=await fixture(name,source);
 const result=await previewLocalFile(pathToFileURL(path).href,root);
 expect(result.kind).toBe("text");expect(result.text).toBe(source);expect(await readdir(root)).toEqual([name]);
});
