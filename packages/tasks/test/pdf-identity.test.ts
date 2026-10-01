import { describe, expect, it } from "vitest";
import { normalizePdfIdentityResult, PdfIdentityError, readPdfIdentity } from "../src/pdf-identity";

describe("pdf identity boundary", () => {
	it("copies bytes before handing them to the isolated parser", async () => {
		const input = Buffer.from([37, 80, 68, 70]);
		let observed: Uint8Array | undefined;
		const result = await readPdfIdentity(input, {
			worker: (bytes) => {
				observed = bytes;
				bytes[0] = 0;
				return { text: "A paper 10.1234/example", pages: 2, partial: false };
			},
		});
		expect(result).toEqual({ text: "A paper 10.1234/example", pages: 2, partial: false });
		expect(input[0]).toBe(37);
		expect(observed).not.toBe(input);
	});

	it("maps parser errors to manual inspection without trusting partial output", () => {
		expect(() => normalizePdfIdentityResult({ error: "encrypted PDF" })).toThrow(
			"PDF identity requires manual inspection: encrypted PDF",
		);
		try {
			normalizePdfIdentityResult({ error: "encrypted PDF" });
		} catch (error) {
			expect(error).toBeInstanceOf(PdfIdentityError);
			expect((error as PdfIdentityError).code).toBe("manual-inspection");
		}
	});

	it("rejects malformed worker responses", async () => {
		await expect(
			readPdfIdentity(new Uint8Array(), {
				worker: async () => ({ text: "missing page count", pages: 1 }),
			}),
		).rejects.toMatchObject({ code: "unavailable" });
	});

	it("maps worker failures to an unavailable identity claim", async () => {
		await expect(
			readPdfIdentity(new Uint8Array(), {
				worker: async () => {
					throw new Error("parser crashed");
				},
			}),
		).rejects.toThrow("PDF identity extractor unavailable; no identity claim was made.");
	});

	it("bounds a parser that never responds", async () => {
		let workerSignal: AbortSignal | undefined;
		await expect(
			readPdfIdentity(new Uint8Array(), {
				timeoutMs: 5,
				worker: (_, signal) => {
					workerSignal = signal;
					return new Promise(() => {});
				},
			}),
		).rejects.toMatchObject({ code: "timeout" });
		expect(workerSignal?.aborted).toBe(true);
	});

	it("normalizes bounded text and preserves page metadata", () => {
		const result = normalizePdfIdentityResult({ text: "x".repeat(100_000), pages: 3, partial: true });
		expect(result.text).toHaveLength(90_000);
		expect(result.pages).toBe(3);
		expect(result.partial).toBe(true);
	});
});
