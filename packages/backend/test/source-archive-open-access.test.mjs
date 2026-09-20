import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sourceArchive from "../../../.pi/extensions/source-archive.mjs";
import { saveWorkspaceConfig } from "../../../.pi/extensions/workspace-config.mjs";
import {
	contactEmail,
	normalizePmcid,
	pmcCloudHttps,
	resolveOpenAccess,
} from "../../../.pi/lib/open-access.mjs";
import { startResearchRun } from "../../../.pi/lib/research-loop.mjs";
import { archiveSource } from "../../../.pi/lib/source-archive.mjs";

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

const DOI = "10.1111/imb.12628";
const PMCID = "PMC7079136";
const PDF = new TextEncoder().encode("%PDF-1.7\n%fake open-access body\n");
const pdf = () => new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } });
const html = (body = "<html><body>landing page</body></html>", status = 200) =>
	new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const json = (body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** 按 URL 正则路由的 fetch 桩；未命中一律 404。 */
function router(routes) {
	const calls = [];
	const fetchImpl = vi.fn(async (url) => {
		const target = String(url);
		calls.push(target);
		for (const [pattern, handler] of routes) if (pattern.test(target)) return handler(target);
		return new Response("not found", { status: 404 });
	});
	return { fetchImpl, calls };
}
const europePmc = (hit) => [
	/ebi\.ac\.uk\/europepmc\/webservices\/rest\/search/,
	() => json({ resultList: { result: hit ? [hit] : [] } }),
];
const OA_HIT = {
	doi: DOI,
	pmcid: PMCID,
	pmid: "32020703",
	isOpenAccess: "Y",
	inEPMC: "Y",
	hasPDF: "Y",
	title: "Sex determination",
};
const S3 = "https://pmc-oa-opendata.s3.amazonaws.com";
const cloudMeta = (version, record) => [
	new RegExp(`pmc-oa-opendata\\.s3\\.amazonaws\\.com/metadata/PMC7079136\\.${version}\\.json$`),
	() =>
		record
			? new Response(JSON.stringify(record), {
					status: 200,
					headers: { "content-type": "binary/octet-stream" },
				})
			: new Response("<Error><Code>NoSuchKey</Code></Error>", {
					status: 404,
					headers: { "content-type": "application/xml" },
				}),
];
const LEGIT_HOSTS = [
	"www.ebi.ac.uk",
	"europepmc.org",
	"pmc-oa-opendata.s3.amazonaws.com",
	"api.unpaywall.org",
	"api.openalex.org",
	"api.semanticscholar.org",
	"api.crossref.org",
	"arxiv.org",
	"onlinelibrary.wiley.com",
	"example.org",
];

describe("open-access resolver", () => {
	it("orders candidates by source trust (PMC article datasets first), prefers the published version and never emits duplicates or s3:// URLs", async () => {
		const { fetchImpl, calls } = router([
			europePmc(OA_HIT),
			cloudMeta(1, {
				pmcid: PMCID,
				version: 1,
				doi: DOI,
				is_manuscript: true,
				is_pmc_openaccess: false,
				license_code: "TDM",
				pdf_url: null,
			}),
			cloudMeta(2, {
				pmcid: PMCID,
				version: 2,
				doi: DOI,
				is_manuscript: false,
				is_pmc_openaccess: true,
				license_code: "CC BY",
				pdf_url: "s3://pmc-oa-opendata/PMC7079136.2/PMC7079136.2.pdf?md5=093c5a73546ed0b49913964a1d788670",
			}),
			cloudMeta(3, null),
			[
				/api\.unpaywall\.org/,
				() =>
					json({
						is_oa: true,
						oa_status: "hybrid",
						best_oa_location: {
							url_for_pdf: "https://onlinelibrary.wiley.com/doi/pdfdirect/10.1111/imb.12628",
							license: "cc-by",
							version: "publishedVersion",
							host_type: "publisher",
						},
						oa_locations: [
							{ url_for_pdf: "https://onlinelibrary.wiley.com/doi/pdfdirect/10.1111/imb.12628" },
							{ url_for_pdf: "https://europepmc.org/articles/PMC7079136?pdf=render" },
						],
					}),
			],
			[
				/api\.openalex\.org/,
				() =>
					json({
						open_access: { is_oa: true, oa_status: "hybrid" },
						best_oa_location: {
							pdf_url: "https://example.org/repo/imb12628.pdf",
							is_oa: true,
							version: "acceptedVersion",
						},
						locations: [{ pdf_url: null, is_oa: false }],
					}),
			],
			[
				/api\.semanticscholar\.org/,
				() =>
					json({
						isOpenAccess: true,
						openAccessPdf: { url: "https://example.org/s2/imb12628.pdf", status: "GREEN" },
						externalIds: { ArXiv: "2001.01234" },
					}),
			],
			[
				/api\.crossref\.org/,
				() =>
					json({
						message: {
							link: [
								{
									URL: "https://onlinelibrary.wiley.com/doi/full-xml/10.1111/imb.12628",
									"content-type": "application/xml",
								},
								{
									URL: "https://onlinelibrary.wiley.com/doi/pdf/10.1111/imb.12628",
									"content-type": "application/pdf",
								},
							],
							license: [{ URL: "http://creativecommons.org/licenses/by/4.0/" }],
						},
					}),
			],
		]);
		const result = await resolveOpenAccess({
			doi: `https://doi.org/${DOI.toUpperCase()}`,
			fetchImpl,
			env: { DRONE_CONTACT_EMAIL: "lab@example.org" },
		});
		expect(result).toMatchObject({
			doi: DOI,
			pmcid: PMCID,
			pmid: "32020703",
			oaStatus: "hybrid",
			license: "CC BY",
		});
		expect(result.candidates.map((c) => [c.source, c.url])).toEqual([
			["pmc-cloud", `${S3}/PMC7079136.2/PMC7079136.2.pdf?md5=093c5a73546ed0b49913964a1d788670`],
			["europepmc", `https://europepmc.org/articles/${PMCID}?pdf=render`],
			["europepmc", `https://europepmc.org/backend/ptpmcrender.fcgi?accid=${PMCID}&blobtype=pdf`],
			["unpaywall", "https://onlinelibrary.wiley.com/doi/pdfdirect/10.1111/imb.12628"],
			["openalex", "https://example.org/repo/imb12628.pdf"],
			["semanticscholar", "https://example.org/s2/imb12628.pdf"],
			["semanticscholar", "https://arxiv.org/pdf/2001.01234"],
			["crossref", "https://onlinelibrary.wiley.com/doi/pdf/10.1111/imb.12628"],
		]);
		expect(result.candidates[0]).toMatchObject({ license: "CC BY", version: "publishedVersion" });
		expect(result.candidates.every((c) => /^https:\/\//.test(c.url))).toBe(true);
		expect(result.queried.map((q) => `${q.source}:${q.status}`)).toEqual([
			"europepmc:ok",
			"pmc-cloud:ok",
			"unpaywall:ok",
			"openalex:ok",
			"semanticscholar:ok",
			"crossref:ok",
		]);
		expect(calls.some((u) => /email=lab%40example\.org/.test(u))).toBe(true);
		for (const u of calls) expect(LEGIT_HOSTS).toContain(new URL(u).hostname);
	});
	it("skips Unpaywall without a contact email, survives source errors and needs an identifier", async () => {
		const { fetchImpl } = router([
			europePmc(null),
			[/api\.openalex\.org/, () => new Response("boom", { status: 500 })],
		]);
		const result = await resolveOpenAccess({ doi: DOI, fetchImpl, env: {} });
		expect(result.candidates).toEqual([]);
		expect(result.queried).toEqual(
			expect.arrayContaining([
				{ source: "europepmc", status: "ok", detail: "no record" },
				{ source: "unpaywall", status: "skipped", detail: expect.stringContaining("DRONE_CONTACT_EMAIL") },
				{ source: "openalex", status: "error", detail: "HTTP 500" },
				{ source: "semanticscholar", status: "ok", detail: "HTTP 404" },
			]),
		);
		await expect(resolveOpenAccess({ fetchImpl })).rejects.toThrow("needs a DOI");
		expect(normalizePmcid("pmc123")).toBe("PMC123");
		expect(normalizePmcid("PMC")).toBeNull();
		expect(pmcCloudHttps("s3://pmc-oa-opendata/PMC1.1/PMC1.1.pdf?md5=ab")).toBe(
			`${S3}/PMC1.1/PMC1.1.pdf?md5=ab`,
		);
		expect(pmcCloudHttps("https://evil.example/PMC1.1.pdf")).toBeNull();
		expect(contactEmail("not-an-email", { UNPAYWALL_EMAIL: "x@y.org" })).toBe("x@y.org");
		expect(contactEmail(undefined, {})).toBeNull();
	});
});

describe("research_archive_source open-access acquisition", () => {
	let cwd, runDir;
	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "oa-archive-"));
		await mkdir(join(cwd, "Vault"));
		await saveWorkspaceConfig(cwd, { obsidianVault: join(cwd, "Vault") });
		runDir = (await startResearchRun({ cwd, resultSlug: "oa", query: "sex determination" })).run_dir;
	});
	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});
	const manifest = async () =>
		JSON.parse(await readFile(join(runDir, "sources", "download-manifest.json"), "utf8"));

	it("archives a paper from its DOI alone through the PMC article datasets", async () => {
		const { fetchImpl, calls } = router([
			europePmc(OA_HIT),
			cloudMeta(1, {
				pmcid: PMCID,
				version: 1,
				doi: DOI,
				is_manuscript: false,
				is_pmc_openaccess: true,
				license_code: "CC BY",
				pdf_url: "s3://pmc-oa-opendata/PMC7079136.1/PMC7079136.1.pdf?md5=093c5a73546ed0b49913964a1d788670",
			}),
			[
				/pmc-oa-opendata\.s3\.amazonaws\.com\/PMC7079136\.1\/PMC7079136\.1\.pdf\?md5=093c5a73546ed0b49913964a1d788670$/,
				() => pdf(),
			],
		]);
		const result = await archiveSource({
			cwd,
			run_dir: runDir,
			category: "papers",
			doi: DOI,
			fetchImpl,
			env: {},
		});
		expect(result.status).toBe("downloaded");
		expect(result.open_access).toMatchObject({
			source: "pmc-cloud",
			url: `${S3}/PMC7079136.1/PMC7079136.1.pdf?md5=093c5a73546ed0b49913964a1d788670`,
			license: "CC BY",
			version: "publishedVersion",
			candidates_tried: 1,
		});
		expect(result.metadata).toMatchObject({ doi: DOI, pmcid: PMCID, pmid: "32020703" });
		expect(result.url).toBe(result.open_access.url);
		expect(result.final_url).toBe(result.open_access.url);
		expect(result.path.toLowerCase().endsWith("pmc7079136.1.pdf")).toBe(true);
		expect(await readFile(result.path)).toEqual(Buffer.from(PDF));
		const m = await manifest();
		expect(m.items).toHaveLength(1);
		expect(m.failures || []).toHaveLength(0);
		// 只访问过公开元数据服务与 Europe PMC；没有任何影子图书馆
		for (const u of calls) expect(LEGIT_HOSTS).toContain(new URL(u).hostname);
	});

	it("falls back from a failing given url to open-access resolution when the DOI is known, skipping non-PDF candidates", async () => {
		const { fetchImpl } = router([
			[/publisher\.example\.org\/paywalled/, () => html("<html>Please sign in</html>", 200)],
			europePmc(OA_HIT),
			[/europepmc\.org\/articles\/PMC7079136\?pdf=render/, () => html()],
			[/ptpmcrender\.fcgi\?accid=PMC7079136/, () => pdf()],
		]);
		const result = await archiveSource({
			cwd,
			run_dir: runDir,
			category: "papers",
			url: "https://publisher.example.org/paywalled/imb.12628.pdf",
			metadata: { doi: DOI, title: "Sex determination" },
			fetchImpl,
			env: {},
		});
		expect(result.status).toBe("downloaded");
		expect(result.open_access).toMatchObject({
			source: "europepmc",
			license: "open-access",
			candidates_tried: 3,
		});
		expect(result.url).toBe("https://publisher.example.org/paywalled/imb.12628.pdf");
		expect(result.final_url).toBe(
			`https://europepmc.org/backend/ptpmcrender.fcgi?accid=${PMCID}&blobtype=pdf`,
		);
		expect(result.path.toLowerCase().endsWith(".pdf")).toBe(true);
		expect(result.metadata.title).toBe("Sex determination");
	});

	it("reports no_open_access honestly with the sources queried and a manual, rights-respecting handoff", async () => {
		const { fetchImpl } = router([
			europePmc({ ...OA_HIT, pmcid: undefined, isOpenAccess: "N", inEPMC: "N", hasPDF: "N" }),
			[
				/api\.unpaywall\.org/,
				() => json({ is_oa: false, oa_status: "closed", best_oa_location: null, oa_locations: [] }),
			],
			[/api\.openalex\.org/, () => json({ open_access: { is_oa: false }, locations: [] })],
			[
				/api\.crossref\.org/,
				() =>
					json({
						message: {
							link: [
								{
									URL: "https://onlinelibrary.wiley.com/doi/pdf/10.1111/imb.12628",
									"content-type": "application/pdf",
								},
							],
						},
					}),
			],
			[/onlinelibrary\.wiley\.com/, () => html("<html>Access denied</html>", 403)],
		]);
		const result = await archiveSource({
			cwd,
			run_dir: runDir,
			category: "papers",
			doi: DOI,
			email: "lab@example.org",
			fetchImpl,
			env: {},
		});
		expect(result.status).toBe("no_open_access");
		expect(result.ok).toBeUndefined();
		expect(result.browser_required).toBe(true);
		expect(result.browser_handoff.url).toBe("https://onlinelibrary.wiley.com/doi/pdf/10.1111/imb.12628");
		expect(result.open_access).toMatchObject({ doi: DOI, oa_status: "closed" });
		expect(result.open_access.queried.map((q) => q.source)).toEqual([
			"europepmc",
			"unpaywall",
			"openalex",
			"semanticscholar",
			"crossref",
		]);
		expect(result.open_access.attempts).toEqual([
			expect.objectContaining({ source: "crossref", browser_required: true }),
		]);
		expect(result.manual_import.task_wait).toEqual({
			kind: "download",
			doi: DOI,
			title: "Sex determination",
		});
		expect(result.manual_import.how).toMatch(/own browser/);
		const m = await manifest();
		expect(m.items).toHaveLength(0);
		expect(m.failures).toHaveLength(1);
		const failures = await readFile(join(runDir, "sources", "download-failures.md"), "utf8");
		expect(failures).toContain("Open access: 10.1111/imb.12628");
		expect(failures).toContain("tried https://onlinelibrary.wiley.com/doi/pdf/10.1111/imb.12628 (crossref)");
	});

	it("keeps the legacy single-url behaviour when resolution is off or no identifier is known", async () => {
		const { fetchImpl, calls } = router([
			[/example\.org\/gone/, () => new Response("gone", { status: 404 })],
		]);
		const off = await archiveSource({
			cwd,
			run_dir: runDir,
			category: "papers",
			url: "https://example.org/gone.pdf",
			doi: DOI,
			resolve_open_access: false,
			fetchImpl,
		});
		expect(off).toMatchObject({ status: "failed", reason: "HTTP 404", browser_required: false });
		const noId = await archiveSource({
			cwd,
			run_dir: runDir,
			category: "papers",
			url: "https://example.org/gone.pdf",
			fetchImpl,
		});
		expect(noId.status).toBe("failed");
		expect(calls.every((u) => /example\.org\/gone/.test(u))).toBe(true);
		await expect(archiveSource({ cwd, run_dir: runDir, category: "papers", fetchImpl })).rejects.toThrow(
			"url is required",
		);
		await expect(
			archiveSource({ cwd, run_dir: runDir, category: "software", doi: DOI, fetchImpl }),
		).rejects.toThrow("url is required");
	});

	it("exposes doi/pmcid/pmid on the tool schema and no longer requires url", () => {
		const tools = new Map();
		sourceArchive({
			registerTool: (tool) => tools.set(tool.name, tool),
			on: () => {},
			registerCommand: () => {},
		});
		const tool = tools.get("research_archive_source");
		expect(tool.parameters.required).toEqual(["run_dir", "category"]);
		expect(Object.keys(tool.parameters.properties)).toEqual(
			expect.arrayContaining(["doi", "pmcid", "pmid", "resolve_open_access", "max_candidates", "local_file"]),
		);
		expect(tool.description).toMatch(/never fetch from pirate mirrors/);
	});
});
