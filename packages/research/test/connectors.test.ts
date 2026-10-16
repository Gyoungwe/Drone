import { describe, expect, it } from "vitest";
import {
	createCrossrefConnector,
	createDoiConnector,
	createEnaConnector,
	createEuropePmcConnector,
	createInstitutionalConnector,
	createOpenAlexConnector,
	createProjectStorageConnector,
	createProtocolsConnector,
	createPubmedConnector,
	createSraConnector,
	createZenodoConnector,
	createZoteroConnector,
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

	it("normalizes OpenAlex literature records with a stable receipt", async () => {
		const hits = await createOpenAlexConnector().search("single cell", {
			fetchImpl: async () =>
				response({
					results: [
						{
							id: "https://openalex.org/W123",
							title: "A work",
							doi: "https://doi.org/10.1000/example",
							primary_location: { source: { display_name: "Journal" } },
						},
					],
				}),
		});
		expect(hits[0]).toMatchObject({ id: "openalex:W123", locator: "https://doi.org/10.1000/example" });
		expect(hits[0]?.sourceReceipt).toMatchObject({ readOnly: true, sourceType: "literature" });
	});

	it("resolves an exact DOI and ignores ordinary free-text queries", async () => {
		let calls = 0;
		const connector = createDoiConnector();
		const options = {
			fetchImpl: async () => {
				calls += 1;
				return response({ message: { DOI: "10.1000/example", title: ["A DOI paper"] } });
			},
		};
		expect(await connector.search("genomics", options)).toEqual([]);
		const hits = await connector.search("https://doi.org/10.1000/example", options);
		expect(hits[0]).toMatchObject({ id: "doi:10.1000/example", sourceType: "citation" });
		expect(calls).toBe(1);
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
		const ena = await createEnaConnector().search("ERR1", {
			fetchImpl: async () =>
				response([{ accession: "ERR1", study_accession: "PRJ1", study_title: "ENA study" }]),
		});
		expect(ena[0]).toMatchObject({ id: "ena:ERR1", sourceType: "dataset" });
		expect(ena[0]?.sourceReceipt).toMatchObject({ readOnly: true, sourceType: "dataset" });
	});

	it("reads Zotero citations through the configured read-only API", async () => {
		let request = "";
		const hits = await createZoteroConnector().search("bee brain", {
			config: { zotero: { libraryId: "123", apiKey: "secret" } },
			fetchImpl: async (input, init) => {
				request = `${String(input)} ${String((init?.headers as Record<string, string>)?.["Zotero-API-Key"])}`;
				return response([{ key: "ABCD", data: { title: "Bee paper", DOI: "10.1000/bee" } }]);
			},
		});
		expect(request).toContain("users/123/items");
		expect(request).toContain("secret");
		expect(hits[0]).toMatchObject({
			id: "zotero:ABCD",
			sourceType: "citation",
			locator: "https://doi.org/10.1000/bee",
		});
	});

	it("normalizes authenticated protocols.io results", async () => {
		const hits = await createProtocolsConnector().search("RNA extraction", {
			config: { protocols: { apiToken: "token" } },
			fetchImpl: async (input, init) => {
				expect(String(input)).toContain("/api/v4/protocols?q=RNA%20extraction");
				expect((init?.headers as Record<string, string>)?.authorization).toBe("Bearer token");
				return response({
					payload: { items: [{ uri: "abc123", title: "RNA extraction", description: "Steps" }] },
				});
			},
		});
		expect(hits[0]).toMatchObject({ id: "protocols:abc123", sourceType: "protocol" });
		expect(hits[0]?.sourceReceipt.readOnly).toBe(true);
	});

	it("records institutional response metadata without copying page contents", async () => {
		const hits = await createInstitutionalConnector().search("https://example.org/paper", {
			fetchImpl: async () =>
				new Response("private page", {
					status: 200,
					headers: { "content-type": "text/html", "content-length": "12" },
				}),
		});
		expect(hits[0]?.sourceType).toBe("institutional");
		expect(hits[0]?.summary).toContain("HTTP 200");
		expect(hits[0]?.sourceReceipt.contentHash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("uses the host project-storage port and preserves file provenance", async () => {
		const hits = await createProjectStorageConnector().search("results", {
			cwd: "/project",
			projectStorage: {
				search: async ({ cwd, query, limit }) => {
					expect({ cwd, query, limit }).toEqual({ cwd: "/project", query: "results", limit: 10 });
					return [{ relativePath: "results/table.csv", size: 12, modifiedAt: "2026-10-17T00:00:00.000Z" }];
				},
			},
		});
		expect(hits[0]).toMatchObject({
			id: expect.stringContaining("project-storage:"),
			locator: "results/table.csv",
		});
		expect(hits[0]?.sourceReceipt.sourceType).toBe("project-storage");
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

	it("forwards cancellation and reports unknown connector ids", async () => {
		const controller = new AbortController();
		let receivedSignal: AbortSignal | undefined;
		const connector: ResearchConnector = {
			id: "test-signal",
			kind: "dataset",
			label: "Signal",
			search: async (_query, options) => {
				receivedSignal = options?.signal;
				return [];
			},
		};
		const result = await new ResearchConnectorRegistry([connector]).search({
			query: "x",
			connectorIds: ["test-signal", "missing"],
			signal: controller.signal,
		});
		expect(receivedSignal).toBe(controller.signal);
		expect(result.connectors).toEqual(["test-signal", "missing"]);
		expect(result.failures).toEqual([expect.objectContaining({ connectorId: "missing", retryable: false })]);
		expect(result.complete).toBe(false);
	});

	it("passes the public limit through to 50", async () => {
		let receivedLimit = 0;
		const connector: ResearchConnector = {
			id: "test-limit",
			kind: "dataset",
			label: "Limit",
			search: async (_query, options) => {
				receivedLimit = options?.limit ?? 0;
				return [];
			},
		};
		await new ResearchConnectorRegistry([connector]).search({ query: "x", limit: 50 });
		expect(receivedLimit).toBe(50);
	});

	it("treats an explicit empty connector list as no-op", async () => {
		let calls = 0;
		const connector: ResearchConnector = {
			id: "test-empty",
			kind: "dataset",
			label: "Empty",
			search: async () => {
				calls += 1;
				return [];
			},
		};
		const result = await new ResearchConnectorRegistry([connector]).search({ query: "x", connectorIds: [] });
		expect(result.connectors).toEqual([]);
		expect(result.hits).toEqual([]);
		expect(result.failures).toEqual([]);
		expect(result.complete).toBe(true);
		expect(calls).toBe(0);
	});
});
