import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	hasMagic,
	isWithin,
	looksLikeChallenge,
	normalizeMetadata,
	safeFilename,
	validateContent,
	validateRunDir,
} from "../src/source-archive-policy";

describe("source archive policy", () => {
	it("requires a direct dated run directory within results", () => {
		const results = resolve("/tmp/results");
		expect(validateRunDir(results, resolve(results, "2026-10-01", "run-alpha"))).toContain("run-alpha");
		expect(() => validateRunDir(results, resolve(results, "run-alpha"))).toThrow("directly inside");
		expect(() => validateRunDir(results, resolve(results, "..", "run-alpha"))).toThrow("directly inside");
		expect(isWithin(results, resolve(results, "2026-10-01"))).toBe(true);
		expect(isWithin(results, resolve(results, "..", "other"))).toBe(false);
	});

	it("sanitizes filenames without letting a path control the destination", () => {
		expect(safeFilename("../../a?b.pdf", "fallback.bin")).toBe("a-b.pdf");
		expect(safeFilename("..", "fallback.bin")).toBe("fallback.bin");
		expect(safeFilename("x".repeat(200), "fallback.bin")).toHaveLength(180);
	});

	it("detects login and human challenges without treating a PDF as HTML", () => {
		expect(looksLikeChallenge(403, "application/pdf", "")).toBe(true);
		expect(looksLikeChallenge(200, "text/html", "Please sign in")).toBe(true);
		expect(looksLikeChallenge(200, "application/pdf", "sign in")).toBe(false);
	});

	it("checks document signatures and rejects executable or unsuitable content", () => {
		const pdf = new TextEncoder().encode("%PDF-1.7\nbody");
		expect(hasMagic(pdf)).toBe(true);
		expect(validateContent("papers", "application/pdf", "paper.pdf", pdf)).toEqual({
			ok: true,
			mime: "application/pdf",
		});
		expect(validateContent("papers", "text/html", "paper.pdf", new Uint8Array([1]))).toMatchObject({
			ok: false,
		});
		expect(validateContent("software", "application/zip", "run.sh", pdf)).toMatchObject({
			ok: false,
			reason: "executable content is not archived",
		});
		expect(validateContent("software", "text/html", "index.html", pdf)).toMatchObject({ ok: false });
	});

	it("keeps only non-empty archival metadata fields", () => {
		expect(normalizeMetadata({ doi: "10.1/a", title: "", token: "secret", version: "v1" })).toEqual({
			doi: "10.1/a",
			version: "v1",
		});
	});
});
