/**
 * 知识入库标准（docs/knowledge-ingest-standard.md）的标识符规范化：DOI / PMID / PMCID / arXiv / ISBN /
 * Zotero key / URL，以及去重键、内容哈希与结论（claim）哈希。纯函数，不读写文件、不联网。
 */
import { createHash } from "node:crypto";

/** 去重用的外部标识。字段名与 frontmatter `identity` 一致（snake_case）。 */
export interface KnowledgeIdentity {
	doi?: string;
	pmid?: string;
	pmcid?: string;
	arxiv?: string;
	isbn?: string;
	zotero_key?: string;
	url?: string;
}

export const IDENTITY_FIELDS = ["doi", "pmid", "pmcid", "arxiv", "isbn", "zotero_key", "url"] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

function clean(value: unknown, max = 2048): string {
	if (typeof value !== "string" && typeof value !== "number") return "";
	const text = String(value).normalize("NFKC").trim();
	return text.length > max ? "" : text;
}

function safeDecode(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

const TRAILING_PUNCTUATION = /[.,;:)\]}>"'。，；：）】」』]+$/u;

/**
 * DOI → 小写裸 DOI（`10.xxxx/...`）。接受 `doi:` 前缀、doi.org / dx.doi.org 链接与 URL 编码；
 * 去掉句末标点。无法识别时返回 null。
 */
export function normalizeDoi(input: unknown): string | null {
	let text = clean(input);
	if (!text) return null;
	text = text.replace(/^doi\s*:\s*/i, "");
	text = text.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
	text = safeDecode(text).trim();
	text = text.replace(TRAILING_PUNCTUATION, "");
	if (!/^10\.\d{4,9}\/\S+$/.test(text)) return null;
	return text.toLowerCase();
}

/** PMID → 纯数字字符串。接受 `PMID: 123`、`pmid:123`、PubMed 链接。 */
export function normalizePmid(input: unknown): string | null {
	let text = clean(input, 256);
	if (!text) return null;
	const url = text.match(/^https?:\/\/(?:www\.)?(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d+)\/?$/i);
	if (url) text = url[1] ?? "";
	text = text.replace(/^pmid\s*:?\s*/i, "");
	if (!/^\d{1,9}$/.test(text)) return null;
	const digits = text.replace(/^0+/, "");
	return digits ? digits : null;
}

/** PMCID → `PMC` + 数字（大写）。 */
export function normalizePmcid(input: unknown): string | null {
	let text = clean(input, 256);
	if (!text) return null;
	const url = text.match(/\/pmc\/articles\/(PMC\d+)\/?/i) ?? text.match(/^https?:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\/(PMC\d+)\/?$/i);
	if (url) text = url[1] ?? "";
	text = text.replace(/^pmcid\s*:?\s*/i, "");
	const match = text.match(/^(?:PMC)?(\d{1,10})$/i);
	if (!match || !/^pmc/i.test(text)) return null;
	return `PMC${match[1]}`;
}

/**
 * arXiv → 不带版本号的标识：新式 `2401.01234`，旧式 `hep-th/9901001`。
 * 接受 `arXiv:` 前缀与 arxiv.org/abs|pdf 链接。
 */
export function normalizeArxiv(input: unknown): string | null {
	let text = clean(input, 512);
	if (!text) return null;
	const url = text.match(/^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/i);
	if (url) text = url[1] ?? "";
	text = text.replace(/^arxiv\s*:\s*/i, "").trim();
	const modern = text.match(/^(\d{4}\.\d{4,5})(?:v\d+)?$/i);
	if (modern) return modern[1] ?? null;
	const legacy = text.match(/^([a-z][a-z.-]*\/\d{7})(?:v\d+)?$/i);
	if (legacy) return (legacy[1] ?? "").toLowerCase();
	return null;
}

function isbn10Valid(digits: string): boolean {
	let sum = 0;
	for (let i = 0; i < 10; i++) {
		const char = digits[i] ?? "";
		const value = char === "X" ? 10 : Number(char);
		if (Number.isNaN(value) || (char === "X" && i !== 9)) return false;
		sum += value * (10 - i);
	}
	return sum % 11 === 0;
}

function isbn13Check(first12: string): number {
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
	return (10 - (sum % 10)) % 10;
}

/** ISBN → 校验通过的 ISBN-13（ISBN-10 自动转换）。 */
export function normalizeIsbn(input: unknown): string | null {
	const text = clean(input, 64)
		.replace(/^isbn(?:-1[03])?\s*:?\s*/i, "")
		.replace(/[\s-]/g, "")
		.toUpperCase();
	if (/^\d{9}[\dX]$/.test(text)) {
		if (!isbn10Valid(text)) return null;
		const first12 = `978${text.slice(0, 9)}`;
		return `${first12}${isbn13Check(first12)}`;
	}
	if (/^97[89]\d{10}$/.test(text)) {
		return isbn13Check(text.slice(0, 12)) === Number(text[12]) ? text : null;
	}
	return null;
}

/** Zotero item key：8 位字母数字（与 `research_deposit_knowledge` 的校验一致）。 */
export function normalizeZoteroKey(input: unknown): string | null {
	const text = clean(input, 32);
	return /^[A-Za-z0-9]{8}$/.test(text) ? text : null;
}

const TRACKING_PARAMS = /^(?:utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|spm|ref_src)$/i;

/**
 * URL → 去重用的规范形式：只接受 http(s)，统一为 https，主机小写并去掉 `www.`，去掉默认端口、
 * 片段、跟踪参数，查询参数排序，路径去掉末尾 `/`。DOI 链接请先用 {@link normalizeDoi}。
 */
export function normalizeUrl(input: unknown): string | null {
	const text = clean(input);
	if (!text) return null;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.username || url.password) return null;
	const host = url.hostname.toLowerCase().replace(/^www\./, "");
	if (!host) return null;
	const port = url.port && url.port !== "80" && url.port !== "443" ? `:${url.port}` : "";
	const params = [...url.searchParams.entries()]
		.filter(([key]) => !TRACKING_PARAMS.test(key))
		.sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
	const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
	let path = url.pathname.replace(/\/{2,}/g, "/");
	if (path.length > 1) path = path.replace(/\/+$/, "");
	if (path === "/") path = "";
	return `https://${host}${port}${path}${query}`;
}

/** 把任意一个来源字符串识别成最具体的标识（DOI > PMID > PMCID > arXiv > ISBN > URL）。 */
export function identifyReference(input: unknown): { field: IdentityField; value: string } | null {
	const text = clean(input);
	if (!text) return null;
	const doi = normalizeDoi(text);
	if (doi) return { field: "doi", value: doi };
	if (/^(?:pmid\s*:?|https?:\/\/(?:www\.)?(?:pubmed\.|ncbi\.nlm\.nih\.gov\/pubmed))/i.test(text)) {
		const pmid = normalizePmid(text);
		if (pmid) return { field: "pmid", value: pmid };
	}
	if (/pmc\d/i.test(text)) {
		const pmcid = normalizePmcid(text);
		if (pmcid) return { field: "pmcid", value: pmcid };
	}
	if (/^(?:arxiv\s*:|https?:\/\/(?:www\.|export\.)?arxiv\.org\/)/i.test(text)) {
		const arxiv = normalizeArxiv(text);
		if (arxiv) return { field: "arxiv", value: arxiv };
	}
	if (/^isbn/i.test(text)) {
		const isbn = normalizeIsbn(text);
		if (isbn) return { field: "isbn", value: isbn };
	}
	if (/^zotero\s*:/i.test(text)) {
		const key = normalizeZoteroKey(text.replace(/^zotero\s*:\s*/i, ""));
		if (key) return { field: "zotero_key", value: key };
	}
	const url = normalizeUrl(text);
	if (url) return { field: "url", value: url };
	return null;
}

export interface ExtractedIdentifiers {
	doi: string[];
	pmid: string[];
	pmcid: string[];
	arxiv: string[];
	url: string[];
}

const MAX_EXTRACTED = 64;

function pushUnique(list: string[], value: string | null): void {
	if (value && !list.includes(value) && list.length < MAX_EXTRACTED) list.push(value);
}

/** 从一段正文中抽取所有可识别的标识（每类最多 64 个，按出现顺序去重）。 */
export function extractIdentifiers(text: unknown): ExtractedIdentifiers {
	const body = typeof text === "string" ? text.slice(0, 2_000_000) : "";
	const out: ExtractedIdentifiers = { doi: [], pmid: [], pmcid: [], arxiv: [], url: [] };
	for (const match of body.matchAll(/\b10\.\d{4,9}\/[^\s"'<>()[\]{}]+/g)) pushUnique(out.doi, normalizeDoi(match[0]));
	for (const match of body.matchAll(/\bPMID\s*:?\s*(\d{1,9})\b/gi)) pushUnique(out.pmid, normalizePmid(match[1]));
	for (const match of body.matchAll(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})/gi))
		pushUnique(out.pmid, normalizePmid(match[1]));
	for (const match of body.matchAll(/\bPMC\d{1,10}\b/gi)) pushUnique(out.pmcid, normalizePmcid(match[0]));
	for (const match of body.matchAll(/\barXiv\s*:\s*([a-z.-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/gi))
		pushUnique(out.arxiv, normalizeArxiv(match[1]));
	for (const match of body.matchAll(/arxiv\.org\/(?:abs|pdf)\/([a-z.-]+\/\d{7}|\d{4}\.\d{4,5})/gi))
		pushUnique(out.arxiv, normalizeArxiv(match[1]));
	for (const match of body.matchAll(/https?:\/\/[^\s"'<>()[\]{}]+/gi)) {
		const raw = match[0].replace(TRAILING_PUNCTUATION, "");
		if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(raw)) continue;
		pushUnique(out.url, normalizeUrl(raw));
	}
	return out;
}

/** 规范化一个 identity 对象：未知字段丢弃，无效值丢弃。 */
export function normalizeIdentity(input: unknown): KnowledgeIdentity {
	if (!input || typeof input !== "object" || Array.isArray(input)) return {};
	const source = input as Record<string, unknown>;
	const out: KnowledgeIdentity = {};
	const doi = normalizeDoi(source.doi);
	if (doi) out.doi = doi;
	const pmid = normalizePmid(source.pmid);
	if (pmid) out.pmid = pmid;
	const pmcid = normalizePmcid(source.pmcid);
	if (pmcid) out.pmcid = pmcid;
	const arxiv = normalizeArxiv(source.arxiv);
	if (arxiv) out.arxiv = arxiv;
	const isbn = normalizeIsbn(source.isbn);
	if (isbn) out.isbn = isbn;
	const zotero = normalizeZoteroKey(source.zotero_key ?? source.zoteroKey);
	if (zotero) out.zotero_key = zotero;
	const url = normalizeUrl(source.url);
	if (url) out.url = url;
	return out;
}

/** 从来源字符串列表推导 identity：每类取第一个。 */
export function identityFromReferences(references: readonly unknown[]): KnowledgeIdentity {
	const out: KnowledgeIdentity = {};
	for (const reference of references.slice(0, 256)) {
		const found = identifyReference(reference);
		if (found && !out[found.field]) out[found.field] = found.value;
	}
	return out;
}

/** 标题去重键：NFKC、小写、只保留字母数字（含中文），空白折叠。 */
export function normalizeTitleKey(title: unknown): string {
	return clean(title, 4000)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ")
		.slice(0, 300);
}

/**
 * 去重键，按可信度从高到低排列：`doi:` > `pmid:` > `pmcid:` > `arxiv:` > `isbn:` > `zotero:` > `url:` >
 * `title:<type>:`。第一个是主键；任一键相同即视为同一对象。
 */
export function identityKeys(
	identity: KnowledgeIdentity,
	options: { type?: string | null; title?: string | null } = {},
): string[] {
	const normalized = normalizeIdentity(identity);
	const keys: string[] = [];
	if (normalized.doi) keys.push(`doi:${normalized.doi}`);
	if (normalized.pmid) keys.push(`pmid:${normalized.pmid}`);
	if (normalized.pmcid) keys.push(`pmcid:${normalized.pmcid}`);
	if (normalized.arxiv) keys.push(`arxiv:${normalized.arxiv}`);
	if (normalized.isbn) keys.push(`isbn:${normalized.isbn}`);
	if (normalized.zotero_key) keys.push(`zotero:${normalized.zotero_key}`);
	if (normalized.url) keys.push(`url:${normalized.url}`);
	const title = normalizeTitleKey(options.title);
	if (title) keys.push(`title:${String(options.type || "note").toLowerCase()}:${title}`);
	return keys;
}

/** 两个对象是否同一（任一去重键相同）。 */
export function sameIdentity(
	a: { identity?: KnowledgeIdentity; type?: string | null; title?: string | null },
	b: { identity?: KnowledgeIdentity; type?: string | null; title?: string | null },
): boolean {
	const left = new Set(identityKeys(a.identity ?? {}, a));
	return identityKeys(b.identity ?? {}, b).some((key) => left.has(key));
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** 去掉开头 frontmatter 块（`---` … `---`/`...`），返回正文。 */
export function stripFrontmatter(text: string): string {
	const source = String(text ?? "").replace(/^\uFEFF/, "");
	const open = source.match(/^---[ \t]*\r?\n/);
	if (!open) return source;
	const start = open[0].length;
	const end = source.slice(start).search(/^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m);
	if (end < 0) return source;
	const rest = source.slice(start + end);
	return rest.replace(/^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, "");
}

/**
 * 正文内容哈希（`content_sha256`）：去掉 frontmatter、换行统一为 LF、去掉行尾空白与首尾空行后取 sha256。
 * 只改 frontmatter 或换行风格不会改变哈希。
 */
export function contentHash(text: string): string {
	const body = stripFrontmatter(text)
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t]+$/, ""))
		.join("\n")
		.replace(/^\n+|\n+$/g, "");
	return sha256(body.normalize("NFC"));
}

export interface ClaimHashInput {
	subject?: unknown;
	predicate?: unknown;
	value?: unknown;
	organism?: unknown;
	tissue?: unknown;
	stage?: unknown;
	method?: unknown;
	sourceHash?: unknown;
}

/** 结论去重键：主语、谓词、取值、条件（物种/组织/阶段/方法）与来源哈希规范化后取 sha256。 */
export function claimHash(claim: ClaimHashInput): string {
	const fields = [
		claim.subject,
		claim.predicate,
		claim.value,
		claim.organism,
		claim.tissue,
		claim.stage,
		claim.method,
	].map((value) => clean(value, 4000).toLowerCase().replace(/\s+/g, " "));
	const source = clean(claim.sourceHash, 128).toLowerCase();
	return sha256([...fields, source].join("\u001f"));
}
