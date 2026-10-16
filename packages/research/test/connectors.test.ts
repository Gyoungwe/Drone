import { describe, expect, it } from "vitest";
import {
	createCrossrefConnector,
	createEuropePmcConnector,
	createPubmedConnector,
	createSraConnector,
	createZenodoConnector,
	type ResearchConnector,
	ResearchConnectorRegistry,
} from "../src/connectors";

function response(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("research connectors", () => {
	it("normalizes Crossref records into read-only source receipts", async () => {
		const connector = createCrossrefConnector();
		const hits = await connector.search("single cell", {
			fetchImpl: async () =>
				response({
					message: { items: [{ DOI: "10.1000/example", title: ["A paper"], abstract: "Summary" }] },
				}),
		});
		expect(hits[0]).toMatchObject({ id: "crossref:10.1000/example", sourceType: "literature" });
		expect(hits[0]?.sourceReceipt).toMatchObject({ readOnly: true, sourceType: "literature" });
		expect(hits[0]?.sourceReceipt.contentHash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("supports Europe PMC and PubMed without credentials", async () => {
		const europe = await createEuropePmcConnector().search("genomics", {
			fetchImpl: async () => response({ resultList: { result: [{ pmid: "123", title: "Genome study" }] } }),
		});
		expect(europe[0]?.locator).toContain("europepmc.org");
		let calls = 0;
		const pubmed = await createPubmedConnector().search("genomics", {
			fetchImpl: async () => {
				calls += 1;
				return calls === 1
					? response({ esearchresult: { idlist: ["123"] } })
					: response({ result: { "123": { title: "Genome study", source: "Nature" } } });
			},
		});
		expect(pubmed[0]?.id).toBe("pubmed:123");
		expect(calls).toBe(2);
	});

	it("normalizes public dataset catalogs with the same provenance shape", async () => {
		const zenodo = await createZenodoConnector().search("bee brain", {
			fetchImpl: async () =>
				response({
					hits: {
						hits: [
							{
								id: "42",
								metadata: { title: "Bee brain data", description: "Reads", license: { id: "CC-BY" } },
								links: { html: "https://zenodo.org/records/42" },
							},
						],
					},
				}),
		});
		expect(zenodo[0]?.sourceReceipt).toMatchObject({ sourceType: "dataset", license: "CC-BY" });
		const sra = await createSraConnector().search("bee brain", {
			fetchImpl: async () => response({ esearchresult: { idlist: ["SRR1"] } }),
		});
		expect(sra[0]?.locator).toContain("ncbi.nlm.nih.gov/sra/SRR1");
	});

	it("returns connector failures as retryable evidence gaps", async () => {
		const failing: ResearchConnector = {
			id: "test-failing",
			kind: "dataset",
			label: "Failing",
			search: async () => {
				throw Object.assign(new Error("temporary outage"), { status: 503 });
			},
		};
		const result = await new ResearchConnectorRegistry([failing]).search({ query: "x" });
		expect(result.complete).toBe(false);
		expect(result.hits).toHaveLength(0);
		expect(result.failures).toEqual([
			expect.objectContaining({ connectorId: "test-failing", retryable: true }),
		]);
	});
});
