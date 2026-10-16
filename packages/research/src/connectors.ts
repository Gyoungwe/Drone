import { createHash } from "node:crypto";
import type {
	ResearchConnectorFailure,
	ResearchConnectorHit,
	ResearchConnectorKind,
	ResearchConnectorSourceReceipt,
	ResearchSearchRequest,
	ResearchSearchResponse,
} from "@drone/shared";

export interface ResearchConnectorContext {
	readonly fetchImpl?: typeof fetch;
	readonly signal?: AbortSignal;
}

export interface ResearchConnector {
	readonly id: string;
	readonly kind: ResearchConnectorKind;
	readonly label: string;
	search(
		query: string,
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
	return Math.max(1, Math.min(20, Math.trunc(value ?? 10)));
}

function text(value: unknown): string {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

async function fetchJson(
	url: string,
	options: ResearchConnectorContext = {},
): Promise<{ value: any; response: Response }> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
	const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
	try {
		const response = await fetchImpl(url, {
			headers: { accept: "application/json", "user-agent": "Drone-Research-Workbench/0.32" },
			signal,
		});
		if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
		return { value: await response.json(), response };
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

export function createDefaultResearchConnectors(): readonly ResearchConnector[] {
	return [
		createCrossrefConnector(),
		createEuropePmcConnector(),
		createPubmedConnector(),
		createZenodoConnector(),
		createOsfConnector(),
		createSraConnector(),
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

	async search(
		input: ResearchSearchRequest,
		context: ResearchConnectorContext = {},
	): Promise<ResearchSearchResponse> {
		const query = input.query.normalize("NFKC").trim();
		if (!query || query.length > 512) throw new Error("Research search query is required");
		const selected = input.connectorIds?.length
			? input.connectorIds
					.map((id) => this.connectors.get(id))
					.filter((item): item is ResearchConnector => Boolean(item))
			: this.list();
		const limit = clampLimit(input.limit);
		const settled = await Promise.allSettled(
			selected.map((connector) => connector.search(query, { ...context, limit })),
		);
		const hits: ResearchConnectorHit[] = [];
		const failures: ResearchConnectorFailure[] = [];
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
			connectors: selected.map((connector) => connector.id),
			complete: failures.length === 0,
		};
	}
}
