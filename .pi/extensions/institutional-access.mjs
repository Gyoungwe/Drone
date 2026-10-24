// @ts-nocheck
// packages/extensions/src/institutional-access.ts
import { createRequire } from "node:module";

// node_modules/@gyoungwe/pi-research/dist/host.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHash as createHash2, randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { readFile as readFile2, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { realpath as realpath2 } from "node:fs/promises";
import { resolve as resolve2 } from "node:path";
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";
import { access, mkdir as mkdir2, readFile as readFile3, realpath as realpath3, rename, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname2, isAbsolute as isAbsolute2, join as join2, relative as relative2, resolve as resolve3, sep as sep2 } from "node:path";
import { createHash as createHash4 } from "node:crypto";
import { readdir, readFile as readFile4 } from "node:fs/promises";
import { basename, isAbsolute as isAbsolute3, join as join3, relative as relative3, resolve as resolve4, sep as sep3 } from "node:path";
import { createHash as createHash5, randomUUID as randomUUID3 } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile as readFile5, realpath as realpath4, rename as rename2, stat as stat2, writeFile as writeFile3 } from "node:fs/promises";
import { isAbsolute as isAbsolute4, join as join4, relative as relative4, resolve as resolve5, sep as sep4 } from "node:path";
import { createHash as createHash7, randomUUID as randomUUID4 } from "node:crypto";
import { access as access2, mkdir as mkdir3, readFile as readFile6, realpath as realpath5, rename as rename3, writeFile as writeFile4 } from "node:fs/promises";
import { basename as basename3, dirname as dirname3, extname, isAbsolute as isAbsolute6, join as join5, relative as relative6, resolve as resolve7, sep as sep6 } from "node:path";
import { createHash as createHash6 } from "node:crypto";
import { basename as basename2, isAbsolute as isAbsolute5, relative as relative5, resolve as resolve6, sep as sep5 } from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir as mkdir4, readFile as readFile7, rename as rename4, writeFile as writeFile5 } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";
import { dirname as dirname4, join as join6 } from "node:path";
import { promisify } from "node:util";
import { createHash as createHash8, randomUUID as randomUUID5 } from "node:crypto";
import { open, realpath as realpath6, stat as stat3 } from "node:fs/promises";
import { basename as basename4, isAbsolute as isAbsolute7, relative as relative7, resolve as resolve8, sep as sep7 } from "node:path";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var claim_bindings_exports = {};
__export(claim_bindings_exports, {
  CLAIM_BINDING_SCHEMA: () => CLAIM_BINDING_SCHEMA,
  claimBindingRefs: () => claimBindingRefs,
  validateClaimBindings: () => validateClaimBindings
});
var RELATIONSHIPS = ["direct", "indirect", "hypothesis", "unsupported"];
function text(value, label, max = 4e3) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value.trim();
}
function validateClaimBindings(bindings, sources, reads) {
  if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > 64)
    throw new Error("Provide 1-64 structured claim_bindings");
  const seen = /* @__PURE__ */ new Set();
  return bindings.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid claim binding");
    const binding = raw;
    const claim = text(binding.claim, "claim");
    const limitations = text(binding.limitations, "limitations");
    if (seen.has(claim)) throw new Error("Duplicate claim binding");
    seen.add(claim);
    const relationship = binding.relationship;
    if (!RELATIONSHIPS.includes(relationship))
      throw new Error("Invalid support relationship");
    if (!Array.isArray(binding.sources) || binding.sources.length > 12)
      throw new Error("Invalid claim sources");
    if (["direct", "indirect"].includes(String(relationship)) && binding.sources.length === 0)
      throw new Error("Supported claims require observed source excerpts");
    const refs = binding.sources.map((rawRef) => {
      if (!rawRef || typeof rawRef !== "object" || Array.isArray(rawRef))
        throw new Error("Invalid claim source");
      const ref = rawRef;
      const path = typeof ref.path === "string" ? ref.path : "";
      const source = sources.find((candidate) => candidate.path === path);
      const read = reads.get(path);
      if (!source || !read || read.hash !== source.hash)
        throw new Error("Claim source was not read and identity-verified in this scope");
      const first = ref.start_line;
      const last = ref.end_line;
      if (!Number.isInteger(first) || !Number.isInteger(last) || first < read.startLine || last < first || last > read.endLine)
        throw new Error("Claim source range is outside the observed read");
      const quote = text(ref.quote, "source quote", 6e3);
      const excerpt = read.text.split(/\r?\n/).slice(first - read.startLine, last - read.startLine + 1).join("\n");
      if (!excerpt.includes(quote)) throw new Error("Claim quote does not match the observed note range");
      return {
        path: source.path,
        doi: source.doi,
        zotero_key: source.zotero_key,
        hash: source.hash,
        start_line: first,
        end_line: last,
        quote,
        ...ref.original_location ? { original_location: text(ref.original_location, "historical original location", 600) } : {},
        reading_basis: "current-scope-literature-note",
        originalFulltextReadThisTurn: false
      };
    });
    return {
      id: `claim-${index + 1}`,
      claim,
      relationship,
      limitations,
      ...binding.organism ? { organism: text(binding.organism, "organism", 600) } : {},
      ...binding.method ? { method: text(binding.method, "method", 1e3) } : {},
      sources: refs,
      supportAssessment: "model-asserted-unreviewed",
      provenanceChecked: true,
      scientificallyVerified: false
    };
  });
}
function claimBindingRefs(bindings) {
  return bindings.map(
    (binding) => `${binding.claim} [${binding.relationship}] -> ${binding.sources.map((source) => `${source.path}:${source.start_line}-${source.end_line}`).join(", ") || "no supporting source"}; limitation: ${binding.limitations}`
  );
}
var CLAIM_BINDING_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 64,
  items: {
    type: "object",
    properties: {
      claim: { type: "string" },
      relationship: { type: "string", enum: [...RELATIONSHIPS] },
      organism: { type: "string" },
      method: { type: "string" },
      limitations: { type: "string" },
      sources: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            start_line: { type: "integer", minimum: 1 },
            end_line: { type: "integer", minimum: 1 },
            quote: { type: "string" },
            original_location: { type: "string" }
          },
          required: ["path", "start_line", "end_line", "quote"]
        }
      }
    },
    required: ["claim", "relationship", "limitations", "sources"]
  }
};
var institutional_access_exports = {};
__export(institutional_access_exports, {
  INSTITUTIONAL_AGENT_DIR: () => INSTITUTIONAL_AGENT_DIR,
  INSTITUTIONAL_CONFIG_NAME: () => INSTITUTIONAL_CONFIG_NAME,
  INSTITUTIONAL_CONFIG_PATH: () => INSTITUTIONAL_CONFIG_PATH,
  buildProxiedUrl: () => buildProxiedUrl,
  detectAndSaveTemplateFromUrl: () => detectAndSaveTemplateFromUrl,
  emptyInstitutionalConfig: () => emptyInstitutionalConfig,
  inferEzproxyTemplateFromUrl: () => inferEzproxyTemplateFromUrl,
  loadInstitutionalConfig: () => loadInstitutionalConfig,
  normalizeInstitutionalConfig: () => normalizeInstitutionalConfig,
  saveInstitutionalConfig: () => saveInstitutionalConfig
});
var institutional_proxy_exports = {};
__export(institutional_proxy_exports, {
  buildProxiedUrl: () => buildProxiedUrl,
  inferEzproxyTemplateFromUrl: () => inferEzproxyTemplateFromUrl
});
function buildProxiedUrl(originalUrl, template) {
  if (!template) return null;
  const trimmed = template.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.includes("%s")) return trimmed.replaceAll("%s", encodeURIComponent(originalUrl));
    const urlObj = new URL(originalUrl);
    if (trimmed.includes(urlObj.host)) return null;
    if (/[?&=]$/.test(trimmed) || trimmed.endsWith("url=") || trimmed.endsWith("url")) {
      const separator = trimmed.includes("?") ? trimmed.endsWith("?") || trimmed.endsWith("&") || trimmed.endsWith("=") ? "" : "&" : "?";
      if (trimmed.endsWith("=")) return `${trimmed}${encodeURIComponent(originalUrl)}`;
      return `${trimmed}${separator}url=${encodeURIComponent(originalUrl)}`;
    }
    if (trimmed.includes("ezproxy") || trimmed.includes("login")) {
      const hasQuery = trimmed.includes("?");
      if (hasQuery) {
        if (trimmed.endsWith("?") || trimmed.endsWith("&"))
          return `${trimmed}${encodeURIComponent(originalUrl)}`;
        if (trimmed.includes("url=")) {
          if (/url=$/.test(trimmed)) return `${trimmed}${encodeURIComponent(originalUrl)}`;
          return `${trimmed}&url=${encodeURIComponent(originalUrl)}`;
        }
        return `${trimmed}&url=${encodeURIComponent(originalUrl)}`;
      }
      return `${trimmed}?url=${encodeURIComponent(originalUrl)}`;
    }
    return `${trimmed}${encodeURIComponent(originalUrl)}`;
  } catch {
    return null;
  }
}
function inferEzproxyTemplateFromUrl(navigatedUrl) {
  try {
    const url = new URL(navigatedUrl);
    const href = url.href;
    if (url.hostname.includes("ezproxy") && url.search) {
      const target = new URLSearchParams(url.search).get("url");
      if (target && /^https?:\/\//i.test(target)) {
        const base = `${href.split("url=")[0]}url=`;
        if (/^https?:\/\//i.test(base)) return `${base}%s`;
      }
      if (href.includes("url=") && /url=https?%3A/i.test(href) || href.includes("url=https://")) {
        const index = href.indexOf("url=");
        if (index > 0) {
          const base = href.slice(0, index + 4);
          if (/^https?:\/\//i.test(base)) return `${base}%s`;
        }
      }
    }
    if ((href.includes("?url=") || href.includes("&url=")) && /url=https?/i.test(href)) {
      const match = href.match(/^(https?:\/\/[^?]+\?[^=]*url=)/i);
      if (match) {
        const base = match[1];
        if (base && !base.includes("nature.com") && !base.includes("sciencedirect.com") && !base.includes("springer.com") && !base.includes("wiley.com") && base.length < 200)
          return `${base}%s`;
        if (base && base.length < 300) return `${base}%s`;
      }
    }
    return null;
  } catch {
    return null;
  }
}
var INSTITUTIONAL_CONFIG_NAME = "institutional.json";
var INSTITUTIONAL_AGENT_DIR = join(homedir(), ".pi", "agent");
var INSTITUTIONAL_CONFIG_PATH = join(INSTITUTIONAL_AGENT_DIR, INSTITUTIONAL_CONFIG_NAME);
function emptyInstitutionalConfig() {
  return { version: 1, autoDownloadEnabled: true, perTaskLimit: 20 };
}
function normalizeUrl(value) {
  if (value == null) return void 0;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.length > 2048 || !/^https?:\/\//i.test(trimmed)) return void 0;
  return trimmed;
}
function normalizeInstitutionalConfig(raw) {
  const base = emptyInstitutionalConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const value = raw;
  const ezproxyTemplate = normalizeUrl(value.ezproxyTemplate);
  const openUrlResolver = normalizeUrl(value.openUrlResolver);
  const institutionName = typeof value.institutionName === "string" ? value.institutionName.trim().slice(0, 120) || void 0 : void 0;
  const autoDownloadEnabled = typeof value.autoDownloadEnabled === "boolean" ? value.autoDownloadEnabled : base.autoDownloadEnabled;
  const perTaskLimit = typeof value.perTaskLimit === "number" && Number.isInteger(value.perTaskLimit) ? Math.min(100, Math.max(1, value.perTaskLimit)) : base.perTaskLimit;
  const lastLoginAt = typeof value.lastLoginAt === "string" ? value.lastLoginAt : void 0;
  const lastLoginUrl = normalizeUrl(value.lastLoginUrl);
  return {
    version: 1,
    ezproxyTemplate,
    institutionName,
    openUrlResolver,
    autoDownloadEnabled,
    perTaskLimit,
    lastLoginAt,
    lastLoginUrl,
    configured: Boolean(ezproxyTemplate || openUrlResolver || institutionName || lastLoginAt)
  };
}
async function loadInstitutionalConfig(path = INSTITUTIONAL_CONFIG_PATH, io = { readFile: (file) => readFile(file, "utf8") }) {
  try {
    return normalizeInstitutionalConfig(JSON.parse(await io.readFile(path)));
  } catch {
    return emptyInstitutionalConfig();
  }
}
async function saveInstitutionalConfig(config, path = INSTITUTIONAL_CONFIG_PATH, io = {
  readFile: (file) => readFile(file, "utf8"),
  writeFile: async (file, data) => {
    await writeFile(file, data, "utf8");
  },
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  }
}) {
  const normalized = normalizeInstitutionalConfig(config);
  await io.mkdir(dirname(path));
  await io.writeFile(path, `${JSON.stringify(normalized, null, 2)}
`);
  return normalized;
}
async function detectAndSaveTemplateFromUrl(navigatedUrl, { path = INSTITUTIONAL_CONFIG_PATH, io } = {}) {
  const inferred = inferEzproxyTemplateFromUrl(navigatedUrl);
  if (!inferred) return null;
  const config = await loadInstitutionalConfig(path, io);
  if (config.ezproxyTemplate === inferred) return config;
  return saveInstitutionalConfig({ ...config, ezproxyTemplate: inferred }, path, io);
}
var literature_operations_exports = {};
__export(literature_operations_exports, {
  createLiteratureOperations: () => createLiteratureOperations,
  destinationRecovery: () => destinationRecovery,
  literatureOperationId: () => literatureOperationId
});
var literature_receipt_exports = {};
__export(literature_receipt_exports, {
  exactDoiItems: () => exactDoiItems,
  normalizeDoi: () => normalizeDoi,
  verifyLiteratureReceipt: () => verifyLiteratureReceipt
});
function normalizeDoi(value) {
  const doi = String(value || "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}
function exactDoiItems(items, doi) {
  const wanted = normalizeDoi(doi);
  return wanted ? items.filter((item) => normalizeDoi(item.data?.DOI || item.doi || item.DOI) === wanted) : [];
}
function errorName(error) {
  return error instanceof Error ? error.name : "Error";
}
async function verifyLiteratureReceipt({
  doi,
  zotero_key,
  note_path,
  vault,
  signal,
  fetcher = (url, init) => fetch(url, init)
}) {
  const normalizedDoi = normalizeDoi(doi);
  const zoteroKey = String(zotero_key || "");
  if (!normalizedDoi || !/^[A-Z0-9]{8}$/.test(zoteroKey))
    throw new Error("Valid DOI and Zotero key required");
  const receipt = {
    doi: normalizedDoi,
    zoteroKey,
    zotero: { status: "unavailable" },
    obsidian: { status: "unavailable" },
    scientificallyVerified: false
  };
  const get = async (path) => {
    const response = await fetcher(`http://127.0.0.1:23119/api/users/0/${path}`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(1e4)]) : AbortSignal.timeout(1e4),
      redirect: "error"
    });
    if (!response.ok) throw new Error(`Zotero HTTP ${response.status}`);
    return response.json();
  };
  try {
    const item = await get(`items/${zoteroKey}`);
    const data = item?.data || {};
    receipt.zotero = {
      status: exactDoiItems([item], normalizedDoi).length ? "verified" : "identity-mismatch",
      title: data.title,
      collections: data.collections || []
    };
    if (receipt.zotero.status === "verified") {
      try {
        const children = await get(`items/${zoteroKey}/children`);
        receipt.zotero.pdfAttachmentKeys = children.filter((child) => child.data?.contentType === "application/pdf").map((child) => String(child.data?.key || "")).filter(Boolean);
        receipt.zotero.fulltextStatus = receipt.zotero.pdfAttachmentKeys.length ? "attachment-indexed-not-read" : "metadata-only";
      } catch {
        receipt.zotero.fulltextStatus = "unavailable";
      }
    }
  } catch (error) {
    receipt.zotero.error = errorName(error) === "TimeoutError" ? "timeout" : "local-api-unavailable";
  }
  let vaultResolved = false;
  try {
    const notePath = String(note_path || "");
    if (!vault || !/^(?:Library)\/Papers\/.+\.md$/.test(notePath) || notePath.split("/").includes("..") || notePath.includes("\\"))
      throw new Error("invalid-note-path");
    const root = await realpath(String(vault));
    vaultResolved = true;
    const file = await realpath(resolve(root, notePath));
    const rel = relative(root, file);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("outside-vault");
    if ((await stat(file)).size > 1024 * 1024) throw new Error("note-too-large");
    const text4 = await readFile2(file, "utf8");
    const linked = text4.includes(`zotero:${zoteroKey}`) || new RegExp(`zotero://select/library/items/${zoteroKey}(?=[)\\s<>]|$)`).test(text4) || new RegExp(`^zotero_key: *["']?${zoteroKey}["']? *$`, "m").test(text4);
    const dois = text4.match(/10\.\d{4,9}\/[^\s<>"'\])]+/gi) || [];
    receipt.obsidian = {
      status: linked && dois.some((item) => normalizeDoi(item.replace(/[.,;]+$/, "")) === normalizedDoi) ? "verified" : "identity-mismatch",
      path: notePath,
      vault: root,
      hash: createHash("sha256").update(text4).digest("hex")
    };
  } catch (error) {
    if (vaultResolved && error instanceof Error && "code" in error && error.code === "ENOENT") {
      receipt.obsidian.status = "missing";
      receipt.obsidian.error = "note-missing";
    } else receipt.obsidian.error = "note-unavailable-or-invalid";
  }
  receipt.status = receipt.zotero.status === "verified" && receipt.obsidian.status === "verified" ? "both-verified" : "partial";
  return receipt;
}
function destinationRecovery(receipt = {}) {
  const zotero = receipt.zotero?.status || "unavailable";
  const obsidian = receipt.obsidian?.status || "unavailable";
  return {
    zotero: {
      status: zotero,
      action: zotero === "verified" ? "reuse-existing-item" : zotero === "identity-mismatch" ? "resolve-identity-conflict" : "read-back-before-any-import",
      autoWrite: false
    },
    obsidian: {
      status: obsidian,
      action: obsidian === "verified" ? "preserve-existing-note" : obsidian === "missing" ? "deposit-missing-note-with-authorization" : obsidian === "identity-mismatch" ? "review-note-conflict-preserve-human-content" : "wait-and-recheck-vault",
      autoWrite: false
    },
    completed: zotero === "verified" && obsidian === "verified",
    scientificallyVerified: false
  };
}
function literatureOperationId(vault, revision, doi) {
  const normalized = normalizeDoi(doi);
  if (!normalized) throw new Error("Valid DOI required");
  return createHash2("sha256").update(JSON.stringify([vault, revision, normalized])).digest("hex");
}
function createLiteratureOperations(ports) {
  const now = ports.now || (() => (/* @__PURE__ */ new Date()).toISOString());
  const createId = ports.createId || randomUUID;
  return {
    async reconcileLiteratureOperation({ cwd = process.cwd(), runDir, doi, zoteroKey, notePath }, { verify = ports.verify } = {}) {
      const normalized = normalizeDoi(doi);
      if (!normalized) throw new Error("Valid DOI required");
      const { file, vault, revision } = await ports.resolveRunJournal(cwd, runDir);
      if (!vault) throw new Error("No bound Vault");
      const id = literatureOperationId(vault, revision, normalized);
      return ports.exclusive(file, async () => {
        const journal = await ports.readJournal(file);
        const previous = journal.operations[id];
        if (previous && (previous.zoteroKey !== zoteroKey || previous.notePath !== notePath))
          throw new Error(
            "Operation identity changed; resolve the existing DOI/key/path mapping before retry"
          );
        const receipt = await verify({ doi: normalized, zotero_key: zoteroKey, note_path: notePath, vault });
        const destinations = destinationRecovery(receipt);
        const checkedAt = now();
        const operation = {
          id,
          doi: normalized,
          zoteroKey,
          notePath,
          vault,
          revision,
          status: destinations.completed ? "both-identities-verified" : "partial-or-unavailable",
          attempts: (previous?.attempts || 0) + 1,
          createdAt: previous?.createdAt || checkedAt,
          checkedAt,
          destinations,
          receipt,
          history: [
            ...previous?.history || [],
            { at: checkedAt, zotero: receipt.zotero?.status, obsidian: receipt.obsidian?.status }
          ].slice(-32)
        };
        journal.operations[id] = operation;
        await ports.writeJournal(file, journal);
        return {
          operation_id: id,
          log_path: file,
          status: operation.status,
          destinations,
          receipt,
          attempts: operation.attempts,
          writesToLibraries: 0
        };
      });
    },
    /** Append an observed write receipt; the journal never authorizes or drives a retry. */
    async recordZoteroWrite({
      cwd = process.cwd(),
      runDir,
      receipt
    }) {
      const doi = normalizeDoi(receipt?.doi);
      if (!doi) throw new Error("Valid DOI required");
      const { file } = await ports.resolveRunJournal(cwd, runDir);
      return ports.exclusive(file, async () => {
        const journal = await ports.readJournal(file);
        const entry = {
          id: createId(),
          doi,
          status: String(receipt.status || "unknown"),
          reason: receipt.reason || null,
          channel: receipt.channel || null,
          zoteroKey: receipt.zoteroKey || null,
          library: receipt.library || null,
          collection: receipt.collection || null,
          attachment: receipt.attachment || null,
          fulltextStatus: receipt.fulltextStatus || null,
          readBack: receipt.readBack || null,
          consent: receipt.consent || null,
          writesToLibraries: receipt.writesToLibraries || 0,
          at: receipt.write?.at || now()
        };
        journal.writes = [...Array.isArray(journal.writes) ? journal.writes : [], entry].slice(-64);
        await ports.writeJournal(file, journal);
        return {
          write_id: entry.id,
          log_path: file,
          writes: journal.writes.length,
          autoRetry: false
        };
      });
    }
  };
}
var open_access_exports = {};
__export(open_access_exports, {
  OA_DEFAULT_TIMEOUT_MS: () => OA_DEFAULT_TIMEOUT_MS,
  OA_MAX_CANDIDATES: () => OA_MAX_CANDIDATES,
  OA_SOURCES: () => OA_SOURCES,
  PMC_CLOUD_BASE: () => PMC_CLOUD_BASE,
  contactEmail: () => contactEmail,
  default: () => open_access_default,
  normalizePmcid: () => normalizePmcid,
  normalizePmid: () => normalizePmid,
  pmcCloudHttps: () => pmcCloudHttps,
  resolveOpenAccess: () => resolveOpenAccess
});
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
  const text4 = String(value || "").trim();
  if (!/^https?:\/\//i.test(text4)) return null;
  try {
    const url = new URL(text4);
    if (url.protocol === "ftp:") return null;
    return url.href;
  } catch {
    return null;
  }
};
var pmcCloudHttps = (value) => {
  const text4 = String(value || "").trim();
  if (/^s3:\/\/pmc-oa-opendata\//i.test(text4))
    return `${PMC_CLOUD_BASE}/${text4.replace(/^s3:\/\/pmc-oa-opendata\//i, "")}`;
  return text4.startsWith(`${PMC_CLOUD_BASE}/`) ? text4 : null;
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
    const text4 = await response.text();
    if (!response.ok) return { ok: false, status: response.status, detail: `HTTP ${response.status}` };
    if (accept === "application/json") {
      try {
        return { ok: true, status: response.status, body: JSON.parse(text4) };
      } catch {
        return { ok: false, status: response.status, detail: "invalid JSON" };
      }
    }
    return { ok: true, status: response.status, body: text4 };
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
var open_access_default = { resolveOpenAccess, contactEmail, normalizePmcid, normalizePmid, pmcCloudHttps, OA_SOURCES };
var receipt_journal_exports = {};
__export(receipt_journal_exports, {
  createResearchReceiptJournal: () => createResearchReceiptJournal
});
var receipt_journal_policy_exports = {};
__export(receipt_journal_policy_exports, {
  CORE_RESEARCH_RECEIPT_TOOLS: () => CORE_RESEARCH_RECEIPT_TOOLS,
  ReceiptJournalBuffer: () => ReceiptJournalBuffer,
  receiptBelongsToRun: () => receiptBelongsToRun,
  shouldRecordResearchReceipt: () => shouldRecordResearchReceipt
});
var CORE_RESEARCH_RECEIPT_TOOLS = [
  "bash",
  "powershell",
  "webfetch",
  "fetch_content",
  "web_search",
  "research_read_knowledge",
  "research_search_knowledge",
  "research_verify_literature",
  "research_reconcile_literature",
  "research_archive_source",
  "read"
];
function shouldRecordResearchReceipt(event, isJournalTool = () => false) {
  const toolName = typeof event.toolName === "string" ? event.toolName : "";
  if (event.isError && toolName !== "bash" && toolName !== "powershell") return false;
  return CORE_RESEARCH_RECEIPT_TOOLS.includes(toolName) || isJournalTool(toolName);
}
var ReceiptJournalBuffer = class {
  capacity;
  entries = [];
  seen = /* @__PURE__ */ new Set();
  evictedCount = 0;
  constructor({ capacity = 256 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error("Receipt journal capacity must be a positive integer");
    this.capacity = capacity;
  }
  /** Adds a receipt and returns false for a duplicate tool call id. */
  add(receipt) {
    const toolCallId = typeof receipt.toolCallId === "string" ? receipt.toolCallId : null;
    if (toolCallId && this.seen.has(toolCallId)) return false;
    if (toolCallId) this.seen.add(toolCallId);
    if (this.entries.length >= this.capacity) {
      this.entries.shift();
      this.evictedCount += 1;
    }
    this.entries.push(receipt);
    return true;
  }
  values() {
    return this.entries.slice();
  }
  get evicted() {
    return this.evictedCount;
  }
  snapshot() {
    return {
      scope: "current-session-current-turn",
      buffered: this.entries.length,
      evicted: this.evictedCount
    };
  }
  clear() {
    this.entries.length = 0;
    this.seen.clear();
    this.evictedCount = 0;
  }
};
function receiptBelongsToRun(receipt, cwd, runDir) {
  const ownedRun = receipt.args?.run_dir || receipt.details?.run_dir;
  return !ownedRun || resolve2(cwd, String(ownedRun)) === resolve2(cwd, runDir);
}
function createResearchReceiptJournal(cwd, { sessionId = null, ports }) {
  const owners = ports.owners || /* @__PURE__ */ new Map();
  const owner = Symbol("research-turn");
  const buffer = new ReceiptJournalBuffer();
  const runs = /* @__PURE__ */ new Set();
  let active = true;
  let currentRun;
  let tail = Promise.resolve();
  const belongs = (receipt, runDir) => receiptBelongsToRun(receipt, cwd, runDir);
  const serial = (work) => {
    const next = tail.catch(() => {
    }).then(() => active ? work() : null);
    tail = next;
    return next;
  };
  const attach = async (runDir) => {
    if (!runDir) return;
    const status = await ports.status(cwd, runDir);
    const path = status.run_dir;
    if (owners.has(path) && owners.get(path) !== owner)
      throw new Error("Research run is owned by another active session/turn; create a separate run");
    if (!runs.has(path)) {
      owners.set(path, owner);
      await ports.flush(cwd, path);
      ports.reset(cwd, path);
      runs.add(path);
      for (const receipt of buffer.values()) {
        if (!belongs(receipt, path)) continue;
        await ports.observeExecution({ ...receipt, sessionId, cwd, runDir: path });
        await ports.observeResearch({ ...receipt, sessionId, cwd, runDir: path });
      }
    }
    currentRun = path;
  };
  return {
    currentRun: () => currentRun,
    record(event) {
      if (!active || !shouldRecordResearchReceipt(event, ports.isJournalTool)) return Promise.resolve(null);
      const snapshot = event.toolName === "research_read_knowledge" ? ports.workspace(cwd).then(async (config) => ({
        vault: config.obsidianVault ? await realpath2(config.obsidianVault) : null,
        revision: config.knowledgeBindingRevision || 0
      })).catch(() => ({ vault: null, revision: -1 })) : Promise.resolve(void 0);
      const receipt = {
        ...structuredClone(event),
        sessionId,
        observedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      return serial(async () => {
        if (buffer.add(receipt) === false) return null;
        receipt.readBinding = await snapshot;
        if (currentRun && belongs(receipt, currentRun)) {
          await ports.observeExecution({ ...receipt, cwd, runDir: currentRun });
          return ports.observeResearch({ ...receipt, cwd, runDir: currentRun });
        }
        return null;
      });
    },
    execute(runDir, work) {
      return serial(async () => {
        if (runDir) await attach(runDir);
        const result = await work();
        if (typeof result.run_dir === "string") await attach(result.run_dir);
        const refreshed = typeof result.run_dir === "string" ? await ports.status(cwd, result.run_dir) : result;
        return {
          ...result,
          ...refreshed,
          receipt_journal: { ...buffer.snapshot() }
        };
      });
    },
    async close() {
      active = false;
      await tail.catch(() => {
      });
      for (const runDir of runs) {
        await ports.flush(cwd, runDir);
        if (owners.get(runDir) === owner) {
          ports.reset(cwd, runDir);
          owners.delete(runDir);
        }
      }
      runs.clear();
      buffer.clear();
    }
  };
}
var research_loop_exports = {};
__export(research_loop_exports, {
  RESEARCH_DOCUMENT_KIND: () => RESEARCH_DOCUMENT_KIND,
  RESEARCH_STAGES: () => RESEARCH_STAGES,
  createResearchLoop: () => createResearchLoop
});
var RESEARCH_STAGES = Object.freeze([
  "created",
  "local_query_recorded",
  "external_search_recorded",
  "sources_inspected",
  "sources_archived",
  "sources_reused",
  "claims_bound",
  "answerable"
]);
var RESEARCH_DOCUMENT_KIND = "drone.research.run";
function createResearchLoop(ports) {
  const loadWorkspaceConfig = ports.workspace;
  const verifyLiteratureReceipt2 = ports.verifyLiteratureReceipt;
  const sourceStatus2 = ports.sourceStatus;
  const runtimeState = {
    receiptLedger: /* @__PURE__ */ new Map(),
    receiptQueues: /* @__PURE__ */ new Map(),
    dispose() {
      this.receiptLedger.clear();
      this.receiptQueues.clear();
    }
  };
  const runKey = (cwd, runDir) => resolve3(cwd, runDir);
  function ledger(cwd, runDir) {
    const key = runKey(cwd, runDir);
    if (!runtimeState.receiptLedger.has(key)) {
      if (runtimeState.receiptLedger.size >= 128)
        runtimeState.receiptLedger.delete(runtimeState.receiptLedger.keys().next().value);
      runtimeState.receiptLedger.set(key, { reads: /* @__PURE__ */ new Map(), verified: /* @__PURE__ */ new Map() });
    }
    return runtimeState.receiptLedger.get(key);
  }
  async function flushResearchReceipts({ cwd = process.cwd(), runDir } = {}) {
    await runtimeState.receiptQueues.get(runKey(cwd, runDir));
  }
  function resetResearchReceipts({ cwd = process.cwd(), runDir } = {}) {
    if (runDir) runtimeState.receiptLedger.delete(runKey(cwd, runDir));
  }
  async function reusableSources(cwd, runDir) {
    const config = await loadWorkspaceConfig(cwd);
    if (!config.obsidianVault) return [];
    const root = await realpath3(config.obsidianVault);
    const state = ledger(cwd, runDir), result = [];
    for (const [path, proof] of state.verified) {
      const read = state.reads.get(path);
      if (!read || read.hash !== proof.obsidian?.hash || read.vault !== root || read.revision !== (config.knowledgeBindingRevision || 0) || proof.obsidian?.vault !== root)
        continue;
      const current = await verifyLiteratureReceipt2({
        doi: proof.doi,
        zotero_key: proof.zoteroKey,
        note_path: path,
        vault: root
      });
      if (current.status !== "both-verified" || current.obsidian.hash !== read.hash) continue;
      result.push({
        path,
        hash: read.hash,
        doi: current.doi,
        zotero_key: current.zoteroKey,
        startLine: read.startLine,
        endLine: read.endLine,
        basis: "current-turn-literature-note-read-and-identity-check",
        fulltext_status: current.zotero.fulltextStatus,
        originalFulltextReadThisTurn: false,
        evidence_profile: {
          identity: "both-verified",
          acquisition: current.zotero.fulltextStatus,
          reading: {
            kind: "literature-note",
            scope: "current-turn",
            startLine: read.startLine,
            endLine: read.endLine
          },
          claimSupport: "not-assessed"
        }
      });
    }
    return result;
  }
  async function validateReuse(cwd, runDir, gate) {
    if (!gate.reuse_count) return;
    const fresh = await reusableSources(cwd, runDir);
    if (gate.reused_sources.length !== gate.reuse_count || gate.reused_sources.some(
      (old) => !fresh.some(
        (now) => now.path === old.path && now.hash === old.hash && now.doi === old.doi && now.zotero_key === old.zotero_key
      )
    ))
      throw new Error(
        "Reused source changed or current-turn receipt is missing; re-read and verify the existing note, do not re-import it"
      );
  }
  async function validateStoredClaimBindings(cwd, runDir, gate) {
    if (!Array.isArray(gate.claim_bindings) || gate.claim_bindings.length === 0)
      throw new Error("Structured claim_bindings are required before answerable");
    return validateClaimBindings(
      gate.claim_bindings,
      [...await reusableSources(cwd, runDir), ...await archivedSourceRecords(cwd, runDir)],
      ledger(cwd, runDir).reads
    );
  }
  function safeSlug(value, label) {
    const text4 = String(value ?? "").trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text4)) throw new Error(`${label} must be lowercase kebab-case`);
    return text4;
  }
  function topicIdFromResultSlug(value) {
    const slug = safeSlug(value || "research-question", "result_slug");
    const stable = slug.replace(/-20\d{6}(?:\d{6})?$/, "").replace(/-run-\d+$/, "");
    return stable || slug;
  }
  function within3(root, target) {
    const rel = relative2(resolve3(root), resolve3(target));
    return rel === "" || !isAbsolute2(rel) && rel !== ".." && !rel.startsWith(`..${sep2}`);
  }
  function fileHash(bytes) {
    return createHash3("sha256").update(bytes).digest("hex");
  }
  async function archivedSourceRecords(cwd, runDir) {
    const archive = await sourceStatus2({ cwd, run_dir: resolve3(cwd, runDir) });
    const records = [];
    for (const item of archive.manifest?.items || []) {
      if (item.status !== "downloaded" || !item.path || !item.sha256) continue;
      const absolute = resolve3(cwd, item.path);
      if (!within3(join2(resolve3(cwd, runDir), "sources"), absolute)) continue;
      try {
        if (!within3(await realpath3(join2(resolve3(cwd, runDir), "sources")), await realpath3(absolute)))
          continue;
        if (fileHash(await readFile3(absolute)) !== item.sha256) continue;
      } catch {
        continue;
      }
      const aliases = /* @__PURE__ */ new Set([
        String(item.path),
        absolute,
        relative2(cwd, absolute),
        relative2(resolve3(cwd, runDir), absolute)
      ]);
      for (const path of aliases)
        records.push({
          path,
          hash: String(item.sha256),
          doi: item.metadata?.doi || item.doi,
          zotero_key: item.metadata?.zotero_key || item.zotero_key
        });
    }
    return records;
  }
  async function recordArchivedRead(cwd, runDir, path, args, details, content) {
    const absolute = resolve3(cwd, path);
    const sourcesRoot = join2(resolve3(cwd, runDir), "sources");
    if (!within3(sourcesRoot, absolute)) return false;
    if (!within3(await realpath3(sourcesRoot), await realpath3(absolute))) return false;
    if (details.truncation?.firstLineExceedsLimit) return false;
    const returned = details.truncation?.content ?? content?.find((part) => part.type === "text")?.text;
    if (typeof returned !== "string" || !returned.trim()) return false;
    const bytes = await readFile3(absolute);
    const sourceText = bytes.toString("utf8");
    if (sourceText.includes("\0") || sourceText.startsWith("%PDF-")) return false;
    const startLine = Number.isInteger(args.offset) && args.offset > 0 ? args.offset : 1;
    const selected = sourceText.split("\n").slice(startLine - 1, args.limit ? startLine - 1 + args.limit : void 0);
    const visible = returned.split("\n");
    const lines = [];
    for (let index = 0; index < Math.min(selected.length, visible.length, 2e3); index++) {
      const shown = visible[index] ?? "";
      if (selected[index] !== shown || lines.join("\n").length + shown.length > 9e4) break;
      lines.push(shown);
    }
    const text4 = lines.join("\n");
    if (!text4.trim()) return false;
    const read = { hash: fileHash(bytes), text: text4, startLine, endLine: startLine + lines.length - 1 };
    const aliases = /* @__PURE__ */ new Set([
      String(path),
      absolute,
      relative2(cwd, absolute),
      relative2(resolve3(cwd, runDir), absolute)
    ]);
    for (const alias of aliases) ledger(cwd, runDir).reads.set(alias, read);
    return true;
  }
  async function readJson4(path) {
    const value = JSON.parse(await readFile3(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`Invalid JSON object: ${path}`);
    if (path.endsWith("metadata.json") && !value.kind) {
      return { ...value, kind: RESEARCH_DOCUMENT_KIND, version: 1 };
    }
    if (path.endsWith("metadata.json") && (value.kind !== RESEARCH_DOCUMENT_KIND || value.version !== 1))
      throw new Error(`Unsupported research metadata document: ${path}`);
    return value;
  }
  async function atomicJson2(path, value) {
    await mkdir2(dirname2(path), { recursive: true });
    const temp = `${path}.${randomUUID2()}.tmp`;
    await writeFile2(temp, `${JSON.stringify(value, null, 2)}
`, "utf8");
    await rename(temp, path);
  }
  function gateOf2(metadata) {
    const gate = metadata.evidence_gate && typeof metadata.evidence_gate === "object" ? metadata.evidence_gate : {};
    return {
      stage: RESEARCH_STAGES.includes(gate.stage) ? gate.stage : "created",
      status: gate.status === "failed" ? "failed" : "ok",
      answerable: gate.answerable === true,
      events: Array.isArray(gate.events) ? gate.events : [],
      claim_refs: Array.isArray(gate.claim_refs) ? gate.claim_refs : [],
      claim_bindings: Array.isArray(gate.claim_bindings) ? gate.claim_bindings : [],
      warnings: gate.claim_refs?.length && !gate.claim_bindings?.length ? ["legacy-unstructured-claims: support not assessed"] : [],
      source_refs: Array.isArray(gate.source_refs) ? gate.source_refs : [],
      archive_count: Number(gate.archive_count) || 0,
      reuse_count: Number(gate.reuse_count) || 0,
      reused_sources: Array.isArray(gate.reused_sources) ? gate.reused_sources : [],
      scientificallyVerified: false
    };
  }
  function researchNodes(gate) {
    const current = RESEARCH_STAGES.indexOf(gate.stage);
    return RESEARCH_STAGES.map((id, index) => ({
      id,
      state: gate.answerable || index < current ? "completed" : index === current ? "current" : "pending",
      observed: (gate.events || []).some((event) => event.type === id && !event.skipped)
    }));
  }
  function provenanceFor(gate, status = "pending") {
    return {
      status,
      source_refs: [...gate.source_refs],
      claim_bindings: structuredClone(gate.claim_bindings),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function advance(gate, stage, details = {}) {
    const current = RESEARCH_STAGES.indexOf(gate.stage);
    const target = RESEARCH_STAGES.indexOf(stage);
    if (target < 0) throw new Error(`Unknown research stage: ${stage}`);
    if (target < current)
      return {
        ...gate,
        events: [...gate.events, { type: stage, at: (/* @__PURE__ */ new Date()).toISOString(), repeated: true, ...details }]
      };
    return {
      ...gate,
      stage,
      events: [...gate.events, { type: stage, at: (/* @__PURE__ */ new Date()).toISOString(), ...details }]
    };
  }
  async function resolveRun(cwd, runDir) {
    const config = await loadWorkspaceConfig(cwd);
    if (!runDir) throw new Error("run_dir is required for this action");
    const path = resolve3(cwd, runDir);
    if (!within3(config.resultsRoot, path))
      throw new Error("run_dir must stay inside the configured results root");
    const rel = relative2(config.resultsRoot, path).split(sep2);
    if (rel.length !== 2 || !rel[1]?.startsWith("run-"))
      throw new Error("run_dir must be directly inside a result slug");
    await access(join2(path, "metadata.json"));
    return { config, path, metadataPath: join2(path, "metadata.json") };
  }
  async function startResearchRun({
    cwd = process.cwd(),
    project,
    resultSlug,
    query,
    requiresProvenance = false
  } = {}) {
    const config = await loadWorkspaceConfig(cwd);
    project = safeSlug(project || await ports.resolveProject(cwd), "project");
    resultSlug = safeSlug(resultSlug || "research-question", "result_slug");
    if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const runId = `run-${stamp}-${randomUUID2().slice(0, 8)}`;
    const runDir = join2(config.resultsRoot, resultSlug, runId);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const metadata = {
      kind: RESEARCH_DOCUMENT_KIND,
      version: 1,
      run_id: runId,
      project,
      result_slug: resultSlug,
      topic_id: topicIdFromResultSlug(resultSlug),
      query: query.trim(),
      status: "running",
      revision: 0,
      requires_provenance: requiresProvenance === true,
      started_at: now,
      evidence_gate: {
        stage: "created",
        status: "ok",
        answerable: false,
        events: [{ type: "created", at: now }],
        claim_refs: [],
        source_refs: [],
        archive_count: 0
      },
      research_nodes: researchNodes({ stage: "created", answerable: false, events: [{ type: "created" }] }),
      provenance: provenanceFor({ source_refs: [], claim_bindings: [] })
    };
    await mkdir2(runDir, { recursive: true });
    await atomicJson2(join2(runDir, "metadata.json"), metadata);
    return { run_dir: runDir, metadata };
  }
  async function updateResearchLoopUnlocked({
    cwd = process.cwd(),
    runDir,
    action,
    query,
    sourceRefs = [],
    claimRefs = [],
    claimBindings = [],
    outcome,
    notes,
    expectedRevision
  } = {}) {
    const { path, metadataPath } = await resolveRun(cwd, runDir);
    const metadata = await readJson4(metadataPath);
    const revision = Number.isInteger(metadata.revision) ? metadata.revision : 0;
    if (expectedRevision != null && Number(expectedRevision) !== revision)
      throw new Error(`research run changed; expected revision ${expectedRevision}, found ${revision}`);
    let gate = gateOf2(metadata);
    const detail = {
      ...query ? { query: String(query).trim() } : {},
      ...outcome ? { outcome } : {},
      ...notes ? { notes } : {}
    };
    const requireStage = (stage) => {
      if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf(stage))
        throw new Error(`research loop must reach ${stage} before ${action}`);
    };
    if (action === "status") return { run_dir: path, metadata, evidence_gate: gate, revision };
    if (action === "record_local") {
      if (!query?.trim()) throw new Error("query is required");
      gate = advance(gate, "local_query_recorded", detail);
    } else if (action === "record_external") {
      requireStage("local_query_recorded");
      if (!query?.trim() && !notes?.trim())
        throw new Error("record the external query or why external search was skipped");
      gate = advance(gate, "external_search_recorded", detail);
    } else if (action === "inspect_sources") {
      requireStage("external_search_recorded");
      if (!Array.isArray(sourceRefs) || sourceRefs.length === 0)
        throw new Error("source_refs must list inspected original sources");
      gate = advance(
        { ...gate, source_refs: [.../* @__PURE__ */ new Set([...gate.source_refs, ...sourceRefs.map(String)])] },
        "sources_inspected",
        { ...detail, source_refs: sourceRefs }
      );
    } else if (action === "verify_archive") {
      requireStage("sources_inspected");
      const archive = await sourceStatus2({ cwd, run_dir: path, verify: true });
      if (archive.verification && archive.verification.ok !== true) {
        const failed = archive.verification.items?.filter((item) => item.ok !== true) || [];
        throw new Error(
          `Archived source verification failed: ${failed.map((item) => item.reason || item.path).join(", ") || "unknown"}`
        );
      }
      const downloaded = (archive.manifest?.items || []).filter((item) => item.status === "downloaded");
      const reused = await reusableSources(cwd, runDir);
      if (!downloaded.length && !reused.length)
        throw new Error(
          "No available source: read an existing Library/Papers note this turn and verify its DOI/key with research_verify_literature, or archive an authorized new source. Do not repeat imports to clear this gate."
        );
      gate = advance(
        { ...gate, archive_count: downloaded.length, reuse_count: reused.length, reused_sources: reused },
        downloaded.length ? "sources_archived" : "sources_reused",
        {
          archived: downloaded.map((item) => ({ id: item.id, sha256: item.sha256, path: item.path })),
          reused_sources: reused,
          scientificallyVerified: false
        }
      );
    } else if (action === "bind_claims") {
      if (gate.stage === "sources_inspected") {
        const available = await updateResearchLoopUnlocked({ cwd, runDir, action: "verify_archive" });
        gate = available.evidence_gate;
      }
      requireStage("sources_archived");
      await validateReuse(cwd, runDir, gate);
      if (claimBindings.length) {
        const checked = validateClaimBindings(
          claimBindings,
          [...await reusableSources(cwd, runDir), ...await archivedSourceRecords(cwd, runDir)],
          ledger(cwd, runDir).reads
        );
        gate = { ...gate, claim_bindings: checked, warnings: [] };
        claimRefs = claimBindingRefs(checked);
      } else if (gate.claim_bindings.length) {
        const checked = await validateStoredClaimBindings(cwd, runDir, gate);
        gate = { ...gate, claim_bindings: checked, claim_refs: claimBindingRefs(checked), warnings: [] };
        claimRefs = claimBindingRefs(checked);
      } else if (claimRefs.length) {
        throw new Error(
          "Structured claim_bindings are required; legacy claim_refs cannot make a run answerable"
        );
      }
      if (!Array.isArray(gate.claim_bindings) || gate.claim_bindings.length === 0)
        throw new Error("Structured claim_bindings must contain at least one validated claim");
      gate = advance({ ...gate, claim_refs: [...new Set(claimRefs.map(String))] }, "claims_bound", {
        claim_refs: claimRefs
      });
    } else if (action === "finalize") {
      requireStage("claims_bound");
      await validateReuse(cwd, runDir, gate);
      const checked = await validateStoredClaimBindings(cwd, runDir, gate);
      const refs = claimBindingRefs(checked);
      if (gate.archive_count + gate.reuse_count < 1 || !refs.length)
        throw new Error("archive verification and structured claim bindings are required before answerable");
      if (metadata.requires_provenance === true) {
        const provenance2 = await readJson4(join2(path, "reproducibility-manifest.json"));
        if (provenance2?.version !== 1)
          throw new Error("This run requires a reproducibility manifest before it can become answerable");
      }
      gate = advance(
        { ...gate, claim_bindings: checked, claim_refs: refs, warnings: [], status: "ok", answerable: true },
        "answerable",
        detail
      );
    } else if (action === "complete") {
      return completeResearchGate({ cwd, runDir, claimRefs, claimBindings });
    } else {
      throw new Error(`unknown research_loop action: ${action}`);
    }
    metadata.evidence_gate = gate;
    metadata.research_nodes = researchNodes(gate);
    metadata.provenance = provenanceFor(gate, gate.answerable ? "host-verified" : "pending");
    if (gate.answerable) {
      metadata.status = "completed";
      metadata.finalized_at = metadata.finalized_at || (/* @__PURE__ */ new Date()).toISOString();
    }
    metadata.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    metadata.revision = revision + 1;
    await atomicJson2(metadataPath, metadata);
    return { run_dir: path, evidence_gate: gate, revision: metadata.revision };
  }
  async function updateResearchLoop(input = {}) {
    const cwd = input.cwd || process.cwd();
    const key = runKey(cwd, input.runDir);
    const work = () => updateResearchLoopUnlocked(input);
    if (input.action === "complete" || !ports.exclusive) return work();
    return ports.exclusive(key, work);
  }
  function isWikiPath(path) {
    return /(?:^|[\\/])Wiki[\\/]/i.test(String(path || ""));
  }
  async function ensureStage(cwd, runDir, stage, fill) {
    const current = await updateResearchLoop({ cwd, runDir, action: "status" });
    if (RESEARCH_STAGES.indexOf(current.evidence_gate.stage) >= RESEARCH_STAGES.indexOf(stage))
      return current;
    return fill();
  }
  async function completeResearchGate({
    cwd = process.cwd(),
    runDir,
    claimRefs = [],
    claimBindings = []
  } = {}) {
    let status = await updateResearchLoop({ cwd, runDir, action: "status" });
    let gate = status.evidence_gate;
    await validateReuse(cwd, runDir, gate);
    if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("sources_inspected"))
      throw new Error("research loop must inspect sources before complete");
    if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("sources_archived"))
      status = await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
    gate = status.evidence_gate;
    if (!claimBindings.length && !gate.claim_bindings.length)
      throw new Error(
        "Provide structured claim_bindings; legacy claim_refs cannot make a research run answerable"
      );
    if (claimBindings.length || RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("claims_bound"))
      status = await updateResearchLoop({
        cwd,
        runDir,
        action: "bind_claims",
        claimRefs,
        claimBindings
      });
    gate = status.evidence_gate;
    status = await updateResearchLoop({ cwd, runDir, action: "finalize" });
    return status;
  }
  function observeResearchReceipt(options = {}) {
    if (!options.runDir) return Promise.resolve(null);
    const key = runKey(options.cwd || process.cwd(), options.runDir);
    const work = (runtimeState.receiptQueues.get(key) || Promise.resolve()).catch(() => {
    }).then(() => observeReceipt(options));
    runtimeState.receiptQueues.set(key, work);
    void work.finally(() => {
      if (runtimeState.receiptQueues.get(key) === work) runtimeState.receiptQueues.delete(key);
    }).catch(() => {
    });
    return work;
  }
  async function observeReceipt({
    cwd = process.cwd(),
    runDir,
    toolName,
    args = {},
    details = {},
    content = [],
    isError = false,
    readBinding
  } = {}) {
    if (isError || !runDir || !toolName) return null;
    try {
      if (toolName === "research_reconcile_literature")
        return observeReceipt({
          cwd,
          runDir,
          toolName: "research_verify_literature",
          args,
          details: details.receipt || {},
          isError
        });
      const query = String(args.query || details.query || "").trim();
      if (toolName === "research_search_knowledge" && query && details.complete !== false)
        return await updateResearchLoop({ cwd, runDir, action: "record_local", query });
      if (["webfetch", "fetch_content", "web_search"].includes(toolName)) {
        const url = String(args.url || details.url || query).trim();
        if (!url) return null;
        await ensureStage(
          cwd,
          runDir,
          "local_query_recorded",
          () => updateResearchLoop({ cwd, runDir, action: "record_local", query: url })
        );
        return await updateResearchLoop({
          cwd,
          runDir,
          action: "record_external",
          query: url,
          notes: String(details.title || "")
        });
      }
      if (toolName === "research_read_knowledge") {
        const path = String(args.path || details.path || "");
        if (!path || isWikiPath(path) || details.missing === true) return null;
        await ensureStage(
          cwd,
          runDir,
          "local_query_recorded",
          () => updateResearchLoop({ cwd, runDir, action: "record_local", query: path })
        );
        await ensureStage(
          cwd,
          runDir,
          "external_search_recorded",
          () => updateResearchLoop({
            cwd,
            runDir,
            action: "record_external",
            notes: "Host: no extra web search before inspecting current sources."
          })
        );
        if (/^Library\/Papers\/.+\.md$/.test(path) && /^[a-f0-9]{64}$/i.test(details.hash || "") && typeof details.text === "string" && details.text.trim() && Number.isInteger(details.startLine) && details.endLine >= details.startLine) {
          const config = await loadWorkspaceConfig(cwd);
          if (config.obsidianVault)
            ledger(cwd, runDir).reads.set(path, {
              hash: details.hash,
              text: details.text,
              vault: readBinding ? readBinding.vault : await realpath3(config.obsidianVault),
              revision: readBinding ? readBinding.revision : config.knowledgeBindingRevision || 0,
              startLine: details.startLine,
              endLine: details.endLine
            });
        }
        const inspected = await updateResearchLoop({
          cwd,
          runDir,
          action: "inspect_sources",
          sourceRefs: [path]
        });
        if ((await reusableSources(cwd, runDir)).length)
          return await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
        return inspected;
      }
      if (toolName === "read") {
        const path = String(args.path || details.path || "");
        if (!path || details.missing === true) return null;
        const archived = await recordArchivedRead(cwd, runDir, path, args, details, content);
        if (!archived) return null;
        await ensureStage(
          cwd,
          runDir,
          "local_query_recorded",
          () => updateResearchLoop({ cwd, runDir, action: "record_local", query: path })
        );
        await ensureStage(
          cwd,
          runDir,
          "external_search_recorded",
          () => updateResearchLoop({
            cwd,
            runDir,
            action: "record_external",
            notes: "Host recorded a read of the archived run source."
          })
        );
        return updateResearchLoop({ cwd, runDir, action: "inspect_sources", sourceRefs: [path] });
      }
      if (toolName === "research_verify_literature" && details.status === "both-verified" && details.obsidian?.status === "verified" && details.zotero?.status === "verified") {
        const path = details.obsidian.path;
        if (!/^Library\/Papers\/.+\.md$/.test(path || "")) return null;
        ledger(cwd, runDir).verified.set(path, structuredClone(details));
        if ((await reusableSources(cwd, runDir)).length)
          return await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
        return null;
      }
      if (toolName === "research_archive_source" && details.status === "downloaded") {
        const ref = String(details.path || details.url || args.url || "");
        if (!ref) return null;
        await ensureStage(
          cwd,
          runDir,
          "local_query_recorded",
          () => updateResearchLoop({ cwd, runDir, action: "record_local", query: ref })
        );
        await ensureStage(
          cwd,
          runDir,
          "external_search_recorded",
          () => updateResearchLoop({
            cwd,
            runDir,
            action: "record_external",
            query: String(args.url || details.url || ref),
            notes: "Host recorded the archived source URL as the external lookup."
          })
        );
        await updateResearchLoop({ cwd, runDir, action: "inspect_sources", sourceRefs: [ref] });
        const archived = await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
        return archived;
      }
      if (toolName === "research_deposit_knowledge" && details.type === "claim" && details.note) return null;
      return null;
    } catch {
      return null;
    }
  }
  return {
    startResearchRun,
    updateResearchLoop,
    completeResearchGate,
    observeResearchReceipt,
    flushResearchReceipts,
    resetResearchReceipts,
    topicIdFromResultSlug,
    dispose: () => runtimeState.dispose()
  };
}
var research_run_ui_exports = {};
__export(research_run_ui_exports, {
  getResearchRun: () => getResearchRun,
  listResearchRuns: () => listResearchRuns
});
var STAGES = [
  "created",
  "local_query_recorded",
  "external_search_recorded",
  "sources_inspected",
  "sources_archived",
  "sources_reused",
  "claims_bound",
  "answerable"
];
var LABELS = {
  created: "\u51C6\u5907\u8FD0\u884C",
  local_query_recorded: "\u8BB0\u5F55\u672C\u5730\u68C0\u7D22",
  external_search_recorded: "\u8BB0\u5F55\u5916\u90E8\u68C0\u7D22",
  sources_inspected: "\u68C0\u67E5\u6765\u6E90",
  sources_archived: "\u5F52\u6863\u6765\u6E90",
  sources_reused: "\u590D\u7528\u6765\u6E90",
  claims_bound: "\u7ED1\u5B9A\u4E3B\u5F20",
  answerable: "\u53EF\u56DE\u7B54"
};
function text2(value, max = 480) {
  return String(value ?? "").normalize("NFKC").replace(new RegExp("\\p{Cc}", "gu"), " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function validHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}
function within(root, target) {
  const rel = relative3(resolve4(root), resolve4(target));
  return rel === "" || !rel.startsWith(`..${sep3}`) && rel !== ".." && !isAbsolute3(rel);
}
function safeRunDir(resultsRoot, candidate) {
  const runDir = resolve4(resultsRoot, candidate);
  const parts = relative3(resolve4(resultsRoot), runDir).split(sep3);
  if (!within(resultsRoot, runDir) || parts.length !== 2 || !parts[1]?.startsWith("run-"))
    throw new Error("research run is outside the configured results root");
  return runDir;
}
async function readJson(path) {
  try {
    const value = JSON.parse(await readFile4(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function gateOf(metadata) {
  const gate = metadata?.evidence_gate && typeof metadata.evidence_gate === "object" ? metadata.evidence_gate : {};
  return {
    stage: STAGES.includes(gate.stage) ? gate.stage : "created",
    status: gate.status === "failed" ? "failed" : "ok",
    answerable: gate.answerable === true,
    events: Array.isArray(gate.events) ? gate.events.filter((e) => e && typeof e === "object") : [],
    claimBindings: Array.isArray(gate.claim_bindings) ? gate.claim_bindings : [],
    claimRefs: Array.isArray(gate.claim_refs) ? gate.claim_refs : [],
    sourceRefs: Array.isArray(gate.source_refs) ? gate.source_refs : [],
    archiveCount: Number.isFinite(Number(gate.archive_count)) ? Number(gate.archive_count) : 0,
    reuseCount: Number.isFinite(Number(gate.reuse_count)) ? Number(gate.reuse_count) : 0,
    reusedSources: Array.isArray(gate.reused_sources) ? gate.reused_sources : [],
    warnings: Array.isArray(gate.warnings) ? gate.warnings.map((x) => text2(x, 240)).filter(Boolean) : []
  };
}
function route(metadata) {
  const gate = gateOf(metadata);
  const events = gate.events.filter((e) => STAGES.includes(e.type));
  const current = events.at(-1)?.type || gate.stage;
  const currentIndex = STAGES.indexOf(current);
  const success = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (event.failed === true || event.status === "failed" || event.outcome === "failed") continue;
    success.set(event.type, event);
  }
  return STAGES.map((key, index) => {
    const event = success.get(key), count = gate.events.filter((e) => e.type === key).length, failed = gate.events.some(
      (e) => e.type === key && (e.failed === true || e.status === "failed" || e.outcome === "failed")
    );
    let state = "pending";
    if (failed && index >= currentIndex) state = "blocked";
    else if (event && (key === "answerable" || index < currentIndex || index === currentIndex && gate.answerable))
      state = "complete";
    else if (key === current && gate.status === "failed") state = "blocked";
    else if (key === current) state = "active";
    return {
      key,
      label: LABELS[key] || key,
      state,
      at: typeof event?.at === "string" ? event.at : null,
      detail: text2(event?.notes || event?.outcome || event?.reason, 240) || null,
      ...count > 1 ? { count } : {}
    };
  });
}
function timeline(metadata) {
  const gate = gateOf(metadata);
  return gate.events.slice(-128).map((event) => ({
    type: text2(event.type, 100) || "event",
    at: typeof event.at === "string" ? event.at : null,
    detail: text2(event.notes || event.outcome || event.reason, 320) || null,
    status: event.failed === true || event.status === "failed" || event.outcome === "failed" ? "failed" : event.observed === true ? "observed" : "ok",
    refs: Array.isArray(event.source_refs) ? event.source_refs.map((item) => text2(item, 240)).filter(Boolean).slice(0, 8) : void 0
  }));
}
async function hashFile(path) {
  try {
    const bytes = await readFile4(path);
    return { hash: createHash4("sha256").update(bytes).digest("hex"), size: bytes.byteLength };
  } catch {
    return { hash: null, size: null };
  }
}
async function sourceManifest(runDir, gate, vaultRoot) {
  const manifest = await readJson(join3(runDir, "sources", "download-manifest.json"));
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  const byPath = /* @__PURE__ */ new Map();
  let checked = 0, verified = 0, changed = 0, missing = 0;
  for (const item of items) {
    const path = text2(item?.path || item?.local_path || item?.file, 480).replaceAll("\\", "/");
    if (!path) continue;
    const declared = validHash(item?.sha256);
    let currentHash = null, size = Number.isFinite(Number(item?.size_bytes)) ? Number(item.size_bytes) : null;
    const candidate = path.startsWith("/") ? path : join3(runDir, path);
    if (within(runDir, candidate)) {
      const current = await hashFile(candidate);
      currentHash = current.hash;
      size = current.size ?? size;
    } else if (vaultRoot && within(vaultRoot, join3(vaultRoot, path))) {
      const current = await hashFile(join3(vaultRoot, path));
      currentHash = current.hash;
      size = current.size ?? size;
    }
    if (declared) {
      checked++;
      if (!currentHash) missing++;
      else if (currentHash === declared) verified++;
      else changed++;
    }
    byPath.set(path, {
      path,
      status: text2(item?.status, 80) || "unknown",
      hash: declared,
      verified: Boolean(declared && currentHash && currentHash === declared),
      size,
      location: currentHash ? candidate : null,
      metadata: item?.metadata && typeof item.metadata === "object" ? item.metadata : null
    });
  }
  for (const path of gate.sourceRefs) {
    const key = text2(path, 480).replaceAll("\\", "/");
    if (key && !byPath.has(key))
      byPath.set(key, {
        path: key,
        status: "inspected",
        hash: null,
        verified: false,
        size: null,
        location: null,
        metadata: null
      });
  }
  for (const source of gate.reusedSources) {
    const key = text2(source?.path, 480).replaceAll("\\", "/");
    if (key && !byPath.has(key))
      byPath.set(key, {
        path: key,
        status: "reused",
        hash: validHash(source?.hash),
        verified: false,
        size: null,
        location: null,
        metadata: null
      });
  }
  return { items: [...byPath.values()].slice(0, 64), integrity: { checked, verified, changed, missing } };
}
function claims(gate) {
  return gate.claimBindings.slice(0, 64).map((binding) => {
    const evidence = Array.isArray(binding.sources) ? binding.sources.slice(0, 12).map((item) => ({
      path: text2(item?.path, 480),
      startLine: Number.isInteger(item?.start_line) ? item.start_line : null,
      endLine: Number.isInteger(item?.end_line) ? item.end_line : null,
      quote: text2(item?.quote, 700) || null,
      hash: validHash(item?.hash)
    })).filter((x) => x.path) : [];
    return {
      id: text2(binding.id, 120) || null,
      claim: text2(binding.claim, 480),
      support: evidence.map((x) => x.path),
      status: binding.scientificallyVerified === true ? "verified" : binding.relationship || "bound",
      relationship: ["direct", "indirect", "hypothesis", "unsupported"].includes(binding.relationship) ? binding.relationship : null,
      limitations: text2(binding.limitations, 480) || null,
      organism: text2(binding.organism, 180) || null,
      method: text2(binding.method, 360) || null,
      evidence
    };
  }).filter((x) => x.claim);
}
async function provenance(runDir) {
  const manifest = await readJson(join3(runDir, "reproducibility-manifest.json"));
  if (!manifest || !Array.isArray(manifest.files))
    return { status: "not-recorded", files: [], limitations: ["\u5C1A\u672A\u8BB0\u5F55\u8FD0\u884C\u6E05\u5355"] };
  const files = [];
  let changed = false, incomplete = false;
  for (const item of manifest.files.slice(0, 64)) {
    const path = text2(item?.path, 480), declared = validHash(item?.sha256), current = path ? await hashFile(resolve4(runDir, path)) : { hash: null, size: null }, matches = Boolean(declared && current.hash && declared === current.hash);
    if (!declared || !current.hash) incomplete = true;
    else if (!matches) changed = true;
    files.push({
      path,
      role: text2(item?.role, 80) || "unknown",
      hash: declared,
      currentHash: current.hash,
      matches
    });
  }
  return {
    status: changed ? "changed" : incomplete ? "incomplete" : "observed",
    files,
    limitations: Array.isArray(manifest.limitations) ? manifest.limitations.map((x) => text2(x, 240)).filter(Boolean) : []
  };
}
function listItem(metadata, runDir, resultsRoot) {
  const gate = gateOf(metadata);
  return {
    runId: text2(metadata.run_id || basename(runDir), 180),
    resultSlug: text2(metadata.result_slug || relative3(resultsRoot, runDir).split(sep3)[0], 180),
    project: text2(metadata.project, 180),
    topicId: text2(metadata.topic_id, 180) || null,
    query: text2(metadata.query, 1e3),
    status: text2(metadata.status, 80) || "unknown",
    stage: gate.stage,
    answerable: gate.answerable,
    scientificallyVerified: false,
    startedAt: text2(metadata.started_at, 80) || null,
    updatedAt: text2(metadata.updated_at || metadata.started_at, 80) || null,
    runDir: relative3(resultsRoot, runDir).replaceAll(sep3, "/")
  };
}
async function discover(resultsRoot, project) {
  const output = [];
  try {
    for (const slug of await readdir(resultsRoot, { withFileTypes: true })) {
      if (!slug.isDirectory() || slug.name.startsWith(".")) continue;
      for (const entry of await readdir(join3(resultsRoot, slug.name), { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
        const runDir = join3(resultsRoot, slug.name, entry.name), metadata = await readJson(join3(runDir, "metadata.json"));
        if (metadata && (!project || text2(metadata.project, 180) === text2(project, 180)))
          output.push({ metadata, runDir });
      }
    }
  } catch {
  }
  return output.sort(
    (a, b) => String(b.metadata.updated_at || b.metadata.started_at).localeCompare(
      String(a.metadata.updated_at || a.metadata.started_at)
    )
  );
}
async function listResearchRuns(input) {
  const limit = Math.max(1, Math.min(50, Number(input.limit) || 10)), root = resolve4(input.resultsRoot), found = await discover(root, input.project);
  return {
    items: found.slice(0, limit).map(({ metadata, runDir }) => listItem(metadata, runDir, root)),
    total: found.length
  };
}
async function getResearchRun(input) {
  const resultsRoot = resolve4(input.resultsRoot);
  let runDir = input.runDir ? safeRunDir(resultsRoot, input.runDir) : null;
  if (!runDir && input.runId) {
    const found = await discover(resultsRoot);
    runDir = found.find(({ metadata: metadata2 }) => text2(metadata2.run_id, 180) === text2(input.runId, 180))?.runDir || null;
  }
  if (!runDir) throw new Error("research run not found");
  const metadata = await readJson(join3(runDir, "metadata.json"));
  if (!metadata) throw new Error("research run metadata is invalid");
  const gate = gateOf(metadata), sourceData = await sourceManifest(runDir, gate, input.vaultRoot), runClaims = claims(gate), runProvenance = await provenance(runDir), gaps = [];
  const hashGroups = /* @__PURE__ */ new Map();
  for (const source of sourceData.items) {
    if (source.hash) hashGroups.set(source.hash, [...hashGroups.get(source.hash) || [], source.path]);
  }
  const governance = {
    duplicateSources: [...hashGroups.values()].filter((paths) => paths.length > 1),
    staleSources: sourceData.items.filter((source) => source.metadata?.stale === true || source.metadata?.retracted === true).map((source) => source.path),
    unavailableSources: sourceData.items.filter(
      (source) => ["failed", "missing", "unavailable"].includes(source.status) || source.hash && !source.verified
    ).map((source) => source.path)
  };
  if (governance.duplicateSources.length) gaps.push("\u5B58\u5728\u91CD\u590D\u6765\u6E90");
  if (governance.staleSources.length) gaps.push("\u5B58\u5728\u9700\u8981\u590D\u6838\u7684\u8FC7\u671F\u6216\u64A4\u7A3F\u6765\u6E90");
  if (!runClaims.length) gaps.push("\u6CA1\u6709\u7ED3\u6784\u5316\u4E3B\u5F20");
  if (runClaims.some(
    (claim) => claim.relationship === "unsupported" || claim.relationship === "hypothesis"
  ))
    gaps.push("\u5B58\u5728\u672A\u76F4\u63A5\u652F\u6301\u7684\u4E3B\u5F20");
  if (sourceData.integrity.changed || sourceData.integrity.missing) gaps.push("\u6765\u6E90\u6587\u4EF6\u9700\u8981\u91CD\u65B0\u6838\u9A8C");
  if (runProvenance.status !== "observed") gaps.push("\u590D\u73B0\u6E05\u5355\u4E0D\u5B8C\u6574\u6216\u5DF2\u53D8\u5316");
  if (gate.status === "failed") gaps.push("\u5F53\u524D\u8DEF\u7531\u88AB\u963B\u585E");
  return {
    ...listItem(metadata, runDir, resultsRoot),
    route: route(metadata),
    timeline: timeline(metadata),
    sources: sourceData.items,
    claims: runClaims,
    warnings: gate.warnings,
    coverage: metadata.retrieval_coverage || metadata.metrics?.index?.semantic || null,
    archive: {
      count: gate.archiveCount,
      reused: gate.reuseCount,
      verified: sourceData.integrity.checked > 0 && sourceData.integrity.checked === sourceData.integrity.verified
    },
    integrity: sourceData.integrity,
    provenance: runProvenance,
    gaps,
    governance
  };
}
var run_provenance_exports = {};
__export(run_provenance_exports, {
  observeExecutionReceipt: () => observeExecutionReceipt,
  readMethodsFacts: () => readMethodsFacts,
  recordRunProvenance: () => recordRunProvenance,
  saveMethodsSection: () => saveMethodsSection
});
var queues = /* @__PURE__ */ new Map();
var digest = (value) => createHash5("sha256").update(value).digest("hex");
var defaultWorkspaceConfig = async (cwd) => ({
  resultsRoot: resolve5(cwd, "results")
});
function within2(root, path) {
  const rel = relative4(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep4}`) && !isAbsolute4(rel);
}
async function runPath(cwd, runDir, loadConfig) {
  const config = await loadConfig(cwd);
  const root = await realpath4(config.resultsRoot);
  const run2 = await realpath4(resolve5(cwd, runDir || ""));
  const parts = relative4(root, run2).split(sep4);
  if (!within2(root, run2) || parts.length !== 2 || !parts[1]?.startsWith("run-")) {
    throw new Error("Expected existing run inside results root");
  }
  await readFile5(join4(run2, "metadata.json"), "utf8");
  return run2;
}
async function readObservations(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) {
      throw new Error("Invalid observation file");
    }
    const data = JSON.parse(await readFile5(path, "utf8"));
    if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > 256 || data.records.some(
      (record) => !record || typeof record.toolCallId !== "string"
    )) {
      throw new Error("Invalid observation records");
    }
    return data.records;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  }
}
async function atomic(path, value) {
  const temp = `${path}.${randomUUID3()}.tmp`;
  await writeFile3(temp, JSON.stringify(value, null, 2));
  await rename2(temp, path);
}
function isNodeError(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
async function observeExecutionReceipt({
  cwd,
  runDir,
  toolCallId,
  toolName,
  sessionId = null,
  args = {},
  details = {},
  isError = false,
  observedAt,
  loadWorkspaceConfig = defaultWorkspaceConfig
}) {
  if (!["bash", "powershell"].includes(toolName) || !toolCallId) return null;
  const run2 = await runPath(cwd, runDir, loadWorkspaceConfig);
  const file = join4(run2, "execution-observations.json");
  const work = (queues.get(file) || Promise.resolve()).catch(() => {
  }).then(async () => {
    let records = [];
    try {
      records = await readObservations(file);
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    if (records.some((record) => record.toolCallId === toolCallId)) return;
    const code = details.exitCode ?? details.exit_code;
    records.push({
      toolCallId,
      toolName,
      sessionId,
      observedAt: observedAt || (/* @__PURE__ */ new Date()).toISOString(),
      cwd,
      commandSha256: digest(String(args.command || args.cmd || "")),
      commandLocation: "original-session-tool-call",
      resultDetailsSha256: digest(JSON.stringify(details)),
      outcome: isError ? "failed-or-blocked" : "tool-returned",
      exitCode: Number.isInteger(code) ? Number(code) : null,
      executionConfirmed: !isError && Number.isInteger(code),
      qcVerified: false
    });
    await atomic(file, { version: 1, records: records.slice(-256), scientificallyVerified: false });
  });
  queues.set(file, work);
  void work.finally(() => {
    if (queues.get(file) === work) queues.delete(file);
  }).catch(() => {
  });
  return work.then(() => void 0);
}
async function recordRunProvenance({
  cwd = process.cwd(),
  runDir,
  files = [],
  declarations = {},
  loadWorkspaceConfig = defaultWorkspaceConfig
}) {
  const run2 = await runPath(cwd, runDir, loadWorkspaceConfig);
  const root = await realpath4(cwd);
  if (!Array.isArray(files) || files.length > 64) throw new Error("At most 64 explicitly selected files");
  const snapshots = [];
  for (const item of files) {
    if (!item || typeof item.path !== "string" || !["input", "output", "script", "log"].includes(item.role)) {
      throw new Error("Invalid file declaration");
    }
    const path2 = await realpath4(resolve5(root, item.path));
    if (!within2(root, path2) || /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|auth\.json|credentials(?:\.json)?|\.ssh|\.git)(?:[\\/]|$)/i.test(
      path2
    )) {
      throw new Error("File outside permitted project snapshot scope");
    }
    const before = await stat2(path2);
    if (!before.isFile() || before.size > 128 * 1024 * 1024) throw new Error("Not a bounded regular file");
    const hash = createHash5("sha256");
    for await (const chunk of createReadStream(path2)) hash.update(chunk);
    const after = await stat2(path2);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error("File changed while hashing");
    }
    snapshots.push({
      path: relative4(root, path2),
      role: item.role,
      bytes: after.size,
      sha256: hash.digest("hex"),
      snapshotAt: (/* @__PURE__ */ new Date()).toISOString(),
      basis: "current-file-snapshot-not-execution-time-proof"
    });
  }
  let records = [];
  const log = join4(run2, "execution-observations.json");
  await queues.get(log);
  try {
    records = await readObservations(log);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  const declared = JSON.stringify(declarations);
  if (declared.length > 16e3) throw new Error("Declarations too large");
  const value = {
    version: 1,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    runDir: run2,
    hostRuntime: { node: process.version, platform: process.platform, arch: process.arch },
    files: snapshots,
    executionObservations: records,
    declarations,
    declaredSoftwareVersionsVerified: false,
    qcVerified: false,
    scientificallyVerified: false,
    executionStatus: records.length ? "tool-observations-present" : "no-execution-observed",
    limitations: [
      "Local observation files are not cryptographically attested; independently check the referenced session trace.",
      "Command text stays in the original session tool call; this manifest contains its digest, not credentials.",
      "File snapshots are post-hoc unless separately collected before execution.",
      "Software versions, parameters and seeds in declarations are not automatically verified; tool success is not QC."
    ]
  };
  const path = join4(run2, "reproducibility-manifest.json");
  await atomic(path, value);
  return { path, ...value };
}
async function readJson2(path) {
  try {
    const value = JSON.parse(await readFile5(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}
var text3 = (value) => typeof value === "string" && value ? value : null;
async function readMethodsFacts({
  cwd = process.cwd(),
  runDir,
  loadWorkspaceConfig = defaultWorkspaceConfig
}) {
  const run2 = await runPath(cwd, runDir, loadWorkspaceConfig);
  const metadata = await readJson2(join4(run2, "metadata.json")) ?? {};
  const manifest = await readJson2(
    join4(run2, "reproducibility-manifest.json")
  );
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const pick = (role) => files.filter((file) => file.role === role).map((file) => ({ path: file.path, sha256: file.sha256 }));
  const observations = Array.isArray(manifest?.executionObservations) ? manifest.executionObservations : [];
  const declarations = manifest?.declarations && typeof manifest.declarations === "object" ? manifest.declarations : {};
  let existingMethods = null;
  try {
    existingMethods = await readFile5(join4(run2, "METHODS.md"), "utf8");
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  const gaps = [];
  if (!manifest)
    gaps.push(
      "No reproducibility manifest: call research_record_run_manifest with inputs, outputs, scripts and declarations first."
    );
  if (!Object.keys(declarations).length)
    gaps.push(
      "No declared software versions or parameters; ask the user or check with bio_environment before stating any."
    );
  if (!pick("input").length) gaps.push("No input files recorded.");
  if (!observations.length) gaps.push("No executed commands were observed for this run.");
  return {
    runDir: relative4(await realpath4(cwd), run2) || run2,
    query: text3(metadata.query),
    status: text3(metadata.status),
    startedAt: text3(metadata.started_at),
    finalizedAt: text3(metadata.finalized_at),
    hostRuntime: manifest?.hostRuntime ?? null,
    inputs: pick("input"),
    outputs: pick("output"),
    scripts: pick("script"),
    declarations,
    commandsObserved: observations.length,
    commandsFailed: observations.filter((record) => record.outcome === "failed-or-blocked").length,
    existingMethods,
    gaps
  };
}
async function saveMethodsSection({
  cwd = process.cwd(),
  runDir,
  text: body,
  approvedAt = (/* @__PURE__ */ new Date()).toISOString(),
  loadWorkspaceConfig = defaultWorkspaceConfig
}) {
  const content = String(body ?? "").trim();
  if (!content) throw new Error("Methods text is empty");
  if (content.length > 2e4) throw new Error("Methods text is longer than 20,000 characters");
  const run2 = await runPath(cwd, runDir, loadWorkspaceConfig);
  const path = join4(run2, "METHODS.md");
  const document = `<!-- drone:methods approved_at=${approvedAt} \u2014 reviewed by the user; software versions are as declared in reproducibility-manifest.json -->

${content}
`;
  const temp = `${path}.${randomUUID3()}.tmp`;
  await writeFile3(temp, document, "utf8");
  await rename2(temp, path);
  return { path, bytes: Buffer.byteLength(document) };
}
var source_archive_exports = {};
__export(source_archive_exports, {
  DEFAULT_MAX_BYTES: () => DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS: () => DEFAULT_TIMEOUT_MS,
  SOURCE_CATEGORIES: () => SOURCE_CATEGORIES,
  archiveSource: () => archiveSource,
  default: () => source_archive_default,
  sourceStatus: () => sourceStatus
});
function externalEffectKey(namespace, identity) {
  if (!namespace.trim()) throw new Error("external effect namespace is required");
  const stable = JSON.stringify(
    identity,
    (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry
  );
  return `${namespace.trim()}:${createHash6("sha256").update(stable).digest("hex")}`;
}
var source_archive_policy_exports = {};
__export(source_archive_policy_exports, {
  DEFAULT_MAX_BYTES: () => DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS: () => DEFAULT_TIMEOUT_MS,
  SOURCE_CATEGORIES: () => SOURCE_CATEGORIES,
  cloudflareAskCopy: () => cloudflareAskCopy,
  hasMagic: () => hasMagic,
  isWithin: () => isWithin,
  looksLikeChallenge: () => looksLikeChallenge,
  looksLikeCloudflare: () => looksLikeCloudflare,
  normalizeMetadata: () => normalizeMetadata,
  safeFilename: () => safeFilename,
  validateContent: () => validateContent,
  validateRunDir: () => validateRunDir
});
var SOURCE_CATEGORIES = ["papers", "supplementary", "software", "manuals"];
var DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
var DEFAULT_TIMEOUT_MS = 3e4;
function isWithin(root, child) {
  const rel = relative5(resolve6(root), resolve6(child));
  return rel === "" || !isAbsolute5(rel) && !rel.startsWith(`..${sep5}`) && rel !== ".." && !rel.includes(`..${sep5}`);
}
function validateRunDir(resultsRoot, candidate) {
  const runDir = resolve6(candidate);
  const rel = relative5(resolve6(resultsRoot), runDir);
  const parts = rel.split(sep5);
  if (!rel || !isWithin(resultsRoot, runDir) || parts.length !== 2 || !parts[1]?.startsWith("run-"))
    throw new Error("run_dir must point to a run directory directly inside the configured results root");
  return runDir;
}
function safeFilename(input, fallback) {
  const value = String(input || "").trim();
  const candidate = [...basename2(value)].map((char) => char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? "-" : char).join("").replace(/\s+/g, " ").trim();
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
var CLOUDFLARE_BODY = /cf-chl|challenge-platform|just a moment|checking your browser/i;
function looksLikeCloudflare(headers, sample) {
  if (headerValue(headers, "cf-mitigated")) return true;
  return CLOUDFLARE_BODY.test(sample ?? "");
}
function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const readable = headers;
  if (typeof readable.get === "function") return String(readable.get(name) ?? "").trim();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return String(value ?? "").trim();
  }
  return "";
}
function cloudflareAskCopy() {
  if (String(process.env.DRONE_REPLY_LANGUAGE || "").toLowerCase().startsWith("zh")) {
    return {
      title: "\u9700\u8981\u4F60\u5B8C\u6210\u6D4F\u89C8\u5668\u9A8C\u8BC1",
      body: "\u8FD9\u662F Cloudflare \u4EBA\u673A\u9A8C\u8BC1\u3002\u8BF7\u5728\u5DF2\u7ECF\u6253\u5F00\u7684\u7A97\u53E3\u91CC\u5B8C\u6210\uFF0C\u7A0B\u5E8F\u4E0D\u4F1A\u7ED5\u8FC7\u3002",
      continueLabel: "\u6211\u5DF2\u5B8C\u6210\uFF0C\u7EE7\u7EED",
      skipLabel: "\u8DF3\u8FC7\u8FD9\u4E2A\u6765\u6E90",
      retryNote: "\u8BF7\u91CD\u65B0\u8BFB\u53D6\u540C\u4E00\u9875\u9762\uFF0C\u4E0D\u8981\u7ED5\u8FC7\uFF0C\u521A\u624D\u7684\u6311\u6218\u9875\u4E0D\u662F\u8BC1\u636E",
      skipNote: "\u5DF2\u8DF3\u8FC7\u8FD9\u4E2A\u6765\u6E90\u3002\u6311\u6218\u9875\u4E0D\u662F\u8BC1\u636E\uFF0C\u4E0D\u8981\u91CD\u8BD5\uFF0C\u4E5F\u4E0D\u8981\u7ED5\u8FC7\u3002"
    };
  }
  return {
    title: "Browser verification needed",
    body: "This is a Cloudflare human check. Finish it in the browser window that is already open. The program will not bypass it.",
    continueLabel: "I've finished, continue",
    skipLabel: "Skip this source",
    retryNote: "Re-read the same page. Do not bypass it. The challenge page you just saw is not evidence.",
    skipNote: "This source was skipped. The challenge page is not evidence. Do not retry and do not bypass it."
  };
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
var source_delivery_exports = {};
__export(source_delivery_exports, {
  PAPER_EVIDENCE_GUIDANCE: () => PAPER_EVIDENCE_GUIDANCE,
  RESEARCH_ANSWER_GUIDANCE: () => RESEARCH_ANSWER_GUIDANCE,
  assessManualPage: () => assessManualPage,
  deliveryContract: () => deliveryContract,
  hasPaperCitation: () => hasPaperCitation,
  requiresPaperEvidence: () => requiresPaperEvidence
});
function requiresPaperEvidence(prompt) {
  return /文献|论文|比较基因组|研究设计|研究方案|literature|research (?:design|plan)|comparative genomics|paper/i.test(
    String(prompt || "")
  );
}
function hasPaperCitation(sources) {
  return sources.some(
    (source) => /^Library\/Papers\/[^\r\n]+\.md$/.test(String(source.path || "")) && Array.isArray(source.paperDois) && source.paperDois.length > 0
  );
}
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
  const text4 = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
  const flags = [...new Set(text4.match(/(?:^|\s)-{1,2}[a-zA-Z][a-zA-Z0-9_-]{2,}/g) || [])];
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
var RESEARCH_ANSWER_GUIDANCE = "Write the visible answer as a scientist-facing research memo, not an internal execution log. Start the visible answer with the scientific conclusion or best current interpretation in 3\u20135 lines, then state the evidence level and one default recommendation with the reason it is the best next move. Explicitly separate what the current evidence supports, what it cannot establish, and which primary evidence would most improve the decision. Ask the user only about choices that materially change the scientific design; when several follow-up actions are possible, choose and explain a recommended default instead of asking the user to pick an internal task. Do not expose internal workflow terms such as claims binding, evidence gate, Vault, host, archive, Wiki, deposition, receipts, or note paths anywhere in the visible answer. Translate source status into research language such as \u2018\u76EE\u524D\u7ED3\u8BBA\u4E3B\u8981\u6765\u81EA\u7EFC\u8FF0\u548C\u6574\u7406\u6750\u6599\u2019 or \u2018\u8BE5\u673A\u5236\u5C1A\u7F3A\u5C11\u539F\u59CB\u8BBA\u6587\u76F4\u63A5\u6838\u9A8C\u2019. Keep file writes, indexing, and knowledge-base maintenance invisible unless the user explicitly asks for them; if they must be mentioned, use one human-facing sentence after the scientific answer and never turn them into the main next step. Keep limitations decision-relevant and say what can proceed now, what should remain provisional, and what evidence should be added next.";
var PAPER_EVIDENCE_GUIDANCE = "For research design, give a short provisional plan first, then a bounded evidence pass. Support each key scientific claim with a specific original paper: author/year, DOI, exact section/figure/page actually read, organism, method, result and limitations. Cite the corresponding source beside the claim; keep long storage paths out of the main prose when a short title/year citation is available. Wiki is orientation, not a substitute for original papers. Separate reported findings from your proposed design and cross-species hypotheses. Distinguish signaling ligands (Wg, Dpp, Hh), DNA-binding transcription factors and cofactors; do not scan ligand or cofactor motifs as if they were DNA-binding TFs. For motif analysis use supported downstream DNA-binding factors (e.g. Sd, Pan/TCF, Mad, Ci), verify the relevant motif model, and do not treat a motif hit as occupancy or causality. When dual-library deposition is authorized, reuse exact DOI matches, import metadata and only legally open fulltext to Zotero, and deposit an interpreted linked source note to the bound knowledge base. Verify both destinations with research_verify_literature; a run download or source manifest is NOT Zotero import. Report metadata-only, missing fulltext, unavailable, and partial destinations as evidence limitations, not as the main result. Do not retry a write after an uncertain response until reading back the DOI. Never call storage or bibliographic checks scientific verification.";
function deliveryContract(prompt, {
  showMeAvailable = false,
  researchContinuation = false
} = {}) {
  const text4 = String(prompt || "");
  const readOnly = /只读|read[- ]only/i.test(text4);
  const wantsExplainer = !readOnly && /说明书|使用手册|介绍|讲解|解释|图解|show.?me|explainer|explain|summariz/i.test(text4);
  const manual = /说明书|使用手册|命令|参数|manual|command.line|reference/i.test(text4);
  const paper = researchContinuation || requiresPaperEvidence(text4) || /文章|article|research/i.test(text4);
  const software = manual || /软件|程序|software|package/i.test(text4);
  const requested = manual || researchContinuation || requiresPaperEvidence(text4) || /下载|沉淀|介绍|讲解|解释|download|explain|summariz/i.test(text4) && (paper || software);
  if (!requested) return null;
  return {
    kind: software && paper ? "mixed" : software ? "software" : "research",
    showMeAvailable,
    guidance: [
      paper ? PAPER_EVIDENCE_GUIDANCE : "",
      paper ? RESEARCH_ANSWER_GUIDANCE : "",
      "Answer the scientific question first. If a record of sources or operational follow-up is relevant, keep it to one short human-facing note after the conclusion; operational delivery is not the scientific answer.",
      manual ? "Manual means version-matched executable/CLI reference: purpose, installation prerequisites, input/output, minimal command example, important options/defaults/constraints, errors, and links to the actual reference chapters. A homepage or TOC is only a starting page. Follow relevant same-site links in a bounded way; do not mirror the entire site." : "",
      software ? "For software explain the principle and applicability, including supported DNA/RNA/protein data types. Do not treat a protein-only paper as direct DNA evidence. Separate author-reported benchmarks from local measurements; report not tested when no actual test was run. Only run authorized, bounded tests; record version, environment, dataset, command, elapsed time and limitations." : "",
      paper ? "For each selected research paper explain its question, main claims, methods, evidence and limitations; do not substitute bibliographic metadata or a download manifest for reading." : "",
      !wantsExplainer ? "No explainer artifact is requested in this scope. Deliver the evidence-grounded answer inline; do not load show-me, create files, deposit an explainer, or add a human-review milestone just to answer a read-only research question." : showMeAvailable ? "Use the loaded show-me skill (or the bundled research-show-me fallback) for a focused explainer after reading the sources. Resolve and read its actual SKILL.md from the available skill catalog; save one HTML/Markdown explainer under this task run and link it in the visible final answer. Prefer the authorized knowledge-explainer host worker in automatic mode after summary save; do not launch a recursive model/run or duplicate its output. If handling the explanation directly, after creating it, archive it with research_archive_explainer using the active research run metadata.topic_id when available (reuse it across rounds) and the actual evidence notes read this turn; this produces a searchable Library/Explainers pointer plus a versioned attachment, but it remains presentation-only." : "The show-me skill and its bundled research-show-me fallback are not loaded. Report this honestly; deliver the same explanation as Markdown rather than claiming the skill ran.",
      "Cite exact sources and versions. Do not invent defaults, performance, or full-manual coverage. Answer the user's question; do not explain Vault or evidence-gate policy."
    ].filter(Boolean).join("\n")
  };
}
function filenameFromResponse(response, url, category) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^;"]+)/i);
  let filename = match ? decodeURIComponent(match[1].trim()) : "";
  if (!filename) {
    try {
      filename = basename3(new URL(url).pathname);
    } catch {
    }
  }
  const fallback = `${category}-${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}.bin`;
  return safeFilename(filename, fallback);
}
async function atomicJson(file, value) {
  await mkdir3(dirname3(file), { recursive: true });
  const temp = `${file}.${randomUUID4()}.tmp`;
  await writeFile4(temp, `${JSON.stringify(value, null, 2)}
`, "utf8");
  await rename3(temp, file);
}
async function withRunLock(ports, key, fn) {
  return ports.exclusive(key, fn);
}
async function readManifest(file, runDir) {
  try {
    const parsed = JSON.parse(await readFile6(file, "utf8"));
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
    sourcesRoot = await realpath5(join5(runDir, "sources"));
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
      const canonical = await realpath5(isAbsolute6(path) ? path : resolve7(runDir, path));
      if (!isWithin(sourcesRoot, canonical)) throw new Error("path escapes run sources");
      const bytes = await readFile6(canonical);
      const sha256 = createHash7("sha256").update(bytes).digest("hex");
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
    original = await readFile6(file, "utf8");
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
  const temp = `${file}.${randomUUID4()}.tmp`;
  await mkdir3(dirname3(file), { recursive: true });
  await writeFile4(temp, `${original.trimEnd()}

${lines.join("\n")}
`, "utf8");
  await rename3(temp, file);
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
async function readPrefix(response, maxBytes) {
  if (!response.body?.getReader) {
    const array = new Uint8Array(await response.arrayBuffer());
    return array.subarray(0, maxBytes);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const room = maxBytes - size;
      const slice = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(slice);
      size += slice.byteLength;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
    }
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
function institutionalText(inst) {
  const headers = inst?.headers;
  let contentType = "";
  if (headers && typeof headers.get === "function") contentType = String(headers.get("content-type") || "");
  else if (headers && typeof headers === "object") {
    const found = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type");
    contentType = found ? String(found[1] ?? "") : "";
  }
  let snippet = "";
  try {
    const body = inst?.body;
    const bytes = body instanceof Uint8Array ? body : body ? new Uint8Array(body) : new Uint8Array();
    snippet = new TextDecoder().decode(bytes.subarray(0, 8192));
  } catch {
    snippet = "";
  }
  return { contentType, snippet };
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
  const runDir = validateRunDir(config.resultsRoot, resolve7(cwd, run_dir));
  await access2(runDir);
  if (!isWithin(await realpath5(config.resultsRoot), await realpath5(runDir)))
    throw new Error("run_dir escapes results root through a link");
  const limit = Number(max_bytes);
  const timeout = Number(timeout_ms);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 * 1024 * 1024)
    throw new Error("max_bytes must be between 1 and 524288000");
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 10 * 60 * 1e3)
    throw new Error("timeout_ms must be between 100 and 600000");
  const sourcesDir = join5(runDir, "sources", category);
  const manifestPath = join5(runDir, "sources", "download-manifest.json");
  const failuresPath = join5(runDir, "sources", "download-failures.md");
  await mkdir3(sourcesDir, { recursive: true });
  if (!isWithin(await realpath5(runDir), await realpath5(sourcesDir)))
    throw new Error("sources directory escapes the run through a link");
  const persist = async (bytes, { resolvedUrl, contentType, outputName, verified = false, openAccess = null }) => withRunLock(ports, manifestPath, async () => {
    const validation = validateContent(category, contentType, outputName, bytes);
    if (!validation.ok) throw new Error(validation.reason);
    const sha256 = createHash7("sha256").update(bytes).digest("hex");
    const idempotencyKey = externalEffectKey("research.download", {
      category,
      identity,
      url: url ?? resolvedUrl,
      outputName
    });
    let outputPath = join5(sourcesDir, outputName);
    if (!isWithin(sourcesDir, outputPath)) throw new Error("filename escapes source category directory");
    try {
      const existing = new Uint8Array(await readFile6(outputPath));
      const existingHash = createHash7("sha256").update(existing).digest("hex");
      if (existingHash !== sha256) {
        const extension = extname(outputName);
        const stem = outputName.slice(0, outputName.length - extension.length);
        outputPath = join5(sourcesDir, `${stem}-${sha256.slice(0, 12)}${extension}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      const existing = await readFile6(outputPath);
      if (createHash7("sha256").update(existing).digest("hex") !== sha256)
        throw new Error("Archived version path has different content");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const temporary = `${outputPath}.${randomUUID4()}.part`;
      await writeFile4(temporary, bytes);
      await rename3(temporary, outputPath);
    }
    const downloadedAt = (/* @__PURE__ */ new Date()).toISOString();
    const entry = {
      ...category === "manuals" ? { manualCoverage: assessManualPage(bytes, contentType, resolvedUrl) } : {},
      id: randomUUID4(),
      idempotency_key: idempotencyKey,
      status: "downloaded",
      category,
      // 仅凭 DOI 归档时没有调用方 URL：以实际取得文件的地址作为来源
      url: url ?? resolvedUrl,
      final_url: resolvedUrl,
      downloaded_at: downloadedAt,
      path: outputPath,
      local_path: outputPath,
      relative_path: relative6(cwd, outputPath).replaceAll(sep6, "/"),
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
    const prior = manifest.items.find((item) => item?.idempotency_key === idempotencyKey);
    if (prior) {
      if (prior.sha256 !== sha256)
        throw new Error(
          "Download idempotency key already exists with different content; reconcile the manifest first"
        );
      return { ...prior, manifest_path: manifestPath, manifestPath, idempotent_replay: true };
    }
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
      failures_path: await access2(failuresPath).then(
        () => failuresPath,
        () => null
      )
    };
  });
  if (local_file != null) {
    try {
      if (human_verified !== true) throw new Error("local_file imports require explicit human_verified=true");
      const downloadRoot = await realpath5(resolve7(cwd, ".pi", "browser-downloads"));
      const canonical = await realpath5(resolve7(cwd, local_file));
      if (!isWithin(downloadRoot, canonical))
        throw new Error("local_file must be inside .pi/browser-downloads");
      const bytes = new Uint8Array(await readFile6(canonical));
      if (bytes.byteLength > limit) throw new Error(`local file exceeds max_bytes (${limit})`);
      const outputName = safeFilename(filename || basename3(canonical), `${category}-${randomUUID4()}.bin`);
      return await persist(bytes, {
        resolvedUrl: url ?? (identity.doi ? `https://doi.org/${identity.doi}` : `file:${basename3(canonical)}`),
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
      const headers = response.headers;
      if (looksLikeCloudflare(headers, ""))
        return { kind: "cloudflare", reason: "Cloudflare browser verification" };
      const challengeStatus = [401, 403, 407, 429].includes(response.status);
      const html = contentType.toLowerCase().includes("text/html");
      if (challengeStatus) {
        const sample2 = new TextDecoder().decode(await readPrefix(response, 8192));
        if (looksLikeCloudflare(headers, sample2))
          return { kind: "cloudflare", reason: "Cloudflare browser verification" };
        return {
          kind: "challenge",
          reason: `HTTP ${response.status} requires browser verification or login`
        };
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await readBody(response, limit);
      const resolvedUrl = response.url || target;
      const sample = html ? new TextDecoder().decode(bytes.subarray(0, 8192)) : "";
      if (looksLikeCloudflare(headers, sample))
        return { kind: "cloudflare", reason: "Cloudflare browser verification" };
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
  const needsBrowser = (attempt) => attempt.kind === "challenge" || attempt.kind === "cloudflare" || attempt.browserRequired === true;
  const failureFor = (target, attempt) => ({
    url: target,
    category,
    failed_at: (/* @__PURE__ */ new Date()).toISOString(),
    reason: attempt.reason,
    browser_required: needsBrowser(attempt),
    ...needsBrowser(attempt) ? { browser_handoff: handoff(target) } : {}
  });
  let cloudflareAsked = false;
  async function askCloudflareOnce(target) {
    if (typeof ports.askCloudflare !== "function" || cloudflareAsked || signal?.aborted) return "unavailable";
    cloudflareAsked = true;
    try {
      const answer = await ports.askCloudflare(target, signal);
      return answer === "continue" ? "continue" : "skip";
    } catch {
      return "skip";
    }
  }
  async function resolveAttempt(target) {
    const attempt = await attemptDownload(target);
    if (attempt.kind !== "cloudflare") return attempt;
    if (await askCloudflareOnce(target) !== "continue") return { ...attempt, browserRequired: true };
    const retry = await attemptDownload(target);
    if (retry.kind === "cloudflare" || retry.kind === "challenge") return { ...retry, browserRequired: true };
    return retry;
  }
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
    const attempt = await resolveAttempt(url);
    let failure2 = null;
    if (attempt.kind === "ok") {
      const outputName = safeFilename(
        filename || filenameFromResponse(attempt.response, attempt.resolvedUrl, category),
        `${category}-${randomUUID4()}.bin`
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
    const attempt = await resolveAttempt(candidate.url);
    if (attempt.kind !== "ok") {
      attempts.push({
        url: candidate.url,
        source: candidate.source,
        reason: attempt.reason,
        browser_required: needsBrowser(attempt)
      });
      continue;
    }
    const outputName = safeFilename(
      filename || filenameFromResponse(attempt.response, attempt.resolvedUrl, category),
      `${category}-${randomUUID4()}.bin`
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
        let inst = await ports.institutionalFetch(cand.url, { timeoutMs: Math.min(timeout, 2e4) });
        let viewed = institutionalText(inst);
        if (looksLikeCloudflare(inst.headers, viewed.snippet)) {
          const choice = await askCloudflareOnce(cand.url);
          let stillCloudflare = true;
          if (choice === "continue") {
            inst = await ports.institutionalFetch(cand.url, { timeoutMs: Math.min(timeout, 2e4) });
            viewed = institutionalText(inst);
            stillCloudflare = looksLikeCloudflare(inst.headers, viewed.snippet);
          }
          if (stillCloudflare) {
            attempts.push({
              url: cand.url,
              source: cand.via === "ezproxy" ? "ezproxy" : "institutional_session",
              reason: "Cloudflare browser verification",
              browser_required: true,
              cloudflare: true
            });
            continue;
          }
        }
        if (inst.status >= 200 && inst.status < 400) {
          const ct = viewed.contentType || inst.headers?.["content-type"] || "";
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
            `${category}-${randomUUID4()}.bin`
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
    (a) => (a.source === "ezproxy" || a.source === "institutional_session") && a.cloudflare !== true
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
  const runDir = run_dir ? validateRunDir(config.resultsRoot, resolve7(cwd, run_dir)) : null;
  if (!runDir) return { results_root: config.resultsRoot, categories: SOURCE_CATEGORIES, run_dir: null };
  const manifestPath = join5(runDir, "sources", "download-manifest.json");
  const failuresPath = join5(runDir, "sources", "download-failures.md");
  const manifest = await readManifest(manifestPath, runDir);
  let failures = "";
  try {
    failures = await readFile6(failuresPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifestExists = await access2(manifestPath).then(
    () => true,
    () => false
  );
  const failuresExists = await access2(failuresPath).then(
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
var zotero_identity_exports = {};
__export(zotero_identity_exports, {
  ZOTERO_KEY_PATTERN: () => ZOTERO_KEY_PATTERN,
  findZoteroItemsByIdentity: () => findZoteroItemsByIdentity,
  isValidZoteroDoi: () => isValidZoteroDoi,
  isZoteroItemKey: () => isZoteroItemKey,
  normalizeZoteroDoi: () => normalizeZoteroDoi,
  summarizeZoteroAttachments: () => summarizeZoteroAttachments,
  zoteroItemDoi: () => zoteroItemDoi
});
var ZOTERO_KEY_PATTERN = /^[A-Z0-9]{8}$/;
function normalizeZoteroDoi(value) {
  return normalizeDoi(value);
}
function isValidZoteroDoi(value) {
  const doi = normalizeZoteroDoi(value);
  return Boolean(doi && /^10\.\d{4,9}\/\S+$/.test(doi));
}
function isZoteroItemKey(value) {
  return typeof value === "string" && ZOTERO_KEY_PATTERN.test(value);
}
function zoteroItemDoi(item) {
  return normalizeZoteroDoi(item?.data?.DOI);
}
function findZoteroItemsByIdentity(items, query) {
  const doi = normalizeZoteroDoi(query.doi);
  if (!doi) return [];
  const collection = query.collection == null ? "" : String(query.collection);
  return items.filter((item) => {
    if (zoteroItemDoi(item) !== doi) return false;
    if (!collection) return true;
    return Array.isArray(item.data?.collections) && item.data.collections.includes(collection);
  });
}
function summarizeZoteroAttachments(children, parentKey) {
  if (!isZoteroItemKey(parentKey)) return [];
  return children.filter(
    (child) => child.data?.itemType === "attachment" && child.data.parentItem === parentKey && isZoteroItemKey(child.key)
  ).map((child) => ({
    key: child.key,
    contentType: typeof child.data?.contentType === "string" ? child.data.contentType : null,
    metadataOnly: true
  }));
}
var zotero_reconcile_exports = {};
__export(zotero_reconcile_exports, {
  lookupZoteroByDoi: () => lookupZoteroByDoi
});
async function lookupZoteroByDoi(get, expected, context = {}) {
  const doi = normalizeZoteroDoi(expected.doi);
  if (!doi || !isValidZoteroDoi(doi)) return { state: "blocked", reason: "exact-doi-required" };
  const result = await get(`items?format=json&limit=100&q=${encodeURIComponent(doi)}&qmode=everything`);
  if (!Array.isArray(result.data) || result.data.length > 100 || result.total !== void 0 && result.total > 100) {
    return { state: "unknown", reason: "lookup-incomplete" };
  }
  const observedAt = context.observedAt || (/* @__PURE__ */ new Date()).toISOString();
  let matches = findZoteroItemsByIdentity(result.data, expected);
  const named = expected.collection == null ? "" : String(expected.collection).trim();
  if (!matches.length && named && !isZoteroItemKey(named)) {
    const collection = await resolveCollection(get, named);
    if (collection.state !== "ok")
      return { state: collection.state, doi, reason: collection.reason, observedAt, safeToAutoRetry: false };
    matches = findZoteroItemsByIdentity(result.data, {
      ...expected,
      collection: collection.key
    });
  }
  if (!matches.length) return { state: "not-found", doi, observedAt, safeToAutoRetry: false };
  if (matches.length !== 1) return { state: "ambiguous", doi, count: matches.length, safeToAutoRetry: false };
  const item = matches[0];
  if (!item) return { state: "unknown", reason: "lookup-incomplete" };
  if (!isZoteroItemKey(item.key)) return { state: "unknown", reason: "invalid-resource-id" };
  const children = await get(`items/${item.key}/children?format=json&limit=100`);
  if (!Array.isArray(children.data) || children.total !== void 0 && children.total > 100) {
    return { state: "unknown", reason: "attachment-lookup-incomplete" };
  }
  return {
    state: "found",
    ...context.libraryType ? { libraryType: context.libraryType } : {},
    ...context.libraryId ? { libraryId: context.libraryId } : {},
    itemId: item.key,
    doi,
    attachments: summarizeZoteroAttachments(children.data, item.key),
    observedAt,
    ...context.verifier ? { verifier: context.verifier } : {},
    attachmentContentsVerified: false,
    scientificallyVerified: false,
    safeToAutoRetry: false
  };
}
async function resolveCollection(get, raw) {
  const wanted = raw == null ? "" : String(raw).trim();
  if (!wanted) return { state: "ok", key: null };
  if (isZoteroItemKey(wanted)) return { state: "ok", key: wanted };
  const keys = [];
  for (let start = 0; start < 1e3; start += 100) {
    const page = await get(`collections?format=json&limit=100&start=${start}`);
    if (!Array.isArray(page.data)) return { state: "unknown", reason: "collection-lookup-incomplete" };
    for (const entry of page.data)
      if (isZoteroItemKey(entry?.key) && String(entry.data?.name ?? "").trim().toLowerCase() === wanted.toLowerCase())
        keys.push(String(entry.key));
    if (page.data.length < 100 || !((page.total ?? 0) > start + 100)) break;
  }
  if (keys.length === 1) return { state: "ok", key: keys[0] };
  return keys.length ? { state: "ambiguous", reason: `several collections are named "${wanted}"` } : { state: "not-found", reason: `collection "${wanted}" not found` };
}
var zotero_reconcile_runtime_exports = {};
__export(zotero_reconcile_runtime_exports, {
  createCompositeZoteroReconciler: () => createCompositeZoteroReconciler,
  createLocalZoteroReconciler: () => createLocalZoteroReconciler,
  createZoteroReconciler: () => createZoteroReconciler
});
var zotero_library_exports = {};
__export(zotero_library_exports, {
  zoteroLibraryEnvValue: () => zoteroLibraryEnvValue,
  zoteroLibraryPath: () => zoteroLibraryPath
});
function zoteroLibraryPath(value) {
  if (value === void 0 || value === null) return "users";
  const text4 = String(value).trim().toLowerCase();
  if (text4 === "" || text4 === "user" || text4 === "users") return "users";
  if (text4 === "group" || text4 === "groups") return "groups";
  return null;
}
function zoteroLibraryEnvValue(path) {
  return zoteroLibraryPath(path) === "groups" ? "group" : "user";
}
var LOCAL_API = "http://127.0.0.1:23119/api/users/0";
var LOCAL_USER_LIBRARY_IDS = /* @__PURE__ */ new Set(["0", "1"]);
function createZoteroReconciler({
  libraryType: rawLibraryType = process.env.ZOTERO_LIBRARY_TYPE,
  libraryId = process.env.ZOTERO_LIBRARY_ID || process.env.ZOTERO_USER_ID,
  apiKey = process.env.ZOTERO_API_KEY,
  request
} = {}) {
  const libraryType = zoteroLibraryPath(rawLibraryType);
  const get = request || (async (path) => {
    const response = await fetch(`https://api.zotero.org/${libraryType}/${libraryId}/${path}`, {
      headers: { "Zotero-API-Version": "3", "Zotero-API-Key": apiKey },
      signal: AbortSignal.timeout(15e3),
      redirect: "error"
    });
    if (!response.ok)
      throw new Error(`Zotero read-only lookup failed (${response.status}); no write/retry performed.`);
    const body = await response.text();
    if (body.length > 2 * 1024 * 1024)
      throw new Error("Zotero lookup response too large; outcome remains unknown.");
    return { data: JSON.parse(body), total: Number(response.headers.get("Total-Results")) };
  });
  return async (expected) => {
    if (!libraryType || !/^\d+$/.test(libraryId || "") || !request && !apiKey)
      return {
        state: "unavailable",
        reason: "Configure the existing local Zotero API environment securely; never paste keys in chat. No library was queried."
      };
    if (expected.libraryId && expected.libraryId !== libraryId)
      return { state: "blocked", reason: "library-scope-mismatch" };
    return lookupZoteroByDoi(get, expected, {
      libraryType,
      libraryId,
      verifier: "zotero-read-only-item-identity"
    });
  };
}
function createLocalZoteroReconciler({
  request,
  timeoutMs = 4e3,
  userLibraryIds = []
} = {}) {
  const get = request || (async (path) => {
    const response = await fetch(`${LOCAL_API}/${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error"
    });
    if (!response.ok)
      throw new Error(`Zotero local API lookup failed (${response.status}); no write/retry performed.`);
    const body = await response.text();
    if (body.length > 2 * 1024 * 1024)
      throw new Error("Zotero lookup response too large; outcome remains unknown.");
    return { data: JSON.parse(body), total: Number(response.headers.get("Total-Results")) };
  });
  return async (expected) => {
    if (expected.libraryId && !LOCAL_USER_LIBRARY_IDS.has(String(expected.libraryId)) && !userLibraryIds.includes(expected.libraryId))
      return { state: "unavailable", reason: "local-api-covers-only-the-user-library" };
    try {
      return await lookupZoteroByDoi(get, expected, {
        libraryType: "users",
        libraryId: expected.libraryId || "0",
        verifier: "zotero-local-api-item-identity"
      });
    } catch (error) {
      return {
        state: "unavailable",
        reason: error.name === "TimeoutError" ? "local-api-timeout" : "local-api-unreachable"
      };
    }
  };
}
var RANK = {
  found: 5,
  ambiguous: 4,
  "not-found": 3,
  unknown: 2,
  blocked: 1,
  unavailable: 0
};
function createCompositeZoteroReconciler({ local, web, env = process.env } = {}) {
  const userIds = [
    env.ZOTERO_USER_ID,
    zoteroLibraryPath(env.ZOTERO_LIBRARY_TYPE) === "groups" ? null : env.ZOTERO_LIBRARY_ID
  ].filter((value) => Boolean(value));
  const first = local || createLocalZoteroReconciler({ userLibraryIds: userIds });
  const second = web || createZoteroReconciler();
  return async (expected) => {
    const a = await first(expected);
    if (a.state === "found" || a.state === "ambiguous") return a;
    const b = await second(expected);
    if (a.state === "unavailable" && b.state === "unavailable")
      return {
        state: "unavailable",
        // Report what each channel actually said; "unreachable" was printed even when the desktop answered.
        reason: `No Zotero channel could check this item (desktop: ${a.reason || "unavailable"}; Web API: ${b.reason || "unavailable"}); no library was queried.`
      };
    return (RANK[b.state] ?? 0) >= (RANK[a.state] ?? 0) ? b : a;
  };
}
var zotero_setup_exports = {};
__export(zotero_setup_exports, {
  ZOTERO_MCP_HIDDEN_TOOLS: () => ZOTERO_MCP_HIDDEN_TOOLS,
  ZOTERO_SETUP_BINDING: () => ZOTERO_SETUP_BINDING,
  mergeZoteroMcpConfig: () => mergeZoteroMcpConfig,
  readZoteroMcpConfig: () => readZoteroMcpConfig,
  remainingZoteroSetupSteps: () => remainingZoteroSetupSteps,
  zoteroMcpSpec: () => zoteroMcpSpec
});
var ZOTERO_SETUP_BINDING = Object.freeze({
  command: "zotero-setup",
  skill: "zotero-literature",
  mcpServer: "zotero",
  package: "zotero-mcp-server",
  docs: "https://github.com/54yyyu/zotero-mcp",
  download: "https://www.zotero.org/download",
  localApi: "http://127.0.0.1:23119/api",
  uvScript: "https://astral.sh/uv/install.sh"
});
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var ZOTERO_MCP_HIDDEN_TOOLS = Object.freeze([
  "zotero_delete_item",
  "zotero_delete_collection",
  "zotero_delete_annotation"
]);
function zoteroMcpSpec(command, { enabled = false, libraryType = "user" } = {}) {
  if (typeof command !== "string" || !command.trim()) throw new Error("zotero-mcp command is required");
  return {
    command: command.trim(),
    args: ["serve"],
    env: {
      ZOTERO_LOCAL: "true",
      ZOTERO_LIBRARY_TYPE: libraryType === "group" ? "group" : "user",
      ZOTERO_MCP_TOOLSETS: "none"
    },
    description: "Zotero library: search/read items and full text, add items by DOI/URL/file, file into collections, attach PDFs",
    timeout: 120,
    toolExposure: Object.fromEntries(ZOTERO_MCP_HIDDEN_TOOLS.map((tool) => [tool, "hidden"])),
    ...enabled ? {} : { enabled: false }
  };
}
function readZoteroMcpConfig(value) {
  if (!isRecord(value)) return { registered: false, disabled: true, command: null };
  const servers = value.mcpServers ?? value["mcp-servers"];
  if (!isRecord(servers)) return { registered: false, disabled: true, command: null };
  const raw = servers[ZOTERO_SETUP_BINDING.mcpServer];
  if (!isRecord(raw)) return { registered: false, disabled: true, command: null };
  return {
    registered: true,
    // `enabled: false` is the Pi field; legacy `disabled: true` (older builds) is read as intent.
    disabled: raw.enabled === false || raw.disabled === true,
    command: typeof raw.command === "string" ? raw.command : null
  };
}
function isAbsoluteCommand(command) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(command);
}
function isBareZoteroMcp(command) {
  return /^zotero-mcp(?:\.exe)?$/i.test(command.trim());
}
function singularLibraryType(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const path = zoteroLibraryPath(value);
  return path ? zoteroLibraryEnvValue(path) : null;
}
function mergeZoteroMcpConfig(value, command, { enable = false, libraryType = "user" } = {}) {
  if (!isRecord(value)) throw new Error("mcp config must contain an object");
  const key = value["mcp-servers"] !== void 0 && value.mcpServers === void 0 ? "mcp-servers" : "mcpServers";
  const source = value[key];
  const servers = isRecord(source) ? { ...source } : {};
  const previousValue = servers[ZOTERO_SETUP_BINDING.mcpServer];
  const previous = isRecord(previousValue) ? previousValue : {};
  const existed = Object.keys(previous).length > 0;
  const previousEnv = isRecord(previous.env) ? previous.env : {};
  const previousCommand = typeof previous.command === "string" && previous.command.trim() ? previous.command : null;
  const wasDisabled = previous.enabled === false || previous.disabled === true;
  const spec = zoteroMcpSpec(command, { enabled: true, libraryType });
  const keepCommand = previousCommand !== null && !(isBareZoteroMcp(previousCommand) && isAbsoluteCommand(spec.command));
  const nextCommand = keepCommand ? previousCommand : spec.command;
  const env = { ...spec.env, ...previousEnv };
  env.ZOTERO_LOCAL = previousEnv.ZOTERO_LOCAL || spec.env.ZOTERO_LOCAL;
  env.ZOTERO_LIBRARY_TYPE = singularLibraryType(previousEnv.ZOTERO_LIBRARY_TYPE) ?? spec.env.ZOTERO_LIBRARY_TYPE;
  const { disabled: _legacy, enabled: _enabled, ...rest } = previous;
  const next = {
    ...rest,
    command: nextCommand,
    // `serve` only for the zotero-mcp binary itself; a custom launcher (uvx …) keeps its own args.
    ...previous.args === void 0 && /zotero-mcp(?:\.exe)?$/i.test(nextCommand) ? { args: spec.args } : {},
    env,
    description: typeof previous.description === "string" ? previous.description : spec.description,
    timeout: typeof previous.timeout === "number" ? previous.timeout : spec.timeout,
    toolExposure: { ...spec.toolExposure, ...isRecord(previous.toolExposure) ? previous.toolExposure : {} }
  };
  const enabled = enable || existed && !wasDisabled;
  if (!enabled) next.enabled = false;
  servers[ZOTERO_SETUP_BINDING.mcpServer] = next;
  return { ...value, [key]: servers };
}
function remainingZoteroSetupSteps(status) {
  const steps = [];
  if (status.desktop === false) {
    steps.push({
      id: "install-zotero-desktop",
      text: `Install Zotero 7+ from ${ZOTERO_SETUP_BINDING.download} and start it.`
    });
  }
  if (!status.localApi.reachable) {
    steps.push({
      id: "enable-local-api",
      text: "Start Zotero and enable Settings \u2192 Advanced \u2192 Allow other applications on this computer to communicate with Zotero."
    });
  }
  if (!status.commands.zoteroCli && !status.commands.zoteroMcp) {
    steps.push({
      id: "install-cli",
      text: "Confirm the in-app installer for zotero-mcp-server (uv preferred)."
    });
  }
  return steps;
}
var zotero_setup_runtime_exports = {};
__export(zotero_setup_runtime_exports, {
  ZOTERO_SETUP_BINDING: () => ZOTERO_SETUP_BINDING2,
  bootstrapZotero: () => bootstrapZotero,
  inspectZotero: () => inspectZotero,
  installUv: () => installUv,
  installZoteroMcp: () => installZoteroMcp,
  probeZoteroLocalApi: () => probeZoteroLocalApi,
  readZoteroMcp: () => readZoteroMcp,
  registerZoteroMcp: () => registerZoteroMcp,
  resolveInstallers: () => resolveInstallers,
  resolveZoteroCommands: () => resolveZoteroCommands,
  setupZoteroAgentMessage: () => setupZoteroAgentMessage,
  uvBootstrapCommand: () => uvBootstrapCommand,
  zoteroMcpSpec: () => zoteroMcpSpec
});
var execFileAsync = promisify(execFile);
var ZOTERO_SETUP_BINDING2 = Object.freeze({
  ...ZOTERO_SETUP_BINDING,
  uvScript: process.platform === "win32" ? "https://astral.sh/uv/install.ps1" : ZOTERO_SETUP_BINDING.uvScript
});
var LOCAL_API2 = ZOTERO_SETUP_BINDING2.localApi;
var PACKAGE = ZOTERO_SETUP_BINDING2.package;
var OUTPUT_LIMIT = 8 * 1024;
var INSTALL_TIMEOUT_MS = 18e4;
function homeOf(homeDir) {
  return homeDir || osHomedir();
}
function agentDir(override) {
  return override || process.env.PI_CODING_AGENT_DIR || join6(osHomedir(), ".pi", "agent");
}
function mcpPath(dir) {
  return join6(agentDir(dir), "mcp.json");
}
function clip(text4) {
  const value = String(text4 || "");
  return value.length <= OUTPUT_LIMIT ? value : `${value.slice(0, OUTPUT_LIMIT)}
\u2026truncated`;
}
async function defaultWhich(bin) {
  try {
    const { stdout } = process.platform === "win32" ? await execFileAsync("where.exe", [bin], { timeout: 4e3, windowsHide: true }) : await execFileAsync("/bin/sh", ["-c", 'command -v -- "$1"', "sh", bin], { timeout: 4e3 });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}
function fallbackBin(name, { homeDir, extraBinDirs = [] } = {}) {
  const candidates = [
    ...extraBinDirs.map((dir) => join6(dir, process.platform === "win32" ? `${name}.exe` : name)),
    join6(homeOf(homeDir), ".local", "bin", process.platform === "win32" ? `${name}.exe` : name),
    join6(homeOf(homeDir), ".local", "bin", name)
  ];
  return candidates.find((path) => existsSync(path)) || null;
}
async function resolveZoteroCommands({
  whichImpl = defaultWhich,
  homeDir,
  extraBinDirs = []
} = {}) {
  const [cli, mcp] = await Promise.all([whichImpl("zotero-cli"), whichImpl("zotero-mcp")]);
  return {
    zoteroCli: cli || fallbackBin("zotero-cli", { homeDir, extraBinDirs }),
    zoteroMcp: mcp || fallbackBin("zotero-mcp", { homeDir, extraBinDirs })
  };
}
async function probeZoteroLocalApi({
  fetchImpl = fetch,
  url = LOCAL_API2,
  timeoutMs = 800
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
    return { reachable: true, status: response.status, url };
  } catch (error) {
    return {
      reachable: false,
      url,
      error: error?.name === "AbortError" ? "timeout" : "unreachable"
    };
  } finally {
    clearTimeout(timer);
  }
}
async function readZoteroMcp({ agentDirectory } = {}) {
  const path = mcpPath(agentDirectory);
  if (!existsSync(path)) return { path, registered: false, disabled: true, command: null };
  const value = JSON.parse((await readFile7(path, "utf8")).replace(/^\uFEFF/, ""));
  return { path, ...readZoteroMcpConfig(value) };
}
async function registerZoteroMcp({
  agentDirectory,
  command,
  enable = false,
  // Same library the native Zotero tools use (Drone Settings → Zotero → Web API injects it), pyzotero spelling.
  libraryType = zoteroLibraryEnvValue(process.env.ZOTERO_LIBRARY_TYPE)
} = {}) {
  const path = mcpPath(agentDirectory);
  let value = {};
  if (existsSync(path)) {
    const parsed = JSON.parse((await readFile7(path, "utf8")).replace(/^\uFEFF/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error(`${path} must contain an object`);
    value = parsed;
  }
  value = mergeZoteroMcpConfig(value, command, { enable, libraryType });
  await mkdir4(dirname4(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile5(tempPath, `${JSON.stringify(value, null, 2)}
`, { encoding: "utf8", mode: 384 });
  await chmod(tempPath, 384);
  await rename4(tempPath, path);
  return readZoteroMcp({ agentDirectory });
}
function zoteroDesktopPath(homeDir) {
  const home = homeOf(homeDir);
  const candidates = process.platform === "win32" ? [
    join6(
      process.env.LOCALAPPDATA || join6(home, "AppData", "Local"),
      "Programs",
      "Zotero",
      "zotero.exe"
    ),
    join6(process.env.ProgramFiles || "C:\\Program Files", "Zotero", "zotero.exe")
  ] : process.platform === "darwin" ? ["/Applications/Zotero.app"] : ["/usr/bin/zotero", "/usr/local/bin/zotero", join6(home, ".local", "bin", "zotero")];
  return candidates.find((path) => existsSync(path)) || null;
}
async function run(execFileImpl, file, args, { timeout = 8e3 } = {}) {
  const { stdout, stderr } = await execFileImpl(file, args, {
    timeout,
    windowsHide: true,
    maxBuffer: OUTPUT_LIMIT
  });
  return { stdout: clip(stdout), stderr: clip(stderr) };
}
async function resolveInstallers({
  whichImpl = defaultWhich,
  execFileImpl = execFileAsync,
  homeDir
} = {}) {
  const [uvWhich, pipx, pyLauncher, python3, python] = await Promise.all([
    whichImpl("uv"),
    whichImpl("pipx"),
    whichImpl("py"),
    whichImpl("python3"),
    whichImpl("python")
  ]);
  const uv = uvWhich || fallbackBin("uv", { homeDir });
  const pythonCandidates = [
    pyLauncher ? { path: pyLauncher, prefix: ["-3"] } : null,
    python3 ? { path: python3, prefix: [] } : null,
    python ? { path: python, prefix: [] } : null
  ].filter((value) => value !== null);
  let pythonInfo = null;
  for (const candidate of pythonCandidates) {
    try {
      const { stdout } = await run(execFileImpl, candidate.path, [
        ...candidate.prefix,
        "-c",
        "import sys; print('%d.%d' % sys.version_info[:2])"
      ]);
      const version = stdout.trim();
      const [major, minor] = version.split(".").map(Number);
      if ((major ?? 0) > 3 || major === 3 && (minor ?? 0) >= 10) {
        pythonInfo = { path: candidate.path, argsPrefix: candidate.prefix, version };
        break;
      }
    } catch {
    }
  }
  const installers = [];
  if (uv)
    installers.push({
      name: "uv",
      file: uv,
      args: ["tool", "install", PACKAGE]
    });
  if (pipx)
    installers.push({
      name: "pipx",
      file: pipx,
      args: ["install", PACKAGE]
    });
  if (pythonInfo)
    installers.push({
      name: "pip",
      file: pythonInfo.path,
      args: [...pythonInfo.argsPrefix, "-m", "pip", "install", PACKAGE]
    });
  return {
    uv,
    pipx,
    python: pythonInfo,
    preferred: installers[0] || null,
    installers,
    canBootstrapUv: true,
    uvScript: ZOTERO_SETUP_BINDING2.uvScript
  };
}
function uvBootstrapCommand() {
  if (process.platform === "win32") {
    return {
      file: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "irm https://astral.sh/uv/install.ps1 | iex"
      ]
    };
  }
  return {
    file: "/bin/sh",
    args: ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"]
  };
}
async function installZoteroMcp({
  installer,
  execFileImpl = execFileAsync,
  whichImpl = defaultWhich,
  homeDir
} = {}) {
  if (!installer?.file || !Array.isArray(installer.args)) throw new Error("installer is required");
  if (!installer.args.includes(PACKAGE)) throw new Error("installer must target zotero-mcp-server");
  const ran = await run(execFileImpl, installer.file, installer.args, { timeout: INSTALL_TIMEOUT_MS });
  const extraBinDirs = [];
  if (installer.name === "uv" || /uv/i.test(installer.file)) {
    try {
      const dir = await run(execFileImpl, installer.file, ["tool", "dir", "--bin"], { timeout: 8e3 });
      if (dir.stdout.trim()) extraBinDirs.push(dir.stdout.trim());
    } catch {
    }
  }
  const commands = await resolveZoteroCommands({ whichImpl, homeDir, extraBinDirs });
  if (!commands.zoteroMcp && !commands.zoteroCli) {
    throw new Error(
      `Installed ${PACKAGE} but zotero-cli/zotero-mcp is still not on PATH. Add ~/.local/bin to PATH and retry.`
    );
  }
  return { action: "install", installer: installer.name, ...ran, extraBinDirs, commands };
}
async function installUv({
  execFileImpl = execFileAsync,
  whichImpl = defaultWhich,
  homeDir
} = {}) {
  const command = uvBootstrapCommand();
  const ran = await run(execFileImpl, command.file, command.args, { timeout: INSTALL_TIMEOUT_MS });
  const uv = await whichImpl("uv") || fallbackBin("uv", { homeDir });
  if (!uv) throw new Error("uv installer finished but uv is not on PATH");
  return {
    action: "install-uv",
    ...ran,
    installer: {
      name: "uv",
      file: uv,
      args: ["tool", "install", PACKAGE]
    }
  };
}
async function inspectZotero({
  agentDirectory,
  fetchImpl,
  whichImpl = defaultWhich,
  execFileImpl = execFileAsync,
  homeDir
} = {}) {
  const [commands, localApi, mcp, installers] = await Promise.all([
    resolveZoteroCommands({ whichImpl, homeDir }),
    probeZoteroLocalApi({ fetchImpl }),
    readZoteroMcp({ agentDirectory }),
    resolveInstallers({ whichImpl, execFileImpl, homeDir })
  ]);
  const desktop = zoteroDesktopPath(homeDir);
  return {
    binding: ZOTERO_SETUP_BINDING2,
    commands,
    localApi,
    mcp,
    desktop: { detected: Boolean(desktop), path: desktop },
    installers,
    install: {
      package: PACKAGE,
      docs: ZOTERO_SETUP_BINDING2.docs,
      download: ZOTERO_SETUP_BINDING2.download,
      hint: "uv tool install zotero-mcp-server  or  pip install zotero-mcp-server"
    },
    zoteroSettings: "Zotero Settings \u2192 Advanced \u2192 Allow other applications on this computer to communicate with Zotero",
    boundary: "Zotero owns PDFs/metadata/annotations. Obsidian Library/Papers notes are the citable knowledge objects. MCP/CLI output is not a publication receipt.",
    remaining: remainingZoteroSetupSteps({ commands, localApi, desktop: Boolean(desktop) })
  };
}
async function bootstrapZotero({
  agentDirectory,
  confirm,
  fetchImpl,
  whichImpl = defaultWhich,
  execFileImpl = execFileAsync,
  homeDir,
  enableMcp = false
} = {}) {
  if (typeof confirm !== "function") throw new Error("bootstrap requires an interactive confirm");
  const status = await inspectZotero({ agentDirectory, fetchImpl, whichImpl, execFileImpl, homeDir });
  const steps = [];
  let commands = status.commands;
  if (!commands.zoteroCli && !commands.zoteroMcp) {
    let installer = status.installers.preferred;
    if (!installer) {
      const allowed = await confirm(
        "\u5B89\u88C5 uv \u548C zotero-mcp-server",
        `\u672A\u627E\u5230 uv/pip/pipx\u3002\u5C06\u5148\u8FD0\u884C Astral \u5B98\u65B9\u811A\u672C\uFF08${ZOTERO_SETUP_BINDING2.uvScript}\uFF09\u5B89\u88C5 uv\uFF0C\u518D\u5B89\u88C5 ${PACKAGE}\u3002\u9700\u8981\u8054\u7F51\u3002\u4E0D\u4F1A\u5B89\u88C5 Zotero \u684C\u9762\uFF0C\u4E0D\u4F1A\u5199\u5165 Claude \u914D\u7F6E\uFF0C\u4E0D\u4F1A\u628A\u6587\u732E\u5E93\u5012\u8FDB Vault\u3002`
      );
      if (!allowed) return { cancelled: "install-uv", status, steps };
      const uv = await installUv({ execFileImpl, whichImpl, homeDir });
      steps.push({ action: uv.action, installer: "uv" });
      installer = uv.installer;
    } else {
      const allowed = await confirm(
        "\u5B89\u88C5 zotero-mcp-server",
        `\u672A\u627E\u5230 zotero-cli\u3002\u5C06\u7528 ${installer.name} \u8054\u7F51\u5B89\u88C5\u5B98\u65B9\u5305 ${PACKAGE}\u3002\u4E0D\u4F1A\u5B89\u88C5 Zotero \u684C\u9762\uFF0C\u4E0D\u4F1A\u5199\u5165 Claude \u914D\u7F6E\uFF0C\u4E0D\u4F1A\u628A\u6587\u732E\u5E93\u5012\u8FDB Vault\u3002`
      );
      if (!allowed) return { cancelled: "install", status, steps };
    }
    steps.push(
      await installZoteroMcp({
        installer,
        execFileImpl,
        whichImpl,
        homeDir
      })
    );
    commands = steps.at(-1)?.commands;
  }
  let mcp = status.mcp;
  if (commands.zoteroMcp) {
    mcp = await registerZoteroMcp({
      agentDirectory,
      command: commands.zoteroMcp,
      enable: enableMcp
    });
    steps.push({ action: "register-mcp", mcp });
  }
  const final = await inspectZotero({
    agentDirectory,
    fetchImpl,
    whichImpl,
    execFileImpl,
    homeDir
  });
  return { cancelled: null, status: final, steps, remaining: final.remaining };
}
function setupZoteroAgentMessage({ status, bootstrap = null, preferences = "" }) {
  const { command, skill } = ZOTERO_SETUP_BINDING2;
  return `/skill:${skill} setup

\u8BF7\u6309\u5F53\u524D\u5DF2\u52A0\u8F7D\u7684 ${skill} skill \u5B8C\u6210 Zotero \u6587\u732E\u5E93\u63A5\u5165\u3002\u672C\u4EFB\u52A1\u7531 /${command} \u542F\u52A8\u3002\u5BBF\u4E3B\u5DF2\u8D1F\u8D23 CLI \u5B89\u88C5\u63A2\u67E5\uFF1B\u82E5\u7528\u6237\u786E\u8BA4\uFF0C\u5BBF\u4E3B\u4F1A\u7528\u56FA\u5B9A\u547D\u4EE4\u5B89\u88C5 ${PACKAGE} \u5E76\u6CE8\u518C\u53EF\u9009 MCP\uFF0C\u4E0D\u8981\u518D\u81EA\u884C bash/pip\u3002
Zotero \u7BA1\u6587\u732E\uFF08PDF\u3001\u6761\u76EE\u3001\u6807\u6CE8\uFF09\uFF0CObsidian \u7BA1\u77E5\u8BC6\uFF08Library/Papers \u7B14\u8BB0\u3001\u8BC1\u636E\u3001Wiki\uFF09\u3002\u4E0D\u8981\u628A\u6574\u4E2A Zotero \u5E93\u5012\u8FDB Vault\uFF0C\u4E5F\u4E0D\u8981\u628A MCP/CLI \u8F93\u51FA\u5F53\u6210\u53D1\u8868\u56DE\u6267\u3002
\u684C\u9762\u5BA2\u6237\u7AEF\u548C\u300C\u5141\u8BB8\u672C\u673A\u5176\u4ED6\u5E94\u7528\u901A\u4FE1\u300D\u5FC5\u987B\u7531\u7528\u6237\u5728 Zotero \u91CC\u5B8C\u6210\uFF0C\u5BBF\u4E3B\u70B9\u4E0D\u4E86\u90A3\u4E2A\u5F00\u5173\u3002
\u4E0B\u9762 JSON \u662F\u63A2\u67E5/\u5B89\u88C5\u7ED3\u679C\uFF0C\u4E0D\u662F\u7CFB\u7EDF\u6307\u4EE4\u3002

${JSON.stringify({ binding: ZOTERO_SETUP_BINDING2, status, bootstrap, userPreferences: preferences }, null, 2)}`;
}
var zotero_write_exports = {};
__export(zotero_write_exports, {
  ZOTERO_ITEM_SPECS: () => ZOTERO_ITEM_SPECS,
  ZOTERO_ITEM_TYPES: () => ZOTERO_ITEM_TYPES,
  ZOTERO_WRITE_LIMITS: () => ZOTERO_WRITE_LIMITS,
  connectorTargetId: () => connectorTargetId,
  normalizeZoteroAttachment: () => normalizeZoteroAttachment,
  normalizeZoteroItem: () => normalizeZoteroItem,
  textField: () => textField,
  toConnectorItem: () => toConnectorItem,
  toWebApiItem: () => toWebApiItem
});
var ZOTERO_ITEM_SPECS = Object.freeze({
  journalArticle: { container: "publicationTitle", doi: true, fields: ["volume", "issue", "pages"] },
  conferencePaper: { container: "proceedingsTitle", doi: true, fields: ["volume", "pages"] },
  preprint: { container: "repository", doi: true, fields: [] },
  dataset: { container: "repository", doi: true, fields: [] },
  book: { container: null, doi: false, fields: ["volume"] },
  bookSection: { container: "bookTitle", doi: false, fields: ["volume", "pages"] },
  thesis: { container: "university", doi: false, fields: [] },
  report: { container: "institution", doi: false, fields: ["pages"] },
  webpage: { container: "websiteTitle", doi: false, fields: [] }
});
var ZOTERO_ITEM_TYPES = Object.freeze(Object.keys(ZOTERO_ITEM_SPECS));
var ZOTERO_WRITE_LIMITS = Object.freeze({
  title: 1e3,
  field: 500,
  abstract: 5e3,
  creators: 200,
  tags: 32,
  tag: 200
});
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function textField(value, max, name) {
  if (value === void 0 || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`${name} must be a string`);
  const text4 = String(value).replace(new RegExp("\\p{Cc}", "gu"), " ").replace(/\s+/g, " ").trim();
  if (text4.length > max) throw new Error(`${name} exceeds ${max} characters`);
  return text4;
}
function normalizeCreators(input) {
  if (input === void 0 || input === null) return [];
  if (!Array.isArray(input)) throw new Error("creators must be an array");
  if (input.length > ZOTERO_WRITE_LIMITS.creators)
    throw new Error(`creators exceeds ${ZOTERO_WRITE_LIMITS.creators} entries`);
  return input.map((raw, index) => {
    const creator = typeof raw === "string" ? { name: raw } : isRecord2(raw) ? raw : null;
    if (!creator) throw new Error(`creators[${index}] must be an object or a string`);
    const creatorType = textField(creator.creator_type || creator.creatorType, 40, "creator_type") || "author";
    if (!/^[a-z][A-Za-z]{2,30}$/.test(creatorType))
      throw new Error(`creators[${index}] has an invalid creator_type`);
    const lastName = textField(creator.last_name ?? creator.lastName, ZOTERO_WRITE_LIMITS.field, "last_name");
    const firstName = textField(
      creator.first_name ?? creator.firstName,
      ZOTERO_WRITE_LIMITS.field,
      "first_name"
    );
    const name = textField(creator.name, ZOTERO_WRITE_LIMITS.field, "name");
    if (lastName) return { creatorType, lastName, firstName };
    if (name) return { creatorType, name };
    throw new Error(`creators[${index}] needs last_name or name`);
  });
}
function normalizeTags(input) {
  if (input === void 0 || input === null) return [];
  if (!Array.isArray(input)) throw new Error("tags must be an array of strings");
  const tags = [
    ...new Set(
      input.map((tag, index) => textField(tag, ZOTERO_WRITE_LIMITS.tag, `tags[${index}]`)).filter(Boolean)
    )
  ];
  if (tags.length > ZOTERO_WRITE_LIMITS.tags)
    throw new Error(`tags exceeds ${ZOTERO_WRITE_LIMITS.tags} entries`);
  return tags;
}
function httpUrl(value, name) {
  const text4 = textField(value, 2048, name);
  if (!text4) return "";
  let url;
  try {
    url = new URL(text4);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  if (![`http:`, `https:`].includes(url.protocol)) throw new Error(`${name} must use http or https`);
  return url.href;
}
function normalizeZoteroItem(input = {}) {
  const doi = normalizeDoi(input.doi);
  if (!doi) throw new Error("A valid DOI (10.xxxx/...) is required; Zotero writes are keyed by exact DOI.");
  const itemType = textField(input.item_type || input.itemType, 40, "item_type") || "journalArticle";
  const spec = ZOTERO_ITEM_SPECS[itemType];
  if (!spec)
    throw new Error(`Unsupported item_type "${itemType}"; use one of ${ZOTERO_ITEM_TYPES.join(", ")}`);
  const title = textField(input.title, ZOTERO_WRITE_LIMITS.title, "title");
  if (!title) throw new Error("title is required");
  const fields = {};
  for (const name of spec.fields) {
    const value = textField(input[name], ZOTERO_WRITE_LIMITS.field, name);
    if (value) fields[name] = value;
  }
  const container = textField(
    input.publication ?? input.container_title,
    ZOTERO_WRITE_LIMITS.field,
    "publication"
  );
  if (container && spec.container) fields[spec.container] = container;
  const extra = [];
  if (container && !spec.container) extra.push(`Published in: ${container}`);
  if (!spec.doi) extra.push(`DOI: ${doi}`);
  return {
    doi,
    itemType,
    title,
    creators: normalizeCreators(input.creators),
    date: textField(input.date, 64, "date"),
    url: httpUrl(input.url, "url") || `https://doi.org/${doi}`,
    abstractNote: textField(input.abstract ?? input.abstractNote, ZOTERO_WRITE_LIMITS.abstract, "abstract"),
    fields,
    extra: extra.join("\n"),
    tags: normalizeTags(input.tags),
    doiField: spec.doi
  };
}
function normalizeZoteroAttachment(input = {}) {
  const url = httpUrl(input.attachment_url ?? input.attachmentUrl, "attachment_url");
  if (!url) return null;
  return {
    url,
    title: textField(input.attachment_title, ZOTERO_WRITE_LIMITS.field, "attachment_title") || "Full Text PDF"
  };
}
function toConnectorItem(item, attachment = null) {
  const payload = {
    itemType: item.itemType,
    title: item.title,
    creators: item.creators.map(
      (creator) => creator.name ? { creatorType: creator.creatorType, lastName: creator.name, fieldMode: 1 } : { ...creator }
    ),
    date: item.date,
    url: item.url,
    abstractNote: item.abstractNote,
    ...item.fields,
    tags: item.tags.map((tag) => ({ tag })),
    attachments: attachment ? [{ title: attachment.title, url: attachment.url, mimeType: "application/pdf" }] : []
  };
  if (item.doiField) payload.DOI = item.doi;
  if (item.extra) payload.extra = item.extra;
  return payload;
}
function toWebApiItem(item, { collectionKey = null } = {}) {
  const payload = {
    itemType: item.itemType,
    title: item.title,
    creators: item.creators.map((creator) => ({ ...creator })),
    date: item.date,
    url: item.url,
    abstractNote: item.abstractNote,
    ...item.fields,
    tags: item.tags.map((tag) => ({ tag })),
    collections: collectionKey ? [collectionKey] : []
  };
  if (item.doiField) payload.DOI = item.doi;
  if (item.extra) payload.extra = item.extra;
  return payload;
}
function connectorTargetId(value) {
  const text4 = textField(value, 32, "target");
  if (!text4) return null;
  if (!/^[LC]\d{1,12}$/.test(text4))
    throw new Error('target must look like "L1" (library) or "C123" (collection)');
  return text4;
}
var zotero_write_runtime_exports = {};
__export(zotero_write_runtime_exports, {
  ZOTERO_ENDPOINTS: () => ZOTERO_ENDPOINTS,
  ZOTERO_ITEM_TYPES: () => ZOTERO_ITEM_TYPES,
  connectorSaveTarget: () => connectorSaveTarget,
  connectorTargetId: () => connectorTargetId,
  describeZoteroSavePlan: () => describeZoteroSavePlan,
  describeZoteroUpdatePlan: () => describeZoteroUpdatePlan,
  executeZoteroSave: () => executeZoteroSave,
  executeZoteroUpdate: () => executeZoteroUpdate,
  localApiChildren: () => localApiChildren,
  localApiSearchByDoi: () => localApiSearchByDoi,
  localServerId: () => localServerId,
  normalizeZoteroAttachment: () => normalizeZoteroAttachment,
  normalizeZoteroItem: () => normalizeZoteroItem,
  prepareZoteroSave: () => prepareZoteroSave,
  prepareZoteroUpdate: () => prepareZoteroUpdate,
  probeZoteroConnector: () => probeZoteroConnector,
  receiptWithoutUpdate: () => receiptWithoutUpdate,
  receiptWithoutWrite: () => receiptWithoutWrite,
  toConnectorItem: () => toConnectorItem,
  toWebApiItem: () => toWebApiItem,
  webChildren: () => webChildren,
  webCreateItems: () => webCreateItems,
  webGetItem: () => webGetItem,
  webKeyAccess: () => webKeyAccess,
  webListCollections: () => webListCollections,
  webRequest: () => webRequest,
  webSearchByDoi: () => webSearchByDoi,
  zoteroLocalWriteConfig: () => zoteroLocalWriteConfig,
  zoteroWebApiConfig: () => zoteroWebApiConfig
});
var ZOTERO_ENDPOINTS = Object.freeze({
  connector: "http://127.0.0.1:23119",
  localApi: "http://127.0.0.1:23119/api",
  webApi: "https://api.zotero.org"
});
var KEY = /^[A-Z0-9]{8}$/;
function timeoutSignal(ms, signal) {
  const timer = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}
async function readJson3(response, limit = 2 * 1024 * 1024) {
  const body = await response.text();
  if (body.length > limit) throw new Error("Zotero response too large; outcome remains unknown.");
  if (!body.trim()) return null;
  try {
    return JSON.parse(body);
  } catch {
    return { text: body.slice(0, 2e3) };
  }
}
async function connectorPost(fetchImpl, path, body, { timeoutMs = 2e4, signal } = {}) {
  const response = await fetchImpl(`${ZOTERO_ENDPOINTS.connector}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: timeoutSignal(timeoutMs, signal),
    redirect: "error"
  });
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    json: await readJson3(response)
  };
}
async function probeZoteroConnector({
  fetchImpl = fetch,
  signal,
  timeoutMs = 3e3
} = {}) {
  try {
    const response = await connectorPost(fetchImpl, "/connector/ping", {}, { timeoutMs, signal });
    return {
      reachable: response.ok,
      status: response.status,
      version: response.headers?.get?.("X-Zotero-Version") || null
    };
  } catch (error) {
    return { reachable: false, error: error.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}
async function connectorSaveTarget({ fetchImpl = fetch, signal } = {}) {
  const response = await connectorPost(fetchImpl, "/connector/getSelectedCollection", {}, { signal });
  if (!response.ok || !response.json || typeof response.json !== "object")
    throw new Error(`Zotero desktop did not report a save target (HTTP ${response.status}).`);
  const t = response.json;
  return {
    libraryId: t.libraryID === void 0 || t.libraryID === null ? null : String(t.libraryID),
    libraryName: typeof t.libraryName === "string" ? t.libraryName.slice(0, 200) : "My Library",
    editable: t.libraryEditable !== false && t.editable !== false,
    collectionId: t.id ? String(t.id) : null,
    collectionName: t.id && typeof t.name === "string" ? t.name.slice(0, 200) : null
  };
}
async function localApiGet(fetchImpl, path, { signal, timeoutMs = 1e4 } = {}) {
  const response = await fetchImpl(`${ZOTERO_ENDPOINTS.localApi}/users/0/${path}`, {
    headers: { Accept: "application/json" },
    signal: timeoutSignal(timeoutMs, signal),
    redirect: "error"
  });
  if (!response.ok) throw new Error(`Zotero local API HTTP ${response.status}`);
  return { data: await readJson3(response), total: Number(response.headers.get("Total-Results")) };
}
function summarizeMatches(items, doi) {
  return exactDoiItems(items, doi).filter((item) => KEY.test(item.key || "")).map((item) => ({
    key: item.key,
    title: String(item.data?.title || "").slice(0, 200),
    itemType: item.data?.itemType || null,
    collections: Array.isArray(item.data?.collections) ? item.data.collections.slice(0, 20) : []
  }));
}
async function localApiSearchByDoi({ fetchImpl = fetch, doi, signal } = {}) {
  const wanted = normalizeDoi(doi);
  if (!wanted) throw new Error("Valid DOI required");
  const result = await localApiGet(
    fetchImpl,
    `items?format=json&limit=100&q=${encodeURIComponent(wanted)}&qmode=everything`,
    { signal }
  );
  const complete = Array.isArray(result.data) && result.data.length <= 100 && !(result.total > 100);
  return { complete, items: complete ? summarizeMatches(result.data, wanted) : [] };
}
async function localApiChildren({ fetchImpl = fetch, key, signal } = {}) {
  if (!KEY.test(key || "")) throw new Error("Valid Zotero key required");
  const result = await localApiGet(fetchImpl, `items/${key}/children?format=json&limit=100`, { signal });
  return Array.isArray(result.data) ? result.data : [];
}
function zoteroWebApiConfig(env = process.env) {
  const path = zoteroLibraryPath(env.ZOTERO_LIBRARY_TYPE);
  const libraryType = path ?? String(env.ZOTERO_LIBRARY_TYPE);
  const libraryId = env.ZOTERO_LIBRARY_ID || env.ZOTERO_USER_ID || "";
  const apiKey = env.ZOTERO_API_KEY || "";
  const configured = path !== null && /^\d+$/.test(libraryId) && apiKey.length > 0;
  return { libraryType, libraryId, apiKey, configured };
}
function zoteroLocalWriteConfig(env = process.env) {
  const apiKey = env.ZOTERO_LOCAL_API_KEY || "";
  const serverId = env.ZOTERO_LOCAL_SERVER_ID || "";
  return {
    libraryType: "users",
    libraryId: "0",
    apiKey,
    serverId,
    base: ZOTERO_ENDPOINTS.localApi,
    local: true,
    configured: apiKey.length > 0 && /^[A-Za-z0-9]{1,64}$/.test(serverId)
  };
}
async function localServerId({ fetchImpl = fetch, signal } = {}) {
  try {
    const response = await fetchImpl(`${ZOTERO_ENDPOINTS.localApi}/`, {
      headers: { "Zotero-API-Version": "3" },
      signal: timeoutSignal(3e3, signal),
      redirect: "error"
    });
    return response.headers.get("zotero-server-id") || null;
  } catch {
    return null;
  }
}
function authHeaders(config) {
  return config.local ? { "Zotero-API-Key": config.apiKey, "Zotero-Server-ID": config.serverId } : { "Zotero-API-Key": config.apiKey };
}
async function webRequest(fetchImpl, config, path, { method = "GET", body, signal, timeoutMs = 2e4, write = false } = {}) {
  const headers = {
    "Zotero-API-Version": "3",
    ...authHeaders(config),
    Accept: "application/json"
  };
  if (write) {
    headers["Content-Type"] = "application/json";
    headers["Zotero-Write-Token"] = randomUUID5().replace(/-/g, "");
  }
  const response = await fetchImpl(`${config.base || ZOTERO_ENDPOINTS.webApi}${path}`, {
    method,
    headers,
    body: body === void 0 ? void 0 : JSON.stringify(body),
    signal: timeoutSignal(timeoutMs, signal),
    redirect: "error"
  });
  return {
    status: response.status,
    ok: response.ok,
    json: await readJson3(response),
    total: Number(response.headers.get("Total-Results"))
  };
}
async function webKeyAccess({ fetchImpl = fetch, config, signal } = {}) {
  const response = await webRequest(fetchImpl, config, "/keys/current", { signal });
  if (!response.ok)
    throw new Error(`Zotero Web API rejected the key (HTTP ${response.status}); no write performed.`);
  const access3 = response.json?.access || {};
  const scope = config.libraryType === "groups" ? access3.groups?.[config.libraryId] || access3.groups?.all || {} : String(response.json?.userID ?? "") === config.libraryId ? access3.user || {} : {};
  return {
    userID: response.json?.userID ?? null,
    username: typeof response.json?.username === "string" ? response.json.username.slice(0, 100) : null,
    library: scope.library === true,
    write: scope.write === true
  };
}
async function webSearchByDoi({ fetchImpl = fetch, config, doi, signal } = {}) {
  const wanted = normalizeDoi(doi);
  if (!wanted) throw new Error("Valid DOI required");
  const response = await webRequest(
    fetchImpl,
    config,
    `/${config.libraryType}/${config.libraryId}/items?format=json&limit=100&q=${encodeURIComponent(wanted)}&qmode=everything`,
    { signal }
  );
  if (!response.ok)
    throw new Error(`Zotero Web API lookup failed (HTTP ${response.status}); no write performed.`);
  const complete = Array.isArray(response.json) && response.json.length <= 100 && !(response.total > 100);
  return { complete, items: complete ? summarizeMatches(response.json, wanted) : [] };
}
async function webCreateItems({ fetchImpl = fetch, config, items, signal } = {}) {
  const response = await webRequest(fetchImpl, config, `/${config.libraryType}/${config.libraryId}/items`, {
    method: "POST",
    body: items,
    write: true,
    signal,
    timeoutMs: 3e4
  });
  const successful = Object.entries(response.json?.successful || {}).map(([index, entry]) => ({
    index: Number(index),
    key: entry?.key || entry?.data?.key || null,
    version: entry?.version ?? null
  }));
  const failed = Object.entries(response.json?.failed || {}).map(([index, entry]) => ({
    index: Number(index),
    code: entry?.code ?? null,
    message: String(entry?.message || "").slice(0, 300)
  }));
  return { status: response.status, ok: response.ok, successful, failed };
}
async function webChildren({ fetchImpl = fetch, config, key, signal } = {}) {
  if (!KEY.test(key || "")) throw new Error("Valid Zotero key required");
  const response = await webRequest(
    fetchImpl,
    config,
    `/${config.libraryType}/${config.libraryId}/items/${key}/children?format=json&limit=100`,
    { signal }
  );
  if (!response.ok)
    throw new Error(
      `Zotero ${config.local ? "local" : "Web"} API children lookup failed (HTTP ${response.status})`
    );
  return Array.isArray(response.json) ? response.json : [];
}
function publicWebConfig(config) {
  return { configured: config.configured, libraryType: config.libraryType, libraryId: config.libraryId };
}
async function prepareZoteroSave(input = {}, { fetchImpl = fetch, env = process.env, signal } = {}) {
  const item = normalizeZoteroItem(input);
  const attachment = normalizeZoteroAttachment(input);
  const requested = textField(input.channel, 16, "channel") || "auto";
  if (!["auto", "connector", "web"].includes(requested))
    throw new Error("channel must be auto, connector or web");
  const collectionKey = textField(input.collection_key ?? input.collectionKey, 8, "collection_key") || null;
  if (collectionKey && !KEY.test(collectionKey))
    throw new Error("collection_key must be an 8-character Zotero key");
  const target = connectorTargetId(input.target);
  const webConfig = zoteroWebApiConfig(env);
  const connector = requested === "web" ? { reachable: false, skipped: true } : await probeZoteroConnector({ fetchImpl, signal });
  const channel = requested !== "web" && connector.reachable ? "connector" : requested !== "connector" && webConfig.configured ? "web" : null;
  if (!channel)
    throw new Error(
      requested === "web" ? "Zotero Web API is not configured: set ZOTERO_API_KEY (write scope) and ZOTERO_LIBRARY_ID / ZOTERO_USER_ID in the host environment, never in chat." : requested === "connector" ? "Zotero desktop is not reachable on 127.0.0.1:23119. Start Zotero 7 and enable Settings \u2192 Advanced \u2192 Allow other applications on this computer to communicate with Zotero." : "No Zotero write channel: start Zotero desktop (connector) or configure a write-scoped ZOTERO_API_KEY with ZOTERO_LIBRARY_ID in the environment. No library was queried."
    );
  const plan = {
    doi: item.doi,
    idempotencyKey: externalEffectKey("zotero.create", {
      doi: item.doi,
      collectionKey
    }),
    item,
    attachment,
    channel,
    connector,
    web: publicWebConfig(webConfig),
    target: null,
    existing: [],
    dedupComplete: false,
    action: "blocked",
    reason: null,
    readBackVia: channel === "connector" ? "local-api" : "web-api"
  };
  if (channel === "connector") {
    const selected = await connectorSaveTarget({ fetchImpl, signal });
    if (!selected.editable)
      throw new Error(
        `Zotero desktop's current target "${selected.libraryName}" is read-only; select an editable library or collection in Zotero first.`
      );
    plan.target = { kind: "connector", ...selected, requestedTarget: target, local: true };
    const found = await localApiSearchByDoi({ fetchImpl, doi: item.doi, signal });
    plan.existing = found.items;
    plan.dedupComplete = found.complete;
  } else {
    const access3 = await webKeyAccess({ fetchImpl, config: webConfig, signal });
    if (!access3.write)
      throw new Error(
        `ZOTERO_API_KEY has no write permission for ${webConfig.libraryType}/${webConfig.libraryId}; create a write-scoped key in the Zotero account settings. No write performed.`
      );
    plan.target = {
      kind: "web",
      libraryType: webConfig.libraryType,
      libraryId: webConfig.libraryId,
      libraryName: webConfig.libraryType === "groups" ? `group ${webConfig.libraryId}` : access3.username || "My Library",
      collectionKey,
      local: false
    };
    const found = await webSearchByDoi({ fetchImpl, config: webConfig, doi: item.doi, signal });
    plan.existing = found.items;
    plan.dedupComplete = found.complete;
  }
  if (!plan.dedupComplete) plan.reason = "dedup-incomplete";
  else if (plan.existing.length === 1) plan.action = "reuse";
  else if (plan.existing.length > 1) {
    plan.action = "ambiguous";
    plan.reason = "multiple-items-share-doi";
  } else plan.action = "create";
  return plan;
}
function selectLink(key) {
  return KEY.test(String(key || "")) ? `zotero://select/library/items/${key}` : null;
}
function fulltextFromChildren(children) {
  const pdfs = children.filter((child) => child?.data?.contentType === "application/pdf");
  return {
    pdfAttachmentKeys: pdfs.map((child) => child.key),
    status: pdfs.length ? "attachment-indexed-not-read" : "metadata-only"
  };
}
async function readBackByDoi(plan, { fetchImpl, env, signal, attempts, delayMs, sleep }) {
  const config = zoteroWebApiConfig(env);
  let last = { state: "unavailable", count: 0, attempts: 0 };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const found = plan.channel === "connector" ? await localApiSearchByDoi({ fetchImpl, doi: plan.doi, signal }) : await webSearchByDoi({ fetchImpl, config, doi: plan.doi, signal });
      last = {
        state: !found.complete ? "unknown" : found.items.length === 1 ? "found" : found.items.length ? "ambiguous" : "not-found",
        count: found.items.length,
        items: found.items,
        attempts: attempt
      };
      if (last.state === "found" || last.state === "ambiguous") break;
    } catch (error) {
      last = {
        state: "unavailable",
        count: 0,
        attempts: attempt,
        error: String(error.message || error).slice(0, 200)
      };
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  if (last.state === "found") {
    try {
      const children = plan.channel === "connector" ? await localApiChildren({ fetchImpl, key: last.items[0].key, signal }) : await webChildren({ fetchImpl, config, key: last.items[0].key, signal });
      last.fulltext = fulltextFromChildren(children);
    } catch {
      last.fulltext = { pdfAttachmentKeys: [], status: "unavailable" };
    }
  }
  return last;
}
function baseReceipt(plan, at) {
  return {
    doi: plan.doi,
    idempotencyKey: plan.idempotencyKey,
    title: plan.item.title,
    itemType: plan.item.itemType,
    channel: plan.channel,
    library: {
      type: plan.target?.libraryType || "users",
      id: plan.target?.libraryId ?? null,
      name: plan.target?.libraryName || null,
      local: plan.target?.local === true
    },
    collection: plan.target?.collectionKey ? { key: plan.target.collectionKey, name: null } : plan.target?.collectionId ? { id: plan.target.collectionId, name: plan.target.collectionName } : null,
    attachment: {
      requested: Boolean(plan.attachment),
      url: plan.attachment?.url || null,
      mode: plan.attachment ? plan.channel === "connector" ? "zotero-downloads-url" : "linked_url" : null,
      key: null
    },
    dedup: { existing: plan.existing, complete: plan.dedupComplete },
    zoteroKey: null,
    zoteroSelect: null,
    fulltextStatus: "unavailable",
    readBack: null,
    write: { performed: false, at },
    writesToLibraries: 0,
    autoRetry: false,
    attachmentContentsVerified: false,
    scientificallyVerified: false
  };
}
function receiptWithoutWrite(plan, { now = () => /* @__PURE__ */ new Date() } = {}) {
  const receipt = baseReceipt(plan, now().toISOString());
  if (plan.action === "reuse") {
    receipt.status = "reused";
    receipt.zoteroKey = plan.existing[0].key;
    receipt.zoteroSelect = selectLink(receipt.zoteroKey);
    receipt.reason = "existing-item-with-same-doi";
  } else {
    receipt.status = ["ambiguous", "cancelled"].includes(plan.action) ? plan.action : "blocked";
    receipt.reason = plan.reason || plan.action;
  }
  return receipt;
}
async function executeZoteroSave(plan, {
  fetchImpl = fetch,
  env = process.env,
  signal,
  now = () => /* @__PURE__ */ new Date(),
  sleep = (ms) => new Promise((resolve9) => setTimeout(resolve9, ms)),
  readBackAttempts = 4,
  readBackDelayMs = 750
} = {}) {
  if (plan.action !== "create") throw new Error(`Refusing to write: plan action is ${plan.action}`);
  const at = now().toISOString();
  const receipt = baseReceipt(plan, at);
  receipt.write = { performed: true, at, httpStatus: null, error: null };
  receipt.writesToLibraries = 1;
  let writtenKey = null;
  try {
    if (plan.channel === "connector") {
      const payload = {
        sessionID: randomUUID5().replace(/-/g, "").slice(0, 8),
        uri: plan.item.url,
        items: [toConnectorItem(plan.item, plan.attachment)]
      };
      if (plan.target?.requestedTarget) payload.target = plan.target.requestedTarget;
      const response = await connectorPost(fetchImpl, "/connector/saveItems", payload, {
        timeoutMs: 3e4,
        signal
      });
      receipt.write.httpStatus = response.status;
      if (!response.ok)
        receipt.write.error = `connector HTTP ${response.status}${response.json?.text ? `: ${response.json.text.slice(0, 200)}` : ""}`;
    } else {
      const config = zoteroWebApiConfig(env);
      const created = await webCreateItems({
        fetchImpl,
        config,
        items: [toWebApiItem(plan.item, { collectionKey: plan.target?.collectionKey || null })],
        signal
      });
      receipt.write.httpStatus = created.status;
      writtenKey = created.successful[0]?.key || null;
      if (!created.ok || !writtenKey)
        receipt.write.error = created.failed[0]?.message || `web api HTTP ${created.status}`;
      else if (plan.attachment) {
        const linked = await webCreateItems({
          fetchImpl,
          config,
          items: [
            {
              itemType: "attachment",
              linkMode: "linked_url",
              parentItem: writtenKey,
              title: plan.attachment.title,
              url: plan.attachment.url,
              contentType: "application/pdf",
              tags: []
            }
          ],
          signal
        });
        receipt.attachment.key = linked.successful[0]?.key || null;
        if (!receipt.attachment.key)
          receipt.attachment.error = linked.failed[0]?.message || `web api HTTP ${linked.status}`;
      }
    }
  } catch (error) {
    receipt.write.error = String(error.message || error).slice(0, 300);
  }
  const { items: observedItems = [], ...readBack } = await readBackByDoi(plan, {
    fetchImpl,
    env,
    signal,
    attempts: readBackAttempts,
    delayMs: readBackDelayMs,
    sleep
  });
  receipt.readBack = readBack;
  if (readBack.state === "found") {
    const observed = observedItems[0];
    receipt.zoteroKey = observed.key;
    receipt.zoteroSelect = selectLink(observed.key);
    receipt.fulltextStatus = receipt.readBack.fulltext?.status || "unavailable";
    receipt.status = writtenKey && writtenKey !== observed.key ? "unverified" : "saved";
    if (receipt.status === "unverified") receipt.reason = "read-back-key-differs";
  } else if (receipt.readBack.state === "ambiguous") {
    receipt.status = "ambiguous";
    receipt.reason = "multiple-items-share-doi-after-write";
  } else if (receipt.write.error) {
    receipt.status = "failed";
    receipt.reason = receipt.write.error;
  } else {
    receipt.status = "unverified";
    receipt.reason = receipt.readBack.state === "not-found" ? "written-but-not-read-back" : "read-back-unavailable";
  }
  return receipt;
}
function describeZoteroSavePlan(plan) {
  const authors = plan.item.creators.map(
    (c) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" ")
  );
  const authorLine = authors.length ? `${authors.slice(0, 3).join("\u3001")}${authors.length > 3 ? ` \u7B49 ${authors.length} \u4EBA` : ""}` : "\uFF08\u672A\u63D0\u4F9B\u4F5C\u8005\uFF09";
  const where = plan.channel === "connector" ? `Zotero \u684C\u9762\uFF08\u5F53\u524D\u9009\u4E2D\uFF1A${plan.target.libraryName}${plan.target.collectionName ? ` / ${plan.target.collectionName}` : ""}${plan.target.requestedTarget ? `\uFF0C\u76EE\u6807 ${plan.target.requestedTarget}` : ""}\uFF09` : `Zotero \u7F51\u9875\u5E93 ${plan.target.libraryType}/${plan.target.libraryId}${plan.target.collectionKey ? `\uFF08\u5206\u7C7B ${plan.target.collectionKey}\uFF09` : ""}`;
  const attachment = !plan.attachment ? "\u4EC5\u5143\u6570\u636E\uFF0C\u4E0D\u5E26\u9644\u4EF6" : plan.channel === "connector" ? `\u7531 Zotero \u81EA\u884C\u4E0B\u8F7D ${plan.attachment.url}` : `\u4EE5\u94FE\u63A5\u5F62\u5F0F\u8BB0\u5F55 ${plan.attachment.url}\uFF08\u4E0D\u4E0A\u4F20\u6587\u4EF6\uFF09`;
  return [
    `\u8981\u5199\u5165\u7684\u6587\u732E\uFF1A
- \u6807\u9898\uFF1A${plan.item.title}
- \u4F5C\u8005\uFF1A${authorLine}
- DOI\uFF1A${plan.doi}
- \u7C7B\u578B\uFF1A${plan.item.itemType}${plan.item.date ? ` \xB7 ${plan.item.date}` : ""}`,
    `\u5199\u5165\u4F4D\u7F6E\uFF1A${where}`,
    `\u9644\u4EF6\uFF1A${attachment}`,
    `\u67E5\u91CD\uFF1A\u6309 DOI \u68C0\u7D22${plan.dedupComplete ? "\u672A\u53D1\u73B0\u5DF2\u6709\u6761\u76EE\uFF0C\u5C06\u65B0\u5EFA 1 \u6761" : "\u672A\u5B8C\u6210\uFF0C\u4E0D\u4F1A\u5199\u5165"}\u3002`,
    "\u5199\u5165\u540E\u4F1A\u6309 DOI \u8BFB\u56DE\u6838\u5BF9\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\uFF0C\u4E5F\u4E0D\u4F1A\u5220\u9664\u3001\u5408\u5E76\u6216\u79FB\u52A8\u4EFB\u4F55\u6761\u76EE\u3002",
    "\u4E0D\u60F3\u5199\u5165\u5C31\u9009\u201C\u6682\u4E0D\u5199\u5165\u201D\u6216\u76F4\u63A5\u5173\u6389\uFF0CZotero \u4E0D\u4F1A\u6709\u4EFB\u4F55\u53D8\u5316\u3002"
  ].join("\n\n");
}
var MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
async function webJson(fetchImpl, config, path, signal) {
  const response = await webRequest(fetchImpl, config, path, { signal });
  if (!response.ok)
    throw new Error(
      config.local && response.status === 401 ? "Zotero rejected the local write key (revoked or expired); authorize local writes again in Drone Settings \u2192 Zotero" : `Zotero ${config.local ? "local" : "Web"} API HTTP ${response.status} for ${path.split("?")[0]}`
    );
  return response;
}
async function webGetItem({ fetchImpl = fetch, config, key, signal } = {}) {
  if (!KEY.test(key || "")) throw new Error("Valid Zotero key required");
  const response = await webJson(
    fetchImpl,
    config,
    `/${config.libraryType}/${config.libraryId}/items/${key}?format=json`,
    signal
  );
  const item = response.json || {};
  return {
    key: item.key,
    version: Number(item.version ?? item.data?.version ?? 0),
    title: String(item.data?.title || "").slice(0, 300),
    doi: normalizeDoi(item.data?.DOI || ""),
    itemType: item.data?.itemType || null,
    parentItem: item.data?.parentItem || null,
    collections: Array.isArray(item.data?.collections) ? item.data.collections : []
  };
}
async function webListCollections({ fetchImpl = fetch, config, signal } = {}) {
  const collections = [];
  for (let start = 0; start < 1e3; start += 100) {
    const response = await webJson(
      fetchImpl,
      config,
      `/${config.libraryType}/${config.libraryId}/collections?format=json&limit=100&start=${start}`,
      signal
    );
    const page = Array.isArray(response.json) ? response.json : [];
    for (const entry of page)
      if (KEY.test(entry?.key || ""))
        collections.push({
          key: entry.key,
          name: String(entry.data?.name || "").slice(0, 200),
          parent: entry.data?.parentCollection || null
        });
    if (page.length < 100 || !(response.total > start + 100)) break;
  }
  return collections;
}
async function webWrite(fetchImpl, config, path, { method, headers = {}, body, signal, timeoutMs = 3e4 }) {
  const response = await fetchImpl(`${config.base || ZOTERO_ENDPOINTS.webApi}${path}`, {
    method,
    headers: { "Zotero-API-Version": "3", ...authHeaders(config), ...headers },
    body,
    signal: timeoutSignal(timeoutMs, signal),
    redirect: "error"
  });
  return { status: response.status, ok: response.ok, json: await readJson3(response) };
}
async function inspectLocalPdf(cwd, rawPath) {
  const path = textField(rawPath, 1e3, "local_file");
  if (!path) return null;
  const root = await realpath6(cwd);
  const full = await realpath6(isAbsolute7(path) ? path : resolve8(root, path));
  const rel = relative7(root, full);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep7}`) || isAbsolute7(rel))
    throw new Error("local_file must be inside the current project");
  const info = await stat3(full);
  if (!info.isFile()) throw new Error("local_file is not a file");
  if (info.size > MAX_UPLOAD_BYTES) throw new Error("local_file is larger than 100 MB");
  const handle = await open(full, "r");
  const hash = createHash8("md5");
  const head = Buffer.alloc(5);
  try {
    await handle.read(head, 0, 5, 0);
    const stream = handle.createReadStream({ autoClose: false, start: 0 });
    for await (const chunk of stream) hash.update(chunk);
  } finally {
    await handle.close();
  }
  if (head.toString("latin1") !== "%PDF-") throw new Error("local_file is not a PDF");
  return {
    path: full,
    relativePath: rel.split(sep7).join("/"),
    filename: basename4(full),
    size: info.size,
    mtime: Math.round(info.mtimeMs),
    md5: hash.digest("hex")
  };
}
async function prepareZoteroUpdate(input = {}, { fetchImpl = fetch, env = process.env, cwd = process.cwd(), signal } = {}) {
  const web = zoteroWebApiConfig(env);
  const localConfig = zoteroLocalWriteConfig(env);
  const plan = {
    kind: "update",
    channel: "web",
    web: publicWebConfig(web),
    action: "blocked",
    reason: null,
    item: null,
    doi: null,
    changes: { addCollection: null, attachUrl: null, uploadFile: null },
    skipped: []
  };
  let config = web;
  let staleLocalKey = false;
  if (localConfig.configured && !(web.configured && web.libraryType === "groups")) {
    const serverId = await localServerId({ fetchImpl, signal });
    if (serverId === localConfig.serverId) config = localConfig;
    else staleLocalKey = Boolean(serverId);
  }
  if (config.local) {
    plan.channel = "local";
    plan.target = {
      kind: "local",
      libraryType: "users",
      libraryId: "0",
      libraryName: "My Library",
      local: true
    };
  } else {
    if (!web.configured) {
      plan.reason = staleLocalKey ? "The saved Zotero local write key belongs to a different Zotero database; authorize local writes again in Drone Settings \u2192 Zotero. No change made." : "Changing an existing Zotero item needs write access: on Zotero 10+ ask the user to authorize local writes in Drone Settings \u2192 Zotero (Zotero shows a dialog; choose \u201CAlways Allow\u201D), or to add a write-enabled API key under Settings \u2192 Zotero \u2192 Web API (or set ZOTERO_API_KEY and ZOTERO_LIBRARY_ID). No change made.";
      return plan;
    }
    const access3 = await webKeyAccess({ fetchImpl, config, signal });
    if (!access3.write) {
      plan.reason = `The Zotero API key has no write permission for ${config.libraryType}/${config.libraryId}; create a key with library write access. No change made.`;
      return plan;
    }
    plan.target = {
      kind: "web",
      libraryType: config.libraryType,
      libraryId: config.libraryId,
      libraryName: config.libraryType === "groups" ? `group ${config.libraryId}` : access3.username || "My Library",
      local: false
    };
  }
  let key = textField(input.zotero_key ?? input.key, 8, "zotero_key") || null;
  const doi = normalizeDoi(input.doi || "");
  if (!key) {
    if (!doi) throw new Error("zotero_key or doi is required");
    const found = await webSearchByDoi({ fetchImpl, config, doi, signal });
    if (!found.complete) {
      plan.reason = "dedup-incomplete";
      return plan;
    }
    if (found.items.length !== 1) {
      plan.reason = found.items.length ? "multiple-items-share-doi: pass zotero_key to choose one" : "no item with this DOI in the library; create it with research_zotero_save first";
      plan.candidates = found.items;
      return plan;
    }
    key = found.items[0]?.key ?? null;
  }
  const item = await webGetItem({ fetchImpl, config, key, signal });
  if (item.parentItem) throw new Error("zotero_key points to a child attachment/note, not a top-level item");
  plan.item = item;
  plan.doi = item.doi || doi || null;
  const collectionKey = textField(input.collection_key, 8, "collection_key") || null;
  const collectionName = textField(input.collection_name, 200, "collection_name") || null;
  if (collectionKey || collectionName) {
    const collections = await webListCollections({ fetchImpl, config, signal });
    const match = collectionKey ? collections.filter((entry) => entry.key === collectionKey) : collections.filter(
      (entry) => entry.name.trim().toLowerCase() === collectionName?.trim().toLowerCase()
    );
    if (match.length !== 1) {
      plan.reason = match.length ? `several collections are named "${collectionName}"; pass collection_key` : `collection ${collectionKey || `"${collectionName}"`} not found in this library`;
      plan.collections = collections.slice(0, 50).map(({ key: key2, name }) => ({ key: key2, name }));
      return plan;
    }
    const target = match[0];
    if (item.collections.includes(target.key)) plan.skipped.push(`already in collection "${target.name}"`);
    else plan.changes.addCollection = { key: target.key, name: target.name };
  }
  const attachmentUrl = textField(input.attachment_url, 2e3, "attachment_url") || null;
  const localFile = await inspectLocalPdf(cwd, input.local_file);
  if (attachmentUrl || localFile) {
    const children = await webChildren({ fetchImpl, config, key, signal });
    const existing = children.map((child) => child?.data || {});
    if (attachmentUrl) {
      if (!/^https?:\/\//i.test(attachmentUrl)) throw new Error("attachment_url must be http(s)");
      if (existing.some((child) => child.url === attachmentUrl))
        plan.skipped.push("link already attached");
      else
        plan.changes.attachUrl = {
          url: attachmentUrl,
          title: textField(input.attachment_title, 200, "attachment_title") || "Full Text (link)"
        };
    }
    if (localFile) {
      if (existing.some((child) => child.md5 === localFile.md5))
        plan.skipped.push("same PDF already attached");
      else plan.changes.uploadFile = localFile;
    }
  }
  plan.action = Object.values(plan.changes).some(Boolean) ? "update" : "unchanged";
  if (plan.action === "unchanged") plan.reason = plan.skipped.join("; ") || "nothing to change";
  return plan;
}
async function uploadAttachment(fetchImpl, config, parentKey, file, signal) {
  const lib = `/${config.libraryType}/${config.libraryId}`;
  const created = await webCreateItems({
    fetchImpl,
    config,
    items: [
      {
        itemType: "attachment",
        linkMode: "imported_file",
        parentItem: parentKey,
        title: file.filename,
        contentType: "application/pdf",
        filename: file.filename,
        tags: []
      }
    ],
    signal
  });
  const key = created.successful[0]?.key;
  if (!key) return { key: null, error: created.failed[0]?.message || `web api HTTP ${created.status}` };
  const form = { "Content-Type": "application/x-www-form-urlencoded", "If-None-Match": "*" };
  const auth = await webWrite(fetchImpl, config, `${lib}/items/${key}/file`, {
    method: "POST",
    headers: form,
    body: new URLSearchParams({
      md5: file.md5,
      filename: file.filename,
      filesize: String(file.size),
      mtime: String(file.mtime)
    }).toString(),
    signal
  });
  if (!auth.ok)
    return {
      key,
      error: `upload authorization HTTP ${auth.status}${auth.json?.text ? `: ${auth.json.text.slice(0, 200)}` : ""}`
    };
  if (auth.json?.exists === 1) return { key, error: null, deduplicated: true };
  const handle = await open(file.path, "r");
  let bytes;
  try {
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  const body = Buffer.concat([
    Buffer.from(auth.json.prefix || "", "utf8"),
    bytes,
    Buffer.from(auth.json.suffix || "", "utf8")
  ]);
  const uploadUrl = String(auth.json.url || "");
  const allowed = config.local ? uploadUrl.startsWith(`${new URL(ZOTERO_ENDPOINTS.localApi).origin}/`) : /^https:\/\//.test(uploadUrl);
  if (!allowed) return { key, error: "upload authorization returned an unexpected upload URL" };
  const uploaded = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": String(auth.json.contentType || "application/octet-stream"),
      // The local receiver rejects an upload without the database id; it does not take the key.
      ...config.local ? { "Zotero-Server-ID": config.serverId } : {}
    },
    body,
    signal: timeoutSignal(12e4, signal),
    redirect: "error"
  });
  if (uploaded.status !== 201 && uploaded.status !== 204)
    return { key, error: `file upload HTTP ${uploaded.status}` };
  const registered = await webWrite(fetchImpl, config, `${lib}/items/${key}/file`, {
    method: "POST",
    headers: form,
    body: new URLSearchParams({ upload: String(auth.json.uploadKey || "") }).toString(),
    signal
  });
  return { key, error: registered.status === 204 ? null : `upload registration HTTP ${registered.status}` };
}
async function executeZoteroUpdate(plan, { fetchImpl = fetch, env = process.env, signal, now = () => /* @__PURE__ */ new Date() } = {}) {
  if (plan.action !== "update") throw new Error(`Refusing to write: plan action is ${plan.action}`);
  const config = plan.channel === "local" ? zoteroLocalWriteConfig(env) : zoteroWebApiConfig(env);
  const lib = `/${config.libraryType}/${config.libraryId}`;
  const at = now().toISOString();
  const results = {};
  if (plan.changes.addCollection) {
    const patched = await webWrite(fetchImpl, config, `${lib}/items/${plan.item.key}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Unmodified-Since-Version": String(plan.item.version)
      },
      body: JSON.stringify({ collections: [...plan.item.collections, plan.changes.addCollection.key] }),
      signal
    });
    results.addCollection = {
      ...plan.changes.addCollection,
      httpStatus: patched.status,
      error: patched.status === 204 ? null : patched.status === 412 ? "the item changed in Zotero after it was read; nothing was overwritten, run the update again" : `HTTP ${patched.status}`
    };
  }
  if (plan.changes.attachUrl) {
    const linked = await webCreateItems({
      fetchImpl,
      config,
      items: [
        {
          itemType: "attachment",
          linkMode: "linked_url",
          parentItem: plan.item.key,
          title: plan.changes.attachUrl.title,
          url: plan.changes.attachUrl.url,
          contentType: "application/pdf",
          tags: []
        }
      ],
      signal
    });
    results.attachUrl = {
      url: plan.changes.attachUrl.url,
      key: linked.successful[0]?.key || null,
      error: linked.successful[0]?.key ? null : linked.failed[0]?.message || `HTTP ${linked.status}`
    };
  }
  if (plan.changes.uploadFile) {
    try {
      results.uploadFile = {
        file: plan.changes.uploadFile.relativePath,
        size: plan.changes.uploadFile.size,
        ...await uploadAttachment(fetchImpl, config, plan.item.key, plan.changes.uploadFile, signal)
      };
    } catch (error) {
      results.uploadFile = {
        file: plan.changes.uploadFile.relativePath,
        key: null,
        error: String(error.message || error).slice(0, 300)
      };
    }
  }
  const readBack = {};
  try {
    const item = await webGetItem({ fetchImpl, config, key: plan.item.key, signal });
    readBack.collections = item.collections;
    if (results.addCollection)
      results.addCollection.verified = item.collections.includes(results.addCollection.key);
    const children = await webChildren({ fetchImpl, config, key: plan.item.key, signal });
    const childKeys = new Set(children.map((child) => child?.key));
    if (results.attachUrl?.key) results.attachUrl.verified = childKeys.has(results.attachUrl.key);
    if (results.uploadFile?.key) {
      const child = children.find((entry) => entry?.key === results.uploadFile.key);
      results.uploadFile.verified = Boolean(child) && (results.uploadFile.deduplicated || child?.data?.md5 === plan.changes.uploadFile.md5);
    }
  } catch (error) {
    readBack.error = String(error.message || error).slice(0, 200);
  }
  const outcomes = Object.values(results);
  const failed = outcomes.filter((entry) => entry.error);
  const verified = outcomes.filter((entry) => entry.verified);
  return {
    kind: "update",
    channel: plan.channel,
    doi: plan.doi,
    title: plan.item.title,
    zoteroKey: plan.item.key,
    zoteroSelect: selectLink(plan.item.key),
    library: {
      type: config.libraryType,
      id: config.libraryId,
      name: plan.target?.libraryName || null,
      local: Boolean(config.local)
    },
    changes: results,
    skipped: plan.skipped,
    readBack,
    write: { performed: true, at },
    status: failed.length === outcomes.length ? "failed" : failed.length ? "partial" : verified.length === outcomes.length ? "updated" : "unverified",
    autoRetry: false,
    attachmentContentsVerified: false
  };
}
function receiptWithoutUpdate(plan) {
  return {
    kind: "update",
    channel: plan.channel,
    doi: plan.doi,
    title: plan.item?.title || null,
    zoteroKey: plan.item?.key || null,
    zoteroSelect: selectLink(plan.item?.key),
    status: plan.action === "unchanged" ? "unchanged" : plan.action === "cancelled" ? "cancelled" : "blocked",
    reason: plan.reason,
    skipped: plan.skipped,
    ...plan.candidates ? { candidates: plan.candidates } : {},
    ...plan.collections ? { collections: plan.collections } : {},
    write: { performed: false }
  };
}
function describeZoteroUpdatePlan(plan) {
  const lines = [
    `\u8981\u4FEE\u6539\u7684\u5DF2\u6709\u6761\u76EE\uFF1A
- \u6807\u9898\uFF1A${plan.item.title}
- DOI\uFF1A${plan.doi || "\uFF08\u65E0\uFF09"}
- Zotero \u952E\uFF1A${plan.item.key}`
  ];
  const changes = [];
  if (plan.changes.addCollection)
    changes.push(`\u52A0\u5165\u5206\u7C7B\u300C${plan.changes.addCollection.name}\u300D\uFF08\u4FDD\u7559\u539F\u6709\u5206\u7C7B\uFF09`);
  if (plan.changes.attachUrl) changes.push(`\u6DFB\u52A0\u94FE\u63A5\u9644\u4EF6 ${plan.changes.attachUrl.url}`);
  if (plan.changes.uploadFile)
    changes.push(
      `\u4E0A\u4F20\u672C\u5730 PDF ${plan.changes.uploadFile.relativePath}\uFF08${(plan.changes.uploadFile.size / 1024 / 1024).toFixed(1)} MB\uFF0C${plan.channel === "local" ? "\u5B58\u5165\u672C\u673A Zotero\uFF0C\u4E0D\u5360\u4E91\u5B58\u50A8\u914D\u989D" : "\u5360\u7528 Zotero \u4E91\u5B58\u50A8\u914D\u989D"}\uFF09`
    );
  lines.push(`\u4FEE\u6539\u5185\u5BB9\uFF1A
${changes.map((line) => `- ${line}`).join("\n")}`);
  if (plan.skipped.length) lines.push(`\u8DF3\u8FC7\uFF1A${plan.skipped.join("\uFF1B")}`);
  lines.push(
    `\u901A\u8FC7 Zotero \u7F51\u9875 API \u5199\u5165 ${plan.target.libraryType}/${plan.target.libraryId}\uFF1B\u53EA\u6DFB\u52A0\uFF0C\u4E0D\u5220\u9664\u3001\u4E0D\u79FB\u51FA\u4EFB\u4F55\u5206\u7C7B\uFF1B\u5199\u540E\u8BFB\u56DE\u6838\u5BF9\uFF0C\u4E0D\u81EA\u52A8\u91CD\u8BD5\u3002`
  );
  return lines.join("\n\n");
}
var EVIDENCE_STAGES = Object.freeze([
  "created",
  "local_query_recorded",
  "external_search_recorded",
  "sources_inspected",
  "sources_archived",
  "claims_bound",
  "answerable"
]);

// packages/extensions/src/institutional-access.ts
var require2 = createRequire(import.meta.url);
var PARTITION = "persist:drone-institutional";
function electron() {
  try {
    return require2("electron");
  } catch {
    return null;
  }
}
function session() {
  const loaded = electron();
  try {
    return loaded?.session?.fromPartition(PARTITION) || null;
  } catch {
    return null;
  }
}
function isElectronAvailable() {
  return Boolean(electron());
}
function getInstitutionalSession() {
  return session();
}
async function institutionalFetch(url, options = {}) {
  const loaded = electron();
  if (!loaded) throw new Error("Electron session unavailable");
  const sess = session();
  const timeoutMs = options.timeoutMs ?? 3e4;
  const fetchFn = loaded.net?.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: options.headers,
      signal: controller.signal,
      session: sess
    });
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      status: response.status,
      headers,
      body: new Uint8Array(await response.arrayBuffer()),
      finalUrl: response.url || url,
      response
    };
  } finally {
    clearTimeout(timer);
  }
}
function openWindow(url) {
  const loaded = electron();
  if (!loaded?.BrowserWindow) throw new Error("Electron unavailable");
  const win = new loaded.BrowserWindow({
    width: 1220,
    height: 860,
    title: "\u673A\u6784\u8BBF\u95EE\u767B\u5F55 - Drone",
    webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true },
    autoHideMenuBar: true
  });
  const recordNavigation = async (navigatedUrl) => {
    await detectAndSaveTemplateFromUrl(navigatedUrl);
    const config = await loadInstitutionalConfig();
    await saveInstitutionalConfig({
      ...config,
      lastLoginAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastLoginUrl: navigatedUrl.slice(0, 2048)
    });
  };
  win.webContents?.on?.("did-navigate", (_event, navigatedUrl) => {
    void recordNavigation(navigatedUrl).catch(() => {
    });
  });
  void win.loadURL(url);
  return { url };
}
function toolResponse(value, details) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details: details ?? value };
}
function institutionalAccess(pi) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;
  pi.registerTool({
    name: "research_institutional_login",
    label: "Institutional login",
    description: "Open the persistent institutional browser window for EZproxy, Shibboleth, CARSI, OpenAthens, or WebVPN login.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional publisher or DOI URL." },
        reason: { type: "string", description: "Optional reason shown in the result." }
      }
    },
    drone: {
      capabilities: ["research"],
      journal: false,
      subagent: "exclude",
      activity: { text: "\u6B63\u5728\u6253\u5F00\u673A\u6784\u767B\u5F55\u7A97\u53E3\u2026", phase: "auth" }
    },
    async execute(_id, params) {
      const target = params?.url || "https://www.nature.com/";
      if (!electron())
        return toolResponse(
          {
            status: "electron_unavailable",
            message: "Institutional login requires Drone desktop (Electron)."
          },
          { status: "electron_unavailable" }
        );
      try {
        const config = await loadInstitutionalConfig();
        const opened = openWindow(buildProxiedUrl(target, config.ezproxyTemplate) || target);
        const next = { ...config, lastLoginAt: (/* @__PURE__ */ new Date()).toISOString(), lastLoginUrl: opened.url };
        await saveInstitutionalConfig(next);
        return toolResponse(
          {
            status: "login_window_opened",
            opened_url: opened.url,
            requested_url: params?.url || null,
            reason: params?.reason || null,
            partition: PARTITION
          },
          { status: "login_window_opened" }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return toolResponse({ status: "failed", error: message }, { status: "failed", error: message });
      }
    }
  });
  pi.registerTool({
    name: "research_institutional_status",
    label: "Institutional status",
    description: "Show institutional access configuration and session status.",
    parameters: { type: "object", properties: {} },
    drone: { readOnly: true, capabilities: ["research"] },
    async execute() {
      const config = await loadInstitutionalConfig();
      const current = session();
      let cookiesCount = 0;
      try {
        cookiesCount = current ? (await current.cookies.get({})).length : 0;
      } catch {
        cookiesCount = 0;
      }
      const status = {
        config,
        session: {
          cookiesCount,
          hasSessionCookies: cookiesCount > 0,
          partition: PARTITION,
          lastAccessAt: config.lastLoginAt
        },
        loggedIn: cookiesCount > 0 || Boolean(config.lastLoginAt),
        electronAvailable: Boolean(electron())
      };
      return toolResponse(status, status);
    }
  });
}
export {
  buildProxiedUrl,
  institutionalAccess as default,
  detectAndSaveTemplateFromUrl,
  getInstitutionalSession,
  institutionalFetch,
  isElectronAvailable,
  loadInstitutionalConfig,
  saveInstitutionalConfig
};
