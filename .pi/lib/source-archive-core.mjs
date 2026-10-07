// packages/research/src/source-archive.ts
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename as basename2, dirname, extname, isAbsolute as isAbsolute2, join, relative as relative2, resolve as resolve2, sep as sep2 } from "node:path";

// packages/research/src/literature-receipt.ts
function normalizeDoi(value) {
  const doi = String(value || "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

// packages/research/src/open-access.ts
var OA_SOURCES = Object.freeze([
  "europepmc",
  "pmc-cloud",
  "unpaywall",
  "openalex",
  "semanticscholar",
  "crossref"
]);
var PMC_CLOUD_BASE = "https://pmc-oa-opendata.s3.amazonaws.com";
var PMC_CLOUD_MAX_VERSIONS = 3;
var OA_DEFAULT_TIMEOUT_MS = 12e3;
var OA_MAX_CANDIDATES = 8;
var DEFAULT_EMAIL_ENV = ["DRONE_CONTACT_EMAIL", "UNPAYWALL_EMAIL"];
function normalizePmcid(value) {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/^(?:PMC)?(\d{1,9})$/);
  return match ? `PMC${match[1]}` : null;
}
function normalizePmid(value) {
  const raw = String(value || "").trim();
  return /^\d{1,9}$/.test(raw) ? raw : null;
}
function contactEmail(explicit, env = process.env) {
  const candidates = [explicit, ...DEFAULT_EMAIL_ENV.map((key) => env[key])];
  for (const value of candidates) {
    const email = String(value || "").trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  }
  return null;
}
var httpsUrl = (value) => {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol === "ftp:") return null;
    return url.href;
  } catch {
    return null;
  }
};
var pmcCloudHttps = (value) => {
  const text = String(value || "").trim();
  if (/^s3:\/\/pmc-oa-opendata\//i.test(text))
    return `${PMC_CLOUD_BASE}/${text.replace(/^s3:\/\/pmc-oa-opendata\//i, "")}`;
  return text.startsWith(`${PMC_CLOUD_BASE}/`) ? text : null;
};
async function fetchJson(fetchImpl, url, {
  timeoutMs,
  signal,
  accept = "application/json"
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept },
      redirect: "follow"
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, detail: `HTTP ${response.status}` };
    if (accept === "application/json") {
      try {
        return { ok: true, status: response.status, body: JSON.parse(text) };
      } catch {
        return { ok: false, status: response.status, detail: "invalid JSON" };
      }
    }
    return { ok: true, status: response.status, body: text };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "fetch failed";
    return {
      ok: false,
      status: 0,
      detail: error instanceof Error && error.name === "AbortError" ? "timeout" : detail
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
function makeCollector(limit) {
  const seen = /* @__PURE__ */ new Set();
  const candidates = [];
  return {
    candidates,
    add(candidate) {
      const url = httpsUrl(candidate?.url);
      if (!url || seen.has(url) || candidates.length >= limit) return false;
      seen.add(url);
      candidates.push({
        url,
        source: candidate.source || "unknown",
        kind: candidate.kind || "pdf",
        license: candidate.license || null,
        version: candidate.version || null,
        hostType: candidate.hostType || null,
        note: candidate.note || null
      });
      return true;
    }
  };
}
async function resolveOpenAccess({
  doi,
  pmcid,
  pmid,
  email,
  fetchImpl = globalThis.fetch,
  timeoutMs = OA_DEFAULT_TIMEOUT_MS,
  signal,
  sources = OA_SOURCES,
  maxCandidates = OA_MAX_CANDIDATES,
  env = process.env
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const identity = { doi: normalizeDoi(doi), pmcid: normalizePmcid(pmcid), pmid: normalizePmid(pmid) };
  if (!identity.doi && !identity.pmcid && !identity.pmid)
    throw new Error("open-access resolution needs a DOI, PMCID or PMID");
  const enabled = new Set(sources);
  const mail = contactEmail(email, env);
  const collector = makeCollector(maxCandidates);
  const queried = [];
  const meta = { oaStatus: null, license: null, title: null };
  const note = (source, status, detail) => queried.push({ source, status, detail: detail || null });
  const opts = { timeoutMs, signal };
  let epmc = null;
  if (enabled.has("europepmc")) {
    const query = identity.doi ? `DOI:"${identity.doi}"` : identity.pmcid ? `PMCID:${identity.pmcid}` : `EXT_ID:${identity.pmid} AND SRC:MED`;
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=lite&pageSize=5`;
    const result = await fetchJson(fetchImpl, url, opts);
    if (!result.ok) note("europepmc", "error", result.detail);
    else {
      const hits = Array.isArray(result.body?.resultList?.result) ? result.body.resultList.result : [];
      const hit = hits.find((h) => identity.doi && normalizeDoi(h.doi) === identity.doi) || hits.find((h) => identity.pmcid && normalizePmcid(h.pmcid) === identity.pmcid) || hits.find((h) => identity.pmid && normalizePmid(h.pmid) === identity.pmid) || null;
      if (!hit) note("europepmc", "ok", "no record");
      else {
        identity.pmcid = identity.pmcid || normalizePmcid(hit.pmcid);
        identity.pmid = identity.pmid || normalizePmid(hit.pmid);
        identity.doi = identity.doi || normalizeDoi(hit.doi);
        meta.title = hit.title || null;
        epmc = { isOa: hit.isOpenAccess === "Y", inEpmc: hit.inEPMC === "Y" };
        note(
          "europepmc",
          "ok",
          `${identity.pmcid || "no PMCID"}; isOpenAccess=${hit.isOpenAccess || "?"}; inEPMC=${hit.inEPMC || "?"}; hasPDF=${hit.hasPDF || "?"}`
        );
      }
    }
  }
  let pmcCloudQueried = null;
  const pmcCloud = async () => {
    if (!enabled.has("pmc-cloud") || !identity.pmcid || pmcCloudQueried === identity.pmcid) return;
    pmcCloudQueried = identity.pmcid;
    const versions = [];
    let errors = 0;
    for (let v = 1; v <= PMC_CLOUD_MAX_VERSIONS; v += 1) {
      const url = `${PMC_CLOUD_BASE}/metadata/${identity.pmcid}.${v}.json`;
      const result = await fetchJson(fetchImpl, url, opts);
      if (!result.ok) {
        if (result.status !== 404 && result.status !== 403) errors += 1;
        continue;
      }
      const record = result.body || {};
      versions.push({
        version: v,
        manuscript: record.is_manuscript === true,
        openAccess: record.is_pmc_openaccess === true,
        license: record.license_code || null,
        pdf: pmcCloudHttps(record.pdf_url),
        doi: normalizeDoi(record.doi)
      });
    }
    if (!versions.length) {
      note(
        "pmc-cloud",
        errors ? "error" : "ok",
        errors ? `${errors} metadata request(s) failed` : "not in PMC article datasets"
      );
      return;
    }
    versions.sort((a, b) => Number(a.manuscript) - Number(b.manuscript) || a.version - b.version);
    let added = 0;
    for (const record of versions) {
      if (identity.doi && record.doi && record.doi !== identity.doi) continue;
      if (record.pdf && collector.add({
        url: record.pdf,
        source: "pmc-cloud",
        kind: "pdf",
        license: record.license,
        version: record.manuscript ? "acceptedVersion" : "publishedVersion",
        hostType: "repository",
        note: `PMC article datasets v${record.version}`
      }))
        added += 1;
      meta.license = meta.license || record.license;
    }
    note("pmc-cloud", "ok", `${versions.length} version(s); ${added} pdf link(s)`);
  };
  await pmcCloud();
  if (enabled.has("europepmc") && identity.pmcid && epmc && (epmc.isOa || epmc.inEpmc)) {
    collector.add({
      url: `https://europepmc.org/articles/${identity.pmcid}?pdf=render`,
      source: "europepmc",
      kind: "pdf",
      license: epmc.isOa ? "open-access" : null,
      note: "Europe PMC rendered PDF"
    });
    collector.add({
      url: `https://europepmc.org/backend/ptpmcrender.fcgi?accid=${identity.pmcid}&blobtype=pdf`,
      source: "europepmc",
      kind: "pdf",
      license: epmc.isOa ? "open-access" : null,
      note: "Europe PMC render backend"
    });
  }
  if (enabled.has("unpaywall") && identity.doi) {
    if (!mail) note("unpaywall", "skipped", "no contact email (set DRONE_CONTACT_EMAIL)");
    else {
      const url = `https://api.unpaywall.org/v2/${encodeURIComponent(identity.doi)}?email=${encodeURIComponent(mail)}`;
      const result = await fetchJson(fetchImpl, url, opts);
      if (!result.ok) note("unpaywall", result.status === 404 ? "ok" : "error", result.detail);
      else {
        const body = result.body || {};
        meta.oaStatus = body.oa_status || meta.oaStatus;
        const locations = [
          body.best_oa_location,
          ...Array.isArray(body.oa_locations) ? body.oa_locations : []
        ].filter(Boolean);
        let added = 0;
        for (const loc of locations) {
          if (collector.add({
            url: loc.url_for_pdf,
            source: "unpaywall",
            kind: "pdf",
            license: loc.license || null,
            version: loc.version || null,
            hostType: loc.host_type || null
          }))
            added += 1;
          meta.license = meta.license || loc.license || null;
        }
        note(
          "unpaywall",
          "ok",
          `is_oa=${body.is_oa === true}; oa_status=${body.oa_status || "?"}; ${added} pdf link(s)`
        );
      }
    }
  }
  if (enabled.has("openalex") && identity.doi) {
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(identity.doi)}${mail ? `?mailto=${encodeURIComponent(mail)}` : ""}`;
    const result = await fetchJson(fetchImpl, url, opts);
    if (!result.ok) note("openalex", result.status === 404 ? "ok" : "error", result.detail);
    else {
      const work = result.body || {};
      meta.oaStatus = meta.oaStatus || work.open_access?.oa_status || null;
      const locations = [
        work.best_oa_location,
        ...Array.isArray(work.locations) ? work.locations : []
      ].filter((loc) => loc && loc.is_oa !== false);
      let added = 0;
      for (const loc of locations) {
        if (collector.add({
          url: loc.pdf_url,
          source: "openalex",
          kind: "pdf",
          license: loc.license || null,
          version: loc.version || null,
          hostType: loc.source?.type || null
        }))
          added += 1;
      }
      if (identity.pmcid == null && work.ids?.pmcid)
        identity.pmcid = normalizePmcid(String(work.ids.pmcid).split("/").pop());
      note("openalex", "ok", `is_oa=${work.open_access?.is_oa === true}; ${added} pdf link(s)`);
    }
  }
  if (enabled.has("semanticscholar") && identity.doi) {
    const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(identity.doi)}?fields=openAccessPdf,externalIds,isOpenAccess`;
    const result = await fetchJson(fetchImpl, url, opts);
    if (!result.ok) note("semanticscholar", result.status === 404 ? "ok" : "error", result.detail);
    else {
      const paper = result.body || {};
      const added = collector.add({
        url: paper.openAccessPdf?.url,
        source: "semanticscholar",
        kind: "pdf",
        license: paper.openAccessPdf?.license || null,
        note: paper.openAccessPdf?.status || null
      });
      if (!identity.pmcid && paper.externalIds?.PubMedCentral)
        identity.pmcid = normalizePmcid(paper.externalIds.PubMedCentral);
      const arxiv = paper.externalIds?.ArXiv;
      if (arxiv && /^[0-9]{4}\.[0-9]{4,5}(v\d+)?$/.test(String(arxiv)))
        collector.add({
          url: `https://arxiv.org/pdf/${arxiv}`,
          source: "semanticscholar",
          kind: "pdf",
          note: "arXiv"
        });
      note(
        "semanticscholar",
        "ok",
        `isOpenAccess=${paper.isOpenAccess === true}; ${added ? 1 : 0} pdf link(s)`
      );
    }
  }
  if (enabled.has("crossref") && identity.doi) {
    const url = `https://api.crossref.org/works/${encodeURIComponent(identity.doi)}${mail ? `?mailto=${encodeURIComponent(mail)}` : ""}`;
    const result = await fetchJson(fetchImpl, url, opts);
    if (!result.ok) note("crossref", result.status === 404 ? "ok" : "error", result.detail);
    else {
      const message = result.body?.message || {};
      let added = 0;
      for (const link of Array.isArray(message.link) ? message.link : []) {
        if (String(link["content-type"] || "").toLowerCase() !== "application/pdf") continue;
        if (collector.add({
          url: link.URL,
          source: "crossref",
          kind: "pdf",
          license: Array.isArray(message.license) ? message.license[0]?.URL || null : null,
          note: link["intended-application"] || null
        }))
          added += 1;
      }
      note("crossref", "ok", `${added} publisher pdf link(s)`);
    }
  }
  await pmcCloud();
  return {
    ...identity,
    title: meta.title,
    oaStatus: meta.oaStatus,
    license: meta.license,
    candidates: collector.candidates,
    queried
  };
}

// packages/research/src/source-archive-policy.ts
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
var SOURCE_CATEGORIES = ["papers", "supplementary", "software", "manuals"];
var DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
var DEFAULT_TIMEOUT_MS = 3e4;
function isWithin(root, child) {
  const rel = relative(resolve(root), resolve(child));
  return rel === "" || !isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== ".." && !rel.includes(`..${sep}`);
}
function validateRunDir(resultsRoot, candidate) {
  const runDir = resolve(candidate);
  const rel = relative(resolve(resultsRoot), runDir);
  const parts = rel.split(sep);
  if (!rel || !isWithin(resultsRoot, runDir) || parts.length !== 2 || !parts[1]?.startsWith("run-"))
    throw new Error("run_dir must point to a run directory directly inside the configured results root");
  return runDir;
}
function safeFilename(input, fallback) {
  const value = String(input || "").trim();
  const candidate = [...basename(value)].map((char) => char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? "-" : char).join("").replace(/\s+/g, " ").trim();
  if (!candidate || candidate === "." || candidate === "..") return fallback;
  return candidate.slice(0, 180);
}
function looksLikeChallenge(status, contentType, sample) {
  if ([401, 403, 407, 429].includes(status)) return true;
  if (!contentType.toLowerCase().includes("text/html")) return false;
  return /cf-chl|cloudflare|captcha|verify you are human|access denied|sign in|log in|login required/i.test(
    sample
  );
}
function hasMagic(bytes) {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") return true;
  if (bytes.length >= 4 && bytes[0] === 80 && bytes[1] === 75 && (bytes[2] === 3 || bytes[2] === 5 || bytes[2] === 7))
    return true;
  return bytes.length >= 2 && bytes[0] === 31 && bytes[1] === 139;
}
function validateContent(category, contentType, filename, bytes) {
  const mime = contentType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const head = new TextDecoder().decode(bytes.subarray(0, 16));
  const executable = /\.(?:exe|dll|msi|com|bat|cmd|ps1|sh)$/i.test(filename) || /application\/(?:x-msdownload|x-dosexec)/.test(mime);
  if (executable) return { ok: false, reason: "executable content is not archived" };
  if (category === "papers" && !head.startsWith("%PDF-"))
    return { ok: false, reason: "papers must be PDF content" };
  if (category === "supplementary" && !(mime.includes("pdf") || mime.includes("zip") || mime.includes("gzip") || hasMagic(bytes)))
    return { ok: false, reason: "unsupported supplementary MIME or file signature" };
  if (category === "software" && mime === "text/html")
    return { ok: false, reason: "HTML is not a software archive" };
  if (category === "manuals" && !mime && !bytes.length) return { ok: false, reason: "empty manual content" };
  return { ok: true, mime };
}
function normalizeMetadata(metadata = {}) {
  const allowed = [
    "doi",
    "pmid",
    "pmcid",
    "commit",
    "version",
    "license",
    "title",
    "authors",
    "repository",
    "open_access"
  ];
  return Object.fromEntries(
    allowed.filter((key) => metadata[key] != null && String(metadata[key]).trim() !== "").map((key) => [key, metadata[key]])
  );
}

// packages/research/src/source-delivery.ts
function assessManualPage(bytes, contentType, url) {
  if (!/html/i.test(String(contentType || ""))) {
    return {
      status: "document-unassessed",
      complete: false,
      candidates: [],
      note: "Content completeness and version still need inspection."
    };
  }
  const html = new TextDecoder().decode(bytes).slice(0, 25e4);
  const text = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
  const flags = [...new Set(text.match(/(?:^|\s)-{1,2}[a-zA-Z][a-zA-Z0-9_-]{2,}/g) || [])];
  const candidates = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const href = match[1];
      const label = match[2];
      if (!href || label === void 0) continue;
      const resolved = new URL(href.replace(/&amp;/g, "&"), url);
      const base = new URL(url);
      resolved.hash = "";
      const title = label.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      if (resolved.origin !== base.origin || !/^https?:$/.test(resolved.protocol) || resolved.username || resolved.password || !/manual|option|command|parameter|usage|align|install|reference/i.test(
        `${title} ${resolved.pathname}`
      ) || resolved.href === base.href || candidates.some((candidate) => candidate.url === resolved.href))
        continue;
      candidates.push({ url: resolved.href, title });
      if (candidates.length >= 12) break;
    } catch {
    }
  }
  return {
    status: flags.length >= 5 ? "reference-page-only" : "landing-or-overview-page",
    complete: false,
    optionCount: flags.length,
    candidates,
    note: "Heuristic page classification, not a completeness or scientific verification result."
  };
}

// packages/research/src/source-archive.ts
function filenameFromResponse(response, url, category) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^;"]+)/i);
  let filename = match ? decodeURIComponent(match[1].trim()) : "";
  if (!filename) {
    try {
      filename = basename2(new URL(url).pathname);
    } catch {
    }
  }
  const fallback = `${category}-${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}.bin`;
  return safeFilename(filename, fallback);
}
async function atomicJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}
`, "utf8");
  await rename(temp, file);
}
async function withRunLock(ports, key, fn) {
  return ports.exclusive(key, fn);
}
async function readManifest(file, runDir) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items))
      throw new Error("invalid manifest");
    return parsed;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 1, run_dir: runDir, updated_at: null, items: [] };
  }
}
async function verifyManifestItems(manifest, runDir) {
  const downloaded = manifest.items.filter((entry) => entry?.status === "downloaded");
  if (downloaded.length === 0) return { ok: true, items: [] };
  let sourcesRoot;
  try {
    sourcesRoot = await realpath(join(runDir, "sources"));
  } catch {
    return {
      ok: false,
      items: downloaded.map((item) => ({
        id: item.id ?? null,
        path: item.path ?? item.local_path ?? null,
        ok: false,
        reason: "sources directory is missing"
      }))
    };
  }
  const items = [];
  for (const item of downloaded) {
    const path = typeof item.path === "string" ? item.path : typeof item.local_path === "string" ? item.local_path : "";
    if (!path) {
      items.push({ id: item.id ?? null, path: null, ok: false, reason: "missing manifest path" });
      continue;
    }
    try {
      const canonical = await realpath(isAbsolute2(path) ? path : resolve2(runDir, path));
      if (!isWithin(sourcesRoot, canonical)) throw new Error("path escapes run sources");
      const bytes = await readFile(canonical);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== String(item.sha256 || "").toLowerCase()) throw new Error("sha256 mismatch");
      if (item.size_bytes !== void 0 && Number(item.size_bytes) !== bytes.byteLength)
        throw new Error("size mismatch");
      items.push({ id: item.id ?? null, path: canonical, ok: true, sha256, size_bytes: bytes.byteLength });
    } catch (error) {
      items.push({ id: item.id ?? null, path, ok: false, reason: String(error?.message || error) });
    }
  }
  return { ok: items.every((item) => item.ok === true), items };
}
async function appendFailure(file, failure) {
  let original = "# Source download failures\n\n";
  try {
    original = await readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const lines = [
    `## ${failure.failed_at} \xB7 ${failure.category}`,
    `- URL: ${failure.url}`,
    `- Reason: ${failure.reason}`,
    `- Browser required: ${failure.browser_required ? "yes" : "no"}`
  ];
  if (failure.browser_handoff) lines.push(`- Browser handoff: ${failure.browser_handoff.url}`);
  if (failure.open_access) {
    const oa = failure.open_access;
    lines.push(
      `- Open access: ${oa.doi || oa.pmcid || "?"} \xB7 oa_status=${oa.oa_status || "unknown"} \xB7 sources=${(oa.queried || []).map((q) => `${q.source}:${q.status}`).join(",")}`
    );
    for (const attempt of oa.attempts || [])
      lines.push(`  - tried ${attempt.url} (${attempt.source}): ${attempt.reason}`);
    if (failure.manual_import) lines.push(`- Manual import: ${failure.manual_import.how}`);
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(temp, `${original.trimEnd()}

${lines.join("\n")}
`, "utf8");
  await rename(temp, file);
}
async function recordFailure(ports, manifestPath, failuresPath, runDir, failure) {
  return withRunLock(ports, manifestPath, async () => {
    const manifest = await readManifest(manifestPath, runDir);
    manifest.updated_at = failure.failed_at;
    manifest.failures = Array.isArray(manifest.failures) ? manifest.failures : [];
    manifest.failures.push(failure);
    await atomicJson(manifestPath, manifest);
    await appendFailure(failuresPath, failure);
  });
}
async function readBody(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new Error(`response exceeds max_bytes (${maxBytes})`);
  if (!response.body) {
    const array = new Uint8Array(await response.arrayBuffer());
    if (array.byteLength > maxBytes) throw new Error(`response exceeds max_bytes (${maxBytes})`);
    return array;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeds max_bytes (${maxBytes})`);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
async function archiveSource(options = {}, ports) {
  if (!ports) throw new Error("Source archive host ports are required");
  const {
    cwd = process.cwd(),
    run_dir,
    url,
    doi,
    pmcid,
    pmid,
    email,
    resolve_open_access,
    max_candidates = OA_MAX_CANDIDATES,
    category = "papers",
    filename,
    metadata,
    local_file,
    human_verified = false,
    content_type,
    max_bytes = DEFAULT_MAX_BYTES,
    timeout_ms = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    signal,
    env = process.env
  } = options;
  if (!SOURCE_CATEGORIES.includes(category))
    throw new Error(`category must be one of: ${SOURCE_CATEGORIES.join(", ")}`);
  const identity = {
    doi: normalizeDoi(doi || metadata?.doi),
    pmcid: normalizePmcid(pmcid || metadata?.pmcid),
    pmid: normalizePmid(pmid || metadata?.pmid)
  };
  const hasIdentity = Boolean(identity.doi || identity.pmcid || identity.pmid);
  if (url == null && !(category === "papers" && hasIdentity))
    throw new Error("url is required unless category is papers and a doi/pmcid/pmid is given");
  if (url != null && (typeof url !== "string" || !/^https?:\/\//i.test(url)))
    throw new Error("url must be an http(s) URL");
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const openAccessWanted = category === "papers" && hasIdentity && resolve_open_access !== false;
  const candidateLimit = Number(max_candidates);
  if (!Number.isInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > OA_MAX_CANDIDATES)
    throw new Error(`max_candidates must be between 1 and ${OA_MAX_CANDIDATES}`);
  const config = await ports.workspace(cwd);
  const runDir = validateRunDir(config.resultsRoot, resolve2(cwd, run_dir));
  await access(runDir);
  if (!isWithin(await realpath(config.resultsRoot), await realpath(runDir)))
    throw new Error("run_dir escapes results root through a link");
  const limit = Number(max_bytes);
  const timeout = Number(timeout_ms);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 * 1024 * 1024)
    throw new Error("max_bytes must be between 1 and 524288000");
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 10 * 60 * 1e3)
    throw new Error("timeout_ms must be between 100 and 600000");
  const sourcesDir = join(runDir, "sources", category);
  const manifestPath = join(runDir, "sources", "download-manifest.json");
  const failuresPath = join(runDir, "sources", "download-failures.md");
  await mkdir(sourcesDir, { recursive: true });
  if (!isWithin(await realpath(runDir), await realpath(sourcesDir)))
    throw new Error("sources directory escapes the run through a link");
  const persist = async (bytes, { resolvedUrl, contentType, outputName, verified = false, openAccess = null }) => withRunLock(ports, manifestPath, async () => {
    const validation = validateContent(category, contentType, outputName, bytes);
    if (!validation.ok) throw new Error(validation.reason);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    let outputPath = join(sourcesDir, outputName);
    if (!isWithin(sourcesDir, outputPath)) throw new Error("filename escapes source category directory");
    try {
      const existing = new Uint8Array(await readFile(outputPath));
      const existingHash = createHash("sha256").update(existing).digest("hex");
      if (existingHash !== sha256) {
        const extension = extname(outputName);
        const stem = outputName.slice(0, outputName.length - extension.length);
        outputPath = join(sourcesDir, `${stem}-${sha256.slice(0, 12)}${extension}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      const existing = await readFile(outputPath);
      if (createHash("sha256").update(existing).digest("hex") !== sha256)
        throw new Error("Archived version path has different content");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const temporary = `${outputPath}.${randomUUID()}.part`;
      await writeFile(temporary, bytes);
      await rename(temporary, outputPath);
    }
    const downloadedAt = (/* @__PURE__ */ new Date()).toISOString();
    const entry = {
      ...category === "manuals" ? { manualCoverage: assessManualPage(bytes, contentType, resolvedUrl) } : {},
      id: randomUUID(),
      status: "downloaded",
      category,
      // 仅凭 DOI 归档时没有调用方 URL：以实际取得文件的地址作为来源
      url: url ?? resolvedUrl,
      final_url: resolvedUrl,
      downloaded_at: downloadedAt,
      path: outputPath,
      local_path: outputPath,
      relative_path: relative2(cwd, outputPath).replaceAll(sep2, "/"),
      size_bytes: bytes.byteLength,
      sha256,
      content_type: contentType,
      human_verified: Boolean(verified),
      metadata: normalizeMetadata({
        ...identity,
        ...metadata || {},
        ...openAccess ? { open_access: openAccess } : {}
      })
    };
    const manifest = await readManifest(manifestPath, runDir);
    manifest.updated_at = downloadedAt;
    manifest.items = [...manifest.items, entry];
    await atomicJson(manifestPath, manifest);
    let knowledge;
    try {
      knowledge = await ports.publishSourceNote({ cwd, runDir, entry });
    } catch (error) {
      knowledge = { obsidian_note: null, knowledge_status: "failed", obsidian_error: error.message };
    }
    return {
      ...entry,
      ...knowledge,
      ...openAccess ? { open_access: openAccess } : {},
      manifest_path: manifestPath,
      manifestPath,
      failures_path: await access(failuresPath).then(
        () => failuresPath,
        () => null
      )
    };
  });
  if (local_file != null) {
    try {
      if (human_verified !== true) throw new Error("local_file imports require explicit human_verified=true");
      const downloadRoot = await realpath(resolve2(cwd, ".pi", "browser-downloads"));
      const canonical = await realpath(resolve2(cwd, local_file));
      if (!isWithin(downloadRoot, canonical))
        throw new Error("local_file must be inside .pi/browser-downloads");
      const bytes = new Uint8Array(await readFile(canonical));
      if (bytes.byteLength > limit) throw new Error(`local file exceeds max_bytes (${limit})`);
      const outputName = safeFilename(filename || basename2(canonical), `${category}-${randomUUID()}.bin`);
      return await persist(bytes, {
        resolvedUrl: url ?? (identity.doi ? `https://doi.org/${identity.doi}` : `file:${basename2(canonical)}`),
        contentType: content_type || metadata?.content_type || "application/octet-stream",
        outputName,
        verified: true
      });
    } catch (error) {
      const failure2 = {
        url,
        category,
        failed_at: (/* @__PURE__ */ new Date()).toISOString(),
        reason: error.message,
        browser_required: false,
        local_file
      };
      await recordFailure(ports, manifestPath, failuresPath, runDir, failure2);
      return { status: "failed", ...failure2, manifest_path: manifestPath, failures_path: failuresPath };
    }
  }
  const handoff = (target) => ({
    url: target,
    action: "Open this URL in Computer Use browser, complete verification manually, then retry archive"
  });
  async function attemptDownload(target) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetchImpl(target, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          accept: "application/pdf,application/zip,application/octet-stream,text/plain,text/markdown,text/html;q=0.8,*/*;q=0.1"
        }
      });
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      if (looksLikeChallenge(response.status, contentType, ""))
        return {
          kind: "challenge",
          reason: `HTTP ${response.status} requires browser verification or login`
        };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await readBody(response, limit);
      const resolvedUrl = response.url || target;
      const sample = contentType.includes("text/html") ? new TextDecoder().decode(bytes.subarray(0, 8192)) : "";
      if (looksLikeChallenge(response.status, contentType, sample))
        return { kind: "challenge", reason: "Response requires browser verification or login" };
      return { kind: "ok", bytes, resolvedUrl, contentType, response };
    } catch (error) {
      const browserRequired = error.name === "AbortError" ? false : /HTTP (401|403|407|429)|cloudflare|captcha|login|required/i.test(error.message);
      return {
        kind: "error",
        reason: error.name === "AbortError" && signal?.aborted ? "aborted" : error.message,
        browserRequired
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  const failureFor = (target, attempt) => ({
    url: target,
    category,
    failed_at: (/* @__PURE__ */ new Date()).toISOString(),
    reason: attempt.reason,
    browser_required: attempt.kind === "challenge" || attempt.browserRequired === true,
    ...attempt.kind === "challenge" || attempt.browserRequired ? { browser_handoff: handoff(target) } : {}
  });
  const legacyFailure = async (failure2) => {
    await recordFailure(ports, manifestPath, failuresPath, runDir, failure2);
    return {
      status: failure2.browser_required ? "browser_required" : "failed",
      ...failure2,
      manifest_path: manifestPath,
      failures_path: failuresPath
    };
  };
  const attempts = [];
  if (url != null) {
    const attempt = await attemptDownload(url);
    let failure2 = null;
    if (attempt.kind === "ok") {
      const outputName = safeFilename(
        filename || filenameFromResponse(attempt.response, attempt.resolvedUrl, category),
        `${category}-${randomUUID()}.bin`
      );
      try {
        return await persist(attempt.bytes, {
          resolvedUrl: attempt.resolvedUrl,
          contentType: attempt.contentType,
          outputName
        });
      } catch (error) {
        failure2 = failureFor(url, {
          kind: "error",
          reason: error.message,
          browserRequired: /HTTP (401|403|407|429)|cloudflare|captcha|login|required/i.test(error.message)
        });
      }
    } else failure2 = failureFor(url, attempt);
    if (!openAccessWanted) return legacyFailure(failure2);
    attempts.push({
      url,
      source: "given",
      reason: failure2.reason,
      browser_required: failure2.browser_required
    });
  }
  let resolution;
  try {
    resolution = await resolveOpenAccess({
      ...identity,
      email,
      fetchImpl,
      signal,
      env,
      timeoutMs: Math.min(timeout, 15e3),
      maxCandidates: candidateLimit
    });
  } catch (error) {
    resolution = {
      ...identity,
      candidates: [],
      queried: [{ source: "resolver", status: "error", detail: error.message }]
    };
  }
  for (const key of ["doi", "pmcid", "pmid"]) identity[key] = identity[key] || resolution[key] || null;
  for (const candidate of resolution.candidates.slice(0, candidateLimit)) {
    if (signal?.aborted) break;
    const attempt = await attemptDownload(candidate.url);
    if (attempt.kind !== "ok") {
      attempts.push({
        url: candidate.url,
        source: candidate.source,
        reason: attempt.reason,
        browser_required: attempt.kind === "challenge" || attempt.browserRequired === true
      });
      continue;
    }
    const outputName = safeFilename(
      filename || filenameFromResponse(attempt.response, attempt.resolvedUrl, category),
      `${category}-${randomUUID()}.bin`
    );
    try {
      return await persist(attempt.bytes, {
        resolvedUrl: attempt.resolvedUrl,
        contentType: attempt.contentType,
        outputName: /\.pdf$/i.test(outputName) ? outputName : `${outputName.replace(/\.[a-z0-9]{1,5}$/i, "")}.pdf`,
        openAccess: {
          source: candidate.source,
          url: candidate.url,
          license: candidate.license || resolution.license || null,
          version: candidate.version || null,
          oa_status: resolution.oaStatus || null,
          candidates_tried: attempts.length + 1
        }
      });
    } catch (error) {
      attempts.push({
        url: candidate.url,
        source: candidate.source,
        reason: error.message,
        browser_required: false
      });
    }
  }
  const _institutionalResult = null;
  let institutionalConfig = null;
  try {
    institutionalConfig = await ports.loadInstitutionalConfig?.() || null;
  } catch {
    institutionalConfig = null;
  }
  const institutionalEnabled = institutionalConfig?.autoDownloadEnabled !== false && institutionalConfig?.configured;
  if (institutionalEnabled && (ports.isElectronAvailable?.() ?? false) && ports.institutionalFetch) {
    const limit2 = institutionalConfig?.perTaskLimit ?? 20;
    let used = 0;
    try {
      const manifest = await readManifest(manifestPath, runDir);
      used = manifest.items.filter((it) => it.open_access?.source === "institutional").length;
    } catch {
      used = 0;
    }
    if (used >= limit2) {
      const failureLimit = {
        url: url || `https://doi.org/${identity.doi || ""}`.replace(/\/$/, ""),
        category,
        failed_at: (/* @__PURE__ */ new Date()).toISOString(),
        reason: `institutional limit reached: ${used}/${limit2} files already fetched via institutional access in this run`,
        browser_required: false,
        open_access: {
          doi: identity.doi,
          pmcid: resolution.pmcid || identity.pmcid,
          pmid: resolution.pmid || identity.pmid,
          oa_status: resolution.oaStatus || null,
          license: resolution.license || null,
          queried: resolution.queried,
          attempts
        },
        institutional: {
          limit: limit2,
          used,
          status: "limit_reached"
        }
      };
      await recordFailure(ports, manifestPath, failuresPath, runDir, failureLimit);
      return {
        status: "institutional_limit_reached",
        ...failureLimit,
        manifest_path: manifestPath,
        failures_path: failuresPath
      };
    }
    const candidates = [];
    const originalForProxy = url || (identity.doi ? `https://doi.org/${identity.doi}` : null);
    const urlsToTry = [];
    if (originalForProxy) urlsToTry.push(originalForProxy);
    for (const c of resolution.candidates.slice(0, candidateLimit)) {
      if (c.url && !urlsToTry.includes(c.url)) urlsToTry.push(c.url);
    }
    if (identity.doi) {
      const doiUrl = `https://doi.org/${identity.doi}`;
      if (!urlsToTry.includes(doiUrl)) urlsToTry.push(doiUrl);
    }
    for (const u of urlsToTry) {
      const proxied = institutionalConfig.ezproxyTemplate && ports.buildProxiedUrl ? ports.buildProxiedUrl(u, String(institutionalConfig.ezproxyTemplate)) : null;
      if (proxied) candidates.push({ url: proxied, via: "ezproxy", original: u });
      candidates.push({ url: u, via: "institutional_session", original: u });
    }
    for (const cand of candidates) {
      if (signal?.aborted) break;
      try {
        const inst = await ports.institutionalFetch(cand.url, { timeoutMs: Math.min(timeout, 2e4) });
        if (inst.status >= 200 && inst.status < 400) {
          const ct = inst.headers?.["content-type"] || "";
          const _isPdf = ct.includes("pdf") || cand.url.toLowerCase().includes(".pdf");
          const isHtmlLogin = ct.includes("text/html") && inst.body?.byteLength < 1e5 && (() => {
            try {
              const snippet = new TextDecoder().decode(inst.body.slice(0, 4e3)).toLowerCase();
              return snippet.includes("shibboleth") || snippet.includes("login") && snippet.includes("password") || snippet.includes("openathens") && snippet.includes("sign in") || snippet.includes("ezproxy") && snippet.includes("login");
            } catch {
              return false;
            }
          })();
          if (isHtmlLogin) {
            attempts.push({
              url: cand.url,
              source: cand.via === "ezproxy" ? "ezproxy" : "institutional_session",
              reason: `institutional auth required (login page detected at ${cand.url.slice(0, 120)})`,
              browser_required: true
            });
            continue;
          }
          const outputName = safeFilename(
            filename || filenameFromResponse(
              { headers: { get: (k) => inst.headers[k.toLowerCase()] || "" } },
              inst.finalUrl,
              category
            ),
            `${category}-${randomUUID()}.bin`
          );
          try {
            return await persist(inst.body, {
              resolvedUrl: inst.finalUrl,
              contentType: ct || "application/pdf",
              outputName: /\.pdf$/i.test(outputName) ? outputName : `${outputName.replace(/\.[a-z0-9]{1,5}$/i, "")}.pdf`,
              openAccess: {
                source: "institutional",
                url: cand.url,
                original_url: cand.original,
                via: cand.via,
                candidates_tried: attempts.length + 1
              }
            });
          } catch (error) {
            attempts.push({
              url: cand.url,
              source: cand.via === "ezproxy" ? "ezproxy" : "institutional_session",
              reason: error.message,
              browser_required: false
            });
          }
        }
      } catch (error) {
        attempts.push({
          url: cand.url,
          source: cand.via === "ezproxy" ? "ezproxy" : "institutional_session",
          reason: error.message,
          browser_required: /HTTP (401|403|407|429)|login|auth|shibboleth|captcha/i.test(error.message)
        });
      }
    }
  }
  const challenged = attempts.find((a) => a.browser_required);
  const label = identity.doi ? `doi:${identity.doi}` : identity.pmcid || `pmid:${identity.pmid}`;
  const institutionalAttempt = attempts.find(
    (a) => a.source === "ezproxy" || a.source === "institutional_session"
  );
  const failure = {
    url: url || `https://doi.org/${identity.doi || ""}`.replace(/\/$/, ""),
    category,
    failed_at: (/* @__PURE__ */ new Date()).toISOString(),
    reason: resolution.candidates.length ? `no open-access PDF could be archived for ${label}: ${attempts.length} candidate(s) failed` : `no open-access location found for ${label} (${resolution.queried.map((q) => `${q.source}:${q.status}`).join(", ") || "no source answered"})`,
    browser_required: Boolean(challenged),
    ...challenged ? { browser_handoff: handoff(challenged.url) } : {},
    open_access: {
      doi: identity.doi,
      pmcid: resolution.pmcid || identity.pmcid,
      pmid: resolution.pmid || identity.pmid,
      oa_status: resolution.oaStatus || null,
      license: resolution.license || null,
      queried: resolution.queried,
      attempts
    },
    institutional: institutionalConfig ? {
      configured: Boolean(institutionalConfig.configured),
      auto_enabled: institutionalConfig.autoDownloadEnabled,
      ezproxy_template: institutionalConfig.ezproxyTemplate ? "set" : "not_set",
      attempted: Boolean(institutionalAttempt),
      last_login_at: institutionalConfig.lastLoginAt || null
    } : { configured: false },
    manual_import: {
      how: "If you have legitimate access (institutional login, purchase or the author's copy), download the PDF in your own browser, place it under .pi/browser-downloads, then call research_archive_source with local_file and human_verified=true. Or configure institutional access in Settings \u2192 Zotero panel \u2192 Institutional Access and log in once. Do not use pirate mirrors.",
      task_wait: { kind: "download", doi: identity.doi, title: resolution.title || null },
      institutional_login: institutionalConfig?.configured ? {
        action: "open_login",
        hint: "Institutional session may have expired; open Settings \u2192 Zotero \u2192 Institutional Access \u2192 Login"
      } : {
        action: "configure",
        hint: "Set EZproxy template or log in via institutional browser in Settings"
      }
    }
  };
  await recordFailure(ports, manifestPath, failuresPath, runDir, failure);
  if (institutionalConfig?.configured && institutionalAttempt && challenged) {
    return {
      status: "institutional_auth_required",
      ...failure,
      manifest_path: manifestPath,
      failures_path: failuresPath
    };
  }
  return { status: "no_open_access", ...failure, manifest_path: manifestPath, failures_path: failuresPath };
}
async function sourceStatus(options = {}, ports) {
  if (!ports) throw new Error("Source archive host ports are required");
  const { cwd = process.cwd(), run_dir } = options;
  const config = await ports.workspace(cwd);
  const runDir = run_dir ? validateRunDir(config.resultsRoot, resolve2(cwd, run_dir)) : null;
  if (!runDir) return { results_root: config.resultsRoot, categories: SOURCE_CATEGORIES, run_dir: null };
  const manifestPath = join(runDir, "sources", "download-manifest.json");
  const failuresPath = join(runDir, "sources", "download-failures.md");
  const manifest = await readManifest(manifestPath, runDir);
  let failures = "";
  try {
    failures = await readFile(failuresPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifestExists = await access(manifestPath).then(
    () => true,
    () => false
  );
  const failuresExists = await access(failuresPath).then(
    () => true,
    () => false
  );
  return {
    run_dir: runDir,
    manifest_path: manifestExists ? manifestPath : null,
    failures_path: failuresExists ? failuresPath : null,
    manifest,
    failure_count: manifest.failures?.length ?? Math.max(0, (failures.match(/^## /gm) || []).length),
    ...options.verify ? { verification: await verifyManifestItems(manifest, runDir) } : {}
  };
}
var source_archive_default = { archiveSource, sourceStatus };
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  SOURCE_CATEGORIES,
  archiveSource,
  source_archive_default as default,
  sourceStatus
};
