import { describe, expect, it } from "vitest";
import {
	createArxivConnector,
	createCrossrefConnector,
	createDoiConnector,
	createEnaConnector,
	createEuropePmcConnector,
	createInstitutionalConnector,
	createOpenAlexConnector,
	createProjectStorageConnector,
	createProtocolsConnector,
	createPubmedConnector,
	createSemanticScholarConnector,
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
	it("exposes one complete default connector inventory", () => {
		const ids = new ResearchConnectorRegistry().list().map((connector) => connector.id);
		expect(ids).toEqual([
			"arxiv",
			"crossref",
			"doi",
			"ena",
			"europe-pmc",
			"institutional",
			"openalex",
			"osf",
			"project-storage",
			"protocols",
			"pubmed",
			"semantic-scholar",
			"sra",
			"zenodo",
			"zotero",
		]);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("searches Semantic Scholar with optional API-key authentication and recommendations", async () => {
		const requests: Array<{ url: string; key?: string }> = [];
		const connector = createSemanticScholarConnector();
		const options = {
			config: { semanticScholar: { apiBase: "https://s2.example", apiKey: "secret" } },
			fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
				requests.push({ url: String(input), key: (init?.headers as Record<string, string>)?.["x-api-key"] });
				return response({
					data: [
						{
							paperId: "paper-1",
							title: "A paper",
							abstract: "Abstract",
							authors: [{ name: "Ada" }],
							year: 2026,
							publicationDate: "2026-10-20",
							externalIds: { DOI: "10.1000/example" },
						},
					],
					recommendedPapers: [{ paperId: "paper-2", title: "Recommended" }],
				});
			},
		};
		const hits = await connector.search("single cell", options);
		const recommendations = await connector.recommend?.("DOI:10.1000/seed", options);
		expect(hits[0]).toMatchObject({
			id: "semantic-scholar:paper-1",
			locator: "https://doi.org/10.1000/example",
			authors: ["Ada"],
			year: 2026,
		});
		expect(recommendations?.[0]).toMatchObject({ id: "semantic-scholar:paper-2" });
		expect(requests).toHaveLength(2);
		expect(requests.every((request) => request.key === "secret")).toBe(true);
		expect(requests[1]?.url).toContain("/recommendations/v1/papers/for/DOI%3A10.1000%2Fseed");
	});

	it("parses arXiv Atom entries in submitted-date order", async () => {
		const hits = await createArxivConnector().search("genomics", {
			fetchImpl: async () =>
				new Response(
					`<?xml version="1.0"?><feed>
					<entry><id>http://arxiv.org/abs/2601.00001v2</id><title> First paper </title><summary> Summary </summary><published>2026-01-20T00:00:00Z</published><author><name>Ada &amp; Bob</name></author></entry>
					<entry><id>http://arxiv.org/abs/2601.00002</id><title>Second paper</title><summary>Second summary</summary><published>2026-01-19T00:00:00Z</published></entry>
					</feed>`,
					{ status: 200, headers: { "content-type": "application/atom+xml" } },
				),
		});
		expect(hits).toHaveLength(2);
		expect(hits[0]).toMatchObject({
			id: "arxiv:2601.00001v2",
			locator: "https://arxiv.org/abs/2601.00001v2",
			authors: ["Ada & Bob"],
			arxivId: "2601.00001v2",
			publishedAt: "2026-01-20T00:00:00Z",
		});
	});

	it("marks Semantic Scholar rate limits as retryable failures", async () => {
		const result = await new ResearchConnectorRegistry([createSemanticScholarConnector()]).search(
			{ query: "genomics" },
			{ fetchImpl: async () => response({ error: "rate limited" }, 429) },
		);
		expect(result.hits).toEqual([]);
		expect(result.failures).toEqual([
			expect.objectContaining({ connectorId: "semantic-scholar", retryable: true }),
		]);
		expect(result.complete).toBe(false);
	});

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
