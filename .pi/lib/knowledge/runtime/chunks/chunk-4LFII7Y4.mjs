// @ts-nocheck
// packages/knowledge/src/ingest-identity.ts
import { createHash } from "node:crypto";
var IDENTITY_FIELDS = ["doi", "pmid", "pmcid", "arxiv", "isbn", "zotero_key", "url"];
function clean(value, max = 2048) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).normalize("NFKC").trim();
  return text.length > max ? "" : text;
}
function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
var TRAILING_PUNCTUATION = /[.,;:)\]}>"'。，；：）】」』]+$/u;
function normalizeDoi(input) {
  let text = clean(input);
  if (!text) return null;
  text = text.replace(/^doi\s*:\s*/i, "");
  text = text.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  text = safeDecode(text).trim();
  text = text.replace(TRAILING_PUNCTUATION, "");
  if (!/^10\.\d{4,9}\/\S+$/.test(text)) return null;
  return text.toLowerCase();
}
function normalizePmid(input) {
  let text = clean(input, 256);
  if (!text) return null;
  const url = text.match(/^https?:\/\/(?:www\.)?(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d+)\/?$/i);
  if (url) text = url[1] ?? "";
  text = text.replace(/^pmid\s*:?\s*/i, "");
  if (!/^\d{1,9}$/.test(text)) return null;
  const digits = text.replace(/^0+/, "");
  return digits ? digits : null;
}
function normalizePmcid(input) {
  let text = clean(input, 256);
  if (!text) return null;
  const url = text.match(/\/pmc\/articles\/(PMC\d+)\/?/i) ?? text.match(/^https?:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\/(PMC\d+)\/?$/i);
  if (url) text = url[1] ?? "";
  text = text.replace(/^pmcid\s*:?\s*/i, "");
  const match = text.match(/^(?:PMC)?(\d{1,10})$/i);
  if (!match || !/^pmc/i.test(text)) return null;
  return `PMC${match[1]}`;
}
function normalizeArxiv(input) {
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
function isbn10Valid(digits) {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const char = digits[i] ?? "";
    const value = char === "X" ? 10 : Number(char);
    if (Number.isNaN(value) || char === "X" && i !== 9) return false;
    sum += value * (10 - i);
  }
  return sum % 11 === 0;
}
function isbn13Check(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - sum % 10) % 10;
}
function normalizeIsbn(input) {
  const text = clean(input, 64).replace(/^isbn(?:-1[03])?\s*:?\s*/i, "").replace(/[\s-]/g, "").toUpperCase();
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
function normalizeZoteroKey(input) {
  const text = clean(input, 32);
  return /^[A-Za-z0-9]{8}$/.test(text) ? text : null;
}
var TRACKING_PARAMS = /^(?:utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|spm|ref_src)$/i;
function normalizeUrl(input) {
  const text = clean(input);
  if (!text) return null;
  let url;
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
  const params = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAMS.test(key)).sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "/") path = "";
  return `https://${host}${port}${path}${query}`;
}
function identifyReference(input) {
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
var MAX_EXTRACTED = 64;
function pushUnique(list, value) {
  if (value && !list.includes(value) && list.length < MAX_EXTRACTED) list.push(value);
}
function extractIdentifiers(text) {
  const body = typeof text === "string" ? text.slice(0, 2e6) : "";
  const out = { doi: [], pmid: [], pmcid: [], arxiv: [], url: [] };
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
function normalizeIdentity(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input;
  const out = {};
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
function identityFromReferences(references) {
  const out = {};
  for (const reference of references.slice(0, 256)) {
    const found = identifyReference(reference);
    if (found && !out[found.field]) out[found.field] = found.value;
  }
  return out;
}
function normalizeTitleKey(title) {
  return clean(title, 4e3).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ").slice(0, 300);
}
function identityKeys(identity, options = {}) {
  const normalized = normalizeIdentity(identity);
  const keys = [];
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
function sameIdentity(a, b) {
  const left = new Set(identityKeys(a.identity ?? {}, a));
  return identityKeys(b.identity ?? {}, b).some((key) => left.has(key));
}
var sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
function stripFrontmatter(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const open = source.match(/^---[ \t]*\r?\n/);
  if (!open) return source;
  const start = open[0].length;
  const end = source.slice(start).search(/^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m);
  if (end < 0) return source;
  const rest = source.slice(start + end);
  return rest.replace(/^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, "");
}
function contentHash(text) {
  const body = stripFrontmatter(text).replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/, "")).join("\n").replace(/^\n+|\n+$/g, "");
  return sha256(body.normalize("NFC"));
}
function claimHash(claim) {
  const fields = [
    claim.subject,
    claim.predicate,
    claim.value,
    claim.organism,
    claim.tissue,
    claim.stage,
    claim.method
  ].map((value) => clean(value, 4e3).toLowerCase().replace(/\s+/g, " "));
  const source = clean(claim.sourceHash, 128).toLowerCase();
  return sha256([...fields, source].join(""));
}

export {
  IDENTITY_FIELDS,
  normalizeDoi,
  normalizePmid,
  normalizePmcid,
  normalizeArxiv,
  normalizeIsbn,
  normalizeZoteroKey,
  normalizeUrl,
  identifyReference,
  extractIdentifiers,
  normalizeIdentity,
  identityFromReferences,
  normalizeTitleKey,
  identityKeys,
  sameIdentity,
  stripFrontmatter,
  contentHash,
  claimHash
};
