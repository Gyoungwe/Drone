import { expect, it } from "vitest";
import { validateClaimBindings } from "../../../.pi/lib/claim-bindings.mjs";

const path = "Library/Papers/example.md",
	hash = "abc",
	sources = [{ path, hash, doi: "10.1234/test", zotero_key: "ABCDEFGH" }];
const reads = new Map([
	[path, { hash, text: "Heading\nLimited result\nLimitation", startLine: 5, endLine: 7 }],
]);
const binding = () => ({
	claim: "Restricted finding",
	relationship: "direct",
	limitations: "One species",
	organism: "Gryllus",
	method: "RNAi",
	sources: [
		{ path, start_line: 6, end_line: 6, quote: "Limited result", original_location: "historical Fig.4" },
	],
});
it("binds verified identity/hash and observed quote range without claiming scientific verification", () => {
	const result = validateClaimBindings([binding()], sources, reads)[0];
	expect(result).toMatchObject({
		provenanceChecked: true,
		scientificallyVerified: false,
		supportAssessment: "model-asserted-unreviewed",
	});
	expect(result.sources[0]).toMatchObject({ hash, doi: "10.1234/test", originalFulltextReadThisTurn: false });
});
it.each(["unread", "range", "quote", "hash", "empty", "limitation"])("rejects %s provenance", (kind) => {
	const b = binding(),
		rs = new Map(reads);
	if (kind === "unread") b.sources[0].path = "Wiki/other.md";
	if (kind === "range") b.sources[0].start_line = 1;
	if (kind === "quote") b.sources[0].quote = "Fabricated result";
	if (kind === "hash") rs.set(path, { ...reads.get(path), hash: "changed" });
	if (kind === "empty") b.sources = [];
	if (kind === "limitation") b.limitations = "";
	expect(() => validateClaimBindings([b], sources, rs)).toThrow();
});
it("unsupported hypotheses may be reported, not manufactured into evidence", () => {
	const b = { ...binding(), relationship: "hypothesis", sources: [] };
	expect(validateClaimBindings([b], sources, reads)[0].sources).toEqual([]);
});
