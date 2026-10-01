import { describe, expect, it, vi } from "vitest";
import { contactEmail, normalizePmcid, pmcCloudHttps, resolveOpenAccess } from "../src/open-access";

const DOI = "10.1111/imb.12628";
const PMCID = "PMC7079136";
const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

describe("open-access package", () => {
	it("normalizes identifiers and only accepts legitimate PMC Cloud URLs", () => {
		expect(normalizePmcid("pmc123")).toBe("PMC123");
		expect(normalizePmcid("PMC")).toBeNull();
		expect(pmcCloudHttps("s3://pmc-oa-opendata/PMC1.1/PMC1.1.pdf?md5=ab")).toBe(
			"https://pmc-oa-opendata.s3.amazonaws.com/PMC1.1/PMC1.1.pdf?md5=ab",
		);
		expect(pmcCloudHttps("https://evil.example/PMC1.1.pdf")).toBeNull();
		expect(contactEmail("not-an-email", { UNPAYWALL_EMAIL: "x@y.org" })).toBe("x@y.org");
	});

	it("orders repository candidates, deduplicates links and records source outcomes", async () => {
		const calls: string[] = [];
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (url.includes("europepmc/webservices"))
				return json({
					resultList: {
						result: [{ doi: DOI, pmcid: PMCID, pmid: "32020703", isOpenAccess: "Y", inEPMC: "Y" }],
					},
				});
			if (url.includes("metadata/PMC7079136.1.json"))
				return json({
					is_manuscript: false,
					is_pmc_openaccess: true,
					license_code: "CC BY",
					pdf_url: "s3://pmc-oa-opendata/PMC7079136.1/PMC7079136.1.pdf",
				});
			if (url.includes("metadata/PMC7079136.2.json")) return new Response("missing", { status: 404 });
			if (url.includes("metadata/PMC7079136.3.json")) return new Response("missing", { status: 404 });
			if (url.includes("api.unpaywall.org"))
				return json({
					is_oa: true,
					oa_status: "hybrid",
					best_oa_location: { url_for_pdf: "https://example.org/paper.pdf", license: "cc-by" },
				});
			return new Response("missing", { status: 404 });
		});
		const result = await resolveOpenAccess({
			doi: DOI,
			fetchImpl,
			env: { DRONE_CONTACT_EMAIL: "lab@example.org" },
			sources: ["europepmc", "pmc-cloud", "unpaywall"],
		});
		expect(result).toMatchObject({
			doi: DOI,
			pmcid: PMCID,
			pmid: "32020703",
			oaStatus: "hybrid",
			license: "CC BY",
		});
		expect(result.candidates.map(({ source, url }) => [source, url])).toEqual([
			["pmc-cloud", "https://pmc-oa-opendata.s3.amazonaws.com/PMC7079136.1/PMC7079136.1.pdf"],
			["europepmc", `https://europepmc.org/articles/${PMCID}?pdf=render`],
			["europepmc", `https://europepmc.org/backend/ptpmcrender.fcgi?accid=${PMCID}&blobtype=pdf`],
			["unpaywall", "https://example.org/paper.pdf"],
		]);
		expect(result.queried.map(({ source, status }) => `${source}:${status}`)).toEqual([
			"europepmc:ok",
			"pmc-cloud:ok",
			"unpaywall:ok",
		]);
		expect(new Set(result.candidates.map((candidate) => candidate.url)).size).toBe(result.candidates.length);
		expect(calls.every((url) => new URL(url).protocol === "https:")).toBe(true);
	});

	it("requires at least one normalized identifier and reports missing contact email", async () => {
		const fetchImpl = vi.fn(async () => new Response("missing", { status: 404 }));
		await expect(resolveOpenAccess({ fetchImpl })).rejects.toThrow("needs a DOI");
		const result = await resolveOpenAccess({ doi: DOI, fetchImpl, env: {}, sources: ["unpaywall"] });
		expect(result.candidates).toEqual([]);
		expect(result.queried).toEqual([
			{ source: "unpaywall", status: "skipped", detail: "no contact email (set DRONE_CONTACT_EMAIL)" },
		]);
	});
});
