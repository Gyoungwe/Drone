import { createHash } from "node:crypto";
import type {
	ResearchConnectorFailure,
	ResearchConnectorHit,
	ResearchConnectorKind,
	ResearchConnectorSourceReceipt,
	ResearchSearchRequest,
	ResearchSearchResponse,
} from "@drone/shared";
import { buildProxiedUrl } from "./institutional-proxy";
import { normalizeDoi } from "./literature-receipt";

export interface ResearchZoteroConnectorConfig {
	readonly apiBase?: string;
	readonly apiKey?: string;
	readonly libraryType?: "users" | "groups";
	readonly libraryId?: string;
}

export interface ResearchProtocolsConnectorConfig {
	readonly apiBase?: string;
	readonly apiToken?: string;
}

export interface ResearchSemanticScholarConnectorConfig {
	readonly apiBase?: string;
	readonly apiKey?: string;
}

export interface ResearchInstitutionalConnectorConfig {
	/** Optional resolver that receives a free-text query as `q`. */
	readonly resolverUrl?: string;
	/** Optional EZproxy template. `%s` is replaced with the encoded target URL. */
	readonly ezproxyTemplate?: string;
}

export interface ResearchProjectStorageItem {
	readonly relativePath: string;
	readonly title?: string;
	readonly summary?: string;
	readonly format?: string;
	readonly size?: number;
	readonly modifiedAt?: string;
	readonly contentHash?: string;
}

export interface ResearchProjectStoragePort {
	search(input: {
		readonly cwd: string;
		readonly query: string;
		readonly limit: number;
		readonly signal?: AbortSignal;
	}): Promise<readonly ResearchProjectStorageItem[]>;
}

export interface ResearchConnectorContext {
	readonly fetchImpl?: typeof fetch;
	readonly signal?: AbortSignal;
	readonly cwd?: string;
	readonly config?: {
		readonly zotero?: ResearchZoteroConnectorConfig;
		readonly protocols?: ResearchProtocolsConnectorConfig;
		readonly semanticScholar?: ResearchSemanticScholarConnectorConfig;
		readonly institutional?: ResearchInstitutionalConnectorConfig;
	};
	readonly projectStorage?: ResearchProjectStoragePort;
}

export interface ResearchConnector {
	readonly id: string;
	readonly kind: ResearchConnectorKind;
	readonly label: string;
	search(
		query: string,
		options?: ResearchConnectorContext & { readonly limit?: number },
	): Promise<readonly ResearchConnectorHit[]>;
	/** Optional recommendation lookup for connectors that support seed papers. */
	recommend?(
		seed: string,
		options?: ResearchConnectorContext & { readonly limit?: number },
	): Promise<readonly ResearchConnectorHit[]>;
}

const DEFAULT_TIMEOUT_MS = 12_000;

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isoNow(): string {
	return new Date().toISOString();
}

function clampLimit(value: number | undefined): number {
	return Math.max(1, Math.min(50, Math.trunc(value ?? 10)));
}

function text(value: unknown): string {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

async function fetchJson(
	url: string,
	options: ResearchConnectorContext = {},
	extraHeaders: Record<string, string> = {},
): Promise<{ value: any; response: Response }> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
	const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
	try {
		const response = await fetchImpl(url, {
			headers: {
				accept: "application/json",
				"user-agent": "Drone-Research-Workbench/0.32",
				...extraHeaders,
			},
			signal,
		});
		if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
		return { value: await response.json(), response };
	} finally {
		clearTimeout(timer);
	}
}

async function fetchResponse(
	url: string,
	options: ResearchConnectorContext = {},
	extraHeaders: Record<string, string> = {},
): Promise<Response> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
	const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
	try {
		const response = await fetchImpl(url, {
			headers: {
				accept: "text/html,application/json;q=0.9,*/*;q=0.8",
				"user-agent": "Drone-Research-Workbench/0.32",
				...extraHeaders,
			},
			signal,
		});
		if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
		return response;
	} finally {
		clearTimeout(timer);
	}
}

function receipt(input: {
	sourceRef: string;
	locator: string;
	kind: ResearchConnectorKind;
	title?: string;
	payload: unknown;
	license?: string;
}): ResearchConnectorSourceReceipt {
	return {
		sourceRef: input.sourceRef,
		locator: input.locator,
		sourceType: input.kind,
		title: input.title,
		license: input.license,
		accessedAt: isoNow(),
		contentHash: hash(input.payload),
		readOnly: true,
	};
}

function retryable(error: unknown): boolean {
	const status =
		typeof error === "object" && error !== null && "status" in error ? Number((error as any).status) : 0;
	return status === 408 || status === 429 || status >= 500 || status === 0;
}

function failure(connectorId: string, error: unknown): ResearchConnectorFailure {
	return {
		connectorId,
		message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
		retryable: retryable(error),
		at: isoNow(),
	};
}

export function createCrossrefConnector(): ResearchConnector {
	return {
		id: "crossref",
		kind: "literature",
		label: "Crossref",
		async search(query, options = {}) {
			const limit = clampLimit(options.limit);
			const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${limit}`;
			const { value } = await fetchJson(url, options);
			const items = Array.isArray(value?.message?.items) ? value.message.items : [];
			return items.slice(0, limit).flatMap((item: any) => {
				const title = text(item?.title?.[0]);
				const doi = text(item?.DOI);
				if (!title || !doi) return [];
				const locator = `https://doi.org/${doi}`;
				return [
					{
						id: `crossref:${doi}`,
						title,
						summary:
							text(item?.abstract) || text(item?.["container-title"]?.[0]) || "Crossref bibliographic record",
						locator,
						sourceType: "literature",
						sourceReceipt: receipt({
							sourceRef: `crossref:${doi}`,
							locator,
							kind: "literature",
							title,
							payload: item,
						}),
					} satisfies ResearchConnectorHit,
				];
			});
		},
	};
}

/** OpenAlex provides a public, provider-neutral literature index without credentials. */
export function createOpenAlexConnector(): ResearchConnector {
	return {
		id: "openalex",
		kind: "literature",
		label: "OpenAlex",
		async search(query, options = {}) {
			const limit = clampLimit(options.limit);
			const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}`;
			const { value } = await fetchJson(url, options);
			const items = Array.isArray(value?.results) ? value.results : [];
			return items.slice(0, limit).flatMap((item: any) => {
				const id = text(item?.id).split("/").pop();
				const title = text(item?.title);
				if (!id || !title) return [];
				const doi = normalizeDoi(item?.doi);
				const locator = doi ? `https://doi.org/${doi}` : text(item?.id);
				return [
					{
						id: `openalex:${id}`,
						title,
						summary:
							text(item?.primary_location?.source?.display_name) ||
							text(item?.publication_year) ||
							"OpenAlex work record",
						locator,
						sourceType: "literature",
						sourceReceipt: receipt({
							sourceRef: `openalex:${id}`,
							locator,
							kind: "literature",
							title,
							payload: item,
						}),
					} satisfies ResearchConnectorHit,
				];
			});
		},
	};
}

/** Resolve an exact DOI through Crossref; non-DOI queries intentionally return no hits. */
export function createDoiConnector(): ResearchConnector {
	return {
		id: "doi",
		kind: "citation",
		label: "DOI",
		async search(query, options = {}) {
			const doi = normalizeDoi(query);
			if (!doi) return [];
			const { value } = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, options);
			const item = value?.message;
			const title = text(item?.title?.[0]);
			if (!title) return [];
			const locator = `https://doi.org/${doi}`;
			return [
				{
					id: `doi:${doi}`,
					title,
					summary: text(item?.abstract) || text(item?.["container-title"]?.[0]) || "DOI record",
					locator,
					sourceType: "citation",
					sourceReceipt: receipt({
						sourceRef: `doi:${doi}`,
						locator,
						kind: "citation",
						title,
						payload: item,
					}),
				} satisfies ResearchConnectorHit,
			];
		},
	};
}

export function createEuropePmcConnector(): ResearchConnector {
	return {
		id: "europe-pmc",
		kind: "literature",
		label: "Europe PMC",
		async search(query, options = {}) {
			const limit = clampLimit(options.limit);
			const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=${limit}`;
			const { value } = await fetchJson(url, options);
			const items = Array.isArray(value?.resultList?.result) ? value.resultList.result : [];
			return items.slice(0, limit).flatMap((item: any) => {
				const id = text(item?.pmcid) || text(item?.pmid) || text(item?.doi);
				const title = text(item?.title);
				if (!id || !title) return [];
				const locator = item?.doi
					? `https://doi.org/${text(item.doi)}`
					: `https://europepmc.org/article/${item?.pmcid ? "MED" : "MED"}/${id}`;
				return [
					{
						id: `europe-pmc:${id}`,
						title,
						summary: text(item?.abstractText) || text(item?.journalTitle) || "Europe PMC record",
						locator,
						sourceType: "literature",
						sourceReceipt: receipt({
							sourceRef: `europe-pmc:${id}`,
							locator,
							kind: "literature",
							title,
							payload: item,
						}),
					} satisfies ResearchConnectorHit,
				];
			});
		},
	};
}

export function createPubmedConnector(): ResearchConnector {
	return {
		id: "pubmed",
		kind: "literature",
		label: "PubMed",
		async search(query, options = {}) {
			const limit = clampLimit(options.limit);
			const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${limit}&term=${encodeURIComponent(query)}`;
			const { value: search } = await fetchJson(searchUrl, options);
			const ids = Array.isArray(search?.esearchresult?.idlist)
				? search.esearchresult.idlist.slice(0, limit)
				: [];
			if (!ids.length) return [];
			const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`;
			const { value: summary } = await fetchJson(summaryUrl, options);
			return ids.flatMap((id: string) => {
				const item = summary?.result?.[id];
				const title = text(item?.title);
				if (!title) return [];
				const locator = `https://pubmed.ncbi.nlm.nih.gov/${id}/`;
				return [
					{
						id: `pubmed:${id}`,
						title,
						summary: text(item?.fulljournalname) || text(item?.source) || "PubMed record",
						locator,
						sourceType: "literature",
						sourceReceipt: receipt({
							sourceRef: `pubmed:${id}`,
							locator,
							kind: "literature",
							title,
							payload: item,
						}),
					} satisfies ResearchConnectorHit,
				];
			});
		},
	};
}

function bibliographicAuthors(value: unknown): string[] {
	return Array.isArray(value)
		? value.flatMap((author) => {
				const name = text((author as { name?: unknown })?.name);
				return name ? [name] : [];
			})
		: [];
}

function semanticScholarHit(
	item: any,
	sourceRef: string,
	kind: "literature" = "literature",
): ResearchConnectorHit[] {
	const paperId = text(item?.paperId) || text(item?.corpusId);
	const title = text(item?.title);
	if (!paperId || !title) return [];
	const doi = text(item?.externalIds?.DOI) || undefined;
	const locator = doi
		? `https://doi.org/${doi}`
		: text(item?.url) || `https://www.semanticscholar.org/paper/${paperId}`;
	return [
		{
			id: `semantic-scholar:${paperId}`,
			title,
			summary: text(item?.abstract) || text(item?.venue) || "Semantic Scholar record",
			locator,
			sourceType: kind,
			authors: bibliographicAuthors(item?.authors),
			year: typeof item?.year === "number" ? item.year : undefined,
			doi,
			publishedAt: text(item?.publicationDate) || undefined,
			sourceReceipt: receipt({ sourceRef, locator, kind, title, payload: item }),
		},
	];
}

/** Search Semantic Scholar's public graph API and optionally use an API key for higher limits. */
export function createSemanticScholarConnector(): ResearchConnector {
	const connector: ResearchConnector = {
		id: "semantic-scholar",
		kind: "literature",
		label: "Semantic Scholar",
		async search(query, options = {}) {
			const limit = clampLimit(options.limit);
			const config = options.config?.semanticScholar;
			const apiBase = (text(config?.apiBase) || "https://api.semanticscholar.org").replace(/\/$/u, "");
			const fields = "title,abstract,authors,year,externalIds,url,venue,publicationDate";
			const headers: Record<string, string> = {};
			if (text(config?.apiKey)) headers["x-api-key"] = text(config?.apiKey);
			const { value } = await fetchJson(
				`${apiBase}/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`,
				options,
				headers,
			);
			const items = Array.isArray(value?.data) ? value.data : [];
			return items
				.slice(0, limit)
				.flatMap((item: any) =>
					semanticScholarHit(item, `semantic-scholar:${text(item?.paperId) || text(item?.corpusId)}`),
				);
		},
	};
	connector.recommend = async (seed, options = {}) => {
		const limit = clampLimit(options.limit);
		const config = options.config?.semanticScholar;
		const apiBase = (text(config?.apiBase) || "https://api.semanticscholar.org").replace(/\/$/u, "");
		const fields = "title,abstract,authors,year,externalIds,url,venue,publicationDate";
		const headers: Record<string, string> = {};
		if (text(config?.apiKey)) headers["x-api-key"] = text(config?.apiKey);
		const { value } = await fetchJson(
			`${apiBase}/recommendations/v1/papers/for/${encodeURIComponent(seed)}?limit=${limit}&fields=${fields}`,
			options,
			headers,
		);
		const items = Array.isArray(value?.recommendedPapers) ? value.recommendedPapers : [];
		return items
			.slice(0, limit)
			.flatMap((item: any) =>
				semanticScholarHit(
					item,
					`semantic-scholar:recommendation:${text(item?.paperId) || text(item?.corpusId)}`,
				),
			);
	};
	return connector;
}

function xmlTag(value: string, tag: string): string {
	const match = value.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "iu"));
	return text(match?.[1])
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"');
}

/** Search arXiv's Atom feed, ordered by submitted date by the upstream API. */
export function createArxivConnector(): ResearchConnector {
	return {
		id: "arxiv",
		kind: "literature",
		label: "arXiv",
		async search(query, options = {}) {
			const limit = clampLimit(options.limit);
			const response = await fetchResponse(
				`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`,
				options,
			);
			const xml = await response.text();
			return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/giu)].slice(0, limit).flatMap((match) => {
				const entry = match[1] ?? "";
				const rawId = xmlTag(entry, "id");
				const arxivId = rawId.match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?$/iu)?.[1];
				const title = xmlTag(entry, "title");
				if (!arxivId || !title) return [];
				const locator = `https://arxiv.org/abs/${arxivId}`;
				const authors = [
					...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/giu),
				].map((item) => text(item[1]).replaceAll("&amp;", "&"));
				const publishedAt = xmlTag(entry, "published") || undefined;
				return [
					{
						id: `arxiv:${arxivId}`,
						title,
						summary: xmlTag(entry, "summary") || "arXiv record",
						locator,
						sourceType: "literature",
						authors,
						publishedAt,
						arxivId,
						sourceReceipt: receipt({
							sourceRef: `arxiv:${arxivId}`,
							locator,
							kind: "literature",
							title,
							payload: entry,
						}),
					} satisfies ResearchConnectorHit,
				];
			});
		},
	};
}

export function createZenodoConnector(): ResearchConnector {
	return {
		id: "zenodo",
		kind: "dataset",
		label: "Zenodo",
		async search(query, options = {}) {
			const limit = clampLimit(options.limit);
			const url = `https://zenodo.org/api/records?q=${encodeURIComponent(query)}&size=${limit}`;
			const { value } = await fetchJson(url, options);
			const items = Array.isArray(value?.hits?.hits) ? value.hits.hits : [];
			return items.slice(0, limit).flatMap((item: any) => {
				const title = text(item?.metadata?.title);
				const id = text(item?.id);
				if (!title || !id) return [];
				const locator = text(item?.links?.html) || `https://zenodo.org/records/${id}`;
				return [
					{
						id: `zenodo:${id}`,
						title,
						summary: text(item?.metadata?.description) || "Zenodo dataset record",
						locator,
						sourceType: "dataset",
						sourceReceipt: receipt({
							sourceRef: `zenodo:${id}`,
							locator,
							kind: "dataset",
							title,
							license: text(item?.metadata?.license?.id) || undefined,
							payload: item,
						}),
					} satisfies ResearchConnectorHit,
				];
			});
		},
	};
}

export function createOsfConnector(): ResearchConnector {
	return {
		id: "osf",
		kind: "dataset",
		label: "OSF",
		async search(query, options = {}) {
			const limit = clampLimit(options.limit);
			const url = `https://api.osf.io/v2/nodes/?filter[title]=${encodeURIComponent(query)}&page[size]=${limit}`;
			const { value } = await fetchJson(url, options);
			const items = Array.isArray(value?.data) ? value.data : [];
			return items.slice(0, limit).flatMap((item: any) => {
				const id = text(item?.id);
				const title = text(item?.attributes?.title);
				if (!id || !title) return [];
				const locator = text(item?.links?.html) || `https://osf.io/${id}/`;
				return [
					{
						id: `osf:${id}`,
						title,
						summary: text(item?.attributes?.description) || "OSF project record",
						locator,
						sourceType: "dataset",
						sourceReceipt: receipt({
							sourceRef: `osf:${id}`,
							locator,
							kind: "dataset",
							title,
							payload: item,
						}),
					} satisfies ResearchConnectorHit,
				];
			});
		},
	};
}

export function createSraConnector(): ResearchConnector {
	return {
		id: "sra",
		kind: "dataset",
		label: "NCBI SRA",
		async search(query, options = {}) {
			const limit = clampLimit(options.limit);
			const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=sra&retmode=json&retmax=${limit}&term=${encodeURIComponent(query)}`;
			const { value } = await fetchJson(url, options);
			const ids = Array.isArray(value?.esearchresult?.idlist)
				? value.esearchresult.idlist.slice(0, limit)
				: [];
			return ids.map((id: string) => {
				const locator = `https://www.ncbi.nlm.nih.gov/sra/${id}`;
				return {
					id: `sra:${id}`,
					title: `SRA record ${id}`,
					summary: "NCBI Sequence Read Archive search record",
					locator,
					sourceType: "dataset",
					sourceReceipt: receipt({
						sourceRef: `sra:${id}`,
						locator,
						kind: "dataset",
						title: `SRA record ${id}`,
						payload: { id, query },
					}),
				} satisfies ResearchConnectorHit;
			});
		},
	};
}

/** ENA Portal search exposes public accession metadata and does not acquire reads. */
export function createEnaConnector(): ResearchConnector {
	return {
		id: "ena",
		kind: "dataset",
		label: "ENA",
		async search(query, options = {}) {
			const limit = clampLimit(options.limit);
			const fields = "accession,study_accession,description,study_title";
			const url =
				`https://www.ebi.ac.uk/ena/portal/api/search?result=read_run&query=${encodeURIComponent(query)}` +
				`&format=json&limit=${limit}&fields=${fields}`;
			const { value } = await fetchJson(url, options);
			const items = Array.isArray(value) ? value : [];
			return items.slice(0, limit).flatMap((item: any) => {
				const id = text(item?.accession);
				if (!id) return [];
				const title = text(item?.study_title) || `ENA run ${id}`;
				const locator = `https://www.ebi.ac.uk/ena/browser/view/${id}`;
				return [
					{
						id: `ena:${id}`,
						title,
						summary: text(item?.description) || text(item?.study_accession) || "ENA read-run record",
						locator,
						sourceType: "dataset",
						sourceReceipt: receipt({
							sourceRef: `ena:${id}`,
							locator,
							kind: "dataset",
							title,
							payload: item,
						}),
					} satisfies ResearchConnectorHit,
				];
			});
		},
	};
}

/** Search a configured Zotero library without writing to it. */
export function createZoteroConnector(): ResearchConnector {
	return {
		id: "zotero",
		kind: "citation",
		label: "Zotero",
		async search(query, options = {}) {
			const config = options.config?.zotero;
			const libraryId = text(config?.libraryId);
			if (!libraryId) throw new Error("Zotero connector requires a configured library ID");
			const libraryType = config?.libraryType === "groups" ? "groups" : "users";
			const apiBase = (text(config?.apiBase) || "https://api.zotero.org").replace(/\/$/, "");
			const limit = clampLimit(options.limit);
			const url =
				`${apiBase}/${libraryType}/${encodeURIComponent(libraryId)}/items` +
				`?q=${encodeURIComponent(query)}&limit=${limit}&format=json`;
			const headers: Record<string, string> = { "Zotero-API-Version": "3" };
			if (config?.apiKey) headers["Zotero-API-Key"] = config.apiKey;
			const { value } = await fetchJson(url, options, headers);
			const items = Array.isArray(value) ? value : [];
			return items.slice(0, limit).flatMap((item: any) => {
				const key = text(item?.key);
				const data = item?.data ?? item;
				const title = text(data?.title);
				if (!key || !title) return [];
				const doi = normalizeDoi(data?.DOI);
				const locator =
					text(data?.url) ||
					(doi
						? `https://doi.org/${doi}`
						: `${apiBase}/${libraryType}/${encodeURIComponent(libraryId)}/items/${key}`);
				return [
					{
						id: `zotero:${key}`,
						title,
						summary: text(data?.abstractNote) || text(data?.publicationTitle) || "Zotero library item",
						locator,
						sourceType: "citation",
						sourceReceipt: receipt({
							sourceRef: `zotero:${key}`,
							locator,
							kind: "citation",
							title,
							license: text(data?.rights) || undefined,
							payload: item,
						}),
					} satisfies ResearchConnectorHit,
				];
			});
		},
	};
}

/** Search public or authenticated protocols.io protocols; no write endpoints are used. */
export function createProtocolsConnector(): ResearchConnector {
	return {
		id: "protocols",
		kind: "protocol",
		label: "Protocols.io",
		async search(query, options = {}) {
			const config = options.config?.protocols;
			const apiToken = text(config?.apiToken);
			if (!apiToken) throw new Error("Protocols.io connector requires an API token");
			const apiBase = (text(config?.apiBase) || "https://www.protocols.io/api/v4").replace(/\/$/, "");
			const limit = clampLimit(options.limit);
			const url = `${apiBase}/protocols?q=${encodeURIComponent(query)}&page_size=${limit}&order_field=relevance`;
			const { value } = await fetchJson(url, options, { authorization: `Bearer ${apiToken}` });
			const items = Array.isArray(value?.payload?.items)
				? value.payload.items
				: Array.isArray(value?.items)
					? value.items
					: Array.isArray(value?.data)
						? value.data
						: [];
			return items.slice(0, limit).flatMap((item: any) => {
				const id = text(item?.uri) || text(item?.id);
				const title = text(item?.title) || text(item?.name);
				if (!id || !title) return [];
				const locator =
					text(item?.url) ||
					(text(item?.doi) ? `https://doi.org/${text(item.doi)}` : `https://www.protocols.io/view/${id}`);
				return [
					{
						id: `protocols:${id}`,
						title,
						summary: text(item?.description) || text(item?.summary) || "Protocols.io protocol",
						locator,
						sourceType: "protocol",
						sourceReceipt: receipt({
							sourceRef: `protocols:${id}`,
							locator,
							kind: "protocol",
							title,
							license: text(item?.license?.name) || text(item?.license) || undefined,
							payload: item,
						}),
					} satisfies ResearchConnectorHit,
				];
			});
		},
	};
}

/** Resolve a URL through an optional EZproxy/resolver and record only response metadata. */
export function createInstitutionalConnector(): ResearchConnector {
	return {
		id: "institutional",
		kind: "institutional",
		label: "Institutional access",
		async search(query, options = {}) {
			const config = options.config?.institutional;
			let target = query;
			try {
				new URL(target);
			} catch {
				if (!config?.resolverUrl) throw new Error("Institutional connector requires a URL or resolver URL");
				const resolver = new URL(config.resolverUrl);
				resolver.searchParams.set("q", query);
				target = resolver.toString();
			}
			const proxied = buildProxiedUrl(target, config?.ezproxyTemplate) || target;
			const response = await fetchResponse(proxied, options);
			const contentType = response.headers.get("content-type") || "";
			const locator = response.url || proxied;
			const title = `Institutional resource (${new URL(target).hostname})`;
			return [
				{
					id: `institutional:${hash({ target, locator })}`.slice(0, 80),
					title,
					summary: `HTTP ${response.status}${contentType ? ` · ${contentType}` : ""}`,
					locator,
					sourceType: "institutional",
					sourceReceipt: receipt({
						sourceRef: `institutional:${hash({ target, locator })}`,
						locator,
						kind: "institutional",
						title,
						payload: {
							status: response.status,
							contentType,
							contentLength: response.headers.get("content-length"),
						},
					}),
				} satisfies ResearchConnectorHit,
			];
		},
	};
}

/** Search project-relative file names through the host-provided storage port. */
export function createProjectStorageConnector(): ResearchConnector {
	return {
		id: "project-storage",
		kind: "project-storage",
		label: "Project files",
		async search(query, options = {}) {
			if (!options.cwd) throw new Error("Project storage connector requires a project root");
			if (!options.projectStorage) throw new Error("Project storage connector is unavailable");
			const items = await options.projectStorage.search({
				cwd: options.cwd,
				query,
				limit: clampLimit(options.limit),
				signal: options.signal,
			});
			return items.slice(0, clampLimit(options.limit)).flatMap((item) => {
				const relativePath = text(item.relativePath).replaceAll("\\", "/");
				if (!relativePath || relativePath.endsWith("/")) return [];
				const sourceRef = `project-storage:${hash({ cwd: options.cwd, relativePath })}`;
				const locator = relativePath;
				const title = text(item.title) || relativePath;
				return [
					{
						id: sourceRef,
						title,
						summary:
							text(item.summary) ||
							[item.format, item.size == null ? "" : `${item.size} bytes`].filter(Boolean).join(" · "),
						locator,
						sourceType: "project-storage",
						sourceReceipt: {
							sourceRef,
							locator,
							sourceType: "project-storage",
							title,
							version: item.modifiedAt,
							accessedAt: isoNow(),
							contentHash:
								item.contentHash ||
								hash({ cwd: options.cwd, relativePath, size: item.size, modifiedAt: item.modifiedAt }),
							readOnly: true,
						},
					} satisfies ResearchConnectorHit,
				];
			});
		},
	};
}

export function createDefaultResearchConnectors(): readonly ResearchConnector[] {
	return [
		createArxivConnector(),
		createCrossrefConnector(),
		createDoiConnector(),
		createEuropePmcConnector(),
		createEnaConnector(),
		createOpenAlexConnector(),
		createPubmedConnector(),
		createSemanticScholarConnector(),
		createZenodoConnector(),
		createOsfConnector(),
		createSraConnector(),
		createZoteroConnector(),
		createProtocolsConnector(),
		createInstitutionalConnector(),
		createProjectStorageConnector(),
	];
}

export class ResearchConnectorRegistry {
	private readonly connectors = new Map<string, ResearchConnector>();

	constructor(connectors: readonly ResearchConnector[] = createDefaultResearchConnectors()) {
		for (const connector of connectors) this.register(connector);
	}

	register(connector: ResearchConnector): void {
		if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(connector.id)) throw new Error("Invalid connector id");
		if (this.connectors.has(connector.id)) throw new Error(`Connector already registered: ${connector.id}`);
		this.connectors.set(connector.id, connector);
	}

	list(): readonly ResearchConnector[] {
		return [...this.connectors.values()].sort((a, b) => a.id.localeCompare(b.id));
	}

	async recommend(
		seed: string,
		connectorId: string,
		context: ResearchConnectorContext = {},
		limit = 10,
	): Promise<{ hits: readonly ResearchConnectorHit[]; failures: readonly ResearchConnectorFailure[] }> {
		const connector = this.connectors.get(connectorId);
		if (!connector) {
			return {
				hits: [],
				failures: [
					{
						connectorId,
						message: `Unknown research connector: ${connectorId}`,
						retryable: false,
						at: isoNow(),
					},
				],
			};
		}
		if (!connector.recommend) return { hits: [], failures: [] };
		try {
			return { hits: await connector.recommend(seed, { ...context, limit }), failures: [] };
		} catch (error) {
			return { hits: [], failures: [failure(connector.id, error)] };
		}
	}

	async search(
		input: ResearchSearchRequest,
		context: ResearchConnectorContext = {},
	): Promise<ResearchSearchResponse> {
		const query = input.query.normalize("NFKC").trim();
		if (!query || query.length > 512) throw new Error("Research search query is required");
		const requested =
			input.connectorIds !== undefined ? [...input.connectorIds] : this.list().map((item) => item.id);
		const selected = requested
			.map((id) => this.connectors.get(id))
			.filter((item): item is ResearchConnector => Boolean(item));
		const limit = clampLimit(input.limit);
		const failures: ResearchConnectorFailure[] = requested
			.filter((id) => !this.connectors.has(id))
			.map((id) => ({
				connectorId: id,
				message: `Unknown research connector: ${id}`,
				retryable: false,
				at: isoNow(),
			}));
		const settled = await Promise.allSettled(
			selected.map((connector) =>
				connector.search(query, {
					...context,
					cwd: input.cwd ?? context.cwd,
					signal: input.signal ?? context.signal,
					limit,
				}),
			),
		);
		const hits: ResearchConnectorHit[] = [];
		settled.forEach((result, index) => {
			const connector = selected[index];
			if (!connector) return;
			if (result.status === "fulfilled") hits.push(...result.value);
			else failures.push(failure(connector.id, result.reason));
		});
		const deduped = [...new Map(hits.map((hit) => [hit.id, hit])).values()].slice(
			0,
			limit * Math.max(1, selected.length),
		);
		return {
			query,
			hits: deduped,
			failures,
			connectors: requested,
			complete: failures.length === 0,
		};
	}
}
