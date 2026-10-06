import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * bio_db：公共生物数据库只读检索（NCBI E-utilities / GEO、UniProt、Ensembl、ENA/SRA）。
 * 只访问固定的官方 HTTPS 端点（无 SSRF 面），响应体有上限、输出截断；
 * 结果附带检索 URL 与数据库版本线索，便于写进数据集笔记和运行记录。
 */

export type BioDbSource = "ncbi" | "geo" | "uniprot" | "ensembl" | "ena";
export type BioDbAction = "search" | "fetch";

export const NCBI_DATABASES = [
	"pubmed",
	"gene",
	"nuccore",
	"protein",
	"sra",
	"gds",
	"assembly",
	"taxonomy",
	"bioproject",
	"biosample",
] as const;

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const UNIPROT = "https://rest.uniprot.org/uniprotkb";
const ENSEMBL = "https://rest.ensembl.org";
const ENA = "https://www.ebi.ac.uk/ena/portal/api";

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_CHARS = 20_000;
/** NCBI 无 API key 时限 3 次/秒：串行并保持请求间隔 */
const NCBI_INTERVAL_MS = 350;

const UNIPROT_FIELDS = "accession,id,protein_name,gene_names,organism_name,length,reviewed";
const ENA_RUN_FIELDS =
	"run_accession,study_accession,sample_accession,scientific_name,instrument_platform,library_strategy,library_layout,read_count,base_count,fastq_ftp,fastq_md5";

const params = Type.Object({
	source: Type.Union(
		[
			Type.Literal("ncbi"),
			Type.Literal("geo"),
			Type.Literal("uniprot"),
			Type.Literal("ensembl"),
			Type.Literal("ena"),
		],
		{ description: "Database: ncbi (E-utilities), geo (GEO DataSets), uniprot, ensembl, ena (ENA/SRA runs)" },
	),
	action: Type.Optional(
		Type.Union([Type.Literal("search"), Type.Literal("fetch")], {
			description: "search by query (default) or fetch one record by id/accession",
		}),
	),
	query: Type.Optional(
		Type.String({
			maxLength: 1000,
			description:
				'search: NCBI Entrez term, UniProt query, Ensembl gene symbol, or ENA query (e.g. tax_tree(9606) AND library_strategy="RNA-Seq")',
		}),
	),
	id: Type.Optional(
		Type.String({
			maxLength: 200,
			description:
				"fetch: accession or id (NCBI uid/accession, UniProt accession, Ensembl stable id, ENA/SRA study/run)",
		}),
	),
	db: Type.Optional(
		Type.String({
			description: `ncbi only: ${NCBI_DATABASES.join(", ")} (default pubmed)`,
		}),
	),
	species: Type.Optional(
		Type.String({ maxLength: 100, description: "ensembl search only: species name, default homo_sapiens" }),
	),
	sequence: Type.Optional(
		Type.Boolean({
			description: "fetch: also return the FASTA sequence (nuccore/protein, uniprot, ensembl)",
		}),
	),
	limit: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 50, description: "search: max records (default 10)" }),
	),
});

export interface BioDbDetails {
	source: BioDbSource;
	action: BioDbAction;
	urls: string[];
	count?: number;
	truncated: boolean;
}

export type BioDbFetch = (url: string, signal?: AbortSignal) => Promise<{ status: number; text: string }>;

async function defaultFetch(url: string, signal?: AbortSignal): Promise<{ status: number; text: string }> {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	const response = await fetch(url, {
		headers: { "user-agent": "Drone-research-workbench", accept: "application/json, text/plain, */*" },
		redirect: "follow",
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
	});
	const reader = response.body?.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	if (reader) {
		while (size < MAX_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			size += value.byteLength;
		}
		await reader.cancel().catch(() => undefined);
	}
	return { status: response.status, text: Buffer.concat(chunks).toString("utf8").slice(0, MAX_BYTES) };
}

function qs(values: Record<string, string | number | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) if (value !== undefined) search.set(key, String(value));
	return search.toString();
}

/** 由参数生成要请求的 URL（纯函数，便于测试与审计） */
export function ncbiSearchUrl(db: string, term: string, limit: number): string {
	return `${EUTILS}/esearch.fcgi?${qs({ db, term, retmode: "json", retmax: limit })}`;
}
export function ncbiSummaryUrl(db: string, ids: string[]): string {
	return `${EUTILS}/esummary.fcgi?${qs({ db, id: ids.join(","), retmode: "json" })}`;
}
export function ncbiFastaUrl(db: string, id: string): string {
	return `${EUTILS}/efetch.fcgi?${qs({ db, id, rettype: "fasta", retmode: "text" })}`;
}
export function uniprotSearchUrl(query: string, limit: number): string {
	return `${UNIPROT}/search?${qs({ query, format: "tsv", fields: UNIPROT_FIELDS, size: limit })}`;
}
export function uniprotEntryUrl(accession: string, format: "tsv" | "fasta"): string {
	return format === "fasta"
		? `${UNIPROT}/${encodeURIComponent(accession)}.fasta`
		: `${UNIPROT}/search?${qs({ query: `accession:${accession}`, format: "tsv", fields: `${UNIPROT_FIELDS},cc_function,go_p,xref_pdb` })}`;
}
export function ensemblSymbolUrl(species: string, symbol: string): string {
	return `${ENSEMBL}/lookup/symbol/${encodeURIComponent(species)}/${encodeURIComponent(symbol)}?${qs({ "content-type": "application/json" })}`;
}
export function ensemblIdUrl(id: string): string {
	return `${ENSEMBL}/lookup/id/${encodeURIComponent(id)}?${qs({ "content-type": "application/json" })}`;
}
export function ensemblSequenceUrl(id: string): string {
	return `${ENSEMBL}/sequence/id/${encodeURIComponent(id)}?${qs({ "content-type": "text/x-fasta", type: "genomic" })}`;
}
export function ensemblReleaseUrl(): string {
	return `${ENSEMBL}/info/data?${qs({ "content-type": "application/json" })}`;
}
export function enaSearchUrl(query: string, limit: number): string {
	return `${ENA}/search?${qs({ result: "read_run", query, fields: ENA_RUN_FIELDS, format: "tsv", limit })}`;
}
export function enaFileReportUrl(accession: string): string {
	return `${ENA}/filereport?${qs({ accession, result: "read_run", fields: ENA_RUN_FIELDS, format: "tsv" })}`;
}

/** esummary JSON → 每条记录一行的摘要（按库挑关键字段） */
export function formatNcbiSummary(db: string, json: unknown): string[] {
	const result = (json as { result?: Record<string, unknown> } | undefined)?.result;
	if (!result) return [];
	const uids = Array.isArray(result.uids) ? (result.uids as string[]) : [];
	return uids.map((uid) => {
		const doc = (result[uid] ?? {}) as Record<string, unknown>;
		const pick = (...keys: string[]) =>
			keys
				.map((key) => doc[key])
				.filter((value) => value !== undefined && value !== null && value !== "")
				.map((value) => (typeof value === "object" ? JSON.stringify(value) : String(value)));
		let fields: string[];
		switch (db) {
			case "pubmed":
				fields = [
					...pick("title", "fulljournalname", "pubdate"),
					...((doc.articleids as { idtype: string; value: string }[] | undefined) ?? [])
						.filter((item) => item.idtype === "doi")
						.map((item) => `doi:${item.value}`),
				];
				break;
			case "gene":
				fields = pick("name", "description", "chromosome", "maplocation").concat(
					pick("organism").map((value) => {
						try {
							return (JSON.parse(value) as { scientificname?: string }).scientificname ?? value;
						} catch {
							return value;
						}
					}),
				);
				break;
			case "gds":
				fields = pick("accession", "title", "gdstype", "taxon", "n_samples", "pdat", "ftplink");
				break;
			case "sra":
				fields = pick("expxml").map((xml) =>
					xml
						.replace(/<[^>]+>/g, " ")
						.replace(/\s+/g, " ")
						.slice(0, 300),
				);
				break;
			case "assembly":
				fields = pick("assemblyaccession", "assemblyname", "speciesname", "assemblystatus", "seqreleasedate");
				break;
			default:
				fields = pick("caption", "accessionversion", "title", "name", "scientificname", "slen", "createdate");
		}
		return `- ${uid}: ${fields.join(" | ")}`;
	});
}

function tsvToLines(tsv: string, limit = 50): { lines: string[]; count: number } {
	const rows = tsv.split(/\r?\n/).filter(Boolean);
	if (rows.length <= 1) return { lines: [], count: 0 };
	const header = rows[0]?.split("\t") ?? [];
	const body = rows.slice(1, limit + 1);
	return {
		count: rows.length - 1,
		lines: body.map((row) => {
			const cells = row.split("\t");
			return `- ${header
				.map((name, index) => (cells[index] ? `${name}=${cells[index]}` : ""))
				.filter(Boolean)
				.join(" | ")}`;
		}),
	};
}

function ensemblLine(record: Record<string, unknown>): string {
	const keys = [
		"id",
		"display_name",
		"biotype",
		"species",
		"assembly_name",
		"seq_region_name",
		"start",
		"end",
		"strand",
		"version",
		"description",
	];
	return `- ${keys
		.filter((key) => record[key] !== undefined && record[key] !== null)
		.map((key) => `${key}=${String(record[key])}`)
		.join(" | ")}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

export interface BioDbToolOptions {
	fetch?: BioDbFetch;
	/** 测试用：NCBI 请求间隔 */
	ncbiIntervalMs?: number;
}

export function makeBioDatabaseTool(options: BioDbToolOptions = {}): ToolDefinition<typeof params> {
	const get = options.fetch ?? defaultFetch;
	const ncbiInterval = options.ncbiIntervalMs ?? NCBI_INTERVAL_MS;
	let ncbiChain: Promise<unknown> = Promise.resolve();

	return {
		name: "bio_db",
		label: "Biological databases",
		description:
			"Query public biological databases read-only: NCBI E-utilities (pubmed, gene, nuccore, protein, sra, assembly, taxonomy, bioproject, biosample), GEO DataSets, UniProtKB, Ensembl (gene lookup, sequence, release) and ENA/SRA sequencing runs (with FASTQ URLs and MD5s). Use search to find records and fetch for one accession. Prefer this over web search for identifiers, accessions, sequences and dataset metadata; record the accession and database release you used.",
		promptSnippet: "bio_db({source, action?, query?, id?, db?, species?, sequence?, limit?})",
		parameters: params,
		execute: async (_id, input, signal): Promise<AgentToolResult<BioDbDetails>> => {
			const action: BioDbAction = input.action ?? (input.id && !input.query ? "fetch" : "search");
			const limit = input.limit ?? 10;
			const urls: string[] = [];
			const call = async (url: string, ncbi = false): Promise<string> => {
				urls.push(url);
				const run = async () => {
					const response = await get(url, signal);
					if (response.status === 404) return "";
					if (response.status < 200 || response.status >= 300)
						throw new Error(
							`${new URL(url).host} returned HTTP ${response.status}: ${response.text.slice(0, 200)}`,
						);
					return response.text;
				};
				if (!ncbi) return run();
				const next = ncbiChain.then(async () => {
					try {
						return await run();
					} finally {
						await sleep(ncbiInterval, signal);
					}
				});
				ncbiChain = next.catch(() => undefined);
				return next;
			};
			const lines: string[] = [];
			let count: number | undefined;

			const needQuery = () => {
				if (!input.query?.trim()) throw new Error(`${input.source} search needs a query`);
				return input.query.trim();
			};
			const needId = () => {
				const value = (input.id ?? input.query ?? "").trim();
				if (!value) throw new Error(`${input.source} fetch needs an id`);
				return value;
			};

			switch (input.source) {
				case "ncbi":
				case "geo": {
					const db = input.source === "geo" ? "gds" : (input.db ?? "pubmed");
					if (!(NCBI_DATABASES as readonly string[]).includes(db))
						throw new Error(`Unsupported NCBI database "${db}"; use one of ${NCBI_DATABASES.join(", ")}`);
					let ids: string[];
					if (action === "search") {
						const json = JSON.parse(await call(ncbiSearchUrl(db, needQuery(), limit), true)) as {
							esearchresult?: { count?: string; idlist?: string[] };
						};
						ids = json.esearchresult?.idlist ?? [];
						count = Number(json.esearchresult?.count ?? ids.length);
						lines.push(`NCBI ${db}: ${count} match(es); showing ${ids.length}.`);
					} else {
						const raw = needId();
						if (/^\d+$/.test(raw)) ids = [raw];
						else {
							const json = JSON.parse(await call(ncbiSearchUrl(db, raw, 1), true)) as {
								esearchresult?: { idlist?: string[] };
							};
							ids = json.esearchresult?.idlist ?? [];
						}
						count = ids.length;
						if (!ids.length) lines.push(`NCBI ${db}: no record for ${raw}.`);
					}
					if (ids.length)
						lines.push(...formatNcbiSummary(db, JSON.parse(await call(ncbiSummaryUrl(db, ids), true))));
					if (action === "fetch" && input.sequence && ids[0] && (db === "nuccore" || db === "protein"))
						lines.push("", (await call(ncbiFastaUrl(db, ids[0]), true)).trim());
					break;
				}
				case "uniprot": {
					if (action === "search") {
						const table = tsvToLines(await call(uniprotSearchUrl(needQuery(), limit)), limit);
						count = table.count;
						lines.push(`UniProtKB: showing ${table.lines.length} record(s).`, ...table.lines);
					} else {
						const accession = needId();
						const table = tsvToLines(await call(uniprotEntryUrl(accession, "tsv")), 1);
						count = table.count;
						lines.push(...(table.lines.length ? table.lines : [`UniProtKB: no entry ${accession}.`]));
						if (input.sequence && table.lines.length)
							lines.push("", (await call(uniprotEntryUrl(accession, "fasta"))).trim());
					}
					break;
				}
				case "ensembl": {
					const text =
						action === "search"
							? await call(ensemblSymbolUrl(input.species?.trim() || "homo_sapiens", needQuery()))
							: await call(ensemblIdUrl(needId()));
					const record = text ? (JSON.parse(text) as Record<string, unknown>) : null;
					count = record ? 1 : 0;
					lines.push(record ? ensemblLine(record) : "Ensembl: no matching record.");
					try {
						const info = JSON.parse(await call(ensemblReleaseUrl())) as { releases?: number[] };
						if (info.releases?.length) lines.push(`Ensembl release: ${info.releases.join(", ")}`);
					} catch {
						/* release is a hint only */
					}
					if (record && input.sequence && typeof record.id === "string")
						lines.push("", (await call(ensemblSequenceUrl(record.id))).trim());
					break;
				}
				case "ena": {
					const table = tsvToLines(
						await call(action === "search" ? enaSearchUrl(needQuery(), limit) : enaFileReportUrl(needId())),
						limit,
					);
					count = table.count;
					lines.push(`ENA read runs: ${table.count} row(s).`, ...table.lines);
					break;
				}
			}

			let text = [...lines, "", `Source URL(s): ${urls.join(" ")}`].join("\n");
			const truncated = text.length > MAX_CHARS;
			if (truncated) text = `${text.slice(0, MAX_CHARS)}\n… (truncated; narrow the query or lower limit)`;
			return {
				content: [{ type: "text", text }],
				details: { source: input.source, action, urls, ...(count === undefined ? {} : { count }), truncated },
			};
		},
	};
}
