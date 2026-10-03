import { describe, expect, it } from "vitest";
import {
	findZoteroItemsByIdentity,
	isValidZoteroDoi,
	isZoteroItemKey,
	normalizeZoteroDoi,
	summarizeZoteroAttachments,
} from "../src/zotero-identity";

const DOI = "10.1234/fixture";
const item = (key: string, doi = DOI, collections: string[] = ["COLL1234"]) => ({
	key,
	data: { DOI: doi, collections },
});

describe("zotero identity policy", () => {
	it("normalizes DOI URLs and rejects malformed lookup identities", () => {
		expect(normalizeZoteroDoi("https://doi.org/10.1234/Fixture")).toBe(DOI);
		expect(isValidZoteroDoi(DOI)).toBe(true);
		expect(isValidZoteroDoi("10.1234")).toBe(false);
		expect(isValidZoteroDoi("title of a paper")).toBe(false);
	});

	it("matches exact DOI and optional collection without fuzzy title matching", () => {
		const records = [
			item("ABCD1234"),
			item("EFGH5678", "10.1234/other"),
			item("IJKL9012", DOI, ["OTHER"]),
			{ key: "BAD", data: { title: "Fixture", collections: ["COLL1234"] } },
		];
		expect(findZoteroItemsByIdentity(records, { doi: "doi:10.1234/Fixture" })).toHaveLength(2);
		expect(findZoteroItemsByIdentity(records, { doi: DOI, collection: "COLL1234" })).toEqual([records[0]]);
		expect(findZoteroItemsByIdentity(records, { doi: "not-a-doi" })).toEqual([]);
	});

	it("accepts only fixed-width Zotero keys and marks attachments as metadata-only", () => {
		expect(isZoteroItemKey("ABCD1234")).toBe(true);
		expect(isZoteroItemKey("bad-key")).toBe(false);
		const children = [
			{
				key: "FILE1234",
				data: { parentItem: "ABCD1234", itemType: "attachment", contentType: "application/pdf" },
			},
			{ key: "NOTE1234", data: { parentItem: "ABCD1234", itemType: "note" } },
			{ key: "OTHER123", data: { parentItem: "OTHER123", itemType: "attachment" } },
		];
		expect(summarizeZoteroAttachments(children, "ABCD1234")).toEqual([
			{ key: "FILE1234", contentType: "application/pdf", metadataOnly: true },
		]);
	});
});
