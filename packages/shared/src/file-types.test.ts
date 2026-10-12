import { describe, expect, it } from "vitest";
import { fileTypeOf, registeredExtensions } from "./file-types";

describe("file type registry", () => {
	it("maps common extensions to mime and preview kind", () => {
		expect(fileTypeOf("a.csv")).toMatchObject({ mime: "text/csv", previewKind: "table", text: true });
		expect(fileTypeOf("Report.PDF")).toMatchObject({
			mime: "application/pdf",
			previewKind: "pdf",
			text: false,
		});
		expect(fileTypeOf("x/y/run.py")).toMatchObject({ previewKind: "code", language: "python" });
		expect(fileTypeOf("C:\\data\\nb.ipynb").previewKind).toBe("notebook");
		expect(fileTypeOf("clip.mp4").previewKind).toBe("video");
		expect(fileTypeOf("a.npy").previewKind).toBe("array");
		expect(fileTypeOf("pic.svg")).toMatchObject({ previewKind: "svg", hasSource: true });
	});
	it("falls back to binary for unknown extensions", () => {
		expect(fileTypeOf("blob.qqq")).toMatchObject({ previewKind: "binary", text: false, ext: "qqq" });
		expect(fileTypeOf("noext").previewKind).toBe("binary");
	});
	it("handles .gz by looking at the inner extension", () => {
		expect(fileTypeOf("reads.fastq.gz")).toMatchObject({ previewKind: "sequence", gzip: true });
		expect(fileTypeOf("x.gz")).toMatchObject({ previewKind: "binary", gzip: true });
	});
	it("knows special file names", () => {
		expect(fileTypeOf("Dockerfile")).toMatchObject({ previewKind: "code", language: "dockerfile" });
		expect(fileTypeOf("README").previewKind).toBe("text");
	});
	it("registers many extensions without duplicates", () => {
		const exts = registeredExtensions();
		expect(new Set(exts).size).toBe(exts.length);
		expect(exts.length).toBeGreaterThan(100);
	});
});
