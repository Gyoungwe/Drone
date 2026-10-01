import { describe, expect, it } from "vitest";
import {
	connectorTargetId,
	normalizeZoteroAttachment,
	normalizeZoteroItem,
	toConnectorItem,
	toWebApiItem,
} from "../src/zotero-write";

const DOI = "10.1234/example.2024";
const paper = (extra: Record<string, unknown> = {}) => ({
	doi: DOI,
	title: "Example paper",
	creators: [{ last_name: "Doe", first_name: "Jane" }, { name: "Example Consortium" }],
	date: "2024",
	publication: "Journal of Examples",
	volume: "1",
	pages: "1-10",
	tags: ["fixture", "fixture"],
	...extra,
});

describe("zotero write policy", () => {
	it("normalizes a whitelisted item and keeps exact DOI identity", () => {
		const item = normalizeZoteroItem(paper({ doi: "https://doi.org/10.1234/Example.2024", nonsense: "x" }));
		expect(item).toMatchObject({
			doi: DOI,
			itemType: "journalArticle",
			fields: { volume: "1", pages: "1-10", publicationTitle: "Journal of Examples" },
			tags: ["fixture"],
		});
		expect(item.creators).toEqual([
			{ creatorType: "author", lastName: "Doe", firstName: "Jane" },
			{ creatorType: "author", name: "Example Consortium" },
		]);
		const connector = toConnectorItem(
			item,
			normalizeZoteroAttachment({ attachment_url: "https://example.org/a.pdf" }),
		);
		expect(connector.DOI).toBe(DOI);
		expect(connector).not.toHaveProperty("nonsense");
		expect(connector.attachments).toEqual([
			{ title: "Full Text PDF", url: "https://example.org/a.pdf", mimeType: "application/pdf" },
		]);
		expect(toWebApiItem(item, { collectionKey: "COLL0001" }).collections).toEqual(["COLL0001"]);
	});

	it("moves DOI into extra for item types without a DOI field", () => {
		const book = normalizeZoteroItem(paper({ item_type: "book", publication: "Big Press" }));
		expect(book.doiField).toBe(false);
		expect(toWebApiItem(book)).not.toHaveProperty("DOI");
		expect(toWebApiItem(book).extra).toContain(`DOI: ${DOI}`);
	});

	it("rejects invalid input and validates connector targets", () => {
		expect(() => normalizeZoteroItem(paper({ doi: "not-a-doi" }))).toThrow(/DOI/);
		expect(() => normalizeZoteroItem(paper({ url: "file:///etc/passwd" }))).toThrow(/http/);
		expect(() => normalizeZoteroItem(paper({ creators: [{ first_name: "Only" }] }))).toThrow(/creators\[0\]/);
		expect(connectorTargetId("L1")).toBe("L1");
		expect(() => connectorTargetId("bad-target")).toThrow(/target/);
	});
});
