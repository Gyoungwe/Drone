Warning: truncated output (original token count: 163877)
Total output lines: 15987

// @ts-nocheck
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// packages/knowledge/src/project-identity.ts
import { readFile as readFile2 } from "node:fs/promises";
import { homedir } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";

// packages/knowledge/src/config.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
function createKnowledgeConfigState() {
  return { local: new AsyncLocalStorage(), queues: /* @__PURE__ */ new Map() };
}
function errorCode(error) {
  return error && typeof error === "object" && "code" in error ? error.code : void 0;
}
function knowledgeDirectory() {
  const value = process.env.DRONE_KNOWLEDGE_DIR;
  if (!value) return null;
  if (!isAbsolute(value)) throw new Error("DRONE_KNOWLEDGE_DIR must be absolute");
  return resolve(value);
}
function projectIdentity(cwd, configured) {
  if (typeof configured === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(configured)) return configured;
  const path = resolve(cwd);
  const stem = basename(path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  return `${stem}-${createHash("sha256").update(path).digest("hex").slice(0, 10)}`;
}
function validateBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !isAbsolute(String(value.vault || "")) || !/^[a-f0-9]{24}$/.test(String(value.vaultId || "")) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !["project", "literature", "hybrid"].includes(String(value.profile)) || !["run-only", "verified", "rich"].includes(String(value.depositMode)) || !["none", "read-local"].includes(String(value.subagentPolicy)) || typeof value.updatedAt !== "string")
    throw new Error("Invalid application knowledge binding; no project fallback was used");
}
async function readKnowledgeBindingWithState(state, { fresh = false } = {}) {
  if (!fresh && state.local.getStore()) return state.local.getStore() ?? null;
  const directory = knowledgeDirectory();
  if (!directory) return null;
  let value;
  try {
    value = JSON.parse((await readFile(join(directory, "binding.json"), "utf8")).replace(/^\uFEFF/, ""));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new Error(
      `Knowledge binding cannot be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  validateBinding(value);
  return value;
}
async function readKnowledgeBinding(options = {}) {
  return readKnowledgeBindingWithState(defaultState, options);
}
var defaultState = createKnowledgeConfigState();

// packages/knowledge/src/project-identity.ts
var SESSION_PROJECT_ENTRY = "drone-session-project-v1";
var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|shared)$/;
function isProjectSlug(value) {
  return typeof value === "string" && value.length <= 96 && SLUG.test(value) && !RESERVED.test(value);
}
function normalizeProjectSlug(input) {
  if (typeof input !== "string") return null;
  const slug = input.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96).replace(/-+$/g, "");
  return isProjectSlug(slug) ? slug : null;
}
function workspaceProjectId(cwd, configured) {
  return projectIdentity(cwd, isProjectSlug(configured) ? configured : void 0);
}
function dailyWorkspaceDir(home = homedir()) {
  return join2(home, ".drone", "daily");
}
function samePath(a, b) {
  const left = resolve2(a).replace(/[\\/]+$/, "");
  const right = resolve2(b).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
function isDailyWorkspace(cwd, home) {
  return samePath(cwd, dailyWorkspaceDir(home));
}
function sessionProjectFromEntries(entries) {
  if (!Array.isArray(entries)) return null;
  let project = null;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || entry.customType !== SESSION_PROJECT_ENTRY) continue;
    if (entry.type !== void 0 && entry.type !== "custom") continue;
    const value = entry.data?.project;
    if (value === null) project = null;
    else if (isProjectSlug(value)) project = value;
  }
  return project;
}
function sessionEntriesOf(ctx) {
  try {
    const manager = ctx?.sessionManager;
    const entries = manager?.getBranch?.() ?? manager?.getEntries?.();
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
function resolveProjectIdentity(input) {
  const daily = isDailyWorkspace(input.cwd, input.home);
  const requestedText = typeof input.requested === "string" ? input.requested.trim() : "";
  const requested = requestedText || null;
  let project;
  let source;
  const session = daily ? sessionProjectFromEntries(input.sessionEntries) : null;
  if (session) {
    project = session;
    source = "session";
  } else if (isProjectSlug(input.configured)) {
    project = input.configured;
    source = "workspace-config";
  } else {
    project = workspaceProjectId(input.cwd);
    source = "workspace";
  }
  const ignoredRequest = requested !== null && normalizeProjectSlug(requested) !== project;
  return { project, source, daily, requested, ignoredRequest };
}
async function readConfiguredProject(cwd) {
  try {
    const parsed = JSON.parse(await readFile2(join2(cwd, ".pi", "research-workspace.json"), "utf8"));
    if (parsed && typeof parsed === "object" && "knowledgeProjectId" in parsed)
      return parsed.knowledgeProjectId;
  } catch {
  }
  return void 0;
}
async function resolveWorkspaceProject(input) {
  return resolveProjectIdentity({ ...input, configured: await readConfiguredProject(input.cwd) });
}
function projectNotice(resolution) {
  if (!resolution.ignoredRequest) return null;
  const how = resolution.daily ? "In the daily space the user picks a project per session with /project <slug>." : "The project is fixed by the current workspace (knowledgeProjectId in .pi/research-workspace.json).";
  return `Requested project "${resolution.requested}" was ignored; using "${resolution.project}". ${how}`;
}
function describeProject(resolution) {
  const notice = projectNotice(resolution);
  return { project: resolution.project, source: resolution.source, ...notice ? { notice } : {} };
}

// packages/research/src/literature-receipt.ts
import { createHash as createHash2 } from "node:crypto";
import { readFile as readFile3, realpath as realpath2, stat } from "node:fs/promises";
import { isAbsolute as isAbsolute2, relative, resolve as resolve3, sep } from "node:path";
function normalizeDoi(value) {
  const doi = String(value || "").trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}
function exactDoiItems(items2, doi) {
  const wanted = normalizeDoi(doi);
  return wanted ? items2.filter((item) => normalizeDoi(item.data?.DOI || item.doi || item.DOI) === wanted) : [];
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
    const root = await realpath2(String(vault));
    vaultResolved = true;
    const file = await realpath2(resolve3(root, notePath));
    const rel = relative(root, file);
    if (isAbsolute2(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("outside-vault");
    if ((await stat(file)).size > 1024 * 1024) throw new Error("note-too-large");
    const text2 = await readFile3(file, "utf8");
    const linked = text2.includes(`zotero:${zoteroKey}`) || new RegExp(`zotero://select/library/items/${zoteroKey}(?=[)\\s<>]|$)`).test(text2) || new RegExp(`^zotero_key: *["']?${zoteroKey}["']? *$`, "m").test(text2);
    const dois = text2.match(/10\.\d{4,9}\/[^\s<>"'\])]+/gi) || [];
    receipt.obsidian = {
      status: linked && dois.some((item) => normalizeDoi(item.replace(/[.,;]+$/, "")) === normalizedDoi) ? "verified" : "identity-mismatch",
      path: notePath,
      vault: root,
      hash: createHash2("sha256").update(text2).digest("hex")
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

// packages/research/src/receipt-journal.ts
import { realpath as realpath3 } from "node:fs/promises";

// packages/research/src/receipt-journal-policy.ts
import { resolve as resolve4 } from "node:path";
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
  return !ownedRun || resolve4(cwd, String(ownedRun)) === resolve4(cwd, runDir);
}

// packages/research/src/receipt-journal.ts
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
    const status2 = await ports.status(cwd, runDir);
    const path = status2.run_dir;
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
        vault: config.obsidianVault ? await realpath3(config.obsidianVault) : null,
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

// packages/research/src/research-loop.ts
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";
import { access, mkdir as mkdir2, readFile as readFile4, realpath as realpath4, rename as rename2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname, isAbsolute as isAbsolute3, join as join3, relative as relative2, resolve as resolve5, sep as sep2 } from "node:path";

// packages/research/src/claim-bindings.ts
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

// packages/research/src/research-loop.ts
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
  const loadWorkspaceConfig2 = ports.workspace;
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
  const runKey = (cwd, runDir) => resolve5(cwd, runDir);
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
    const config = await loadWorkspaceConfig2(cwd);
    if (!config.obsidianVault) return [];
    const root = await realpath4(config.obsidianVault);
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
    const text2 = String(value ?? "").trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text2)) throw new Error(`${label} must be lowercase kebab-case`);
    return text2;
  }
  function topicIdFromResultSlug(value) {
    const slug = safeSlug(value || "research-question", "result_slug");
    const stable = slug.replace(/-20\d{6}(?:\d{6})?$/, "").replace(/-run-\d+$/, "");
    return stable || slug;
  }
  function within2(root, target) {
    const rel = relative2(resolve5(root), resolve5(target));
    return rel === "" || !isAbsolute3(rel) && rel !== ".." && !rel.startsWith(`..${sep2}`);
  }
  function fileHash(bytes) {
    return createHash3("sha256").update(bytes).digest("hex");
  }
  async function archivedSourceRecords(cwd, runDir) {
    const archive = await sourceStatus2({ cwd, run_dir: resolve5(cwd, runDir) });
    const records = [];
    for (const item of archive.manifest?.items || []) {
      if (item.status !== "downloaded" || !item.path || !item.sha256) continue;
      const absolute = resolve5(cwd, item.path);
      if (!within2(join3(resolve5(cwd, runDir), "sources"), absolute)) continue;
      try {
        if (!within2(await realpath4(join3(resolve5(cwd, runDir), "sources")), await realpath4(absolute)))
          continue;
        if (fileHash(await readFile4(absolute)) !== item.sha256) continue;
      } catch {
        continue;
      }
      const aliases = /* @__PURE__ */ new Set([
        String(item.path),
        absolute,
        relative2(cwd, absolute),
        relative2(resolve5(cwd, runDir), absolute)
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
    const absolute = resolve5(cwd, path);
    const sourcesRoot = join3(resolve5(cwd, runDir), "sources");
    if (!within2(sourcesRoot, absolute)) return false;
    if (!within2(await realpath4(sourcesRoot), await realpath4(absolute))) return false;
    if (details.truncation?.firstLineExceedsLimit) return false;
    const returned = details.truncation?.content ?? content?.find((part) => part.type === "text")?.text;
    if (typeof returned !== "string" || !returned.trim()) return false;
    const bytes = await readFile4(absolute);
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
    const text2 = lines.join("\n");
    if (!text2.trim()) return false;
    const read = { hash: fileHash(bytes), text: text2, startLine, endLine: startLine + lines.length - 1 };
    const aliases = /* @__PURE__ */ new Set([
      String(path),
      absolute,
      relative2(cwd, absolute),
      relative2(resolve5(cwd, runDir), absolute)
    ]);
    for (const alias of aliases) ledger(cwd, runDir).reads.set(alias, read);
    return true;
  }
  async function readJson(path) {
    const value = JSON.parse(await readFile4(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`Invalid JSON object: ${path}`);
    if (path.endsWith("metadata.json") && !value.kind) {
      return { ...value, kind: RESEARCH_DOCUMENT_KIND, version: 1 };
    }
    if (path.endsWith("metadata.json") && (value.kind !== RESEARCH_DOCUMENT_KIND || value.version !== 1))
      throw new Error(`Unsupported research metadata document: ${path}`);
    return value;
  }
  async function atomicJson(path, value) {
    await mkdir2(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID2()}.tmp`;
    await writeFile2(temp, `${JSON.stringify(value, null, 2)}
`, "utf8");
    await rename2(temp, path);
  }
  function gateOf(metadata) {
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
  function provenanceFor(gate, status2 = "pending") {
    return {
      status: status2,
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
    const config = await loadWorkspaceConfig2(cwd);
    if (!runDir) throw new Error("run_dir is required for this action");
    const path = resolve5(cwd, runDir);
    if (!within2(config.resultsRoot, path))
      throw new Error("run_dir must stay inside the configured results root");
    const rel = relative2(config.resultsRoot, path).split(sep2);
    if (rel.length !== 2 || !rel[1]?.startsWith("run-"))
      throw new Error("run_dir must be directly inside a result slug");
    await access(join3(path, "metadata.json"));
    return { config, path, metadataPath: join3(path, "metadata.json") };
  }
  async function startResearchRun({
    cwd = process.cwd(),
    project,
    resultSlug,
    query,
    requiresProvenance = false
  } = {}) {
    const config = await loadWorkspaceConfig2(cwd);
    project = safeSlug(project || (await resolveWorkspaceProject({ cwd })).project, "project");
    resultSlug = safeSlug(resultSlug || "research-question", "result_slug");
    if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const runId = `run-${stamp}-${randomUUID2().slice(0, 8)}`;
    const runDir = join3(config.resultsRoot, resultSlug, runId);
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
    await atomicJson(join3(runDir, "metadata.json"), metadata);
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
    const metadata = await readJson(metadataPath);
    const revision = Number.isInteger(metadata.revision) ? metadata.revision : 0;
    if (expectedRevision != null && Number(expectedRevision) !== revision)
      throw new Error(`research run changed; expected revision ${expectedRevision}, found ${revision}`);
    let gate = gateOf(metadata);
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
        const provenance = await readJson(join3(path, "reproducibility-manifest.json"));
        if (provenance?.version !== 1)
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
    await atomicJson(metadataPath, metadata);
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
    let status2 = await updateResearchLoop({ cwd, runDir, action: "status" });
    let gate = status2.evidence_gate;
    await validateReuse(cwd, runDir, gate);
    if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("sources_inspected"))
      throw new Error("research loop must inspect sources before complete");
    if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("sources_archived"))
      status2 = await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
    gate = status2.evidence_gate;
    if (!claimBindings.length && !gate.claim_bindings.length)
      throw new Error(
        "Provide structured claim_bindings; legacy claim_refs cannot make a research run answerable"
      );
    if (claimBindings.length || RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("claims_bound"))
      status2 = await updateResearchLoop({
        cwd,
        runDir,
        action: "bind_claims",
        claimRefs,
        claimBindings
      });
    gate = status2.evidence_gate;
    status2 = await updateResearchLoop({ cwd, runDir, action: "finalize" });
    return status2;
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
          const config = await loadWorkspaceConfig2(cwd);
          if (config.obsidianVault)
            ledger(cwd, runDir).reads.set(path, {
              hash: details.hash,
              text: details.text,
              vault: readBinding ? readBinding.vault : await realpath4(config.obsidianVault),
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

// packages/research/src/run-provenance.ts
import { createHash as createHash4, randomUUID as randomUUID3 } from "node:crypto";
import { lstat, readFile as readFile5, realpath as realpath5, rename as rename3, stat as stat2, writeFile as writeFile3 } from "node:fs/promises";
import { isAbsolute as isAbsolute4, join as join4, relative as relative3, resolve as resolve6, sep as sep3 } from "node:path";
var queues = /* @__PURE__ */ new Map();
var digest = (value) => createHash4("sha256").update(value).digest("hex");
var defaultWorkspaceConfig = async (cwd) => ({
  resultsRoot: resolve6(cwd, "results")
});
function within(root, path) {
  const rel = relative3(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep3}`) && !isAbsolute4(rel);
}
async function runPath(cwd, runDir, loadConfig) {
  const config = await loadConfig(cwd);
  const root = await realpath5(config.resultsRoot);
  const run = await realpath5(resolve6(cwd, runDir || ""));
  const parts = relative3(root, run).split(sep3);
  if (!within(root, run) || parts.length !== 2 || !parts[1]?.startsWith("run-")) {
    throw new Error("Expected existing run inside results root");
  }
  await readFile5(join4(run, "metadata.json"), "utf8");
  return run;
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
  await rename3(temp, path);
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
  loadWorkspaceConfig: loadWorkspaceConfig2 = defaultWorkspaceConfig
}) {
  if (!["bash", "powershell"].includes(toolName) || !toolCallId) return null;
  const run = await runPath(cwd, runDir, loadWorkspaceConfig2);
  const file = join4(run, "execution-observations.json");
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

// packages/research/src/source-archive.ts
import { createHash as createHash6, randomUUID as randomUUID4 } from "node:crypto";
import { access as access2, mkdir as mkdir3, readFile as readFile6, realpath as realpath6, rename as rename4, writeFile as writeFile4 } from "node:fs/promises";
import { basename as basename3, dirname as dirname2, extname, isAbsolute as isAbsolute6, join as join5, relative as relative5, resolve as resolve8, sep as sep5 } from "node:path";

// packages/shared/src/analysis-orchestration.ts
var ANALYSIS_STAGES = Object.freeze([
  "intake",
  "design",
  "readiness",
  "execution",
  "review",
  "delivery",
  "completed"
]);

// node_modules/typebox/build/system/memory/memory.mjs
var memory_exports = {};
__export(memory_exports, {
  Assign: () => Assign,
  Clone: () => Clone,
  Create: () => Create,
  Discard: () => Discard,
  Metrics: () => Metrics,
  Update: () => Update
});

// node_modules/typebox/build/system/memory/metrics.mjs
var Metrics = {
  assign: 0,
  create: 0,
  clone: 0,
  discard: 0,
  update: 0
};

// node_modules/typebox/build/system/memory/assign.mjs
function Assign(left, right) {
  Metrics.assign += 1;
  return { ...left, ...right };
}

// node_modules/typebox/build/guard/guard.mjs
var guard_exports = {};
__export(guard_exports, {
  Entries: () => Entries,
  EntriesRegExp: () => EntriesRegExp,
  Every: () => Every,
  EveryAll: () => EveryAll,
  GraphemeCount: () => GraphemeCount2,
  HasPropertyKey: () => HasPropertyKey,
  IsArray: () => IsArray,
  IsBigInt: () => IsBigInt,
  IsBoolean: () => IsBoolean,
  IsClassInstance: () => IsClassInstance,
  IsConstructor: () => IsConstructor,
  IsDeepEqual: () => IsDeepEqual,
  IsEqual: () => IsEqual,
  IsFunction: () => IsFunction,
  IsGreaterEqualThan: () => IsGreaterEqualThan,
  IsGreaterThan: () => IsGreaterThan,
  IsInteger: () => IsInteger,
  IsLessEqualThan: () => IsLessEqualThan,
  IsLessThan: () => IsLessThan,
  IsMaxLength: () => IsMaxLength2,
  IsMinLength: () => IsMinLength2,
  IsMultipleOf: () => IsMultipleOf,
  IsNull: () => IsNull,
  IsNumber: () => IsNumber,
  IsObject: () => IsObject,
  IsObjectNotArray: () => IsObjectNotArray,
  IsString: () => IsString,
  IsSymbol: () => IsSymbol,
  IsUndefined: () => IsUndefined,
  IsUnsafePropertyKey: () => IsUnsafePropertyKey,
  IsValueLike: () => IsValueLike,
  Keys: () => Keys,
  ShiftLeft: () => ShiftLeft,
  Symbols: () => Symbols,
  Values: () => Values
});

// node_modules/typebox/build/guard/string.mjs
function IsBetween(value, min, max) {
  return value >= min && value <= max;
}
function IsZeroWidthJoiner(value) {
  return value === 8205;
}
function IsHighSurrogate(value) {
  return IsBetween(value, 55296, 56319);
}
function IsRegionalIndicator(value) {
  return IsBetween(value, 127462, 127487);
}
function IsVariationSelector(value) {
  return IsBetween(value, 65024, 65039);
}
function IsCombiningMark(value) {
  return IsBetween(value, 768, 879) || IsBetween(value, 6832, 6911) || IsBetween(value, 7616, 7679) || IsBetween(value, 65056, 65071);
}
function CodePointLength(value) {
  return value > 65535 ? 2 : 1;
}
function ConsumeModifiers(value, index) {
  while (index < value.length) {
    const point = value.codePointAt(index);
    if (IsCombiningMark(point) || IsVariationSelector(point)) {
      index += CodePointLength(point);
    } else {
      break;
    }
  }
  return index;
}
function NextGraphemeClusterIndex(value, clusterStart) {
  const startCP = value.codePointAt(clusterStart);
  let clusterEnd = clusterStart + CodePointLength(startCP);
  clusterEnd = ConsumeModifiers(value, clusterEnd);
  while (clusterEnd < value.length - 1 && value[clusterEnd] === "\u200D") {
    const nextCP = value.codePointAt(clusterEnd + 1);
    clusterEnd += 1 + CodePointLength(nextCP);
    clusterEnd = ConsumeModifiers(value, clusterEnd);
  }
  if (IsRegionalIndicator(startCP) && clusterEnd < value.length && IsRegionalIndicator(value.codePointAt(clusterEnd))) {
    clusterEnd += CodePointLength(value.codePointAt(clusterEnd));
  }
  return clusterEnd;
}
function IsGraphemeCodePoint(value) {
  return IsHighSurrogate(value) || IsCombiningMark(value) || IsVariationSelector(value) || IsZeroWidthJoiner(value);
}
function GraphemeCount(value) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
  }
  return count;
}
function IsMinLength(value, minLength) {
  if (minLength === 0)
    return true;
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
    if (count >= minLength)
      return true;
  }
  return false;
}
function IsMaxLength(value, maxLength) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
    if (count > maxLength)
      return false;
  }
  return true;
}
function IsMinLengthFast(value, minLength) {
  if (minLength === 0)
    return true;
  let index = 0;
  while (index < value.length) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMinLength(value, minLength);
    }
    index++;
    if (index >= minLength)
      return true;
  }
  return false;
}
function IsMaxLengthFast(value, maxLength) {
  let index = 0;
  while (index < value.length) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMaxLength(value, maxLength);
    }
    index++;
    if (index > maxLength)
      return false;
  }
  return true;
}

// node_modules/typebox/build/guard/guard.mjs
function IsArray(value) {
  return Array.isArray(value);
}
function IsBigInt(value) {
  return IsEqual(typeof value, "bigint");
}
function IsBoolean(value) {
  return IsEqual(typeof value, "boolean");
}
function IsConstructor(value) {
  if (IsUndefined(value) || !IsFunction(value))
    return false;
  const result = Function.prototype.toString.call(value);
  if (/^class\s/.test(result))
    return true;
  if (/\[native code\]/.test(result))
    return true;
  return false;
}
function IsFunction(value) {
  return IsEqual(typeof value, "function");
}
function IsInteger(value) {
  return Number.isInteger(value);
}
function IsNull(value) {
  return IsEqual(value, null);
}
function IsNumber(value) {
  return Number.isFinite(value);
}
function IsObjectNotArray(value) {
  return IsObject(value) && !IsArray(value);
}
function IsObject(value) {
  return IsEqual(typeof value, "object") && !IsNull(value);
}
function IsString(value) {
  return IsEqual(typeof value, "string");
}
function IsSymbol(value) {
  return IsEqual(typeof value, "symbol");
}
function IsUndefined(value) {
  return IsEqual(value, void 0);
}
function IsEqual(left, right) {
  return left === right;
}
function IsGreaterThan(left, right) {
  return left > right;
}
function IsLessThan(left, right) {
  return left < right;
}
function IsLessEqualThan(left, right) {
  return left <= right;
}
function IsGreaterEqualThan(left, right) {
  return left >= right;
}
function IsMultipleOf(dividend, divisor) {
  if (IsBigInt(dividend) || IsBigInt(divisor)) {
    return BigInt(dividend) % BigInt(divisor) === 0n;
  }
  const tolerance = 1e-10;
  if (!IsNumber(dividend))
    return true;
  if (IsInteger(dividend) && 1 / divisor % 1 === 0)
    return true;
  const mod = dividend % divisor;
  return Math.min(Math.abs(mod), Math.abs(mod - divisor), Math.abs(mod + divisor)) < tolerance;
}
function IsClassInstance(value) {
  if (!IsObject(value))
    return false;
  const proto = globalThis.Object.getPrototypeOf(value);
  if (IsNull(proto))
    return false;
  return IsEqual(typeof proto.constructor, "function") && !(IsEqual(proto.constructor, globalThis.Object) || IsEqual(proto.constructor.name, "Object"));
}
function IsValueLike(value) {
  return IsBigInt(value) || IsBoolean(value) || IsNull(value) || IsNumber(value) || IsString(value) || IsUndefined(value);
}
function GraphemeCount2(value) {
  return GraphemeCount(value);
}
function IsMaxLength2(value, length) {
  return IsMaxLengthFast(value, length);
}
function IsMinLength2(value, length) {
  return IsMinLengthFast(value, length);
}
function Every(value, offset, callback) {
  for (let index = offset; index < value.length; index++) {
    if (!callback(value[index], index))
      return false;
  }
  return true;
}
function EveryAll(value, offset, callback) {
  let result = true;
  for (let index = offset; index < value.length; index++) {
    if (!callback(value[index], index))
      result = false;
  }
  return result;
}
function ShiftLeft(array, true_, false_) {
  return IsEqual(array.length, 0) ? false_() : true_(array[0], array.slice(1));
}
function IsUnsafePropertyKey(key) {
  return IsEqual(key, "__proto__") || IsEqual(key, "constructor") || IsEqual(key, "prototype");
}
function HasPropertyKey(value, key) {
  return IsUnsafePropertyKey(key) ? Object.prototype.hasOwnProperty.call(value, key) : key in value;
}
function EntriesRegExp(value) {
  return Keys(value).map((key) => [new RegExp(`^${key}$`), value[key]]);
}
function Entries(value) {
  return Object.entries(value);
}
function Keys(value) {
  return Object.getOwnPropertyNames(value);
}
function Symbols(value) {
  return Object.getOwnPropertySymbols(value);
}
function Values(value) {
  return Object.values(value);
}
function DeepEqualObject(left, right) {
  if (!IsObject(right))
    return false;
  const keys = Keys(left);
  return IsEqual(keys.length, Keys(right).length) && keys.every((key) => IsDeepEqual(left[key], right[key]));
}
function DeepEqualArray(left, right) {
  return IsArray(right) && IsEqual(left.length, right.length) && left.every((_, index) => IsDeepEqual(left[index], right[index]));
}
function IsDeepEqual(left, right) {
  return IsArray(left) ? DeepEqualArray(left, right) : IsObject(left) ? DeepEqualObject(left, right) : IsEqual(left, right);
}

// node_modules/typebox/build/guard/globals.mjs
var globals_exports = {};
__export(globals_exports, {
  IsBigInt64Array: () => IsBigInt64Array,
  IsBigUint64Array: () => IsBigUint64Array,
  IsBoolean: () => IsBoolean2,
  IsDate: () => IsDate,
  IsFloat32Array: () => IsFloat32Array,
  IsFloat64Array: () => IsFloat64Array,
  IsInt16Array: () => IsInt16Array,
  IsInt32Array: () => IsInt32Array,
  IsInt8Array: () => IsInt8Array,
  IsMap: () => IsMap,
  IsNumber: () => IsNumber2,
  IsRegExp: () => IsRegExp,
  IsSet: () => IsSet,
  IsString: () => IsString2,
  IsTypeArray: () => IsTypeArray,
  IsUint16Array: () => IsUint16Array,
  IsUint32Array: () => IsUint32Array,
  IsUint8Array: () => IsUint8Array,
  IsUint8ClampedArray: () => IsUint8ClampedArray
});
function IsBoolean2(value) {
  return value instanceof Boolean;
}
function IsNumber2(value) {
  return value instanceof Number;
}
function IsString2(value) {
  return value instanceof String;
}
function IsTypeArray(value) {
  return globalThis.ArrayBuffer.isView(value);
}
function IsInt8Array(value) {
  return value instanceof globalThis.Int8Array;
}
function IsUint8Array(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUint8ClampedArray(value) {
  return value instanceof globalThis.Uint8ClampedArray;
}
function IsInt16Array(value) {
  return value instanceof globalThis.Int16Array;
}
function IsUint16Array(value) {
  return value instanceof globalThis.Uint16Array;
}
function IsInt32Array(value) {
  return value instanceof globalThis.Int32Array;
}
function IsUint32Array(value) {
  return value instanceof globalThis.Uint32Array;
}
function IsFloat32Array(value) {
  return value instanceof globalThis.Float32Array;
}
function IsFloat64Array(value) {
  return value instanceof globalThis.Float64Array;
}
function IsBigInt64Array(value) {
  return value instanceof globalThis.BigInt64Array;
}
function IsBigUint64Array(value) {
  return value instanceof globalThis.BigUint64Array;
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsDate(value) {
  return value instanceof globalThis.Date;
}
function IsSet(value) {
  return value instanceof globalThis.Set;
}
function IsMap(value) {
  return value instanceof globalThis.Map;
}

// node_modules/typebox/build/guard/index.mjs
var guard_default = guard_exports;

// node_modules/typebox/build/system/memory/clone.mjs
function FromClassInstance(value) {
  return value;
}
function IsTypeObject(value) {
  return guard_exports.HasPropertyKey(value, "~kind") || guard_exports.HasPropertyKey(value, "~unsafe");
}
function FromTypeObject(value) {
  const result = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    const descriptor = descriptors[key];
    if (guard_exports.HasPropertyKey(descriptor, "value")) {
      Object.defineProperty(result, key, { ...descriptor, value: FromValue(descriptor.value) });
    }
  }
  return result;
}
function FromPlainObject(value) {
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    result[key] = FromValue(value[key]);
  }
  for (const key of guard_exports.Symbols(value)) {
    result[key] = FromValue(value[key]);
  }
  return result;
}
function FromObject(value) {
  return guard_exports.IsClassInstance(value) ? FromClassInstance(value) : IsTypeObject(value) ? FromTypeObject(value) : FromPlainObject(value);
}
function FromArray(value) {
  return value.map((element) => FromValue(element));
}
function FromTypedArray(value) {
  return value.slice();
}
function FromRegExp(value) {
  return new RegExp(value.source, value.flags);
}
function FromMap(value) {
  return new Map(FromValue([...value.entries()]));
}
function FromSet(value) {
  return new Set(FromValue([...value.values()]));
}
function FromValue(value) {
  return globals_exports.IsTypeArray(value) ? FromTypedArray(value) : globals_exports.IsRegExp(value) ? FromRegExp(value) : globals_exports.IsMap(value) ? FromMap(value) : globals_exports.IsSet(value) ? FromSet(value) : guard_exports.IsArray(value) ? FromArray(value) : guard_exports.IsObject(value) ? FromObject(value) : value;
}
function Clone(value) {
  Metrics.clone += 1;
  return FromValue(value);
}

// node_modules/typebox/build/system/settings/settings.mjs
var settings_exports = {};
__export(settings_exports, {
  Get: () => Get,
  Reset: () => Reset,
  Set: () => Set2
});
var settings = {
  immutableTypes: false,
  maxErrors: 8,
  useAcceleration: true,
  exactOptionalPropertyTypes: false,
  enumerableKind: false,
  correctiveParse: false,
  unionPrioritySort: true
};
function Reset() {
  settings.immutableTypes = false;
  settings.maxErrors = 8;
  settings.useAcceleration = true;
  settings.exactOptionalPropertyTypes = false;
  settings.enumerableKind = false;
  settings.correctiveParse = false;
  settings.unionPrioritySort = true;
}
function Set2(options) {
  for (const key of guard_exports.Keys(options)) {
    const value = options[key];
    if (value !== void 0) {
      Object.defineProperty(settings, key, { value });
    }
  }
}
function Get() {
  return settings;
}

// node_modules/typebox/build/system/memory/create.mjs
function MergeHidden(left, right) {
  for (const key of Object.keys(right)) {
    Object.defineProperty(left, key, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: right[key]
    });
  }
  return left;
}
function Merge(left, right) {
  return { ...left, ...right };
}
function Create(hidden, enumerable, options = {}) {
  Metrics.create += 1;
  const settings2 = settings_exports.Get();
  const withOptions = Merge(enumerable, options);
  const withHidden = settings2.enumerableKind ? Merge(withOptions, hidden) : MergeHidden(withOptions, hidden);
  return settings2.immutableTypes ? Object.freeze(withHidden) : withHidden;
}

// node_modules/typebox/build/system/memory/discard.mjs
function Discard(value, propertyKeys) {
  Metrics.discard += 1;
  const result = {};
  const descriptors = Object.getOwnPropertyDescriptors(Clone(value));
  const keysToDiscard = new Set(propertyKeys);
  for (const key of Object.keys(descriptors)) {
    if (keysToDiscard.has(key))
      continue;
    Object.defineProperty(result, key, descriptors[key]);
  }
  return result;
}

// node_modules/typebox/build/system/memory/update.mjs
function Update(current, hidden, enumerable) {
  Metrics.update += 1;
  const settings2 = settings_exports.Get();
  const result = Clone(current);
  for (const key of Object.keys(hidden)) {
    Object.defineProperty(result, key, {
      configurable: true,
      writable: true,
      enumerable: settings2.enumerableKind,
      value: hidden[key]
    });
  }
  for (const key of Object.keys(enumerable)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: enumerable[key]
    });
  }
  return result;
}

// node_modules/typebox/build/type/types/schema.mjs
function IsKind(value, kind) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], kind);
}
function IsSchema(value) {
  return guard_exports.IsObject(value);
}

// node_modules/typebox/build/type/types/deferred.mjs
function Deferred(action, parameters, options) {
  return memory_exports.Create({ "~kind": "Deferred" }, { type: "deferred", action, parameters, options }, {});
}
function IsDeferred(value) {
  return IsKind(value, "Deferred");
}

// node_modules/typebox/build/type/engine/readonly/instantiate_add.mjs
function AddReadonlyOperation(type) {
  return memory_exports.Update(type, { "~readonly": true }, {});
}
function AddReadonlyAction(type, options) {
  const result = memory_exports.Update(AddReadonlyOperation(type), {}, options);
  return result;
}
function AddReadonlyInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddReadonlyAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/optional/instantiate_add.mjs
function AddOptionalOperation(type) {
  return memory_exports.Update(type, { "~optional": true }, {});
}
function AddOptionalAction(type, options) {
  const result = memory_exports.Update(AddOptionalOperation(type), {}, options);
  return result;
}
function AddOptionalInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddOptionalAction(instantiatedType, options);
}

// node_modules/typebox/build/type/types/array.mjs
function _Array_(items2, options) {
  return memory_exports.Create({ "~kind": "Array" }, { type: "array", items: items2 }, options);
}
function IsArray2(value) {
  return IsKind(value, "Array");
}
function ArrayOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items"]);
}

// node_modules/typebox/build/type/types/constructor.mjs
function Constructor(parameters, instanceType, options = {}) {
  return memory_exports.Create({ "~kind": "Constructor" }, { type: "constructor", parameters, instanceType }, options);
}
function IsConstructor2(value) {
  return IsKind(value, "Constructor");
}
function ConstructorOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "instanceType"]);
}

// node_modules/typebox/build/type/types/function.mjs
function _Function_(parameters, returnType, options = {}) {
  return memory_exports.Create({ ["~kind"]: "Function" }, { type: "function", parameters, returnType }, options);
}
function IsFunction2(value) {
  return IsKind(value, "Function");
}
function FunctionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "returnType"]);
}

// node_modules/typebox/build/type/types/ref.mjs
function Ref(ref, options) {
  return memory_exports.Create({ ["~kind"]: "Ref" }, { $ref: ref }, options);
}
function IsRef(value) {
  return IsKind(value, "Ref");
}

// node_modules/typebox/build/type/types/generic.mjs
function Generic(parameters, expression) {
  return memory_exports.Create({ "~kind": "Generic" }, { type: "generic", parameters, expression });
}
function IsGeneric(value) {
  return IsKind(value, "Generic");
}

// node_modules/typebox/build/type/types/any.mjs
function Any(options) {
  return memory_exports.Create({ ["~kind"]: "Any" }, {}, options);
}
function IsAny(value) {
  return IsKind(value, "Any");
}

// node_modules/typebox/build/type/types/never.mjs
var NeverPattern = "(?!)";
function Never(options) {
  return memory_exports.Create({ "~kind": "Never" }, { not: {} }, options);
}
function IsNever(value) {
  return IsKind(value, "Never");
}

// node_modules/typebox/build/type/action/_add_optional.mjs
function AddOptionalDeferred(type, options = {}) {
  return Deferred("AddOptional", [type], options);
}
function AddOptional(type, options = {}) {
  return AddOptionalAction(type, options);
}

// node_modules/typebox/build/type/types/_optional.mjs
function Optional(type) {
  return AddOptional(type);
}
function IsOptional(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~optional");
}

// node_modules/typebox/build/type/types/properties.mjs
function RequiredArray(properties) {
  return guard_exports.Keys(properties).filter((key) => !IsOptional(properties[key]));
}
function PropertyKeys(properties) {
  return guard_exports.Keys(properties);
}
function PropertyValues(properties) {
  return guard_exports.Values(properties);
}

// node_modules/typebox/build/type/types/object.mjs
function _Object_(properties, options = {}) {
  const requiredKeys = RequiredArray(properties);
  const required = requiredKeys.length > 0 ? { required: requiredKeys } : {};
  return memory_exports.Create({ "~kind": "Object" }, { type: "object", ...required, properties }, options);
}
function IsObject2(value) {
  return IsKind(value, "Object");
}
function ObjectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "properties", "required"]);
}

// node_modules/typebox/build/type/types/unknown.mjs
function Unknown(options) {
  return memory_exports.Create({ ["~kind"]: "Unknown" }, {}, options);
}
function IsUnknown(value) {
  return IsKind(value, "Unknown");
}

// node_modules/typebox/build/type/types/cyclic.mjs
function Cyclic($defs, $ref, options) {
  const defs = guard_exports.Keys($defs).reduce((result, key) => {
    return { ...result, [key]: memory_exports.Update($defs[key], {}, { $id: key }) };
  }, {});
  return memory_exports.Create({ ["~kind"]: "Cyclic" }, { $defs: defs, $ref }, options);
}
function IsCyclic(value) {
  return IsKind(value, "Cyclic");
}

// node_modules/typebox/build/type/types/unsafe.mjs
function Unsafe(schema) {
  return memory_exports.Update(schema, { ["~unsafe"]: null }, {});
}
function IsUnsafe(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "~unsafe") && guard_exports.IsNull(value["~unsafe"]);
}

// node_modules/typebox/build/system/arguments/arguments.mjs
var arguments_exports = {};
__export(arguments_exports, {
  Match: () => Match
});
function Match(args, match) {
  return match[args.length]?.(...args) ?? (() => {
    throw Error("Invalid Arguments");
  })();
}

// node_modules/typebox/build/type/types/infer.mjs
function Infer(...args) {
  const [name, extends_] = arguments_exports.Match(args, {
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ ["~kind"]: "Infer" }, { type: "infer", name, extends: extends_ }, {});
}
function IsInfer(value) {
  return IsKind(value, "Infer");
}

// node_modules/typebox/build/type/types/dependent.mjs
function Dependent(if_, then_, else_, options = {}) {
  return memory_exports.Create({ "~kind": "Dependent" }, { if: if_, then: then_, else: else_ }, options);
}
function IsDependent(value) {
  return IsKind(value, "Dependent");
}
function DependentOptions(type) {
  return memory_exports.Discard(type, ["~kind", "if", "then", "else"]);
}

// node_modules/typebox/build/type/engine/enum/typescript_enum_to_enum_values.mjs
function IsTypeScriptEnumLike(value) {
  return guard_exports.IsObjectNotArray(value);
}
function TypeScriptEnumToEnumValues(type) {
  const keys = guard_exports.Keys(type).filter((key) => isNaN(key));
  return keys.reduce((result, key) => [...result, type[key]], []);
}

// node_modules/typebox/build/type/types/enum.mjs
function IsEnumValue(value) {
  return guard_exports.IsString(value) || guard_exports.IsNumber(value);
}
function Enum(value, options) {
  const values = IsTypeScriptEnumLike(value) ? TypeScriptEnumToEnumValues(value) : value;
  return memory_exports.Create({ "~kind": "Enum" }, { enum: values }, options);
}
function IsEnum(value) {
  return IsKind(value, "Enum");
}

// node_modules/typebox/build/type/types/intersect.mjs
function Intersect(types, options = {}) {
  return memory_exports.Create({ "~kind": "Intersect" }, { allOf: types }, options);
}
function IsIntersect(value) {
  return IsKind(value, "Intersect");
}
function IntersectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "allOf"]);
}

// node_modules/typebox/build/system/hashing/hash.mjs
var hash_exports = {};
__export(hash_exports, {
  Hash: () => Hash,
  HashCode: () => HashCode
});

// node_modules/typebox/build/system/unreachable/unreachable.mjs
function Unreachable() {
  throw new Error("Unreachable");
}

// node_modules/typebox/build/system/hashing/hash.mjs
function InstanceKeys(value) {
  const propertyKeys = /* @__PURE__ */ new Set();
  let current = value;
  while (current && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (key !== "constructor" && typeof key !== "symbol")
        propertyKeys.add(key);
    }
    current = Object.getPrototypeOf(current);
  }
  return [...propertyKeys];
}
function IsIEEE754(value) {
  return typeof value === "number";
}
var ByteMarker;
(function(ByteMarker2) {
  ByteMarker2[ByteMarker2["Array"] = 0] = "Array";
  ByteMarker2[ByteMarker2["BigInt"] = 1] = "BigInt";
  ByteMarker2[ByteMarker2["Boolean"] = 2] = "Boolean";
  ByteMarker2[ByteMarker2["Date"] = 3] = "Date";
  ByteMarker2[ByteMarker2["Constructor"] = 4] = "Constructor";
  ByteMarker2[ByteMarker2["Function"] = 5] = "Function";
  ByteMarker2[ByteMarker2["Null"] = 6] = "Null";
  ByteMarker2[ByteMarker2["Number"] = 7] = "Number";
  ByteMarker2[ByteMarker2["Object"] = 8] = "Object";
  ByteMarker2[ByteMarker2["RegExp"] = 9] = "RegExp";
  ByteMarker2[ByteMarker2["String"] = 10] = "String";
  ByteMarker2[ByteMarker2["Symbol"] = 11] = "Symbol";
  ByteMarker2[ByteMarker2["TypeArray"] = 12] = "TypeArray";
  ByteMarker2[ByteMarker2["Undefined"] = 13] = "Undefined";
})(ByteMarker || (ByteMarker = {}));
var Accumulator = BigInt("14695981039346656037");
var [Prime, Size] = [BigInt("1099511628211"), BigInt(
  "18446744073709551616"
  /* 2 ^ 64 */
)];
var Bytes = Array.from({ length: 256 }).map((_, i) => BigInt(i));
var F64 = new Float64Array(1);
var F64In = new DataView(F64.buffer);
var F64Out = new Uint8Array(F64.buffer);
function FNV1A64_OP(byte) {
  Accumulator = Accumulator ^ Bytes[byte];
  Ac…123877 tokens truncated…{
  const [context, schema, value] = arguments_exports.Match(args, {
    3: (context2, schema2, value2) => [context2, schema2, value2],
    2: (schema2, value2) => [{}, schema2, value2]
  });
  const settings2 = settings_exports.Get();
  const locale2 = Get2();
  const errors = [];
  const stack = new Stack(context, schema);
  const errorContext = new ErrorContext((error) => {
    if (guard_exports.IsGreaterEqualThan(errors.length, settings2.maxErrors))
      return;
    return errors.push({ ...error, message: locale2(error) });
  });
  const result = ErrorSchema(stack, errorContext, "#", "", schema, value);
  return [result, errors];
}

// node_modules/typebox/build/schema/check.mjs
function Check(...args) {
  const [context, schema, value] = arguments_exports.Match(args, {
    3: (context2, schema2, value2) => [context2, schema2, value2],
    2: (schema2, value2) => [{}, schema2, value2]
  });
  const stack = new Stack(context, schema);
  const checkContext = new CheckContext();
  return CheckSchema(stack, checkContext, schema, value);
}

// node_modules/typebox/build/value/check/check.mjs
function Check2(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return Check(context, type, value);
}

// node_modules/typebox/build/value/errors/errors.mjs
function Errors2(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const [_, errors] = Errors(context, type, value);
  return errors;
}

// node_modules/typebox/build/value/assert/assert.mjs
var AssertError = class extends Error {
  constructor(source, value, errors) {
    super(source);
    Object.defineProperty(this, "cause", {
      value: { source, errors, value },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
};

// node_modules/typebox/build/value/clean/from_array.mjs
function FromArray7(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  return value.map((value2) => FromType19(context, type.items, value2));
}

// node_modules/typebox/build/value/clean/from_cyclic.mjs
function FromCyclic6(context, type, value) {
  return FromType19({ ...context, ...type.$defs }, Ref(type.$ref), value);
}

// node_modules/typebox/build/value/clean/from_intersect.mjs
function EvaluateIntersection(context, type) {
  const additionalProperties = guard_exports.HasPropertyKey(type, "unevaluatedProperties") ? { additionalProperties: type.unevaluatedProperties } : {};
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return IsObject2(evaluated) ? With2(evaluated, additionalProperties) : evaluated;
}
function FromIntersect6(context, type, value) {
  const evaluated = EvaluateIntersection(context, type);
  return FromType19(context, evaluated, value);
}

// node_modules/typebox/build/value/clean/additional.mjs
function GetAdditionalProperties(type) {
  const additionalProperties = guard_exports.HasPropertyKey(type, "additionalProperties") ? type.additionalProperties : void 0;
  return additionalProperties;
}

// node_modules/typebox/build/value/clean/from_object.mjs
function FromObject11(context, type, value) {
  if (!guard_exports.IsObject(value) || guard_exports.IsArray(value))
    return value;
  const additionalProperties = GetAdditionalProperties(type);
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.HasPropertyKey(type.properties, key)) {
      value[key] = FromType19(context, type.properties[key], value[key]);
      continue;
    }
    const unknownCheck = (
      // 1. additionalProperties: true
      guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema(additionalProperties) && Check2(context, additionalProperties, value[key])
    );
    if (unknownCheck) {
      value[key] = FromType19(context, additionalProperties, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}

// node_modules/typebox/build/value/clean/from_record.mjs
function FromRecord3(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const additionalProperties = GetAdditionalProperties(type);
  const [recordPattern, recordValue] = [new RegExp(RecordPattern(type)), RecordValue(type)];
  for (const key of guard_exports.Keys(value)) {
    if (recordPattern.test(key)) {
      value[key] = FromType19(context, recordValue, value[key]);
      continue;
    }
    const unknownCheck = (
      // 1. additionalProperties: true
      guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema(additionalProperties) && Check2(context, additionalProperties, value[key])
    );
    if (unknownCheck) {
      value[key] = FromType19(context, additionalProperties, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}

// node_modules/typebox/build/value/clean/from_ref.mjs
function FromRef5(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType19(context, context[type.$ref], value) : value;
}

// node_modules/typebox/build/value/clean/from_tuple.mjs
function FromTuple5(context, schema, value) {
  if (!guard_exports.IsArray(value))
    return value;
  const length = Math.min(value.length, schema.items.length);
  for (let index = 0; index < length; index++) {
    value[index] = FromType19(context, schema.items[index], value[index]);
  }
  return guard_exports.IsGreaterThan(value.length, length) ? value.slice(0, length) : value;
}

// node_modules/typebox/build/value/clone/clone.mjs
function Clone2(value) {
  return Clone(value);
}

// node_modules/typebox/build/value/clean/from_union.mjs
function FromUnion9(context, type, value) {
  for (const schema of type.anyOf) {
    const clean = FromType19(context, schema, Clone2(value));
    if (Check2(context, schema, clean))
      return clean;
  }
  return value;
}

// node_modules/typebox/build/value/clean/from_type.mjs
function FromType19(context, type, value) {
  return IsArray2(type) ? FromArray7(context, type, value) : IsCyclic(type) ? FromCyclic6(context, type, value) : IsIntersect(type) ? FromIntersect6(context, type, value) : IsObject2(type) ? FromObject11(context, type, value) : IsRecord(type) ? FromRecord3(context, type, value) : IsRef(type) ? FromRef5(context, type, value) : IsTuple(type) ? FromTuple5(context, type, value) : IsUnion(type) ? FromUnion9(context, type, value) : value;
}

// node_modules/typebox/build/value/shared/union_priority_sort.mjs
function Modifiers(type, next) {
  for (const key of guard_default.Keys(type)) {
    if (guard_default.HasPropertyKey(next, key))
      continue;
    next[key] = type[key];
  }
  return next;
}
function FromProperties4(properties) {
  const result = {};
  for (const key of guard_default.Keys(properties))
    result[key] = FromType20(properties[key]);
  return result;
}
function FromPriorityTypes(types) {
  return FromTypes6(Priority(types));
}
function FromTypes6(types) {
  return types.map((type) => FromType20(type));
}
function FromType20(type) {
  const next = IsArray2(type) ? _Array_(FromType20(type.items), ArrayOptions(type)) : IsIntersect(type) ? Intersect(FromTypes6(type.allOf)) : IsUnion(type) ? Union(FromPriorityTypes(type.anyOf)) : IsObject2(type) ? _Object_(FromProperties4(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType20(RecordValue(type))) : IsTuple(type) ? Tuple(FromTypes6(type.items)) : type;
  return Modifiers(type, next);
}
function UnionPrioritySort(type) {
  const result = FromType20(type);
  return result;
}

// node_modules/typebox/build/value/clean/clean.mjs
function Clean(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType19(context, sorted, value);
}

// node_modules/typebox/build/value/convert/try/try.mjs
var try_exports = {};
__export(try_exports, {
  Fail: () => Fail,
  IsOk: () => IsOk,
  Ok: () => Ok,
  TryArray: () => TryArray,
  TryBigInt: () => TryBigInt,
  TryBoolean: () => TryBoolean,
  TryNull: () => TryNull,
  TryNumber: () => TryNumber,
  TryString: () => TryString,
  TryUndefined: () => TryUndefined
});

// node_modules/typebox/build/value/convert/try/try_result.mjs
function IsOk(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "value");
}
function Ok(value) {
  return { value };
}
function Fail() {
  return void 0;
}

// node_modules/typebox/build/value/convert/try/try_array.mjs
function TryArray(value) {
  return guard_exports.IsArray(value) ? Ok(value) : Ok([value]);
}

// node_modules/typebox/build/value/convert/try/try_bigint.mjs
function FromBoolean2(value) {
  return guard_exports.IsEqual(value, true) ? Ok(BigInt(1)) : Ok(BigInt(0));
}
var bigintPattern = /^-?(0|[1-9]\d*)n$/;
var decimalPattern = /^-?(0|[1-9]\d*)\.\d+$/;
var integerPattern = /^-?(0|[1-9]\d*)$/;
function IsStringBigIntLike(value) {
  return bigintPattern.test(value);
}
function IsStringDecimalLike(value) {
  return decimalPattern.test(value);
}
function IsStringIntegerLike(value) {
  return integerPattern.test(value);
}
function FromString2(value) {
  const lowercase = value.toLowerCase();
  return IsStringBigIntLike(value) ? Ok(BigInt(value.slice(0, value.length - 1))) : IsStringDecimalLike(value) ? Ok(BigInt(value.split(".")[0])) : IsStringIntegerLike(value) ? Ok(BigInt(value)) : guard_exports.IsEqual(lowercase, "false") ? Ok(BigInt(0)) : guard_exports.IsEqual(lowercase, "true") ? Ok(BigInt(1)) : Fail();
}
function TryBigInt(value) {
  return guard_exports.IsBigInt(value) ? Ok(value) : guard_exports.IsBoolean(value) ? FromBoolean2(value) : guard_exports.IsNumber(value) ? Ok(BigInt(Math.trunc(value))) : guard_exports.IsNull(value) ? Ok(BigInt(0)) : guard_exports.IsString(value) ? FromString2(value) : guard_exports.IsUndefined(value) ? Ok(BigInt(0)) : Fail();
}

// node_modules/typebox/build/value/convert/try/try_boolean.mjs
function FromBigInt2(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(false) : guard_exports.IsEqual(value, BigInt(1)) ? Ok(true) : Fail();
}
function FromNumber2(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(false) : guard_exports.IsEqual(value, 1) ? Ok(true) : Fail();
}
function FromString3(value) {
  return guard_exports.IsEqual(value.toLowerCase(), "false") ? Ok(false) : guard_exports.IsEqual(value.toLowerCase(), "true") ? Ok(true) : guard_exports.IsEqual(value, "0") ? Ok(false) : guard_exports.IsEqual(value, "1") ? Ok(true) : Fail();
}
function TryBoolean(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt2(value) : guard_exports.IsBoolean(value) ? Ok(value) : guard_exports.IsNumber(value) ? FromNumber2(value) : guard_exports.IsNull(value) ? Ok(false) : guard_exports.IsString(value) ? FromString3(value) : guard_exports.IsUndefined(value) ? Ok(false) : Fail();
}

// node_modules/typebox/build/value/convert/try/try_null.mjs
function FromBigInt3(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(null) : Fail();
}
function FromBoolean3(value) {
  return guard_exports.IsEqual(value, false) ? Ok(null) : Fail();
}
function FromNumber3(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(null) : Fail();
}
function FromString4(value) {
  const lowercase = value.toLowerCase();
  const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
  return predicate ? Ok(null) : Fail();
}
function TryNull(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt3(value) : guard_exports.IsBoolean(value) ? FromBoolean3(value) : guard_exports.IsNumber(value) ? FromNumber3(value) : guard_exports.IsNull(value) ? Ok(null) : guard_exports.IsString(value) ? FromString4(value) : guard_exports.IsUndefined(value) ? Ok(null) : Fail();
}

// node_modules/typebox/build/value/convert/try/try_number.mjs
var maxBigInt = BigInt(Number.MAX_SAFE_INTEGER);
var minBigInt = BigInt(Number.MIN_SAFE_INTEGER);
function FromBigInt4(value) {
  return value <= maxBigInt && value >= minBigInt ? Ok(Number(value)) : Fail();
}
function FromBoolean4(value) {
  return Ok(value ? 1 : 0);
}
function FromString5(value) {
  const coerced = +value;
  if (guard_exports.IsNumber(coerced))
    return Ok(coerced);
  const lowercase = value.toLowerCase();
  if (guard_exports.IsEqual(lowercase, "false"))
    return Ok(0);
  if (guard_exports.IsEqual(lowercase, "true"))
    return Ok(1);
  const result = TryBigInt(value);
  if (IsOk(result))
    return result.value <= maxBigInt && result.value >= minBigInt ? Ok(Number(result.value)) : Fail();
  return Fail();
}
function TryNumber(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt4(value) : guard_exports.IsBoolean(value) ? FromBoolean4(value) : guard_exports.IsNumber(value) ? Ok(value) : guard_exports.IsNull(value) ? Ok(0) : guard_exports.IsString(value) ? FromString5(value) : guard_exports.IsUndefined(value) ? Ok(0) : Fail();
}

// node_modules/typebox/build/value/convert/try/try_string.mjs
function TryString(value) {
  return guard_exports.IsBigInt(value) ? Ok(value.toString()) : guard_exports.IsBoolean(value) ? Ok(value.toString()) : guard_exports.IsNumber(value) ? Ok(value.toString()) : guard_exports.IsNull(value) ? Ok("null") : guard_exports.IsString(value) ? Ok(value) : guard_exports.IsUndefined(value) ? Ok("") : Fail();
}

// node_modules/typebox/build/value/convert/try/try_undefined.mjs
function FromBigInt5(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(void 0) : Fail();
}
function FromBoolean5(value) {
  return guard_exports.IsEqual(value, false) ? Ok(void 0) : Fail();
}
function FromNumber4(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(void 0) : Fail();
}
function FromString6(value) {
  const lowercase = value.toLowerCase();
  const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
  return predicate ? Ok(void 0) : Fail();
}
function TryUndefined(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt5(value) : guard_exports.IsBoolean(value) ? FromBoolean5(value) : guard_exports.IsNumber(value) ? FromNumber4(value) : guard_exports.IsNull(value) ? Ok(void 0) : guard_exports.IsString(value) ? FromString6(value) : guard_exports.IsUndefined(value) ? Ok(value) : Fail();
}

// node_modules/typebox/build/value/convert/from_array.mjs
function FromArray8(context, type, value) {
  const result = try_exports.TryArray(value);
  return result.value.map((value2) => FromType21(context, type.items, value2));
}

// node_modules/typebox/build/value/convert/from_bigint.mjs
function FromBigInt6(_context, _type, value) {
  const result = try_exports.TryBigInt(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_boolean.mjs
function FromBoolean6(_context, _type, value) {
  const result = try_exports.TryBoolean(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_cyclic.mjs
function FromCyclic7(context, type, value) {
  return FromType21({ ...context, ...type.$defs }, Ref(type.$ref), value);
}

// node_modules/typebox/build/value/convert/from_enum.mjs
function FromEnum3(context, type, value) {
  return FromType21(context, Evaluate(type), value);
}

// node_modules/typebox/build/value/convert/from_integer.mjs
function FromInteger(_context, _type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) ? Math.trunc(result.value) : value;
}

// node_modules/typebox/build/value/convert/from_intersect.mjs
function FromIntersect7(context, type, value) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType21(context, evaluated, value);
}

// node_modules/typebox/build/value/convert/from_literal.mjs
function FromLiteralBigInt(_context, type, value) {
  const result = try_exports.TryBigInt(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralBoolean(_context, type, value) {
  const result = try_exports.TryBoolean(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralNumber(_context, type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralString(_context, type, value) {
  const result = try_exports.TryString(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteral6(context, type, value) {
  if (guard_exports.IsEqual(type.const, value))
    return value;
  return IsLiteralBigInt(type) ? FromLiteralBigInt(context, type, value) : IsLiteralBoolean(type) ? FromLiteralBoolean(context, type, value) : IsLiteralNumber(type) ? FromLiteralNumber(context, type, value) : IsLiteralString(type) ? FromLiteralString(context, type, value) : Unreachable();
}

// node_modules/typebox/build/value/convert/from_null.mjs
function FromNull2(_context, _type, value) {
  const result = try_exports.TryNull(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_number.mjs
function FromNumber5(_context, _type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_additional.mjs
function FromAdditionalProperties(context, entries, additionalProperties, value) {
  const keys = guard_exports.Keys(value);
  for (const [regexp, _] of entries) {
    for (const key of keys) {
      if (!regexp.test(key)) {
        value[key] = FromType21(context, additionalProperties, value[key]);
      }
    }
  }
  return value;
}

// node_modules/typebox/build/value/shared/optional_undefined.mjs
function IsOptionalUndefined(property, key, value) {
  return IsOptional(property) && guard_exports.IsUndefined(value[key]);
}

// node_modules/typebox/build/value/convert/from_object.mjs
function FromProperties5(context, type, value) {
  const entries = guard_exports.EntriesRegExp(type.properties);
  const keys = guard_exports.Keys(value);
  for (const [regexp, property] of entries) {
    for (const key of keys) {
      if (!regexp.test(key) || IsOptionalUndefined(property, key, value))
        continue;
      value[key] = FromType21(context, property, value[key]);
    }
  }
  return guard_exports.HasPropertyKey(type, "additionalProperties") && guard_exports.IsObject(type.additionalProperties) ? FromAdditionalProperties(context, entries, type.additionalProperties, value) : value;
}
function FromObject12(context, type, value) {
  return guard_exports.IsObjectNotArray(value) ? FromProperties5(context, type, value) : value;
}

// node_modules/typebox/build/value/convert/from_record.mjs
function FromPatternProperties(context, type, value) {
  const entries = guard_exports.EntriesRegExp(type.patternProperties);
  const keys = guard_exports.Keys(value);
  for (const [regexp, schema] of entries) {
    for (const key of keys) {
      if (regexp.test(key)) {
        value[key] = FromType21(context, schema, value[key]);
      }
    }
  }
  return guard_exports.HasPropertyKey(type, "additionalProperties") && guard_exports.IsObject(type.additionalProperties) ? FromAdditionalProperties(context, entries, type.additionalProperties, value) : value;
}
function FromRecord4(context, type, value) {
  return guard_exports.IsObjectNotArray(value) ? FromPatternProperties(context, type, value) : value;
}

// node_modules/typebox/build/value/convert/from_ref.mjs
function FromRef6(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType21(context, context[type.$ref], value) : value;
}

// node_modules/typebox/build/value/convert/from_string.mjs
function FromString7(_context, _type, value) {
  const result = try_exports.TryString(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_template_literal.mjs
function FromTemplateLiteral4(context, type, value) {
  return FromType21(context, Evaluate(type), value);
}

// node_modules/typebox/build/value/convert/from_tuple.mjs
function FromTuple6(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let index = 0; index < Math.min(type.items.length, value.length); index++) {
    value[index] = FromType21(context, type.items[index], value[index]);
  }
  return value;
}

// node_modules/typebox/build/value/convert/from_undefined.mjs
function FromUndefined2(_context, _type, value) {
  const result = try_exports.TryUndefined(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/typebox/build/value/convert/from_union.mjs
function FromUnion10(context, type, value) {
  const matched = type.anyOf.some((type2) => Check2(context, type2, value));
  if (matched)
    return value;
  const candidates = type.anyOf.map((type2) => FromType21(context, type2, Clone2(value)));
  const selected = candidates.find((value2) => Check2(context, type, value2));
  return guard_exports.IsUndefined(selected) ? value : selected;
}

// node_modules/typebox/build/value/convert/from_void.mjs
function FromVoid(_context, _type, value) {
  const result = try_exports.TryUndefined(value);
  return try_exports.IsOk(result) ? void 0 : value;
}

// node_modules/typebox/build/value/convert/from_type.mjs
function FromType21(context, type, value) {
  return IsArray2(type) ? FromArray8(context, type, value) : IsBigInt2(type) ? FromBigInt6(context, type, value) : IsBoolean3(type) ? FromBoolean6(context, type, value) : IsCyclic(type) ? FromCyclic7(context, type, value) : IsEnum(type) ? FromEnum3(context, type, value) : IsInteger2(type) ? FromInteger(context, type, value) : IsIntersect(type) ? FromIntersect7(context, type, value) : IsLiteral(type) ? FromLiteral6(context, type, value) : IsNull2(type) ? FromNull2(context, type, value) : IsNumber3(type) ? FromNumber5(context, type, value) : IsObject2(type) ? FromObject12(context, type, value) : IsRecord(type) ? FromRecord4(context, type, value) : IsRef(type) ? FromRef6(context, type, value) : IsString3(type) ? FromString7(context, type, value) : IsTemplateLiteral(type) ? FromTemplateLiteral4(context, type, value) : IsTuple(type) ? FromTuple6(context, type, value) : IsUndefined2(type) ? FromUndefined2(context, type, value) : IsUnion(type) ? FromUnion10(context, type, value) : IsVoid(type) ? FromVoid(context, type, value) : value;
}

// node_modules/typebox/build/value/convert/convert.mjs
function Convert(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return FromType21(context, type, value);
}

// node_modules/typebox/build/value/default/from_array.mjs
function FromArray9(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < value.length; i++) {
    value[i] = FromType22(context, type.items, value[i]);
  }
  return value;
}

// node_modules/typebox/build/value/default/from_cyclic.mjs
function FromCyclic8(context, type, value) {
  return FromType22({ ...context, ...type.$defs }, Ref(type.$ref), value);
}

// node_modules/typebox/build/value/default/from_default.mjs
function FromDefault(type, value) {
  if (!guard_exports.IsUndefined(value))
    return value;
  return guard_exports.IsFunction(type.default) ? type.default() : Clone2(type.default);
}

// node_modules/typebox/build/value/default/from_intersect.mjs
function FromIntersect8(context, type, value) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType22(context, evaluated, value);
}

// node_modules/typebox/build/value/default/from_object.mjs
function FromObject13(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const knownPropertyKeys = guard_exports.Keys(type.properties);
  for (const key of knownPropertyKeys) {
    const propertyValue = FromType22(context, type.properties[key], value[key]);
    const isUnassignableUndefined = guard_exports.IsUndefined(propertyValue) && (IsOptional(type.properties[key]) || !guard_exports.HasPropertyKey(type.properties[key], "default"));
    if (isUnassignableUndefined)
      continue;
    value[key] = propertyValue;
  }
  if (!IsAdditionalProperties(type) || guard_exports.IsBoolean(type.additionalProperties))
    return value;
  for (const key of guard_exports.Keys(value)) {
    if (knownPropertyKeys.includes(key))
      continue;
    value[key] = FromType22(context, type.additionalProperties, value[key]);
  }
  return value;
}

// node_modules/typebox/build/value/default/from_record.mjs
function FromRecord5(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const [recordKey, recordValue] = [new RegExp(RecordPattern(type)), RecordValue(type)];
  for (const key of guard_exports.Keys(value)) {
    if (!(recordKey.test(key) && IsDefault(recordValue)))
      continue;
    value[key] = FromType22(context, recordValue, value[key]);
  }
  if (!IsAdditionalProperties(type))
    return value;
  for (const key of guard_exports.Keys(value)) {
    if (recordKey.test(key))
      continue;
    value[key] = FromType22(context, type.additionalProperties, value[key]);
  }
  return value;
}

// node_modules/typebox/build/value/default/from_ref.mjs
function FromRef7(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType22(context, context[type.$ref], value) : value;
}

// node_modules/typebox/build/value/default/from_tuple.mjs
function FromTuple7(context, schema, value) {
  if (!guard_exports.IsArray(value))
    return value;
  const [items2, max] = [schema.items, Math.max(schema.items.length, value.length)];
  for (let i = 0; i < max; i++) {
    if (i < items2.length)
      value[i] = FromType22(context, items2[i], value[i]);
  }
  return value;
}

// node_modules/typebox/build/value/default/from_union.mjs
function FromUnion11(context, schema, value) {
  for (const inner of schema.anyOf) {
    const result = FromType22(context, inner, Clone2(value));
    if (Check2(context, inner, result)) {
      return result;
    }
  }
  return value;
}

// node_modules/typebox/build/value/default/from_type.mjs
function FromType22(context, type, value) {
  const defaulted = IsDefault(type) ? FromDefault(type, value) : value;
  return IsArray2(type) ? FromArray9(context, type, defaulted) : IsCyclic(type) ? FromCyclic8(context, type, defaulted) : IsIntersect(type) ? FromIntersect8(context, type, defaulted) : IsObject2(type) ? FromObject13(context, type, defaulted) : IsRecord(type) ? FromRecord5(context, type, defaulted) : IsRef(type) ? FromRef7(context, type, defaulted) : IsTuple(type) ? FromTuple7(context, type, defaulted) : IsUnion(type) ? FromUnion11(context, type, defaulted) : defaulted;
}

// node_modules/typebox/build/value/default/default.mjs
function Default(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return FromType22(context, type, value);
}

// node_modules/typebox/build/value/pipeline/pipeline.mjs
function Pipeline(pipeline) {
  return (...args) => {
    const [context, type, value] = arguments_exports.Match(args, {
      3: (context2, type2, value2) => [context2, type2, value2],
      2: (type2, value2) => [{}, type2, value2]
    });
    return pipeline.reduce((result, func) => func(context, type, result), value);
  };
}

// node_modules/typebox/build/value/codec/callback.mjs
function Decode3(_context, type, value) {
  return type["~codec"].decode(value);
}
function Encode2(_context, type, value) {
  return type["~codec"].encode(value);
}
function Callback(direction, context, type, value) {
  if (!IsCodec(type))
    return value;
  return guard_exports.IsEqual(direction, "Decode") ? Decode3(context, type, value) : Encode2(context, type, value);
}

// node_modules/typebox/build/value/codec/from_array.mjs
function Decode4(direction, context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < value.length; i++) {
    value[i] = FromType23(direction, context, type.items, value[i]);
  }
  return Callback(direction, context, type, value);
}
function Encode3(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsArray(exterior))
    return exterior;
  for (let i = 0; i < exterior.length; i++) {
    exterior[i] = FromType23(direction, context, type.items, exterior[i]);
  }
  return exterior;
}
function FromArray10(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode4(direction, context, type, value) : Encode3(direction, context, type, value);
}

// node_modules/typebox/build/value/codec/from_cyclic.mjs
function FromCyclic9(direction, context, type, value) {
  value = FromType23(direction, { ...context, ...type.$defs }, Ref(type.$ref), value);
  return Callback(direction, context, type, value);
}

// node_modules/typebox/build/value/codec/from_intersect.mjs
function MergeInteriors(interiors) {
  return interiors.reduce((results, interior) => ({ ...results, ...interior }), {});
}
function NonMatchingInterior(value, interiors) {
  for (const interior of interiors)
    if (!guard_exports.IsDeepEqual(value, interior))
      return interior;
  return value;
}
function Decode5(direction, context, type, value) {
  if (guard_exports.IsEqual(type.allOf.length, 0))
    return Callback(direction, context, type, value);
  const interiors = type.allOf.map((schema) => FromType23(direction, context, schema, Clean(schema, Clone2(value))));
  const structural = interiors.every((result) => guard_exports.IsObject(result));
  const exterior = structural ? MergeInteriors(interiors) : NonMatchingInterior(value, interiors);
  return Callback(direction, context, type, exterior);
}
function Encode4(direction, context, type, value) {
  if (guard_exports.IsEqual(type.allOf.length, 0))
    return Callback(direction, context, type, value);
  const exterior = Callback(direction, context, type, value);
  const interiors = type.allOf.map((schema) => FromType23(direction, context, schema, Clean(schema, Clone2(exterior))));
  const structural = interiors.every((result) => guard_exports.IsObject(result));
  if (structural)
    return MergeInteriors(interiors);
  return NonMatchingInterior(exterior, interiors);
}
function FromIntersect9(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode5(direction, context, type, value) : Encode4(direction, context, type, value);
}

// node_modules/typebox/build/value/codec/from_object.mjs
function Decode6(direction, context, type, value) {
  if (!guard_exports.IsObjectNotArray(value))
    return value;
  for (const key of guard_exports.Keys(type.properties)) {
    if (!guard_exports.HasPropertyKey(value, key) || IsOptionalUndefined(type.properties[key], key, value))
      continue;
    value[key] = FromType23(direction, context, type.properties[key], value[key]);
  }
  return Callback(direction, context, type, value);
}
function Encode5(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsObjectNotArray(exterior))
    return exterior;
  for (const key of guard_exports.Keys(type.properties)) {
    if (!guard_exports.HasPropertyKey(exterior, key) || IsOptionalUndefined(type.properties[key], key, exterior))
      continue;
    exterior[key] = FromType23(direction, context, type.properties[key], exterior[key]);
  }
  return exterior;
}
function FromObject14(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode6(direction, context, type, value) : Encode5(direction, context, type, value);
}

// node_modules/typebox/build/value/codec/from_record.mjs
function Decode7(direction, context, type, value) {
  if (!guard_exports.IsObjectNotArray(value))
    return value;
  const regexp = new RegExp(RecordPattern(type));
  for (const key of guard_exports.Keys(value)) {
    if (!regexp.test(key))
      continue;
    value[key] = FromType23(direction, context, RecordValue(type), value[key]);
  }
  return Callback(direction, context, type, value);
}
function Encode6(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsObjectNotArray(exterior))
    return exterior;
  const regexp = new RegExp(RecordPattern(type));
  for (const key of guard_exports.Keys(exterior)) {
    if (!regexp.test(key))
      continue;
    exterior[key] = FromType23(direction, context, RecordValue(type), exterior[key]);
  }
  return exterior;
}
function FromRecord6(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode7(direction, context, type, value) : Encode6(direction, context, type, value);
}

// node_modules/typebox/build/value/codec/from_ref.mjs
function ResolveRef(direction, context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType23(direction, context, context[type.$ref], value) : value;
}
function FromRef8(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Callback(direction, context, type, ResolveRef(direction, context, type, value)) : ResolveRef(direction, context, type, Callback(direction, context, type, value));
}

// node_modules/typebox/build/value/codec/from_tuple.mjs
function Decode8(direction, context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < Math.min(type.items.length, value.length); i++) {
    value[i] = FromType23(direction, context, type.items[i], value[i]);
  }
  return Callback(direction, context, type, value);
}
function Encode7(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsArray(exterior))
    return value;
  for (let i = 0; i < Math.min(type.items.length, exterior.length); i++) {
    exterior[i] = FromType23(direction, context, type.items[i], exterior[i]);
  }
  return exterior;
}
function FromTuple8(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode8(direction, context, type, value) : Encode7(direction, context, type, value);
}

// node_modules/typebox/build/value/codec/from_union.mjs
function Decode9(direction, context, type, value) {
  for (const schema of type.anyOf) {
    if (!Check2(context, schema, value))
      continue;
    const variant = FromType23(direction, context, schema, value);
    return Callback(direction, context, type, variant);
  }
  return value;
}
function Encode8(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  for (const schema of type.anyOf) {
    const variant = FromType23(direction, context, schema, Clone2(exterior));
    if (!Check2(context, schema, variant))
      continue;
    return variant;
  }
  return exterior;
}
function FromUnion12(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode9(direction, context, type, value) : Encode8(direction, context, type, value);
}

// node_modules/typebox/build/value/codec/from_type.mjs
function FromType23(direction, context, type, value) {
  return IsArray2(type) ? FromArray10(direction, context, type, value) : IsCyclic(type) ? FromCyclic9(direction, context, type, value) : IsIntersect(type) ? FromIntersect9(direction, context, type, value) : IsObject2(type) ? FromObject14(direction, context, type, value) : IsRecord(type) ? FromRecord6(direction, context, type, value) : IsRef(type) ? FromRef8(direction, context, type, value) : IsTuple(type) ? FromTuple8(direction, context, type, value) : IsUnion(type) ? FromUnion12(direction, context, type, value) : Callback(direction, context, type, value);
}

// node_modules/typebox/build/value/codec/decode.mjs
var DecodeError = class extends AssertError {
  constructor(value, errors) {
    super("Decode", value, errors);
  }
};
function Assert(context, type, value) {
  if (!Check2(context, type, value))
    throw new DecodeError(value, Errors2(context, type, value));
  return value;
}
function DecodeUnsafe(context, type, value) {
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType23("Decode", context, sorted, value);
}
var Decoder = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context, type, value) => Default(context, type, value),
  (context, type, value) => Convert(context, type, value),
  (context, type, value) => Clean(context, type, value),
  (context, type, value) => Assert(context, type, value),
  (context, type, value) => DecodeUnsafe(context, type, value)
]);

// node_modules/typebox/build/value/codec/encode.mjs
var EncodeError = class extends AssertError {
  constructor(value, errors) {
    super("Encode", value, errors);
  }
};
function Assert2(context, type, value) {
  if (!Check2(context, type, value))
    throw new EncodeError(value, Errors2(context, type, value));
  return value;
}
function EncodeUnsafe(context, type, value) {
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType23("Encode", context, sorted, value);
}
var Encoder = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context, type, value) => EncodeUnsafe(context, type, value),
  (context, type, value) => Default(context, type, value),
  (context, type, value) => Convert(context, type, value),
  (context, type, value) => Clean(context, type, value),
  (context, type, value) => Assert2(context, type, value)
]);

// node_modules/typebox/build/value/parse/parse.mjs
var ParseError2 = class extends AssertError {
  constructor(value, errors) {
    super("Parse", value, errors);
  }
};
function Assert3(context, type, value) {
  if (!Check2(context, type, value))
    throw new ParseError2(value, Errors2(context, type, value));
  return value;
}
var Parser = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context, type, value) => Default(context, type, value),
  (context, type, value) => Convert(context, type, value),
  (context, type, value) => Clean(context, type, value),
  (context, type, value) => Assert3(context, type, value)
]);

// node_modules/typebox/build/value/delta/edit.mjs
var Insert2 = _Object_({
  type: Literal("insert"),
  path: String2(),
  value: Unknown()
});
var Update2 = Object({
  type: Literal("update"),
  path: String2(),
  value: Unknown()
});
var Delete2 = _Object_({
  type: Literal("delete"),
  path: String2()
});
var Edit = Union([Insert2, Update2, Delete2]);

// packages/compute/src/authorization.ts
import { createHash as createHash5 } from "node:crypto";

// packages/compute/src/workflow.ts
function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

// packages/compute/src/authorization.ts
function computeContractHash(authorization) {
  return createHash5("sha256").update(stableJson(authorization)).digest("hex");
}
function computeJobContractHash(job) {
  const { contractHash: _ignored, ...authorization } = job.authorization;
  return createHash5("sha256").update(
    stableJson({
      jobId: job.jobId,
      host: job.host,
      authorization,
      workflowSpecSha256: job.workflow.workflowSpecSha256,
      executionMode: job.workflow.executionMode,
      moduleCommits: job.workflow.moduleCommits,
      containerDigests: job.workflow.containerDigests,
      executor: job.executor,
      remoteRead: job.remoteRead,
      remoteWrite: job.remoteWrite
    })
  ).digest("hex");
}
function withinRoots(path, roots) {
  return roots.some((root) => {
    const normalizedRoot = root.replace(/\/+$/, "") || "/";
    return path === normalizedRoot || path.startsWith(normalizedRoot === "/" ? "/" : `${normalizedRoot}/`);
  });
}
function checkJobAuthorization(job, expectedContractHash) {
  const auth = job.authorization;
  if (!auth.approved) return { ok: false, reason: "compute authorization is not approved" };
  const { contractHash: suppliedHash, ...unsignedAuthorization } = auth;
  if (!suppliedHash || suppliedHash !== computeContractHash(unsignedAuthorization)) {
    return { ok: false, reason: "compute authorization contract hash is invalid" };
  }
  if (expectedContractHash && suppliedHash !== expectedContractHash)
    return { ok: false, reason: "compute authorization does not match the approved task contract" };
  if (job.contractHash !== computeJobContractHash(job))
    return { ok: false, reason: "job contract hash is invalid" };
  if (job.workflow.executionMode !== "ready")
    return { ok: false, reason: "workflow is a preview fixture and cannot be submitted" };
  if (!auth.hosts.includes(job.host))
    return { ok: false, reason: `host ${job.host} is outside the approved scope` };
  if (!auth.workflows.some(
    (workflow) => workflow === "*" || Object.keys(job.workflow.moduleCommits).some((module) => module === workflow)
  )) {
    return { ok: false, reason: "workflow is outside the approved scope" };
  }
  if (job.remoteRead.some((path) => !validRemotePath(path) || !withinRoots(path, auth.remoteRead)))
    return { ok: false, reason: "remote read path is outside the approved scope" };
  if (job.remoteWrite.some((path) => !validRemotePath(path) || !withinRoots(path, auth.remoteWrite)))
    return { ok: false, reason: "remote write path is outside the approved scope" };
  const coreHours = job.executor.cpus * job.executor.walltimeMinutes / 60;
  if (coreHours > auth.budget.maxCoreHours)
    return { ok: false, reason: "job exceeds the approved core-hour budget" };
  if (job.executor.walltimeMinutes > auth.budget.maxWalltimeMinutes)
    return { ok: false, reason: "job exceeds the approved wall-time budget" };
  if (Object.keys(job.workflow.moduleCommits).some((module) => module.startsWith("agent/") && !auth.agentCode))
    return { ok: false, reason: "agent modules require agentCode authorization" };
  return { ok: true };
}
function validRemotePath(path) {
  return Boolean(path) && !path.startsWith("-") && !path.includes("\\") && !path.split("/").includes("..") && !path.includes("//");
}
function assertJobAuthorized(job, expectedContractHash) {
  const result = checkJobAuthorization(job, expectedContractHash);
  if (!result.ok) throw new Error(result.reason);
}

// packages/compute/src/jobs.ts
function workflowAdapter(kind) {
  return {
    kind,
    prepare: (job, runner) => {
      assertJobAuthorized(job);
      return runner.request({
        operation: "prepare",
        jobId: job.jobId,
        payload: { executor: kind, workflowSpecSha256: job.workflow.workflowSpecSha256 }
      });
    },
    start: (job, runner) => {
      assertJobAuthorized(job);
      return runner.request({ operation: "start", jobId: job.jobId, payload: { executor: kind } });
    },
    status: (job, runner) => runner.request({ operation: "status", jobId: job.jobId }),
    logs: (job, cursor, runner) => runner.request({ operation: "logs", jobId: job.jobId, cursor }),
    cancel: (job, runner) => runner.request({ operation: "cancel", jobId: job.jobId }),
    collect: (job, runner) => runner.request({ operation: "collect", jobId: job.jobId, payload: { remoteWrite: job.remoteWrite } })
  };
}
var directScheduler = workflowAdapter("direct");
var slurmScheduler = workflowAdapter("slurm");

// packages/research/src/open-access.ts
var OA_SOURCES = Object.freeze([
  "europepmc",
  "pmc-cloud",
  "unpaywall",
  "openalex",
  "semanticscholar",
  "crossref"
]);

// packages/research/src/source-archive-policy.ts
import { basename as basename2, isAbsolute as isAbsolute5, relative as relative4, resolve as resolve7, sep as sep4 } from "node:path";
var SOURCE_CATEGORIES = ["papers", "supplementary", "software", "manuals"];
var DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
function isWithin(root, child) {
  const rel = relative4(resolve7(root), resolve7(child));
  return rel === "" || !isAbsolute5(rel) && !rel.startsWith(`..${sep4}`) && rel !== ".." && !rel.includes(`..${sep4}`);
}
function validateRunDir(resultsRoot, candidate) {
  const runDir = resolve7(candidate);
  const rel = relative4(resolve7(resultsRoot), runDir);
  const parts = rel.split(sep4);
  if (!rel || !isWithin(resultsRoot, runDir) || parts.length !== 2 || !parts[1]?.startsWith("run-"))
    throw new Error("run_dir must point to a run directory directly inside the configured results root");
  return runDir;
}

// packages/research/src/source-archive.ts
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
    sourcesRoot = await realpath6(join5(runDir, "sources"));
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
  const items2 = [];
  for (const item of downloaded) {
    const path = typeof item.path === "string" ? item.path : typeof item.local_path === "string" ? item.local_path : "";
    if (!path) {
      items2.push({ id: item.id ?? null, path: null, ok: false, reason: "missing manifest path" });
      continue;
    }
    try {
      const canonical = await realpath6(isAbsolute6(path) ? path : resolve8(runDir, path));
      if (!isWithin(sourcesRoot, canonical)) throw new Error("path escapes run sources");
      const bytes = await readFile6(canonical);
      const sha2562 = createHash6("sha256").update(bytes).digest("hex");
      if (sha2562 !== String(item.sha256 || "").toLowerCase()) throw new Error("sha256 mismatch");
      if (item.size_bytes !== void 0 && Number(item.size_bytes) !== bytes.byteLength)
        throw new Error("size mismatch");
      items2.push({ id: item.id ?? null, path: canonical, ok: true, sha256: sha2562, size_bytes: bytes.byteLength });
    } catch (error) {
      items2.push({ id: item.id ?? null, path, ok: false, reason: String(error?.message || error) });
    }
  }
  return { ok: items2.every((item) => item.ok === true), items: items2 };
}
async function sourceStatus(options = {}, ports) {
  if (!ports) throw new Error("Source archive host ports are required");
  const { cwd = process.cwd(), run_dir } = options;
  const config = await ports.workspace(cwd);
  const runDir = run_dir ? validateRunDir(config.resultsRoot, resolve8(cwd, run_dir)) : null;
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

// packages/tasks/src/runtime-compiled/process-events.mjs
function emitProcessEvent(event, ...args) {
  process.emit(event, ...args);
}

// packages/tasks/src/runtime-compiled/runtime-bridge.mjs
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
var contexts = new AsyncLocalStorage2();
var installedRuntime = null;
var standaloneRuntime = null;
var runtimeBindings = /* @__PURE__ */ new WeakSet();
var hostRuntimes = /* @__PURE__ */ new WeakMap();
var KeyedScheduler = class {
  #tails = /* @__PURE__ */ new Map();
  #disposed = false;
  async acquire(key) {
    if (this.#disposed) throw new Error("Runtime scheduler has been disposed");
    const previous = this.#tails.get(key) || Promise.resolve();
    let unlock;
    const gate = new Promise((resolve10) => {
      unlock = resolve10;
    });
    const tail = previous.then(() => gate);
    this.#tails.set(key, tail);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unlock();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    };
  }
  async run(key, task2) {
    const release = await this.acquire(key);
    try {
      return await task2();
    } finally {
      release();
    }
  }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#tails.clear();
  }
};
function createStandaloneRuntime(log = {}) {
  const disposables = /* @__PURE__ */ new Set();
  let disposed = false;
  let disposal;
  const registerDisposable = (resource) => {
    if (!resource || typeof resource.dispose !== "function" && typeof resource.close !== "function")
      return () => {
      };
    if (disposed) {
      void (resource.dispose?.() ?? resource.close?.());
      return () => {
      };
    }
    disposables.add(resource);
    return () => disposables.delete(resource);
  };
  const runtime = {
    knowledge: {},
    tasks: {},
    tools: { tools: /* @__PURE__ */ new Map(), families: /* @__PURE__ */ new Map() },
    scheduler: new KeyedScheduler(),
    log,
    registerDisposable,
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      disposal = (async () => {
        const resources = [...disposables];
        disposables.clear();
        await Promise.allSettled(
          resources.map((resource) => {
            try {
              return resource.dispose?.() ?? resource.close?.();
            } catch (error) {
              return Promise.reject(error);
            }
          })
        );
        await runtime.scheduler.dispose();
      })();
      return disposal;
    }
  };
  return runtime;
}
function withRuntime(runtime, operation) {
  if (!runtime || typeof runtime !== "object" || !runtime.scheduler)
    throw new TypeError("A DroneRuntime with a scheduler is required");
  return contexts.run(runtime, operation);
}
function bindRuntime(pi) {
  if (!pi || typeof pi !== "object" && typeof pi !== "function") return () => {
  };
  if (runtimeBindings.has(pi)) return () => {
  };
  runtimeBindings.add(pi);
  const inherited = currentRuntime();
  const fallback = createStandaloneRuntime();
  adoptRuntimeState(inherited, fallback);
  hostRuntimes.set(pi, fallback);
  if (!pi.events?.on || !pi.events?.emit) {
    return () => {
      if (hostRuntimes.get(pi) !== fallback) return;
      runtimeBindings.delete(pi);
      hostRuntimes.delete(pi);
      void fallback.dispose();
    };
  }
  const receive = (payload) => {
    if (payload?.version !== RUNTIME_BRIDGE_VERSION) return;
    const runtime = payload?.runtime;
    if (!runtime || typeof runtime !== "object" || !runtime.scheduler) return;
    const previous = hostRuntimes.get(pi);
    if (previous && previous !== runtime) adoptRuntimeState(previous, runtime);
    hostRuntimes.set(pi, runtime);
    if (previous && previous !== runtime) void previous.dispose();
  };
  pi.events.on("drone:runtime/v1", receive);
  void pi.events.emit?.("drone:runtime/request/v1", { version: RUNTIME_BRIDGE_VERSION });
  return () => {
    runtimeBindings.delete(pi);
    if (hostRuntimes.get(pi) === fallback) {
      hostRuntimes.delete(pi);
      void fallback.dispose();
    } else hostRuntimes.delete(pi);
  };
}
function adoptRuntimeState(previous, runtime) {
  const sourceTools = previous?.tools?.manifest;
  if (sourceTools) {
    if (!runtime.tools) runtime.tools = {};
    const targetTools = runtime.tools.manifest ?? { tools: /* @__PURE__ */ new Map(), families: /* @__PURE__ */ new Map() };
    runtime.tools.manifest = targetTools;
    if (!targetTools.tools) targetTools.tools = /* @__PURE__ */ new Map();
    for (const [name, meta] of sourceTools.tools || []) {
      if (!targetTools.tools.has(name)) targetTools.tools.set(name, meta);
    }
    if (!targetTools.families) targetTools.families = /* @__PURE__ */ new Map();
    for (const [name, meta] of sourceTools.families || []) {
      if (!targetTools.families.has(name)) targetTools.families.set(name, meta);
    }
  }
  const sourceAcceptance = previous?.tasks?.acceptance;
  if (sourceAcceptance) {
    if (!runtime.tasks) runtime.tasks = {};
    const targetAcceptance = runtime.tasks.acceptance ?? {
      verifiers: /* @__PURE__ */ new Map(),
      kinds: [],
      properties: {}
    };
    runtime.tasks.acceptance = targetAcceptance;
    if (!targetAcceptance.verifiers) targetAcceptance.verifiers = /* @__PURE__ */ new Map();
    for (const [kind, verifier] of sourceAcceptance.verifiers || []) {
      if (!targetAcceptance.verifiers.has(kind)) targetAcceptance.verifiers.set(kind, verifier);
    }
    if (Array.isArray(sourceAcceptance.kinds)) {
      targetAcceptance.kinds ??= [];
      for (const kind of sourceAcceptance.kinds)
        if (!targetAcceptance.kinds.includes(kind)) targetAcceptance.kinds.push(kind);
    }
    targetAcceptance.properties ??= {};
    for (const [key, value] of Object.entries(sourceAcceptance.properties || {}))
      if (!(key in targetAcceptance.properties)) targetAcceptance.properties[key] = value;
  }
  for (const domain of ["knowledge", "tasks", "tools"]) {
    const source = previous?.[domain];
    if (!source || typeof source !== "object") continue;
    let target = runtime[domain];
    if (!target) {
      target = {};
      runtime[domain] = target;
    }
    for (const key of Reflect.ownKeys(source)) if (!(key in target)) target[key] = source[key];
  }
}
function runtimeForHost(pi) {
  return hostRuntimes.get(pi) || currentRuntime();
}
function withHostRuntime(pi, operation) {
  return withRuntime(runtimeForHost(pi), operation);
}
function currentRuntime() {
  if (contexts.getStore()) return contexts.getStore();
  if (installedRuntime) return installedRuntime;
  if (!standaloneRuntime) standaloneRuntime = createStandaloneRuntime();
  return standaloneRuntime;
}
function resolveSlot(domain, slot, create) {
  const runtime = currentRuntime();
  let group = runtime[domain];
  if (!group) {
    group = {};
    runtime[domain] = group;
  }
  if (!group[slot]) {
    group[slot] = create();
    runtime.registerDisposable?.(group[slot]);
  }
  return group[slot];
}
function runtimeSlot(domain, slot, create) {
  if (typeof create !== "function") throw new TypeError("runtimeSlot requires a factory");
  const proxy = new Proxy(
    {},
    {
      get(_target, property) {
        const value = resolveSlot(domain, slot, create)[property];
        return typeof value === "function" ? value.bind(resolveSlot(domain, slot, create)) : value;
      },
      set(_target, property, value) {
        resolveSlot(domain, slot, create)[property] = value;
        return true;
      },
      ownKeys() {
        return Reflect.ownKeys(resolveSlot(domain, slot, create));
      },
      getOwnPropertyDescriptor(_target, property) {
        const descriptor = Object.getOwnPropertyDescriptor(resolveSlot(domain, slot, create), property);
        return descriptor ? { ...descriptor, configurable: true } : void 0;
      }
    }
  );
  return (
    /** @type {T} */
    proxy
  );
}
var RUNTIME_BRIDGE_VERSION = 1;

// packages/tasks/src/runtime-compiled/tool-manifest.mjs
var registry = runtimeSlot("tools", "manifest", () => ({ tools: /* @__PURE__ */ new Map(), families: /* @__PURE__ */ new Map() }));
var compatibilityTools = /* @__PURE__ */ new Map();
var compatibilityFamilies = /* @__PURE__ */ new Map();
var TOOL_MANIFEST_EVENT = "drone:tool-manifest/v1";
var TOOL_MANIFEST_REQUEST_EVENT = "drone:tool-manifest/request/v1";
var eventBridges = runtimeSlot("tools", "manifestEventBridges", () => /* @__PURE__ */ new WeakSet());
var SUBAGENT_MODES = /* @__PURE__ */ new Set(["exclude", "inherit"]);
function assertMeta(name, meta) {
  if (!meta || typeof meta !== "object") throw new Error(`Tool ${name}: drone metadata must be an object`);
  if (meta.subagent !== void 0 && !SUBAGENT_MODES.has(meta.subagent))
    throw new Error(`Tool ${name}: drone.subagent must be "exclude" or "inherit"`);
  if (meta.capabilities !== void 0 && !Array.isArray(meta.capabilities))
    throw new Error(`Tool ${name}: drone.capabilities must be an array`);
  if (meta.activity !== void 0 && (typeof meta.activity?.text !== "string" || typeof meta.activity?.phase !== "string"))
    throw new Error(`Tool ${name}: drone.activity needs text and phase`);
  if (meta.flowCards !== void 0 && typeof meta.flowCards !== "function")
    throw new Error(`Tool ${name}: drone.flowCards must be a function`);
  for (const family of meta.families || [])
    if (typeof family?.match !== "string" || !family.match)
      throw new Error(`Tool ${name}: family.match required`);
}
function registration(name, meta) {
  return { version: 1, name, meta };
}
function replayRegistrations(pi) {
  if (!pi?.events?.emit) return;
  withHostRuntime(pi, () => {
    for (const [name, meta] of registry.tools) {
      void pi.events.emit(TOOL_MANIFEST_EVENT, registration(name, meta));
    }
  });
}
function installEventBridge(pi) {
  if (!pi?.events?.on || eventBridges.has(pi)) return;
  eventBridges.add(pi);
  pi.events.on(TOOL_MANIFEST_REQUEST_EVENT, (payload) => {
    if (payload?.version === 1) replayRegistrations(pi);
  });
}
function bindToolRuntime(pi, definition) {
  if (typeof definition?.execute !== "function") return definition;
  const execute = definition.execute;
  return {
    ...definition,
    execute(...args) {
      return withHostRuntime(pi, () => execute.apply(this, args));
    }
  };
}
function publishRegistration(pi, name, meta) {
  const payload = registration(name, meta);
  void pi?.events?.emit?.(TOOL_MANIFEST_EVENT, payload);
  emitProcessEvent(TOOL_MANIFEST_EVENT, payload);
}
function defineTool(definition) {
  const name = definition?.name;
  if (typeof name !== "string" || !name) throw new Error("defineTool: name required");
  const meta = definition.drone || {};
  assertMeta(name, meta);
  registry.tools.set(name, meta);
  for (const family of meta.families || [])
    registry.families.set(family.match.toLowerCase(), { ...family, owner: name });
  if (!compatibilityTools.has(name)) compatibilityTools.set(name, meta);
  for (const family of meta.families || []) {
    const key = family.match.toLowerCase();
    if (!compatibilityFamilies.has(key)) compatibilityFamilies.set(key, { ...family, owner: name });
  }
  return definition;
}
function registerTools(pi, definitions) {
  bindRuntime(pi);
  return withHostRuntime(pi, () => {
    installEventBridge(pi);
    const registered = [];
    for (const definition of definitions) {
      const defined = defineTool(definition);
      publishRegistration(pi, defined.name, defined.drone || {});
      if (process.env.PI_SUBAGENT_CHILD && defined.drone?.subagent === "exclude") continue;
      pi.registerTool(bindToolRuntime(pi, defined));
      registered.push(defined.name);
    }
    return registered;
  });
}
function registerTool(pi, definition) {
  return registerTools(pi, [definition])[0] ?? null;
}

// packages/extensions/src/internal/runtime.ts
import { AsyncLocalStorage as AsyncLocalStorage3 } from "node:async_hooks";
var VERSION = 1;
var RUNTIME_EVENT = "drone:runtime/v1";
var RUNTIME_REQUEST_EVENT = "drone:runtime/request/v1";
var contexts2 = new AsyncLocalStorage3();
var hostRuntimes2 = /* @__PURE__ */ new WeakMap();
var hostCleanups = /* @__PURE__ */ new WeakMap();
var processRuntime;
var KeyedScheduler2 = class {
  tails = /* @__PURE__ */ new Map();
  disposed = false;
  async run(key, task2) {
    if (this.disposed) throw new Error("Extension runtime scheduler has been disposed");
    const previous = this.tails.get(key) ?? Promise.resolve();
    let unlock;
    const gate = new Promise((resolve10) => {
      unlock = resolve10;
    });
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);
    await previous;
    try {
      return await task2();
    } finally {
      unlock();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
  dispose() {
    this.disposed = true;
    this.tails.clear();
  }
};
function createStandaloneRuntime2() {
  const scheduler = new KeyedScheduler2();
  let disposed = false;
  return {
    knowledge: {},
    tasks: {},
    tools: {},
    scheduler,
    registerDisposable(resource) {
      if (disposed) void (resource.dispose?.() ?? resource.close?.());
      return () => {
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scheduler.dispose();
    }
  };
}
function validRuntime(value) {
  return Boolean(
    value && typeof value === "object" && typeof value.scheduler?.run === "function"
  );
}
function bindExtensionRuntime(pi) {
  if (!pi || typeof pi !== "object" && typeof pi !== "function") return standaloneRuntime2();
  const existing = hostRuntimes2.get(pi);
  if (existing) return existing;
  let runtime = createStandaloneRuntime2();
  hostRuntimes2.set(pi, runtime);
  const events = pi.events;
  if (!events?.on || !events.emit) return runtime;
  const receive = (payload) => {
    if (!payload || typeof payload !== "object") return;
    const value = payload.runtime;
    if (payload.version !== VERSION || !validRuntime(value)) return;
    const previous = runtime;
    runtime = value;
    hostRuntimes2.set(pi, runtime);
    if (previous !== runtime && typeof previous.dispose === "function") void previous.dispose();
  };
  const maybeCleanup = events.on(RUNTIME_EVENT, receive);
  hostCleanups.set(pi, () => {
    if (typeof maybeCleanup === "function") maybeCleanup();
    if (hostRuntimes2.get(pi) === runtime) hostRuntimes2.delete(pi);
    if (typeof runtime.dispose === "function") void runtime.dispose();
    hostCleanups.delete(pi);
  });
  void events.emit(RUNTIME_REQUEST_EVENT, { version: VERSION });
  return runtime;
}
function withExtensionRuntime(pi, operation) {
  const runtime = hostRuntimes2.get(pi) ?? bindExtensionRuntime(pi);
  return contexts2.run(runtime, operation);
}
function runExtensionExclusive(pi, key, task2) {
  return Promise.resolve(
    withExtensionRuntime(pi, () => {
      const runtime = contexts2.getStore() ?? standaloneRuntime2();
      return runtime.scheduler.run(key, task2);
    })
  );
}
function standaloneRuntime2() {
  if (!processRuntime) processRuntime = createStandaloneRuntime2();
  return processRuntime;
}

// packages/extensions/src/workspace-config.ts
import { access as access3, mkdir as mkdir4, readFile as readFile7, realpath as realpath7, rename as rename5, writeFile as writeFile5 } from "node:fs/promises";
import { dirname as dirname3, isAbsolute as isAbsolute7, join as join6, relative as relative6, resolve as resolve9, sep as sep6 } from "node:path";

// packages/extensions/src/internal/vault.ts
var VAULT_PROFILES = {
  project: {
    id: "project",
    projectTypes: [
      "Questions",
      "Concepts",
      "Entities",
      "Papers",
      "Sources",
      "Evidence",
      "Claims",
      "Decisions",
      "Runs",
      "Artifacts",
      "Wiki"
    ],
    libraryTypes: ["Papers", "Methods", "Software", "Ideas", "Datasets", "Explainers"]
  },
  literature: {
    id: "literature",
    projectTypes: ["Questions", "Papers", "Evidence", "Claims", "Runs", "Wiki"],
    libraryTypes: ["Papers", "Methods", "Concepts", "Software", "Entities", "Ideas", "Datasets", "Explainers"]
  },
  hybrid: {
    id: "hybrid",
    projectTypes: [
      "Questions",
      "Concepts",
      "Entities",
      "Papers",
      "Sources",
      "Evidence",
      "Claims",
      "Decisions",
      "Runs",
      "Artifacts",
      "Wiki"
    ],
    libraryTypes: ["Papers", "Methods", "Concepts", "Software", "Entities", "Ideas", "Datasets", "Explainers"]
  }
};
var DEFAULT_VAULT_PROFILE = "hybrid";
var SUBAGENT_MCP_POLICIES = ["none", "read-local"];
function getVaultProfile(id = DEFAULT_VAULT_PROFILE) {
  if (typeof id !== "string" || !(id in VAULT_PROFILES)) throw new Error(`Unknown knowledge profile: ${id}`);
  return VAULT_PROFILES[id];
}

// packages/extensions/src/research-policy.ts
var MAX_CONCURRENT_RESEARCH_SUBAGENTS = 3;

// packages/extensions/src/workspace-config.ts
var DEFAULT_WORKSPACE_CONFIG = Object.freeze({
  resultsRoot: "./results",
  obsidianVault: null,
  // Keep the compatibility fields present in every returned shape. The
  // legacy Obsidian adapter reads these fields even when no desktop binding
  // has been established yet.
  vaultWritePolicy: null,
  mcpStatus: null,
  knowledgeScope: "project",
  knowledgeProjectId: null,
  knowledgeBindingRevision: 0,
  legacyProjectVault: null,
  maxConcurrentSubagents: MAX_CONCURRENT_RESEARCH_SUBAGENTS,
  timezone: "Asia/Shanghai",
  knowledgeProfile: DEFAULT_VAULT_PROFILE,
  knowledgeDepositMode: "verified",
  subagentMcpPolicy: "read-local"
});
var CONFIG_NAME = ".pi/research-workspace.json";
function configPath(cwd) {
  return join6(cwd, CONFIG_NAME);
}
function resolveConfiguredPath(cwd, value) {
  if (value == null || value === "") return null;
  return resolve9(cwd, value);
}
function validatePatch(config) {
  const max = Number(config.maxConcurrentSubagents);
  if (!Number.isInteger(max) || max < 1 || max > MAX_CONCURRENT_RESEARCH_SUBAGENTS) {
    throw new Error(
      `maxConcurrentSubagents must be an integer between 1 and ${MAX_CONCURRENT_RESEARCH_SUBAGENTS}`
    );
  }
  if (typeof config.timezone !== "string" || !config.timezone.trim()) {
    throw new Error("timezone must be a non-empty string");
  }
  if (typeof config.resultsRoot !== "string" || !config.resultsRoot.trim()) {
    throw new Error("resultsRoot must be a non-empty path");
  }
  getVaultProfile(config.knowledgeProfile);
  if (!["run-only", "verified", "rich"].includes(config.knowledgeDepositMode)) {
    throw new Error("knowledgeDepositMode must be run-only, verified, or rich");
  }
  if (!SUBAGENT_MCP_POLICIES.includes(config.subagentMcpPolicy)) {
    throw new Error("subagentMcpPolicy must be none or read-local");
  }
}
async function loadWorkspaceConfig(cwd = process.cwd()) {
  if (process.env.PI_RESEARCH_DESKTOP_CONFIG) {
    const desktop = JSON.parse(await readFile7(process.env.PI_RESEARCH_DESKTOP_CONFIG, "utf8"));
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      resultsRoot: desktop.resultsRoot,
      obsidianVault: desktop.vaultStatus === "bound" ? desktop.obsidianVault : null,
      vaultWritePolicy: desktop.vaultWritePolicy,
      mcpStatus: desktop.mcpStatus
    };
  }
  const projectRoot = resolve9(cwd);
  let raw = {};
  try {
    raw = JSON.parse(await readFile7(configPath(projectRoot), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") raw = {};
  }
  const merged = { ...DEFAULT_WORKSPACE_CONFIG, ...raw };
  if (knowledgeDirectory()) {
    const binding = await readKnowledgeBinding();
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      resultsRoot: resolveConfiguredPath(
        projectRoot,
        typeof raw.resultsRoot === "string" && raw.resultsRoot.trim() ? raw.resultsRoot : DEFAULT_WORKSPACE_CONFIG.resultsRoot
      ),
      obsidianVault: binding?.vault || null,
      knowledgeProfile: binding?.profile || "hybrid",
      knowledgeDepositMode: binding?.depositMode || "verified",
      subagentMcpPolicy: binding?.subagentPolicy || "none",
      knowledgeScope: "application",
      knowledgeProjectId: projectIdentity(projectRoot, raw.knowledgeProjectId),
      knowledgeBindingRevision: binding?.revision || 0,
      legacyProjectVault: raw.obsidianVault || null,
      maxConcurrentSubagents: [1, 2, 3].includes(raw.maxConcurrentSubagents) ? raw.maxConcurrentSubagents : DEFAULT_WORKSPACE_CONFIG.maxConcurrentSubagents
    };
  }
  try {
    validatePatch(merged);
  } catch {
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      resultsRoot: resolveConfiguredPath(projectRoot, DEFAULT_WORKSPACE_CONFIG.resultsRoot),
      obsidianVault: null
    };
  }
  return {
    ...merged,
    resultsRoot: resolveConfiguredPath(projectRoot, merged.resultsRoot),
    obsidianVault: resolveConfiguredPath(projectRoot, merged.obsidianVault)
  };
}

// packages/extensions/src/research-loop.ts
var CLAIM_BINDING_SCHEMA2 = {
  type: "array",
  maxItems: 24,
  items: { type: "object", additionalProperties: true }
};
var USER_QUESTION_FOCUS = "Answer the user's current question. Use evidence for factual research claims, not unrelated citations for ordinary chat. For substantive tasks, do bounded read-only preparation and consolidate scope, assumptions, needed permissions and deliverables into one task_plan for one user authorization. After authorization, carry out routine steps and recoverable checks within that scope without repeatedly asking whether to continue. Respect prior decisions, especially declined installs. New risks or scope, missing credentials and genuinely unavailable user data still require a specific request; never infer consent. At completion, explain what changed, link actual outputs or show key figures, separate execution from validation, and give one next step only if needed. Keep internal counters and tool logs out of the main answer.";
function sessionKey(ctx) {
  return ctx?.sessionManager?.getSessionId?.() || ctx?.sessionId || ctx?.cwd || "";
}
function researchLoop(pi) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;
  bindExtensionRuntime(pi);
  const state = { journals: /* @__PURE__ */ new Map(), pending: /* @__PURE__ */ new Map(), awaitingUserStart: /* @__PURE__ */ new Set() };
  let loop;
  const ports = {
    workspace: async (cwd) => await loadWorkspaceConfig(cwd),
    verifyLiteratureReceipt: (input) => verifyLiteratureReceipt(input),
    sourceStatus: async ({ cwd, run_dir, verify }) => {
      return sourceStatus(
        { cwd, run_dir, verify },
        {
          workspace: async (workspaceCwd) => await loadWorkspaceConfig(workspaceCwd),
          publishSourceNote: async () => ({}),
          exclusive: (key, work) => runExtensionExclusive(pi, key, work)
        }
      );
    }
  };
  loop = createResearchLoop(ports);
  const run = (operation) => runExtensionExclusive(pi, "research-loop", operation);
  const journalFor = (ctx) => {
    const key = sessionKey(ctx);
    let journal = state.journals.get(key);
    if (!journal) {
      journal = createResearchReceiptJournal(ctx.cwd, {
        sessionId: key,
        ports: {
          workspace: async (cwd) => await loadWorkspaceConfig(cwd),
          status: async (cwd, runDir) => loop.updateResearchLoop({ cwd, runDir, action: "status" }),
          flush: async (cwd, runDir) => loop.flushResearchReceipts({ cwd, runDir }),
          reset: (cwd, runDir) => loop.resetResearchReceipts({ cwd, runDir }),
          observeExecution: (event) => observeExecutionReceipt(event),
          observeResearch: (event) => loop.observeResearchReceipt(event)
        }
      });
      state.journals.set(key, journal);
    }
    return journal;
  };
  registerTool(pi, {
    name: "research_loop",
    label: "Research evidence loop",
    drone: {
      libraryMode: true,
      recoverySafe: true,
      capabilities: ["research"],
      activity: { text: "\u6B63\u5728\u68C0\u67E5\u7814\u7A76\u8BC1\u636E\u94FE\u2026", phase: "verification" }
    },
    description: "Create or inspect a scientific evidence gate. Prefer start and status; the host advances search, inspection, archive, claims and finalize from successful tools. Structured claim_bindings with observed source excerpts are required before complete/finalize; claim_refs alone do not establish support.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "start",
            "record_local",
            "record_external",
            "inspect_sources",
            "verify_archive",
            "bind_claims",
            "finalize",
            "complete",
            "status"
          ]
        },
        run_dir: { type: "string" },
        project: {
          type: "string",
          description: "Optional. The host resolves the project from the workspace (or the daily-space session choice); a different value is ignored."
        },
        result_slug: { type: "string" },
        query: { type: "string" },
        requires_provenance: { type: "boolean" },
        source_refs: { type: "array", items: { type: "string" } },
        claim_refs: { type: "array", items: { type: "string" } },
        claim_bindings: CLAIM_BINDING_SCHEMA2,
        outcome: { type: "string" },
        notes: { type: "string" }
      },
      required: ["action"]
    },
    async execute(_id, params, _signal, _update, ctx) {
      return run(async () => {
        const journal = journalFor(ctx);
        const runDir = params.run_dir || journal.currentRun();
        if (params.action === "status" && !runDir) {
          const value = {
            run_dir: null,
            evidence_gate: { stage: "not-started", answerable: false },
            next_action: "start",
            guidance: "Call research_loop(action=start,query=the research question)."
          };
          return { content: [{ type: "text", text: JSON.stringify(value) }], details: value };
        }
        const projectResolution = params.action === "start" ? await resolveWorkspaceProject({
          cwd: ctx.cwd,
          sessionEntries: sessionEntriesOf(ctx),
          requested: params.project
        }) : null;
        const result = await journal.execute(
          runDir,
          async () => params.action === "start" ? loop.startResearchRun({
            cwd: ctx.cwd,
            project: projectResolution?.project,
            resultSlug: params.result_slug,
            query: params.query,
            requiresProvenance: params.requires_provenance === true
          }) : loop.updateResearchLoop({
            cwd: ctx.cwd,
            runDir,
            action: params.action,
            query: params.query,
            sourceRefs: params.source_refs || [],
            claimRefs: params.claim_refs || [],
            claimBindings: params.claim_bindings || [],
            outcome: params.outcome,
            notes: params.notes
          })
        );
        const gate = result?.evidence_gate;
        const visible = params.action === "status" ? result : {
          run_dir: result?.run_dir,
          topic_id: result?.metadata?.topic_id,
          evidence_gate: gate && {
            stage: gate.stage,
            answerable: gate.answerable,
            archive_count: gate.archive_count,
            reuse_count: gate.reuse_count,
            source_refs: gate.source_refs,
            claim_count: gate.claim_refs.length,
            structured_claim_count: gate.claim_bindings.length,
            warnings: gate.warnings,
            scientificallyVerified: false
          },
          receipt_journal: result?.receipt_journal,
          ...projectResolution ? { project: describeProject(projectResolution) } : {}
        };
        return { content: [{ type: "text", text: JSON.stringify(visible, null, 2) }], details: result };
      });
    }
  });
  const on = pi.on?.bind(pi);
  on?.(
    "tool_execution_start",
    (event, ctx) => run(() => {
      if (state.pending.size > 256) state.pending.delete(state.pending.keys().next().value);
      state.pending.set(event.toolCallId, {
        args: event.args || {},
        journal: journalFor(ctx),
        key: sessionKey(ctx)
      });
    })
  );
  on?.(
    "tool_execution_end",
    (event, ctx) => run(async () => {
      const started = state.pending.get(event.toolCallId);
      state.pending.delete(event.toolCallId);
      if (!started || started.key !== sessionKey(ctx) || started.journal !== state.journals.get(started.key) || event.toolName === "research_loop")
        return;
      await started.journal.record({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: started.args,
        details: event.result?.details || {},
        ...event.toolName === "read" ? { content: event.result?.content || [] } : {},
        isError: !!event.isError
      });
    })
  );
  on?.(
    "before_agent_start",
    (event, ctx) => run(async () => {
      const key = sessionKey(ctx);
      state.awaitingUserStart.add(key);
      const previous = state.journals.get(key);
      state.journals.set(
        key,
        createResearchReceiptJournal(ctx.cwd, {
          sessionId: key,
          ports: {
            workspace: async (cwd) => await loadWorkspaceConfig(cwd),
            status: async (cwd, runDir) => loop.updateResearchLoop({ cwd, runDir, action: "status" }),
            flush: async (cwd, runDir) => loop.flushResearchReceipts({ cwd, runDir }),
            reset: (cwd, runDir) => loop.resetResearchReceipts({ cwd, runDir }),
            observeExecution: (e) => observeExecutionReceipt(e),
            observeResearch: (e) => loop.observeResearchReceipt(e)
          }
        })
      );
      state.pending.forEach((item, id) => {
        if (item.key === key) state.pending.delete(id);
      });
      await previous?.close();
      return {
        systemPrompt: `${event.systemPrompt}

For substantive research, use research_loop(action=start) when a tracked run is needed. The host checks provenance, not scientific truth. ${USER_QUESTION_FOCUS}`
      };
    })
  );
  on?.("message_start", (event, ctx) => {
    if (event.message?.role !== "user") return;
    return run(async () => {
      const key = sessionKey(ctx);
      if (state.awaitingUserStart.delete(key)) return;
      await state.journals.get(key)?.close();
      state.journals.delete(key);
    });
  });
  on?.(
    "session_shutdown",
    (_event, ctx) => run(async () => {
      const key = sessionKey(ctx);
      await state.journals.get(key)?.close();
      state.journals.delete(key);
      state.pending.forEach((item, id) => {
        if (item.key === key) state.pending.delete(id);
      });
      loop.dispose();
    })
  );
}
export {
  researchLoop as default
};
