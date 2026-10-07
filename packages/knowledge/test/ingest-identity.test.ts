import { describe, expect, it } from "vitest";
import {
	claimHash,
	contentHash,
	extractIdentifiers,
	identifyReference,
	identityFromReferences,
	identityKeys,
	normalizeArxiv,
	normalizeDoi,
	normalizeIdentity,
	normalizeIsbn,
	normalizePmcid,
	normalizePmid,
	normalizeTitleKey,
	normalizeUrl,
	normalizeZoteroKey,
	sameIdentity,
	stripFrontmatter,
} from "../src/ingest-identity";

describe("normalizeDoi", () => {
	it.each([
		["10.1038/S41586-020-2649-2", "10.1038/s41586-020-2649-2"],
		["doi:10.1038/s41586-020-2649-2", "10.1038/s41586-020-2649-2"],
		["DOI: 10.1038/s41586-020-2649-2.", "10.1038/s41586-020-2649-2"],
		["https://doi.org/10.1038/s41586-020-2649-2", "10.1038/s41586-020-2649-2"],
		["http://dx.doi.org/10.1038/s41586-020-2649-2", "10.1038/s41586-020-2649-2"],
		["https://doi.org/10.1002%2F%28SICI%291097-0258", "10.1002/(sici)1097-0258"],
		["  10.1101/2024.01.02.123456；", "10.1101/2024.01.02.123456"],
	])("%s → %s", (input, expected) => {
		expect(normalizeDoi(input)).toBe(expected);
	});

	it.each([[""], ["11.1038/x"], ["10.12/x"], ["10.1038"], ["see 10.1038/x"], [null], [{}]])(
		"rejects %j",
		(input) => {
			expect(normalizeDoi(input)).toBeNull();
		},
	);
});

describe("normalizePmid / normalizePmcid", () => {
	it.each([
		["12345678", "12345678"],
		["PMID: 12345678", "12345678"],
		["pmid:00042", "42"],
		["https://pubmed.ncbi.nlm.nih.gov/12345678/", "12345678"],
		["https://www.ncbi.nlm.nih.gov/pubmed/12345678", "12345678"],
	])("pmid %s → %s", (input, expected) => {
		expect(normalizePmid(input)).toBe(expected);
	});

	it("accepts numeric PMIDs from YAML", () => {
		expect(normalizePmid(31234567)).toBe("31234567");
	});

	it.each([["0"], ["1234567890"], ["PMC123"], ["abc"]])("rejects pmid %s", (input) => {
		expect(normalizePmid(input)).toBeNull();
	});

	it.each([
		["PMC1234567", "PMC1234567"],
		["pmc1234567", "PMC1234567"],
		["PMCID: PMC1234567", "PMC1234567"],
		["https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/", "PMC1234567"],
		["https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/", "PMC1234567"],
	])("pmcid %s → %s", (input, expected) => {
		expect(normalizePmcid(input)).toBe(expected);
	});

	it("requires the PMC prefix so bare numbers stay PMIDs", () => {
		expect(normalizePmcid("1234567")).toBeNull();
	});
});

describe("normalizeArxiv", () => {
	it.each([
		["2401.01234", "2401.01234"],
		["2401.01234v3", "2401.01234"],
		["arXiv:2401.01234v2", "2401.01234"],
		["https://arxiv.org/abs/2401.01234v1", "2401.01234"],
		["https://arxiv.org/pdf/2401.01234v1.pdf", "2401.01234"],
		["hep-th/9901001", "hep-th/9901001"],
		["arXiv:Q-BIO.PE/0401001v2", "q-bio.pe/0401001"],
	])("%s → %s", (input, expected) => {
		expect(normalizeArxiv(input)).toBe(expected);
	});

	it.each([["240.01234"], ["arxiv"], ["10.1038/x"]])("rejects %s", (input) => {
		expect(normalizeArxiv(input)).toBeNull();
	});
});

describe("normalizeIsbn / normalizeZoteroKey", () => {
	it("validates and converts ISBN-10 to ISBN-13", () => {
		expect(normalizeIsbn("0-306-40615-2")).toBe("9780306406157");
		expect(normalizeIsbn("ISBN 978-0-306-40615-7")).toBe("9780306406157");
		expect(normalizeIsbn("ISBN-10: 080442957X")).toBe("9780804429573");
	});

	it("rejects bad checksums", () => {
		expect(normalizeIsbn("0-306-40615-3")).toBeNull();
		expect(normalizeIsbn("9780306406158")).toBeNull();
	});

	it("accepts only 8-character Zotero keys", () => {
		expect(normalizeZoteroKey("ABCD1234")).toBe("ABCD1234");
		expect(normalizeZoteroKey("ABCD123")).toBeNull();
		expect(normalizeZoteroKey("ABCD-123")).toBeNull();
	});
});

describe("normalizeUrl", () => {
	it("canonicalizes scheme, host, port, tracking params, fragment and trailing slash", () => {
		expect(normalizeUrl("HTTP://WWW.Example.org:80/Path/?utm_source=x&b=2&a=1#section")).toBe(
			"https://example.org/Path?a=1&b=2",
		);
		expect(normalizeUrl("https://example.org/")).toBe("https://example.org");
		expect(normalizeUrl("https://example.org:8443//a//b/")).toBe("https://example.org:8443/a/b");
	});

	it("treats variants of one page as one key", () => {
		expect(normalizeUrl("https://www.ncbi.nlm.nih.gov/gene/7157?fbclid=1")).toBe(
			normalizeUrl("http://ncbi.nlm.nih.gov/gene/7157/"),
		);
	});

	it.each([["ftp://example.org/x"], ["file:///etc/passwd"], ["https://user:pw@example.org/"], ["not a url"]])(
		"rejects %s",
		(input) => {
			expect(normalizeUrl(input)).toBeNull();
		},
	);
});

describe("identifyReference / identityFromReferences", () => {
	it.each([
		["https://doi.org/10.1038/X", { field: "doi", value: "10.1038/x" }],
		["PMID: 123", { field: "pmid", value: "123" }],
		["https://pubmed.ncbi.nlm.nih.gov/123/", { field: "pmid", value: "123" }],
		["PMC42", { field: "pmcid", value: "PMC42" }],
		["arXiv:2401.01234v2", { field: "arxiv", value: "2401.01234" }],
		["https://arxiv.org/abs/2401.01234", { field: "arxiv", value: "2401.01234" }],
		["ISBN 0-306-40615-2", { field: "isbn", value: "9780306406157" }],
		["zotero:ABCD1234", { field: "zotero_key", value: "ABCD1234" }],
		["https://www.example.org/a/", { field: "url", value: "https://example.org/a" }],
	])("%s", (input, expected) => {
		expect(identifyReference(input)).toEqual(expected);
	});

	it("returns null for free text", () => {
		expect(identifyReference("Smith et al. 2020")).toBeNull();
	});

	it("keeps the first identifier of each kind", () => {
		expect(
			identityFromReferences(["doi:10.1000/a", "doi:10.1000/b", "PMID: 9", "https://example.org/x", "junk"]),
		).toEqual({ doi: "10.1000/a", pmid: "9", url: "https://example.org/x" });
	});
});

describe("extractIdentifiers", () => {
	it("finds identifiers in prose and deduplicates them", () => {
		const text = [
			"See doi:10.1038/s41586-020-2649-2. Also https://doi.org/10.1038/S41586-020-2649-2,",
			"PMID: 12345678 and https://pubmed.ncbi.nlm.nih.gov/12345678/ (PMC7654321).",
			"Preprint arXiv:2401.01234v2; mirror https://arxiv.org/abs/2401.01234.",
			"Docs: https://www.example.org/docs/?utm_medium=x.",
		].join("\n");
		const found = extractIdentifiers(text);
		expect(found.doi).toEqual(["10.1038/s41586-020-2649-2"]);
		expect(found.pmid).toEqual(["12345678"]);
		expect(found.pmcid).toEqual(["PMC7654321"]);
		expect(found.arxiv).toEqual(["2401.01234"]);
		expect(found.url).toContain("https://example.org/docs");
		expect(found.url.some((url) => url.includes("doi.org"))).toBe(false);
	});

	it("tolerates non-string input", () => {
		expect(extractIdentifiers(undefined)).toEqual({ doi: [], pmid: [], pmcid: [], arxiv: [], url: [] });
	});
});

describe("normalizeIdentity / identityKeys / sameIdentity", () => {
	it("drops unknown fields and invalid values", () => {
		expect(
			normalizeIdentity({
				doi: "DOI:10.1000/ABC",
				pmid: "x",
				zoteroKey: "ABCD1234",
				foo: "bar",
				url: "ftp://x",
			}),
		).toEqual({ doi: "10.1000/abc", zotero_key: "ABCD1234" });
		expect(normalizeIdentity(["x"])).toEqual({});
	});

	it("orders keys from most to least trusted", () => {
		expect(
			identityKeys(
				{ url: "https://example.org/", doi: "10.1000/x", pmid: "1", arxiv: "2401.00001" },
				{ type: "paper", title: "  A  Study: of Things! " },
			),
		).toEqual([
			"doi:10.1000/x",
			"pmid:1",
			"arxiv:2401.00001",
			"url:https://example.org",
			"title:paper:a study of things",
		]);
	});

	it("matches when any key is shared", () => {
		expect(
			sameIdentity(
				{ identity: { doi: "10.1000/X", pmid: "1" } },
				{ identity: { pmid: "PMID: 1" }, title: "Other" },
			),
		).toBe(true);
		expect(
			sameIdentity({ title: "单细胞 图谱", type: "paper" }, { title: "单细胞图谱", type: "paper" }),
		).toBe(false);
		expect(sameIdentity({ title: "Cell Atlas", type: "paper" }, { title: "cell-atlas", type: "paper" })).toBe(
			true,
		);
		expect(
			sameIdentity({ title: "Cell Atlas", type: "paper" }, { title: "Cell Atlas", type: "dataset" }),
		).toBe(false);
	});

	it("normalizes titles with NFKC and keeps CJK", () => {
		expect(normalizeTitleKey("ＣＲＩＳＰＲ　筛选：方法")).toBe("crispr 筛选 方法");
	});
});

describe("stripFrontmatter / contentHash / claimHash", () => {
	const body = "# Title\n\nLine one  \nLine two\n";

	it("strips LF and CRLF frontmatter", () => {
		expect(stripFrontmatter(`---\ntype: paper\n---\n${body}`)).toBe(body);
		expect(stripFrontmatter("---\r\ntype: paper\r\n---\r\nBody")).toBe("Body");
		expect(stripFrontmatter("\uFEFF---\ntype: paper\n...\nBody")).toBe("Body");
		expect(stripFrontmatter("no frontmatter")).toBe("no frontmatter");
		expect(stripFrontmatter("---\nunterminated")).toBe("---\nunterminated");
	});

	it("ignores frontmatter, line endings and trailing whitespace", () => {
		const hash = contentHash(body);
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
		expect(contentHash(`---\nstatus: verified\n---\n\n${body}`)).toBe(hash);
		expect(contentHash(body.replaceAll("\n", "\r\n"))).toBe(hash);
		expect(contentHash("# Title\n\nLine one\nLine two")).toBe(hash);
		expect(contentHash("# Title\n\nLine one\nLine 2")).not.toBe(hash);
	});

	it("normalizes Unicode composition", () => {
		expect(contentHash("caf\u00e9")).toBe(contentHash("cafe\u0301"));
	});

	it("hashes claims by normalized content and conditions", () => {
		const base = {
			subject: "TP53",
			predicate: "Represses",
			value: "MDM2",
			organism: "Homo sapiens",
			sourceHash: "ABC",
		};
		expect(claimHash(base)).toBe(
			claimHash({ ...base, subject: " tp53 ", predicate: "represses", sourceHash: "abc" }),
		);
		expect(claimHash(base)).not.toBe(claimHash({ ...base, organism: "Mus musculus" }));
		expect(claimHash(base)).not.toBe(claimHash({ ...base, sourceHash: "def" }));
	});
});
