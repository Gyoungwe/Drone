import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exactDoiItems, normalizeDoi, verifyLiteratureReceipt } from "../src/literature-receipt";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("literature receipt", () => {
	it("normalizes DOI identities and filters unrelated items", () => {
		expect(normalizeDoi("https://doi.org/10.1038/ABC")).toBe("10.1038/abc");
		expect(
			exactDoiItems([{ doi: "10.1038/xyz" }, { data: { DOI: "10.1038/ABC" } }], "doi:10.1038/abc"),
		).toHaveLength(1);
	});
	it("verifies a DOI-linked note without claiming scientific verification", async () => {
		const root = await mkdtemp(join(tmpdir(), "drone-research-receipt-"));
		roots.push(root);
		const vault = join(root, "Vault");
		await mkdir(join(vault, "Library/Papers"), { recursive: true });
		await writeFile(join(vault, "Library/Papers/a.md"), "doi:10.1038/abc\nzotero:ABCDEFGH");
		const result = await verifyLiteratureReceipt({
			vault,
			doi: "10.1038/ABC",
			zotero_key: "ABCDEFGH",
			note_path: "Library/Papers/a.md",
			fetcher: async () => ({ ok: true, status: 200, json: async () => ({ data: { DOI: "10.1038/abc" } }) }),
		});
		expect(result.status).toBe("both-verified");
		expect(result.scientificallyVerified).toBe(false);
	});
});
