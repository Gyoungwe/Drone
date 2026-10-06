import { describe, expect, it, vi } from "vitest";
import {
	type BioDbFetch,
	enaSearchUrl,
	formatNcbiSummary,
	makeBioDatabaseTool,
	ncbiSearchUrl,
	uniprotSearchUrl,
} from "../src/tools/bio/databases";

function respond(routes: [RegExp, string, number?][]): BioDbFetch {
	return vi.fn(async (url: string) => {
		const route = routes.find(([pattern]) => pattern.test(url));
		return route ? { status: route[2] ?? 200, text: route[1] } : { status: 404, text: "" };
	});
}

function text(result: { content: { type: string; text?: string }[] }): string {
	return result.content.map((part) => part.text ?? "").join("");
}

describe("bio_db urls", () => {
	it("builds encoded official endpoints", () => {
		expect(ncbiSearchUrl("gds", "TP53 AND human[orgn]", 5)).toBe(
			"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gds&term=TP53+AND+human%5Borgn%5D&retmode=json&retmax=5",
		);
		expect(uniprotSearchUrl("gene:BRCA1 AND reviewed:true", 3)).toContain(
			"rest.uniprot.org/uniprotkb/search?",
		);
		expect(enaSearchUrl('library_strategy="RNA-Seq"', 2)).toContain("result=read_run");
	});

	it("summarises NCBI esummary records per database", () => {
		const lines = formatNcbiSummary("pubmed", {
			result: {
				uids: ["1"],
				"1": {
					title: "A paper",
					fulljournalname: "Nature",
					pubdate: "2024",
					articleids: [{ idtype: "doi", value: "10.1/x" }],
				},
			},
		});
		expect(lines).toEqual(["- 1: A paper | Nature | 2024 | doi:10.1/x"]);
	});
});

describe("bio_db tool", () => {
	it("searches NCBI then summarises the hits and reports the urls", async () => {
		const fetch = respond([
			[/esearch/, JSON.stringify({ esearchresult: { count: "42", idlist: ["200001"] } })],
			[
				/esummary/,
				JSON.stringify({
					result: { uids: ["200001"], "200001": { accession: "GSE1", title: "RNA-seq of x", n_samples: 6 } },
				}),
			],
		]);
		const tool = makeBioDatabaseTool({ fetch, ncbiIntervalMs: 0 });
		const result = await tool.execute(
			"t",
			{ source: "geo", query: "liver RNA-seq" },
			undefined,
			undefined,
			{} as never,
		);
		expect(text(result)).toContain("42 match(es)");
		expect(text(result)).toContain("GSE1 | RNA-seq of x | 6");
		expect(result.details).toMatchObject({ source: "geo", action: "search", count: 42 });
		expect(result.details.urls).toHaveLength(2);
	});

	it("fetches a UniProt entry with its sequence", async () => {
		const fetch = respond([
			[/\.fasta$/, ">sp|P04637|P53_HUMAN\nMEEPQSDPSV\n"],
			[/search/, "Entry\tProtein names\nP04637\tCellular tumor antigen p53\n"],
		]);
		const tool = makeBioDatabaseTool({ fetch });
		const result = await tool.execute(
			"t",
			{ source: "uniprot", action: "fetch", id: "P04637", sequence: true },
			undefined,
			undefined,
			{} as never,
		);
		expect(text(result)).toContain("Entry=P04637 | Protein names=Cellular tumor antigen p53");
		expect(text(result)).toContain(">sp|P04637|P53_HUMAN");
	});

	it("looks up an Ensembl gene with the current release", async () => {
		const fetch = respond([
			[
				/lookup\/symbol\/homo_sapiens\/TP53/,
				JSON.stringify({ id: "ENSG00000141510", display_name: "TP53", assembly_name: "GRCh38" }),
			],
			[/info\/data/, JSON.stringify({ releases: [113] })],
		]);
		const tool = makeBioDatabaseTool({ fetch });
		const result = await tool.execute(
			"t",
			{ source: "ensembl", query: "TP53" },
			undefined,
			undefined,
			{} as never,
		);
		expect(text(result)).toContain("id=ENSG00000141510 | display_name=TP53 | assembly_name=GRCh38");
		expect(text(result)).toContain("Ensembl release: 113");
	});

	it("lists ENA runs for a study and surfaces HTTP errors", async () => {
		const tool = makeBioDatabaseTool({
			fetch: respond([
				[/filereport/, "run_accession\tfastq_ftp\nSRR1\tftp.sra.ebi.ac.uk/vol1/SRR1_1.fastq.gz\n"],
			]),
		});
		const result = await tool.execute(
			"t",
			{ source: "ena", id: "PRJNA1" },
			undefined,
			undefined,
			{} as never,
		);
		expect(result.details.action).toBe("fetch");
		expect(text(result)).toContain("run_accession=SRR1 | fastq_ftp=ftp.sra.ebi.ac.uk/vol1/SRR1_1.fastq.gz");

		const failing = makeBioDatabaseTool({ fetch: respond([[/search/, "bad query", 400]]) });
		await expect(
			failing.execute("t", { source: "ena", query: "x=" }, undefined, undefined, {} as never),
		).rejects.toThrow(/HTTP 400/);
	});

	it("rejects unsupported NCBI databases and missing queries", async () => {
		const tool = makeBioDatabaseTool({ fetch: respond([]) });
		await expect(
			tool.execute("t", { source: "ncbi", db: "omim", query: "x" }, undefined, undefined, {} as never),
		).rejects.toThrow(/Unsupported NCBI database/);
		await expect(tool.execute("t", { source: "uniprot" }, undefined, undefined, {} as never)).rejects.toThrow(
			/needs a query/,
		);
	});
});
