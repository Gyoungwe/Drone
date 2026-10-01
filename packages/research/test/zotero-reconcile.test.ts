import { describe, expect, it } from "vitest";
import { lookupZoteroByDoi } from "../src/zotero-reconcile";

describe("zotero read-only reconciliation policy", () => {
	it("requires an exact DOI and projects attachment metadata only", async () => {
		const calls: string[] = [];
		const result = await lookupZoteroByDoi(
			async (path) => {
				calls.push(path);
				if (path.startsWith("items?"))
					return {
						data: [{ key: "ABCD1234", data: { DOI: "10.1234/Example", collections: ["C1"] } }],
						total: 1,
					};
				return {
					data: [
						{
							key: "EFGH5678",
							data: { itemType: "attachment", parentItem: "ABCD1234", contentType: "application/pdf" },
						},
					],
					total: 1,
				};
			},
			{ doi: "https://doi.org/10.1234/EXAMPLE", collection: "C1" },
			{ libraryType: "users", libraryId: "0", verifier: "fixture", observedAt: "2026-10-01T00:00:00.000Z" },
		);
		expect(result).toEqual({
			state: "found",
			libraryType: "users",
			libraryId: "0",
			itemId: "ABCD1234",
			doi: "10.1234/example",
			attachments: [{ key: "EFGH5678", contentType: "application/pdf", metadataOnly: true }],
			observedAt: "2026-10-01T00:00:00.000Z",
			verifier: "fixture",
			attachmentContentsVerified: false,
			scientificallyVerified: false,
			safeToAutoRetry: false,
		});
		expect(calls).toHaveLength(2);
	});

	it("fails closed for incomplete, ambiguous and invalid lookups", async () => {
		const incomplete = await lookupZoteroByDoi(async () => ({ data: [], total: 101 }), { doi: "10.1234/x" });
		expect(incomplete).toEqual({ state: "unknown", reason: "lookup-incomplete" });
		const invalid = await lookupZoteroByDoi(async () => ({ data: [] }), { doi: "not-doi" });
		expect(invalid).toEqual({ state: "blocked", reason: "exact-doi-required" });
		const ambiguous = await lookupZoteroByDoi(
			async () => ({
				data: [
					{ key: "ABCD1234", data: { DOI: "10.1234/x" } },
					{ key: "EFGH5678", data: { DOI: "10.1234/x" } },
				],
				total: 2,
			}),
			{ doi: "10.1234/x" },
		);
		expect(ambiguous).toMatchObject({ state: "ambiguous", count: 2, safeToAutoRetry: false });
	});
});
