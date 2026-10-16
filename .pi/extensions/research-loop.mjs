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
  Accumulator = Accumulator * Prime % Size;
}
function FromArray2(value) {
  FNV1A64_OP(ByteMarker.Array);
  for (const item of value) {
    FromValue2(item);
  }
}
function FromBigInt(value) {
  FNV1A64_OP(ByteMarker.BigInt);
  F64In.setBigInt64(0, value);
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromBoolean(value) {
  FNV1A64_OP(ByteMarker.Boolean);
  FNV1A64_OP(value ? 1 : 0);
}
function FromConstructor(value) {
  FNV1A64_OP(ByteMarker.Constructor);
  FromValue2(value.toString());
}
function FromDate(value) {
  FNV1A64_OP(ByteMarker.Date);
  FromValue2(value.getTime());
}
function FromFunction(value) {
  FNV1A64_OP(ByteMarker.Function);
  FromValue2(value.toString());
}
function FromNull(_value) {
  FNV1A64_OP(ByteMarker.Null);
}
function FromNumber(value) {
  FNV1A64_OP(ByteMarker.Number);
  F64In.setFloat64(
    0,
    value,
    true
    /* little-endian */
  );
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromObject2(value) {
  FNV1A64_OP(ByteMarker.Object);
  for (const key of InstanceKeys(value).sort()) {
    FromValue2(key);
    FromValue2(value[key]);
  }
}
function FromRegExp2(value) {
  FNV1A64_OP(ByteMarker.RegExp);
  FromString(value.toString());
}
var encoder = new TextEncoder();
function FromString(value) {
  FNV1A64_OP(ByteMarker.String);
  for (const byte of encoder.encode(value)) {
    FNV1A64_OP(byte);
  }
}
function FromSymbol(value) {
  FNV1A64_OP(ByteMarker.Symbol);
  FromValue2(value.toString());
}
function FromTypeArray(value) {
  FNV1A64_OP(ByteMarker.TypeArray);
  const buffer = new Uint8Array(value.buffer);
  for (let i = 0; i < buffer.length; i++) {
    FNV1A64_OP(buffer[i]);
  }
}
function FromUndefined(_value) {
  return FNV1A64_OP(ByteMarker.Undefined);
}
function FromValue2(value) {
  return globals_exports.IsTypeArray(value) ? FromTypeArray(value) : globals_exports.IsDate(value) ? FromDate(value) : globals_exports.IsRegExp(value) ? FromRegExp2(value) : globals_exports.IsBoolean(value) ? FromBoolean(value.valueOf()) : globals_exports.IsString(value) ? FromString(value.valueOf()) : globals_exports.IsNumber(value) ? FromNumber(value.valueOf()) : IsIEEE754(value) ? FromNumber(value) : guard_exports.IsArray(value) ? FromArray2(value) : guard_exports.IsBoolean(value) ? FromBoolean(value) : guard_exports.IsBigInt(value) ? FromBigInt(value) : guard_exports.IsConstructor(value) ? FromConstructor(value) : guard_exports.IsNull(value) ? FromNull(value) : guard_exports.IsObject(value) ? FromObject2(value) : guard_exports.IsString(value) ? FromString(value) : guard_exports.IsSymbol(value) ? FromSymbol(value) : guard_exports.IsUndefined(value) ? FromUndefined(value) : guard_exports.IsFunction(value) ? FromFunction(value) : Unreachable();
}
function HashCode(value) {
  Accumulator = BigInt("14695981039346656037");
  FromValue2(value);
  return Accumulator;
}
function Hash(value) {
  return HashCode(value).toString(16).padStart(16, "0");
}

// node_modules/typebox/build/system/locale/en_US.mjs
function en_US(error) {
  switch (error.keyword) {
    case "additionalProperties":
      return "must not have additional properties";
    case "anyOf":
      return "must match a schema in anyOf";
    case "boolean":
      return "schema is false";
    case "const":
      return "must be equal to constant";
    case "contains":
      return "must contain at least 1 valid item";
    case "dependencies":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "dependentRequired":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "enum":
      return "must be equal to one of the allowed values";
    case "exclusiveMaximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "exclusiveMinimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "format":
      return `must match format "${error.params.format}"`;
    case "if":
      return `must match "${error.params.failingKeyword}" schema`;
    case "maxItems":
      return `must not have more than ${error.params.limit} items`;
    case "maxLength":
      return `must not have more than ${error.params.limit} characters`;
    case "maxProperties":
      return `must not have more than ${error.params.limit} properties`;
    case "maximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "minItems":
      return `must not have fewer than ${error.params.limit} items`;
    case "minLength":
      return `must not have fewer than ${error.params.limit} characters`;
    case "minProperties":
      return `must not have fewer than ${error.params.limit} properties`;
    case "minimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "multipleOf":
      return `must be multiple of ${error.params.multipleOf}`;
    case "not":
      return "must not be valid";
    case "oneOf":
      return "must match exactly one schema in oneOf";
    case "pattern":
      return `must match pattern "${error.params.pattern}"`;
    case "propertyNames":
      return `property names ${error.params.propertyNames.join(", ")} are invalid`;
    case "required":
      return `must have required properties ${error.params.requiredProperties.join(", ")}`;
    case "type":
      return typeof error.params.type === "string" ? `must be ${error.params.type}` : `must be either ${error.params.type.join(" or ")}`;
    case "unevaluatedItems":
      return "must not have unevaluated items";
    case "unevaluatedProperties":
      return "must not have unevaluated properties";
    case "uniqueItems":
      return `must not have duplicate items`;
    case "~refine":
      return error.params.message;
    // deno-coverage-ignore - unreachable
    default:
      return "an unknown validation error occurred";
  }
}

// node_modules/typebox/build/system/locale/_config.mjs
var locale = en_US;
function Get2() {
  return locale;
}

// node_modules/typebox/build/type/types/_codec.mjs
var EncodeBuilder = class {
  constructor(type, decode) {
    this.type = type;
    this.decode = decode;
  }
  Encode(callback) {
    const type = this.type;
    const decode = IsCodec(type) ? (value) => this.decode(type["~codec"].decode(value)) : this.decode;
    const encode = IsCodec(type) ? (value) => type["~codec"].encode(callback(value)) : callback;
    const codec = { decode, encode };
    return memory_exports.Update(this.type, { "~codec": codec }, {});
  }
};
var DecodeBuilder = class {
  constructor(type) {
    this.type = type;
  }
  Decode(callback) {
    return new EncodeBuilder(this.type, callback);
  }
};
function Codec(type) {
  return new DecodeBuilder(type);
}
function Decode(type, callback) {
  return Codec(type).Decode(callback).Encode(() => {
    throw Error("Encode not implemented");
  });
}
function Encode(type, callback) {
  return Codec(type).Decode(() => {
    throw Error("Decode not implemented");
  }).Encode(callback);
}
function IsCodec(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~codec") && guard_exports.IsObject(value["~codec"]) && guard_exports.HasPropertyKey(value["~codec"], "encode") && guard_exports.HasPropertyKey(value["~codec"], "decode");
}

// node_modules/typebox/build/type/types/_immutable.mjs
function Immutable(type) {
  return AddImmutable(type);
}
function IsImmutable(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~immutable");
}

// node_modules/typebox/build/type/action/_add_readonly.mjs
function AddReadonlyDeferred(type, options = {}) {
  return Deferred("AddReadonly", [type], options);
}
function AddReadonly(type, options = {}) {
  return AddReadonlyAction(type, options);
}

// node_modules/typebox/build/type/types/_readonly.mjs
function Readonly(type) {
  return AddReadonly(type);
}
function IsReadonly(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~readonly");
}

// node_modules/typebox/build/type/types/_refine.mjs
function RefineAdd(type, refinement) {
  const refinements = IsRefine(type) ? [...type["~refine"], refinement] : [refinement];
  return memory_exports.Update(type, { "~refine": refinements }, {});
}
function Refine(...args) {
  const [type, check, error] = arguments_exports.Match(args, {
    3: (type2, check2, error2) => [type2, check2, error2],
    2: (type2, check2) => [type2, check2, () => "Refine Error"]
  });
  return RefineAdd(type, { check, error });
}
function IsRefinement(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "check") && guard_exports.HasPropertyKey(value, "error") && guard_exports.IsFunction(value.check) && guard_exports.IsFunction(value.error);
}
function IsRefine(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => IsRefinement(value2));
}

// node_modules/typebox/build/type/types/bigint.mjs
var BigIntPattern = "-?(?:0|[1-9][0-9]*)n";
function BigInt2(options) {
  return memory_exports.Create({ "~kind": "BigInt" }, { type: "bigint" }, options);
}
function IsBigInt2(value) {
  return IsKind(value, "BigInt");
}

// node_modules/typebox/build/type/types/boolean.mjs
function Boolean2(options) {
  return memory_exports.Create({ "~kind": "Boolean" }, { type: "boolean" }, options);
}
function IsBoolean3(value) {
  return IsKind(value, "Boolean");
}

// node_modules/typebox/build/type/types/identifier.mjs
function Identifier(name) {
  return memory_exports.Create({ "~kind": "Identifier" }, { name });
}
function IsIdentifier(value) {
  return IsKind(value, "Identifier");
}

// node_modules/typebox/build/type/types/integer.mjs
var IntegerPattern = "-?(?:0|[1-9][0-9]*)";
function Integer(options) {
  return memory_exports.Create({ "~kind": "Integer" }, { type: "integer" }, options);
}
function IsInteger2(value) {
  return IsKind(value, "Integer");
}

// node_modules/typebox/build/type/types/literal.mjs
var InvalidLiteralValue = class extends Error {
  constructor(value) {
    super(`Invalid Literal value`);
    Object.defineProperty(this, "cause", {
      value: { value },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
};
function LiteralTypeName(value) {
  return guard_exports.IsBigInt(value) ? "bigint" : guard_exports.IsBoolean(value) ? "boolean" : guard_exports.IsNumber(value) ? "number" : guard_exports.IsString(value) ? "string" : (() => {
    throw new InvalidLiteralValue(value);
  })();
}
function Literal(value, options) {
  return memory_exports.Create({ "~kind": "Literal" }, { type: LiteralTypeName(value), const: value }, options);
}
function IsLiteralValue(value) {
  return guard_exports.IsBigInt(value) || guard_exports.IsBoolean(value) || guard_exports.IsNumber(value) || guard_exports.IsString(value);
}
function IsLiteralBigInt(value) {
  return IsLiteral(value) && guard_exports.IsBigInt(value.const);
}
function IsLiteralBoolean(value) {
  return IsLiteral(value) && guard_exports.IsBoolean(value.const);
}
function IsLiteralNumber(value) {
  return IsLiteral(value) && guard_exports.IsNumber(value.const);
}
function IsLiteralString(value) {
  return IsLiteral(value) && guard_exports.IsString(value.const);
}
function IsLiteral(value) {
  return IsKind(value, "Literal");
}

// node_modules/typebox/build/type/types/null.mjs
function Null(options) {
  return memory_exports.Create({ "~kind": "Null" }, { type: "null" }, options);
}
function IsNull2(value) {
  return IsKind(value, "Null");
}

// node_modules/typebox/build/type/types/number.mjs
var NumberPattern = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?";
function Number2(options) {
  return memory_exports.Create({ "~kind": "Number" }, { type: "number" }, options);
}
function IsNumber3(value) {
  return IsKind(value, "Number");
}

// node_modules/typebox/build/type/types/symbol.mjs
function Symbol2(options) {
  return memory_exports.Create({ "~kind": "Symbol" }, { type: "symbol" }, options);
}
function IsSymbol2(value) {
  return IsKind(value, "Symbol");
}

// node_modules/typebox/build/type/types/parameter.mjs
function Parameter(...args) {
  const [name, extends_, equals] = arguments_exports.Match(args, {
    3: (name2, extends_2, equals2) => [name2, extends_2, equals2],
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ "~kind": "Parameter" }, { name, extends: extends_, equals }, {});
}
function IsParameter(value) {
  return IsKind(value, "Parameter");
}

// node_modules/typebox/build/type/types/string.mjs
var StringPattern = ".*";
function String2(options) {
  return memory_exports.Create({ "~kind": "String" }, { type: "string" }, options);
}
function IsString3(value) {
  return IsKind(value, "String");
}

// node_modules/typebox/build/type/types/union.mjs
function Union(anyOf, options = {}) {
  return memory_exports.Create({ "~kind": "Union" }, { anyOf }, options);
}
function IsUnion(value) {
  return IsKind(value, "Union");
}
function UnionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "anyOf"]);
}

// node_modules/typebox/build/type/engine/patterns/pattern.mjs
function ParsePatternIntoTypes(pattern) {
  const parsed = Pattern(pattern);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : [];
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/is_finite.mjs
function FromLiteral(_value) {
  return true;
}
function FromTypesReduce(types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType(left) ? FromTypesReduce(right) : false, () => true);
}
function FromTypes(types) {
  const result = guard_exports.IsEqual(types.length, 0) ? false : FromTypesReduce(types);
  return result;
}
function FromType(type) {
  return IsUnion(type) ? FromTypes(type.anyOf) : IsLiteral(type) ? FromLiteral(type.const) : false;
}
function IsTemplateLiteralFinite(types) {
  const result = FromTypes(types);
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/create.mjs
function TemplateLiteralCreate(pattern) {
  return memory_exports.Create({ ["~kind"]: "TemplateLiteral" }, { type: "string", pattern }, {});
}

// node_modules/typebox/build/type/engine/template_literal/decode.mjs
function FromLiteralPush(variants, value, result = []) {
  return guard_exports.ShiftLeft(variants, (left, right) => FromLiteralPush(right, value, [...result, `${left}${value}`]), () => result);
}
function FromLiteral2(variants, value) {
  return guard_exports.IsEqual(variants.length, 0) ? [`${value}`] : FromLiteralPush(variants, value);
}
function FromUnion(variants, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => FromUnion(variants, right, [...result, ...FromType2(variants, left)]), () => result);
}
function FromType2(variants, type) {
  const result = IsUnion(type) ? FromUnion(variants, type.anyOf) : IsLiteral(type) ? FromLiteral2(variants, type.const) : Unreachable();
  return result;
}
function DecodeFromSpan(variants, types) {
  return guard_exports.ShiftLeft(types, (left, right) => DecodeFromSpan(FromType2(variants, left), right), () => variants);
}
function VariantsToLiterals(variants) {
  return variants.map((variant) => Literal(variant));
}
function DecodeTypesAsUnion(types) {
  const variants = DecodeFromSpan([], types);
  const literals = VariantsToLiterals(variants);
  const result = Union(literals);
  return result;
}
function DecodeTypes(types) {
  return guard_exports.IsEqual(types.length, 0) ? Unreachable() : (
    // Literal('') :
    guard_exports.IsEqual(types.length, 1) && IsLiteral(types[0]) ? types[0] : DecodeTypesAsUnion(types)
  );
}
function TemplateLiteralDecodeUnsafe(pattern) {
  const types = ParsePatternIntoTypes(pattern);
  const result = guard_exports.IsEqual(types.length, 0) ? String2() : IsTemplateLiteralFinite(types) ? DecodeTypes(types) : TemplateLiteralCreate(pattern);
  return result;
}
function TemplateLiteralDecode(pattern) {
  const decoded = TemplateLiteralDecodeUnsafe(pattern);
  const result = IsTemplateLiteral(decoded) ? String2() : decoded;
  return result;
}

// node_modules/typebox/build/type/engine/record/record_create.mjs
function CreateRecord(key, value) {
  const type = "object";
  const patternProperties = { [key]: value };
  return memory_exports.Create({ ["~kind"]: "Record" }, { type, patternProperties });
}

// node_modules/typebox/build/type/engine/record/from_key_any.mjs
function FromAnyKey(value) {
  return CreateRecord(StringKey, value);
}

// node_modules/typebox/build/type/engine/record/from_key_boolean.mjs
function FromBooleanKey(value) {
  return _Object_({ true: value, false: value });
}

// node_modules/typebox/build/type/types/tuple.mjs
function Tuple(types, options = {}) {
  const [items2, minItems, additionalItems] = [types, types.length, false];
  return memory_exports.Create({ ["~kind"]: "Tuple" }, { type: "array", additionalItems, items: items2, minItems }, options);
}
function IsTuple(value) {
  return IsKind(value, "Tuple");
}
function TupleOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items", "minItems", "additionalItems"]);
}

// node_modules/typebox/build/type/engine/readonly/instantiate_remove.mjs
function RemoveReadonlyOperation(type) {
  return memory_exports.Discard(type, ["~readonly"]);
}
function RemoveReadonlyAction(type, options) {
  const result = memory_exports.Update(RemoveReadonlyOperation(type), {}, options);
  return result;
}
function RemoveReadonlyInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveReadonlyAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/_remove_readonly.mjs
function RemoveReadonlyDeferred(type, options = {}) {
  return Deferred("RemoveReadonly", [type], options);
}
function RemoveReadonly(type, options = {}) {
  return RemoveReadonlyAction(type, options);
}

// node_modules/typebox/build/type/engine/optional/instantiate_remove.mjs
function RemoveOptionalOperation(type) {
  return memory_exports.Discard(type, ["~optional"]);
}
function RemoveOptionalAction(type, options) {
  const result = memory_exports.Update(RemoveOptionalOperation(type), {}, options);
  return result;
}
function RemoveOptionalInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveOptionalAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/_remove_optional.mjs
function RemoveOptionalDeferred(type, options = {}) {
  return Deferred("RemoveOptional", [type], options);
}
function RemoveOptional(type, options = {}) {
  return RemoveOptionalAction(type, options);
}

// node_modules/typebox/build/type/engine/tuple/to_object.mjs
function TupleElementsToProperties(types) {
  const result = types.reduceRight((result2, right, index) => {
    return { [index]: right, ...result2 };
  }, {});
  return result;
}
function TupleToObject(type) {
  const properties = TupleElementsToProperties(type.items);
  const result = _Object_(properties);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/composite.mjs
function IsReadonlyProperty(left, right) {
  return IsReadonly(left) ? IsReadonly(right) ? true : false : false;
}
function IsOptionalProperty(left, right) {
  return IsOptional(left) ? IsOptional(right) ? true : false : false;
}
function CompositeProperty(left, right) {
  const isReadonly = IsReadonlyProperty(left, right);
  const isOptional = IsOptionalProperty(left, right);
  const evaluated = EvaluateIntersect([left, right]);
  const property = RemoveReadonly(RemoveOptional(evaluated));
  return isReadonly && isOptional ? AddReadonly(AddOptional(property)) : isReadonly && !isOptional ? AddReadonly(property) : !isReadonly && isOptional ? AddOptional(property) : property;
}
function CompositePropertyKey(left, right, key) {
  return key in left ? key in right ? CompositeProperty(left[key], right[key]) : left[key] : key in right ? right[key] : Never();
}
function CompositeProperties(left, right) {
  const keys = /* @__PURE__ */ new Set([...guard_exports.Keys(right), ...guard_exports.Keys(left)]);
  return [...keys].reduce((result, key) => {
    return { ...result, [key]: CompositePropertyKey(left, right, key) };
  }, {});
}
function GetProperties(type) {
  const result = IsObject2(type) ? type.properties : IsTuple(type) ? TupleElementsToProperties(type.items) : Unreachable();
  return result;
}
function Composite(left, right) {
  const leftProperties = GetProperties(left);
  const rightProperties = GetProperties(right);
  const properties = CompositeProperties(leftProperties, rightProperties);
  return _Object_(properties);
}

// node_modules/typebox/build/type/engine/evaluate/narrow.mjs
function Narrow(left, right) {
  const result = Compare(left, right);
  return guard_exports.IsEqual(result, ResultLeftInside) ? left : guard_exports.IsEqual(result, ResultRightInside) ? right : guard_exports.IsEqual(result, ResultEqual) ? right : Never();
}

// node_modules/typebox/build/type/engine/evaluate/distribute.mjs
function IsObjectLike(type) {
  return IsObject2(type) || IsTuple(type);
}
function IsUnionOperand(left, right) {
  const isUnionLeft = IsUnion(left);
  const isUnionRight = IsUnion(right);
  const result = isUnionLeft || isUnionRight;
  return result;
}
function DistributeOperation(left, right) {
  const evaluatedLeft = EvaluateType(left);
  const evaluatedRight = EvaluateType(right);
  const isUnionOperand = IsUnionOperand(evaluatedLeft, evaluatedRight);
  const isObjectLeft = IsObjectLike(evaluatedLeft);
  const IsObjectRight = IsObjectLike(evaluatedRight);
  const result = isUnionOperand ? EvaluateIntersect([evaluatedLeft, evaluatedRight]) : isObjectLeft && IsObjectRight ? Composite(evaluatedLeft, evaluatedRight) : isObjectLeft && !IsObjectRight ? evaluatedLeft : !isObjectLeft && IsObjectRight ? evaluatedRight : Narrow(evaluatedLeft, evaluatedRight);
  return result;
}
function DistributeType(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeType(type, right, [...result, DistributeOperation(type, left)]), () => guard_exports.IsEqual(result.length, 0) ? [type] : result);
}
function DistributeUnion(types, distribution, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeUnion(right, distribution, [...result, ...Distribute([left], distribution)]), () => result);
}
function Distribute(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => IsUnion(left) ? Distribute(right, DistributeUnion(left.anyOf, result)) : Distribute(right, DistributeType(left, result)), () => result);
}

// node_modules/typebox/build/type/engine/exclude/operation.mjs
function ExcludeType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [] : [left];
  return result;
}
function ExcludeUnion(types, right) {
  return types.reduce((result, head) => {
    return [...result, ...ExcludeType(head, right)];
  }, []);
}
function ExcludeOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExcludeUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/evaluate.mjs
function EvaluateDependent(if_, then_, else_) {
  const intersect = Intersect([if_, then_]);
  const excluded = ExcludeOperation(else_, if_);
  const result = EvaluateUnion([intersect, excluded]);
  return result;
}
function EvaluateEnum(values) {
  const result = values.map((value) => Literal(value));
  return EvaluateUnion(result);
}
function EvaluateIntersect(types) {
  const distribution = Distribute(types);
  const broadend = Broaden(distribution);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateTemplateLiteral(pattern) {
  const evaluated = TemplateLiteralDecode(pattern);
  const result = EvaluateType(evaluated);
  return result;
}
function EvaluateUnion(types) {
  const broadend = Broaden(types);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateType(type) {
  return IsDependent(type) ? EvaluateDependent(type.if, type.then, type.else) : IsEnum(type) ? EvaluateEnum(type.enum) : IsIntersect(type) ? EvaluateIntersect(type.allOf) : IsTemplateLiteral(type) ? EvaluateTemplateLiteral(type.pattern) : IsUnion(type) ? EvaluateUnion(type.anyOf) : type;
}
function EvaluateUnionFast(types) {
  const result = guard_exports.IsEqual(types.length, 1) ? types[0] : guard_exports.IsEqual(types.length, 0) ? Never() : Union(types);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_enum.mjs
function FromEnumKey(values, value) {
  const unionKey = EvaluateEnum(values);
  const result = FromKey(unionKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_integer.mjs
function FromIntegerKey(_key, value) {
  const result = CreateRecord(IntegerKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_intersect.mjs
function FromIntersectKey(types, value) {
  const evaluatedKey = EvaluateIntersect(types);
  const result = FromKey(evaluatedKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_literal.mjs
function FromLiteralKey(key, value) {
  return guard_exports.IsString(key) || guard_exports.IsNumber(key) ? _Object_({ [key]: value }) : guard_exports.IsEqual(key, false) ? _Object_({ false: value }) : guard_exports.IsEqual(key, true) ? _Object_({ true: value }) : _Object_({});
}

// node_modules/typebox/build/type/engine/record/from_key_number.mjs
function FromNumberKey(_key, value) {
  const result = CreateRecord(NumberKey, value);
  return result;
}

// node_modules/typebox/build/type/engine/record/from_key_string.mjs
function FromStringKey(key, value) {
  return guard_exports.HasPropertyKey(key, "pattern") && (guard_exports.IsString(key.pattern) || key.pattern instanceof RegExp) ? CreateRecord(key.pattern.toString(), value) : CreateRecord(StringKey, value);
}

// node_modules/typebox/build/type/engine/record/from_key_template_literal.mjs
function FromTemplateKey(pattern, value) {
  const types = ParsePatternIntoTypes(pattern);
  const finite = IsTemplateLiteralFinite(types);
  const result = finite ? FromKey(EvaluateTemplateLiteral(pattern), value) : CreateRecord(pattern, value);
  return result;
}

// node_modules/typebox/build/type/engine/evaluate/flatten.mjs
function FlattenType(type) {
  const result = IsUnion(type) ? Flatten(type.anyOf) : [type];
  return result;
}
function Flatten(types) {
  return types.reduce((result, type) => {
    return [...result, ...FlattenType(type)];
  }, []);
}

// node_modules/typebox/build/type/engine/record/from_key_union.mjs
function StringOrNumberCheck(types) {
  return types.some((type) => IsString3(type) || IsNumber3(type) || IsInteger2(type));
}
function TryBuildRecord(types, value) {
  return guard_exports.IsEqual(StringOrNumberCheck(types), true) ? CreateRecord(StringKey, value) : void 0;
}
function CreateProperties(types, value) {
  return types.reduce((result, left) => {
    return IsLiteral(left) && (guard_exports.IsString(left.const) || guard_exports.IsNumber(left.const)) ? { ...result, [left.const]: value } : result;
  }, {});
}
function CreateObject(types, value) {
  const properties = CreateProperties(types, value);
  const result = _Object_(properties);
  return result;
}
function FromUnionKey(types, value) {
  const flattened = Flatten(types);
  const record = TryBuildRecord(flattened, value);
  return IsSchema(record) ? record : CreateObject(flattened, value);
}

// node_modules/typebox/build/type/engine/record/from_key.mjs
function FromKey(key, value) {
  const result = IsAny(key) ? FromAnyKey(value) : IsBoolean3(key) ? FromBooleanKey(value) : IsEnum(key) ? FromEnumKey(key.enum, value) : IsInteger2(key) ? FromIntegerKey(key, value) : IsIntersect(key) ? FromIntersectKey(key.allOf, value) : IsLiteral(key) ? FromLiteralKey(key.const, value) : IsNumber3(key) ? FromNumberKey(key, value) : IsUnion(key) ? FromUnionKey(key.anyOf, value) : IsString3(key) ? FromStringKey(key, value) : IsTemplateLiteral(key) ? FromTemplateKey(key.pattern, value) : _Object_({});
  return result;
}

// node_modules/typebox/build/type/engine/record/instantiate.mjs
function RecordAction(key, value, options) {
  const result = CanInstantiate([key]) ? memory_exports.Update(FromKey(key, value), {}, options) : RecordDeferred(key, value, options);
  return result;
}
function RecordInstantiate(context, state, key, value, options) {
  const instantiatedKey = InstantiateType(context, state, key);
  const instantiatedValue = InstantiateType(context, state, value);
  return RecordAction(instantiatedKey, instantiatedValue, options);
}

// node_modules/typebox/build/type/types/record.mjs
var IntegerKey = `^${IntegerPattern}$`;
var NumberKey = `^${NumberPattern}$`;
var StringKey = `^${StringPattern}$`;
function RecordDeferred(key, value, options = {}) {
  return Deferred("Record", [key, value], options);
}
function Record(key, value, options = {}) {
  return RecordAction(key, value, options);
}
function RecordFromPattern(pattern, value) {
  return CreateRecord(pattern, value);
}
function RecordPatternToType(pattern) {
  const result = guard_exports.IsEqual(pattern, StringKey) ? String2() : guard_exports.IsEqual(pattern, IntegerKey) ? Integer() : guard_exports.IsEqual(pattern, NumberKey) ? Number2() : TemplateLiteralDecodeUnsafe(pattern);
  return result;
}
function RecordPattern(type) {
  return guard_exports.Keys(type.patternProperties)[0];
}
function RecordKey(type) {
  const pattern = RecordPattern(type);
  const result = RecordPatternToType(pattern);
  return result;
}
function RecordValue(type) {
  return type.patternProperties[RecordPattern(type)];
}
function IsRecord(value) {
  return IsKind(value, "Record");
}

// node_modules/typebox/build/type/types/rest.mjs
function Rest(type) {
  return memory_exports.Create({ "~kind": "Rest" }, { type: "rest", items: type }, {});
}
function IsRest(value) {
  return IsKind(value, "Rest");
}

// node_modules/typebox/build/type/types/this.mjs
function This(options) {
  return memory_exports.Create({ ["~kind"]: "This" }, { $ref: "#" }, options);
}
function IsThis(value) {
  return IsKind(value, "This");
}

// node_modules/typebox/build/type/types/undefined.mjs
function Undefined(options) {
  return memory_exports.Create({ "~kind": "Undefined" }, { type: "undefined" }, options);
}
function IsUndefined2(value) {
  return IsKind(value, "Undefined");
}

// node_modules/typebox/build/type/types/void.mjs
function Void(options) {
  return memory_exports.Create({ "~kind": "Void" }, { type: "void" }, options);
}
function IsVoid(value) {
  return IsKind(value, "Void");
}

// node_modules/typebox/build/type/script/mapping.mjs
function IntrinsicOrCall(ref, parameters) {
  return guard_exports.IsEqual(ref, "Array") ? _Array_(parameters[0]) : guard_exports.IsEqual(ref, "Capitalize") ? CapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ConstructorParameters") ? ConstructorParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Evaluate") ? EvaluateDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Exclude") ? ExcludeDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Extract") ? ExtractDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Index") ? IndexDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "InstanceType") ? InstanceTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Lowercase") ? LowercaseDeferred(parameters[0]) : guard_exports.IsEqual(ref, "NonNullable") ? NonNullableDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Omit") ? OmitDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Parameters") ? ParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Partial") ? PartialDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Pick") ? PickDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Readonly") ? ReadonlyObjectDeferred(parameters[0]) : guard_exports.IsEqual(ref, "KeyOf") ? KeyOfDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Record") ? RecordDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Required") ? RequiredDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ReturnType") ? ReturnTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uncapitalize") ? UncapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uppercase") ? UppercaseDeferred(parameters[0]) : CallConstruct(Ref(ref), parameters);
}
function Unreachable2() {
  throw Error("Unreachable");
}
var DelimitedDecode = (input, result = []) => {
  return input.reduce((result2, left) => {
    return guard_exports.IsArray(left) && guard_exports.IsEqual(left.length, 2) ? [...result2, left[0]] : [...result2, left];
  }, []);
};
var Delimited = (input) => {
  const [left, right] = input;
  return DelimitedDecode([...left, ...right]);
};
function GenericParameterExtendsEqualsMapping(input) {
  return Parameter(input[0], input[2], input[4]);
}
function GenericParameterExtendsMapping(input) {
  return Parameter(input[0], input[2], input[2]);
}
function GenericParameterEqualsMapping(input) {
  return Parameter(input[0], Unknown(), input[2]);
}
function GenericParameterIdentifierMapping(input) {
  return Parameter(input, Unknown(), Unknown());
}
function GenericParameterMapping(input) {
  return input;
}
function GenericParameterListMapping(input) {
  return Delimited(input);
}
function GenericParametersMapping(input) {
  return input[1];
}
function GenericCallArgumentListMapping(input) {
  return Delimited(input);
}
function GenericCallArgumentsMapping(input) {
  return input[1];
}
function GenericCallMapping(input) {
  return IntrinsicOrCall(input[0], input[1]);
}
function OptionalSemiColonMapping(input) {
  return null;
}
function KeywordStringMapping(input) {
  return String2();
}
function KeywordNumberMapping(input) {
  return Number2();
}
function KeywordBooleanMapping(input) {
  return Boolean2();
}
function KeywordUndefinedMapping(input) {
  return Undefined();
}
function KeywordNullMapping(input) {
  return Null();
}
function KeywordIntegerMapping(input) {
  return Integer();
}
function KeywordBigIntMapping(input) {
  return BigInt2();
}
function KeywordUnknownMapping(input) {
  return Unknown();
}
function KeywordAnyMapping(input) {
  return Any();
}
function KeywordObjectMapping(input) {
  return _Object_({});
}
function KeywordNeverMapping(input) {
  return Never();
}
function KeywordSymbolMapping(input) {
  return Symbol2();
}
function KeywordVoidMapping(input) {
  return Void();
}
function KeywordThisMapping(input) {
  return This();
}
function LiteralBigIntMapping(input) {
  return Literal(BigInt(input));
}
function LiteralBooleanMapping(input) {
  return Literal(guard_exports.IsEqual(input, "true"));
}
function LiteralNumberMapping(input) {
  return Literal(parseFloat(input));
}
function LiteralStringMapping(input) {
  return Literal(input);
}
function TemplateInterpolateMapping(input) {
  return input[1];
}
function TemplateSpanMapping(input) {
  return Literal(input);
}
function TemplateBodyMapping(input) {
  return guard_exports.IsEqual(input.length, 3) ? [input[0], input[1], ...input[2]] : [input[0]];
}
function TemplateLiteralTypesMapping(input) {
  return input[1];
}
function TemplateLiteralMapping(input) {
  return TemplateLiteralDeferred(input);
}
function DependentMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? Dependent(input[1], input[3], input[5]) : Dependent(input[1], input[3], Unknown());
}
function KeyOfMapping(input) {
  return input.length > 0;
}
function IndexArrayMapping(input) {
  return input.reduce((result, current) => {
    return guard_exports.IsEqual(current.length, 3) ? [...result, [current[1]]] : [...result, []];
  }, []);
}
function ExtendsMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? [input[1], input[3], input[5]] : [];
}
function BaseMapping(input) {
  return guard_exports.IsArray(input) && guard_exports.IsEqual(input.length, 3) ? input[1] : input;
}
function WithMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function FactorIndexArray(Type2, indexArray) {
  return indexArray.reduce((result, left) => {
    const _left = left;
    return guard_exports.IsEqual(_left.length, 1) ? IndexDeferred(result, _left[0]) : guard_exports.IsEqual(_left.length, 0) ? _Array_(result) : Unreachable2();
  }, Type2);
}
function FactorExtends(type, extend) {
  return guard_exports.IsEqual(extend.length, 3) ? ConditionalDeferred(type, extend[0], extend[1], extend[2]) : type;
}
function FactorWith(type, withClause) {
  return guard_exports.IsArray(withClause) && guard_exports.IsEqual(withClause.length, 0) ? type : WithDeferred(type, withClause);
}
function FactorMapping(input) {
  const [keyOf, type, indexArray, extend, withClause] = input;
  return FactorWith(keyOf ? FactorExtends(KeyOfDeferred(FactorIndexArray(type, indexArray)), extend) : FactorExtends(FactorIndexArray(type, indexArray), extend), withClause);
}
function ExprBinaryMapping(left, rest) {
  return guard_exports.IsEqual(rest.length, 3) ? (() => {
    const [operator, right, next] = rest;
    const Schema = ExprBinaryMapping(right, next);
    if (guard_exports.IsEqual(operator, "&")) {
      return IsIntersect(Schema) ? Intersect([left, ...Schema.allOf]) : Intersect([left, Schema]);
    }
    if (guard_exports.IsEqual(operator, "|")) {
      return IsUnion(Schema) ? Union([left, ...Schema.anyOf]) : Union([left, Schema]);
    }
    Unreachable2();
  })() : left;
}
function ExprTermTailMapping(input) {
  return input;
}
function ExprTermMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprTailMapping(input) {
  return input;
}
function ExprMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprReadonlyMapping(input) {
  return AddImmutableDeferred(input[1]);
}
function ExprPipeMapping(input) {
  return input[1];
}
function GenericTypeMapping(input) {
  return Generic(input[0], input[2]);
}
function InferTypeMapping(input) {
  return guard_exports.IsEqual(input.length, 4) ? Infer(input[1], input[3]) : guard_exports.IsEqual(input.length, 2) ? Infer(input[1], Unknown()) : Unreachable2();
}
function TypeMapping(input) {
  return input;
}
function PropertyKeyNumberMapping(input) {
  return `${input}`;
}
function PropertyKeyIdentMapping(input) {
  return input;
}
function PropertyKeyQuotedMapping(input) {
  return input;
}
function PropertyKeyIndexMapping(input) {
  return IsInteger2(input[3]) ? IntegerKey : IsNumber3(input[3]) ? NumberKey : IsSymbol2(input[3]) ? StringKey : IsString3(input[3]) ? StringKey : Unreachable2();
}
function PropertyKeyMapping(input) {
  return input;
}
function ReadonlyMapping(input) {
  return input.length > 0;
}
function OptionalMapping(input) {
  return input.length > 0;
}
function PropertyMapping(input) {
  const [isReadonly, key, isOptional, _colon, type] = input;
  return {
    [key]: isReadonly && isOptional ? AddReadonlyDeferred(AddOptionalDeferred(type)) : isReadonly && !isOptional ? AddReadonlyDeferred(type) : !isReadonly && isOptional ? AddOptionalDeferred(type) : type
  };
}
function PropertyDelimiterMapping(input) {
  return input;
}
function PropertyListMapping(input) {
  return Delimited(input);
}
function PropertiesReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    const isPatternProperties = guard_exports.HasPropertyKey(left, IntegerKey) || guard_exports.HasPropertyKey(left, NumberKey) || guard_exports.HasPropertyKey(left, StringKey);
    return isPatternProperties ? [result[0], memory_exports.Assign(result[1], left)] : [memory_exports.Assign(result[0], left), result[1]];
  }, [{}, {}]);
}
function PropertiesMapping(input) {
  return PropertiesReduce(input[1]);
}
function _Object_Mapping(input) {
  const [properties, patternProperties] = input;
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return _Object_(properties, options);
}
function ElementNamedMapping(input) {
  return guard_exports.IsEqual(input.length, 5) ? AddReadonlyDeferred(AddOptionalDeferred(input[4])) : guard_exports.IsEqual(input.length, 3) ? input[2] : guard_exports.IsEqual(input.length, 4) ? guard_exports.IsEqual(input[2], "readonly") ? AddReadonlyDeferred(input[3]) : AddOptionalDeferred(input[3]) : Unreachable2();
}
function ElementReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[1]));
}
function ElementReadonlyMapping(input) {
  return AddReadonlyDeferred(input[1]);
}
function ElementOptionalMapping(input) {
  return AddOptionalDeferred(input[0]);
}
function ElementBaseMapping(input) {
  return input;
}
function ElementMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ElementListMapping(input) {
  return Delimited(input);
}
function _Tuple_Mapping(input) {
  return Tuple(input[1]);
}
function ParameterReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[4]));
}
function ParameterReadonlyMapping(input) {
  return AddReadonlyDeferred(input[3]);
}
function ParameterOptionalMapping(input) {
  return AddOptionalDeferred(input[3]);
}
function ParameterTypeMapping(input) {
  return input[2];
}
function ParameterBaseMapping(input) {
  return input;
}
function ParameterMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ParameterListMapping(input) {
  return Delimited(input);
}
function _Function_Mapping(input) {
  return _Function_(input[1], input[4]);
}
function _Constructor_Mapping(input) {
  return Constructor(input[2], input[5]);
}
function ApplyReadonly(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveReadonlyDeferred(type) : guard_exports.IsEqual(state, "add") ? AddReadonlyDeferred(type) : type;
}
function MappedReadonlyMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function ApplyOptional(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveOptionalDeferred(type) : guard_exports.IsEqual(state, "add") ? AddOptionalDeferred(type) : type;
}
function MappedOptionalMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function MappedAsMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? [input[1]] : [];
}
function _Mapped_Mapping(input) {
  return guard_exports.IsArray(input[6]) && guard_exports.IsEqual(input[6].length, 1) ? MappedDeferred(Identifier(input[3]), input[5], input[6][0], ApplyReadonly(input[1], ApplyOptional(input[8], input[10]))) : MappedDeferred(Identifier(input[3]), input[5], Ref(input[3]), ApplyReadonly(input[1], ApplyOptional(input[8], input[10])));
}
function ReferenceMapping(input) {
  return Ref(input);
}
function WithBigIntMapping(input) {
  return BigInt(input);
}
function WithNumberMapping(input) {
  return parseFloat(input);
}
function WithBooleanMapping(input) {
  return guard_exports.IsEqual(input, "true");
}
function WithStringMapping(input) {
  return input;
}
function WithNullMapping(input) {
  return null;
}
function WithUndefinedMapping(input) {
  return void 0;
}
function WithPropertyMapping(input) {
  return { [input[0]]: input[2] };
}
function WithPropertyListMapping(input) {
  return Delimited(input);
}
function WithObjectMappingReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    return memory_exports.Assign(result, left);
  }, {});
}
function WithObjectMapping(input) {
  return WithObjectMappingReduce(input[1]);
}
function WithElementListMapping(input) {
  return Delimited(input);
}
function WithArrayMapping(input) {
  return input[1];
}
function WithValueMapping(input) {
  return input;
}
function PatternBigIntMapping(input) {
  return BigInt2();
}
function PatternStringMapping(input) {
  return String2();
}
function PatternNumberMapping(input) {
  return Number2();
}
function PatternIntegerMapping(input) {
  return Integer();
}
function PatternNeverMapping(input) {
  return Never();
}
function PatternTextMapping(input) {
  return Literal(input);
}
function PatternBaseMapping(input) {
  return input;
}
function PatternGroupMapping(input) {
  return Union(input[1]);
}
function PatternUnionMapping(input) {
  return input.length === 3 ? [...input[0], ...input[2]] : input.length === 1 ? [...input[0]] : [];
}
function PatternTermMapping(input) {
  return [input[0], ...input[1]];
}
function PatternBodyMapping(input) {
  return input;
}
function PatternMapping(input) {
  return input[1];
}
function InterfaceDeclarationHeritageListMapping(input) {
  return Delimited(input);
}
function InterfaceDeclarationHeritageMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function InterfaceDeclarationGenericMapping(input) {
  const parameters = input[2];
  const heritage = input[3];
  const [properties, patternProperties] = input[4];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: Generic(parameters, InterfaceDeferred(heritage, properties, options)) };
}
function InterfaceDeclarationMapping(input) {
  const heritage = input[2];
  const [properties, patternProperties] = input[3];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: InterfaceDeferred(heritage, properties, options) };
}
function TypeAliasDeclarationGenericMapping(input) {
  return { [input[1]]: Generic(input[2], input[4]) };
}
function TypeAliasDeclarationMapping(input) {
  return { [input[1]]: input[3] };
}
function ExportKeywordMapping(input) {
  return null;
}
function ModuleDeclarationDelimiterMapping(input) {
  return input;
}
function ModuleDeclarationListMapping(input) {
  return PropertiesReduce(Delimited(input));
}
function ModuleDeclarationMapping(input) {
  return input[1];
}
function ModuleMapping(input) {
  const moduleDeclaration = input[0];
  const moduleDeclarationList = input[1];
  return ModuleDeferred(memory_exports.Assign(moduleDeclaration, moduleDeclarationList[0]));
}
function ScriptMapping(input) {
  return input;
}

// node_modules/typebox/build/type/script/token/internal/match.mjs
function IsMatch(value) {
  return IsEqual(value.length, 2);
}
function Match2(input, ok, fail) {
  return IsMatch(input) ? ok(input[0], input[1]) : fail();
}

// node_modules/typebox/build/type/script/token/internal/take.mjs
function TakeVariant(variant, input) {
  return IsEqual(input.indexOf(variant), 0) ? [variant, input.slice(variant.length)] : [];
}
function Take(variants, input) {
  for (let i = 0; i < variants.length; i++) {
    const result = TakeVariant(variants[i], input);
    if (IsMatch(result))
      return result;
  }
  return [];
}

// node_modules/typebox/build/type/script/token/internal/char.mjs
function Range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i));
}
var Alpha = [
  ...Range(97, 122),
  // Lowercase
  ...Range(65, 90)
  // Uppercase
];
var Zero = "0";
var NonZero = Range(49, 57);
var Digit = [Zero, ...NonZero];
var WhiteSpace = " ";
var NewLine = "\n";
var UnderScore = "_";
var Dot = ".";
var DollarSign = "$";
var Hyphen = "-";

// node_modules/typebox/build/type/script/token/internal/trim.mjs
var LineComment = "//";
var OpenComment = "/*";
var CloseComment = "*/";
function DiscardMultilineComment(input) {
  const index = input.indexOf(CloseComment);
  const result = IsEqual(index, -1) ? "" : input.slice(index + 2);
  return result;
}
function DiscardLineComment(input) {
  const index = input.indexOf(NewLine);
  const result = IsEqual(index, -1) ? "" : input.slice(index);
  return result;
}
function TrimStartUntilNewline(input) {
  return input.replace(/^[ \t\r\f\v]+/, "");
}
function TrimWhitespace(input) {
  const trimmed = TrimStartUntilNewline(input);
  return trimmed.startsWith(OpenComment) ? TrimWhitespace(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? TrimWhitespace(DiscardLineComment(trimmed.slice(2))) : trimmed;
}
function Trim(input) {
  const trimmed = input.trimStart();
  return trimmed.startsWith(OpenComment) ? Trim(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? Trim(DiscardLineComment(trimmed.slice(2))) : trimmed;
}

// node_modules/typebox/build/type/script/token/internal/optional.mjs
function Optional2(value, input) {
  return Match2(Take([value], input), (Optional4, Rest2) => [Optional4, Rest2], () => ["", input]);
}

// node_modules/typebox/build/type/script/token/internal/many.mjs
function IsDiscard(discard, input) {
  return discard.includes(input);
}
function Many(allowed, discard, input, result = "") {
  return Match2(Take(allowed, input), (Char, Rest2) => IsDiscard(discard, Char) ? Many(allowed, discard, Rest2, result) : Many(allowed, discard, Rest2, `${result}${Char}`), () => [result, input]);
}

// node_modules/typebox/build/type/script/token/unsigned_integer.mjs
function TakeNonZero(input) {
  return Take(NonZero, input);
}
var AllowedDigits = [...Digit, UnderScore];
function TakeDigits(input) {
  return Many(AllowedDigits, [UnderScore], input);
}
function TakeUnsignedInteger(input) {
  return Match2(Take([Zero], input), (Zero2, ZeroRest) => [Zero2, ZeroRest], () => Match2(
    TakeNonZero(input),
    (NonZero2, NonZeroRest) => Match2(TakeDigits(NonZeroRest), (Digits, DigitsRest) => [`${NonZero2}${Digits}`, DigitsRest], () => []),
    // fail: did not match Digits
    () => []
  ));
}
function UnsignedInteger(input) {
  return TakeUnsignedInteger(Trim(input));
}

// node_modules/typebox/build/type/script/token/integer.mjs
function TakeSign(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedInteger(input) {
  return Match2(
    TakeSign(input),
    (Sign, SignRest) => Match2(UnsignedInteger(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Integer2(input) {
  return TakeSignedInteger(Trim(input));
}

// node_modules/typebox/build/type/script/token/bigint.mjs
function TakeBigInt(input) {
  return Match2(
    Integer2(input),
    (Integer3, IntegerRest) => Match2(Take(["n"], IntegerRest), (_N, NRest) => [`${Integer3}`, NRest], () => []),
    // fail: did not match 'n'
    () => []
  );
}
function BigInt3(input) {
  return TakeBigInt(input);
}

// node_modules/typebox/build/type/script/token/const.mjs
function TakeConst(const_, input) {
  return Take([const_], input);
}
function Const(const_, input) {
  return IsEqual(const_, "") ? ["", input] : const_.startsWith(NewLine) ? TakeConst(const_, TrimWhitespace(input)) : const_.startsWith(WhiteSpace) ? TakeConst(const_, input) : TakeConst(const_, Trim(input));
}

// node_modules/typebox/build/type/script/token/ident.mjs
var Initial = [...Alpha, UnderScore, DollarSign];
function TakeInitial(input) {
  return Take(Initial, input);
}
var Remaining = [...Initial, ...Digit];
function TakeRemaining(input, result = "") {
  return Match2(Take(Remaining, input), (Remaining2, RemainingRest) => TakeRemaining(RemainingRest, `${result}${Remaining2}`), () => [result, input]);
}
function TakeIdent(input) {
  return Match2(
    TakeInitial(input),
    (Initial2, InitialRest) => Match2(TakeRemaining(InitialRest), (Remaining2, RemainingRest) => [`${Initial2}${Remaining2}`, RemainingRest], () => []),
    // fail: did not match Remaining
    () => []
  );
}
function Ident(input) {
  return TakeIdent(Trim(input));
}

// node_modules/typebox/build/type/script/token/unsigned_number.mjs
var AllowedDigits2 = [...Digit, UnderScore];
function IsLeadingDot(input) {
  return IsMatch(Take([Dot], input));
}
function TakeFractional(input) {
  return Match2(Many(AllowedDigits2, [UnderScore], input), (Digits, DigitsRest) => IsEqual(Digits, "") ? [] : [Digits, DigitsRest], () => []);
}
function LeadingDot(input) {
  return Match2(
    Take([Dot], input),
    (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`0${Dot2}${Fractional}`, FractionalRest], () => []),
    // fail: did not match Fractional
    () => []
  );
}
function LeadingInteger(input) {
  return Match2(
    UnsignedInteger(input),
    (Integer3, IntegerRest) => Match2(
      Take([Dot], IntegerRest),
      (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`${Integer3}${Dot2}${Fractional}`, FractionalRest], () => [`${Integer3}`, DotRest]),
      // fail: did not match Fractional, use Integer
      () => [`${Integer3}`, IntegerRest]
    ),
    // fail: did not match Dot, use Integer
    () => []
  );
}
function TakeUnsignedNumber(input) {
  return IsLeadingDot(input) ? LeadingDot(input) : LeadingInteger(input);
}
function UnsignedNumber(input) {
  return TakeUnsignedNumber(Trim(input));
}

// node_modules/typebox/build/type/script/token/number.mjs
function TakeSign2(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedNumber(input) {
  return Match2(
    TakeSign2(input),
    (Sign, SignRest) => Match2(UnsignedNumber(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Number3(input) {
  return TakeSignedNumber(Trim(input));
}

// node_modules/typebox/build/type/script/token/until.mjs
function TakeOne(input) {
  const result = IsEqual(input, "") ? [] : [input.slice(0, 1), input.slice(1)];
  return result;
}
function IsInputMatchSentinal(end, input) {
  return ShiftLeft(end, (left, right) => input.startsWith(left) ? true : IsInputMatchSentinal(right, input), () => false);
}
function Until(end, input, result = "") {
  return Match2(
    TakeOne(input),
    (One, Rest2) => IsInputMatchSentinal(end, input) ? [result, input] : Until(end, Rest2, `${result}${One}`),
    () => []
  );
}

// node_modules/typebox/build/type/script/token/span.mjs
function MultiLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, Rest3) => [`${Until2}`, Rest3], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function SingleLine(start, end, input) {
  return Match2(
    Take([start], input),
    (_, Rest2) => Match2(
      Until([NewLine, end], Rest2),
      (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, EndRest) => [`${Until2}`, EndRest], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function Span(start, end, multiLine, input) {
  return multiLine ? MultiLine(start, end, Trim(input)) : SingleLine(start, end, Trim(input));
}

// node_modules/typebox/build/type/script/token/string.mjs
function TakeInitial2(quotes, input) {
  return Take(quotes, input);
}
function TakeSpan(quote, input) {
  return Span(quote, quote, false, input);
}
function TakeString(quotes, input) {
  return Match2(TakeInitial2(quotes, input), (Initial2, InitialRest) => TakeSpan(Initial2, `${Initial2}${InitialRest}`), () => []);
}
function String3(quotes, input) {
  return TakeString(quotes, Trim(input));
}

// node_modules/typebox/build/type/script/token/until_1.mjs
function Until_1(end, input) {
  return Match2(Until(end, input), (Until2, UntilRest) => IsEqual(Until2, "") ? [] : [Until2, UntilRest], () => []);
}

// node_modules/typebox/build/type/script/parser.mjs
var If = (result, left, right = () => []) => result.length === 2 ? left(result) : right();
var GenericParameterExtendsEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [GenericParameterExtendsEqualsMapping(_0), input2]);
var GenericParameterExtends = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterExtendsMapping(_0), input2]);
var GenericParameterEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterEqualsMapping(_0), input2]);
var GenericParameterIdentifier = (input) => If(Ident(input), ([_0, input2]) => [GenericParameterIdentifierMapping(_0), input2]);
var GenericParameter = (input) => If(If(GenericParameterExtendsEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterExtends(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterIdentifier(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [GenericParameterMapping(_0), input2]);
var GenericParameterList_0 = (input, result = []) => If(If(GenericParameter(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericParameterList_0(input2, [...result, _0]), () => [result, input]);
var GenericParameterList = (input) => If(If(GenericParameterList_0(input), ([_0, input2]) => If(If(If(GenericParameter(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericParameterListMapping(_0), input2]);
var GenericParameters = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericParameterList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParametersMapping(_0), input2]);
var GenericCallArgumentList_0 = (input, result = []) => If(If(Type(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericCallArgumentList_0(input2, [...result, _0]), () => [result, input]);
var GenericCallArgumentList = (input) => If(If(GenericCallArgumentList_0(input), ([_0, input2]) => If(If(If(Type(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallArgumentListMapping(_0), input2]);
var GenericCallArguments = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericCallArgumentList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericCallArgumentsMapping(_0), input2]);
var GenericCall = (input) => If(If(Ident(input), ([_0, input2]) => If(GenericCallArguments(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallMapping(_0), input2]);
var OptionalSemiColon = (input) => If(If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalSemiColonMapping(_0), input2]);
var KeywordString = (input) => If(Const("string", input), ([_0, input2]) => [KeywordStringMapping(_0), input2]);
var KeywordNumber = (input) => If(Const("number", input), ([_0, input2]) => [KeywordNumberMapping(_0), input2]);
var KeywordBoolean = (input) => If(Const("boolean", input), ([_0, input2]) => [KeywordBooleanMapping(_0), input2]);
var KeywordUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [KeywordUndefinedMapping(_0), input2]);
var KeywordNull = (input) => If(Const("null", input), ([_0, input2]) => [KeywordNullMapping(_0), input2]);
var KeywordInteger = (input) => If(Const("integer", input), ([_0, input2]) => [KeywordIntegerMapping(_0), input2]);
var KeywordBigInt = (input) => If(Const("bigint", input), ([_0, input2]) => [KeywordBigIntMapping(_0), input2]);
var KeywordUnknown = (input) => If(Const("unknown", input), ([_0, input2]) => [KeywordUnknownMapping(_0), input2]);
var KeywordAny = (input) => If(Const("any", input), ([_0, input2]) => [KeywordAnyMapping(_0), input2]);
var KeywordObject = (input) => If(Const("object", input), ([_0, input2]) => [KeywordObjectMapping(_0), input2]);
var KeywordNever = (input) => If(Const("never", input), ([_0, input2]) => [KeywordNeverMapping(_0), input2]);
var KeywordSymbol = (input) => If(Const("symbol", input), ([_0, input2]) => [KeywordSymbolMapping(_0), input2]);
var KeywordVoid = (input) => If(Const("void", input), ([_0, input2]) => [KeywordVoidMapping(_0), input2]);
var KeywordThis = (input) => If(Const("this", input), ([_0, input2]) => [KeywordThisMapping(_0), input2]);
var TemplateInterpolate = (input) => If(If(Const("${", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateInterpolateMapping(_0), input2]);
var TemplateSpan = (input) => If(Until(["${", "`"], input), ([_0, input2]) => [TemplateSpanMapping(_0), input2]);
var TemplateBody = (input) => If(If(If(TemplateSpan(input), ([_0, input2]) => If(TemplateInterpolate(input2), ([_1, input3]) => If(TemplateBody(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [TemplateBodyMapping(_0), input2]);
var TemplateLiteralTypes = (input) => If(If(Const("`", input), ([_0, input2]) => If(TemplateBody(input2), ([_1, input3]) => If(Const("`", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateLiteralTypesMapping(_0), input2]);
var TemplateLiteral = (input) => If(TemplateLiteralTypes(input), ([_0, input2]) => [TemplateLiteralMapping(_0), input2]);
var Dependent2 = (input) => If(If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const("else", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [DependentMapping(_0), input2]);
var LiteralBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [LiteralBigIntMapping(_0), input2]);
var LiteralBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [LiteralBooleanMapping(_0), input2]);
var LiteralNumber = (input) => If(Number3(input), ([_0, input2]) => [LiteralNumberMapping(_0), input2]);
var LiteralString = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [LiteralStringMapping(_0), input2]);
var KeyOf = (input) => If(If(If(Const("keyof", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [KeyOfMapping(_0), input2]);
var IndexArray_0 = (input, result = []) => If(If(If(Const("[", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(Const("[", input), ([_0, input2]) => If(Const("]", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => IndexArray_0(input2, [...result, _0]), () => [result, input]);
var IndexArray = (input) => If(IndexArray_0(input), ([_0, input2]) => [IndexArrayMapping(_0), input2]);
var Extends2 = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const(":", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExtendsMapping(_0), input2]);
var Base = (input) => If(If(If(Const("(", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(KeywordString(input), ([_0, input2]) => [_0, input2], () => If(KeywordNumber(input), ([_0, input2]) => [_0, input2], () => If(KeywordBoolean(input), ([_0, input2]) => [_0, input2], () => If(KeywordUndefined(input), ([_0, input2]) => [_0, input2], () => If(KeywordNull(input), ([_0, input2]) => [_0, input2], () => If(KeywordInteger(input), ([_0, input2]) => [_0, input2], () => If(KeywordBigInt(input), ([_0, input2]) => [_0, input2], () => If(KeywordUnknown(input), ([_0, input2]) => [_0, input2], () => If(KeywordAny(input), ([_0, input2]) => [_0, input2], () => If(KeywordObject(input), ([_0, input2]) => [_0, input2], () => If(KeywordNever(input), ([_0, input2]) => [_0, input2], () => If(KeywordSymbol(input), ([_0, input2]) => [_0, input2], () => If(KeywordVoid(input), ([_0, input2]) => [_0, input2], () => If(KeywordThis(input), ([_0, input2]) => [_0, input2], () => If(LiteralBigInt(input), ([_0, input2]) => [_0, input2], () => If(LiteralBoolean(input), ([_0, input2]) => [_0, input2], () => If(LiteralNumber(input), ([_0, input2]) => [_0, input2], () => If(LiteralString(input), ([_0, input2]) => [_0, input2], () => If(TemplateLiteral(input), ([_0, input2]) => [_0, input2], () => If(Dependent2(input), ([_0, input2]) => [_0, input2], () => If(_Object_2(input), ([_0, input2]) => [_0, input2], () => If(_Tuple_(input), ([_0, input2]) => [_0, input2], () => If(_Constructor_(input), ([_0, input2]) => [_0, input2], () => If(_Function_2(input), ([_0, input2]) => [_0, input2], () => If(_Mapped_(input), ([_0, input2]) => [_0, input2], () => If(GenericCall(input), ([_0, input2]) => [_0, input2], () => If(Reference(input), ([_0, input2]) => [_0, input2], () => [])))))))))))))))))))))))))))), ([_0, input2]) => [BaseMapping(_0), input2]);
var With = (input) => If(If(If(Const("with", input), ([_0, input2]) => If(WithObject(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithMapping(_0), input2]);
var Factor = (input) => If(If(KeyOf(input), ([_0, input2]) => If(Base(input2), ([_1, input3]) => If(IndexArray(input3), ([_2, input4]) => If(Extends2(input4), ([_3, input5]) => If(With(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [FactorMapping(_0), input2]);
var ExprTermTail = (input) => If(If(If(Const("&", input), ([_0, input2]) => If(Factor(input2), ([_1, input3]) => If(ExprTermTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTermTailMapping(_0), input2]);
var ExprTerm = (input) => If(If(Factor(input), ([_0, input2]) => If(ExprTermTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprTermMapping(_0), input2]);
var ExprTail = (input) => If(If(If(Const("|", input), ([_0, input2]) => If(ExprTerm(input2), ([_1, input3]) => If(ExprTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTailMapping(_0), input2]);
var Expr = (input) => If(If(ExprTerm(input), ([_0, input2]) => If(ExprTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprMapping(_0), input2]);
var ExprReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprReadonlyMapping(_0), input2]);
var ExprPipe = (input) => If(If(Const("|", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprPipeMapping(_0), input2]);
var GenericType = (input) => If(If(GenericParameters(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericTypeMapping(_0), input2]);
var InferType = (input) => If(If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("extends", input3), ([_2, input4]) => If(Expr(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InferTypeMapping(_0), input2]);
var Type = (input) => If(If(InferType(input), ([_0, input2]) => [_0, input2], () => If(ExprPipe(input), ([_0, input2]) => [_0, input2], () => If(ExprReadonly(input), ([_0, input2]) => [_0, input2], () => If(Expr(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [TypeMapping(_0), input2]);
var PropertyKeyNumber = (input) => If(Number3(input), ([_0, input2]) => [PropertyKeyNumberMapping(_0), input2]);
var PropertyKeyIdent = (input) => If(Ident(input), ([_0, input2]) => [PropertyKeyIdentMapping(_0), input2]);
var PropertyKeyQuoted = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [PropertyKeyQuotedMapping(_0), input2]);
var PropertyKeyIndex = (input) => If(If(Const("[", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(If(KeywordInteger(input4), ([_02, input5]) => [_02, input5], () => If(KeywordNumber(input4), ([_02, input5]) => [_02, input5], () => If(KeywordString(input4), ([_02, input5]) => [_02, input5], () => If(KeywordSymbol(input4), ([_02, input5]) => [_02, input5], () => [])))), ([_3, input5]) => If(Const("]", input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyKeyIndexMapping(_0), input2]);
var PropertyKey = (input) => If(If(PropertyKeyNumber(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIdent(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyQuoted(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIndex(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [PropertyKeyMapping(_0), input2]);
var Readonly2 = (input) => If(If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ReadonlyMapping(_0), input2]);
var Optional3 = (input) => If(If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalMapping(_0), input2]);
var Property = (input) => If(If(Readonly2(input), ([_0, input2]) => If(PropertyKey(input2), ([_1, input3]) => If(Optional3(input3), ([_2, input4]) => If(Const(":", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyMapping(_0), input2]);
var PropertyDelimiter = (input) => If(If(If(Const(",", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(",", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [PropertyDelimiterMapping(_0), input2]);
var PropertyList_0 = (input, result = []) => If(If(Property(input), ([_0, input2]) => If(PropertyDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => PropertyList_0(input2, [...result, _0]), () => [result, input]);
var PropertyList = (input) => If(If(PropertyList_0(input), ([_0, input2]) => If(If(If(Property(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PropertyListMapping(_0), input2]);
var Properties = (input) => If(If(Const("{", input), ([_0, input2]) => If(PropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PropertiesMapping(_0), input2]);
var _Object_2 = (input) => If(Properties(input), ([_0, input2]) => [_Object_Mapping(_0), input2]);
var ElementNamed = (input) => If(If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ElementNamedMapping(_0), input2]);
var ElementReadonlyOptional = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ElementReadonlyOptionalMapping(_0), input2]);
var ElementReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementReadonlyMapping(_0), input2]);
var ElementOptional = (input) => If(If(Type(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementOptionalMapping(_0), input2]);
var ElementBase = (input) => If(If(ElementNamed(input), ([_0, input2]) => [_0, input2], () => If(ElementReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ElementReadonly(input), ([_0, input2]) => [_0, input2], () => If(ElementOptional(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [ElementBaseMapping(_0), input2]);
var Element = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ElementBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ElementBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementMapping(_0), input2]);
var ElementList_0 = (input, result = []) => If(If(Element(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ElementList_0(input2, [...result, _0]), () => [result, input]);
var ElementList = (input) => If(If(ElementList_0(input), ([_0, input2]) => If(If(If(Element(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementListMapping(_0), input2]);
var _Tuple_ = (input) => If(If(Const("[", input), ([_0, input2]) => If(ElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_Tuple_Mapping(_0), input2]);
var ParameterReadonlyOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [ParameterReadonlyOptionalMapping(_0), input2]);
var ParameterReadonly = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterReadonlyMapping(_0), input2]);
var ParameterOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterOptionalMapping(_0), input2]);
var ParameterType = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ParameterTypeMapping(_0), input2]);
var ParameterBase = (input) => If(If(ParameterReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterReadonly(input), ([_0, input2]) => [_0, input2], () => If(ParameterOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterType(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ParameterBaseMapping(_0), input2]);
var Parameter2 = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ParameterBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ParameterBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ParameterMapping(_0), input2]);
var ParameterList_0 = (input, result = []) => If(If(Parameter2(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ParameterList_0(input2, [...result, _0]), () => [result, input]);
var ParameterList = (input) => If(If(ParameterList_0(input), ([_0, input2]) => If(If(If(Parameter2(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ParameterListMapping(_0), input2]);
var _Function_2 = (input) => If(If(Const("(", input), ([_0, input2]) => If(ParameterList(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => If(Const("=>", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_Function_Mapping(_0), input2]);
var _Constructor_ = (input) => If(If(Const("new", input), ([_0, input2]) => If(Const("(", input2), ([_1, input3]) => If(ParameterList(input3), ([_2, input4]) => If(Const(")", input4), ([_3, input5]) => If(Const("=>", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_Constructor_Mapping(_0), input2]);
var MappedReadonly = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedReadonlyMapping(_0), input2]);
var MappedOptional = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedOptionalMapping(_0), input2]);
var MappedAs = (input) => If(If(If(Const("as", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [MappedAsMapping(_0), input2]);
var _Mapped_ = (input) => If(If(Const("{", input), ([_0, input2]) => If(MappedReadonly(input2), ([_1, input3]) => If(Const("[", input3), ([_2, input4]) => If(Ident(input4), ([_3, input5]) => If(Const("in", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => If(MappedAs(input7), ([_6, input8]) => If(Const("]", input8), ([_7, input9]) => If(MappedOptional(input9), ([_8, input10]) => If(Const(":", input10), ([_9, input11]) => If(Type(input11), ([_10, input12]) => If(OptionalSemiColon(input12), ([_11, input13]) => If(Const("}", input13), ([_12, input14]) => [[_0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12], input14]))))))))))))), ([_0, input2]) => [_Mapped_Mapping(_0), input2]);
var Reference = (input) => If(Ident(input), ([_0, input2]) => [ReferenceMapping(_0), input2]);
var WithBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [WithBigIntMapping(_0), input2]);
var WithNumber = (input) => If(Number3(input), ([_0, input2]) => [WithNumberMapping(_0), input2]);
var WithBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithBooleanMapping(_0), input2]);
var WithString = (input) => If(String3(['"', "'"], input), ([_0, input2]) => [WithStringMapping(_0), input2]);
var WithNull = (input) => If(Const("null", input), ([_0, input2]) => [WithNullMapping(_0), input2]);
var WithUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [WithUndefinedMapping(_0), input2]);
var WithProperty = (input) => If(If(PropertyKey(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(WithValue(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithPropertyMapping(_0), input2]);
var WithPropertyList_0 = (input, result = []) => If(If(WithProperty(input), ([_0, input2]) => If(PropertyDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithPropertyList_0(input2, [...result, _0]), () => [result, input]);
var WithPropertyList = (input) => If(If(WithPropertyList_0(input), ([_0, input2]) => If(If(If(WithProperty(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [WithPropertyListMapping(_0), input2]);
var WithObject = (input) => If(If(Const("{", input), ([_0, input2]) => If(WithPropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithObjectMapping(_0), input2]);
var WithElementList_0 = (input, result = []) => If(If(WithValue(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithElementList_0(input2, [...result, _0]), () => [result, input]);
var WithElementList = (input) => If(If(WithElementList_0(input), ([_0, input2]) => If(If(If(WithValue(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [WithElementListMapping(_0), input2]);
var WithArray = (input) => If(If(Const("[", input), ([_0, input2]) => If(WithElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithArrayMapping(_0), input2]);
var WithValue = (input) => If(If(WithBigInt(input), ([_0, input2]) => [_0, input2], () => If(WithNumber(input), ([_0, input2]) => [_0, input2], () => If(WithBoolean(input), ([_0, input2]) => [_0, input2], () => If(WithString(input), ([_0, input2]) => [_0, input2], () => If(WithNull(input), ([_0, input2]) => [_0, input2], () => If(WithUndefined(input), ([_0, input2]) => [_0, input2], () => If(WithObject(input), ([_0, input2]) => [_0, input2], () => If(WithArray(input), ([_0, input2]) => [_0, input2], () => [])))))))), ([_0, input2]) => [WithValueMapping(_0), input2]);
var PatternBigInt = (input) => If(Const("-?(?:0|[1-9][0-9]*)n", input), ([_0, input2]) => [PatternBigIntMapping(_0), input2]);
var PatternString = (input) => If(Const(".*", input), ([_0, input2]) => [PatternStringMapping(_0), input2]);
var PatternNumber = (input) => If(Const("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", input), ([_0, input2]) => [PatternNumberMapping(_0), input2]);
var PatternInteger = (input) => If(Const("-?(?:0|[1-9][0-9]*)", input), ([_0, input2]) => [PatternIntegerMapping(_0), input2]);
var PatternNever = (input) => If(Const("(?!)", input), ([_0, input2]) => [PatternNeverMapping(_0), input2]);
var PatternText = (input) => If(Until_1(["-?(?:0|[1-9][0-9]*)n", ".*", "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", "-?(?:0|[1-9][0-9]*)", "(?!)", "(", ")", "$", "|"], input), ([_0, input2]) => [PatternTextMapping(_0), input2]);
var PatternBase = (input) => If(If(PatternBigInt(input), ([_0, input2]) => [_0, input2], () => If(PatternString(input), ([_0, input2]) => [_0, input2], () => If(PatternNumber(input), ([_0, input2]) => [_0, input2], () => If(PatternInteger(input), ([_0, input2]) => [_0, input2], () => If(PatternNever(input), ([_0, input2]) => [_0, input2], () => If(PatternGroup(input), ([_0, input2]) => [_0, input2], () => If(PatternText(input), ([_0, input2]) => [_0, input2], () => []))))))), ([_0, input2]) => [PatternBaseMapping(_0), input2]);
var PatternGroup = (input) => If(If(Const("(", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternGroupMapping(_0), input2]);
var PatternUnion = (input) => If(If(If(PatternTerm(input), ([_0, input2]) => If(Const("|", input2), ([_1, input3]) => If(PatternUnion(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(PatternTerm(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [PatternUnionMapping(_0), input2]);
var PatternTerm = (input) => If(If(PatternBase(input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PatternTermMapping(_0), input2]);
var PatternBody = (input) => If(If(PatternUnion(input), ([_0, input2]) => [_0, input2], () => If(PatternTerm(input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PatternBodyMapping(_0), input2]);
var Pattern = (input) => If(If(Const("^", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const("$", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternMapping(_0), input2]);
var InterfaceDeclarationHeritageList_0 = (input, result = []) => If(If(Type(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => InterfaceDeclarationHeritageList_0(input2, [...result, _0]), () => [result, input]);
var InterfaceDeclarationHeritageList = (input) => If(If(InterfaceDeclarationHeritageList_0(input), ([_0, input2]) => If(If(If(Type(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [InterfaceDeclarationHeritageListMapping(_0), input2]);
var InterfaceDeclarationHeritage = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(InterfaceDeclarationHeritageList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InterfaceDeclarationHeritageMapping(_0), input2]);
var InterfaceDeclarationGeneric = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(InterfaceDeclarationHeritage(input4), ([_3, input5]) => If(Properties(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [InterfaceDeclarationGenericMapping(_0), input2]);
var InterfaceDeclaration = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(InterfaceDeclarationHeritage(input3), ([_2, input4]) => If(Properties(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [InterfaceDeclarationMapping(_0), input2]);
var TypeAliasDeclarationGeneric = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [TypeAliasDeclarationGenericMapping(_0), input2]);
var TypeAliasDeclaration = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("=", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [TypeAliasDeclarationMapping(_0), input2]);
var ExportKeyword = (input) => If(If(If(Const("export", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExportKeywordMapping(_0), input2]);
var ModuleDeclarationDelimiter = (input) => If(If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ModuleDeclarationDelimiterMapping(_0), input2]);
var ModuleDeclarationList_0 = (input, result = []) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ModuleDeclarationList_0(input2, [...result, _0]), () => [result, input]);
var ModuleDeclarationList = (input) => If(If(ModuleDeclarationList_0(input), ([_0, input2]) => If(If(If(ModuleDeclaration(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleDeclarationListMapping(_0), input2]);
var ModuleDeclaration = (input) => If(If(ExportKeyword(input), ([_0, input2]) => If(If(InterfaceDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(InterfaceDeclaration(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclaration(input2), ([_02, input3]) => [_02, input3], () => [])))), ([_1, input3]) => If(OptionalSemiColon(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ModuleDeclarationMapping(_0), input2]);
var Module = (input) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleMapping(_0), input2]);
var Script = (input) => If(If(Module(input), ([_0, input2]) => [_0, input2], () => If(GenericType(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ScriptMapping(_0), input2]);

// node_modules/typebox/build/type/engine/patterns/template.mjs
function ParseTemplateIntoTypes(template) {
  const parsed = TemplateLiteralTypes(`\`${template}\``);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : Unreachable();
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/encode.mjs
function JoinString(input) {
  return input.join("|");
}
function UnwrapTemplateLiteralPattern(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function EncodeLiteral(value, right, pattern) {
  return EncodeTypes(right, `${pattern}${value}`);
}
function EncodeBigInt(right, pattern) {
  return EncodeTypes(right, `${pattern}${BigIntPattern}`);
}
function EncodeInteger(right, pattern) {
  return EncodeTypes(right, `${pattern}${IntegerPattern}`);
}
function EncodeNumber(right, pattern) {
  return EncodeTypes(right, `${pattern}${NumberPattern}`);
}
function EncodeBoolean(right, pattern) {
  return EncodeType(Union([Literal("false"), Literal("true")]), right, pattern);
}
function EncodeString(right, pattern) {
  return EncodeTypes(right, `${pattern}${StringPattern}`);
}
function EncodeTemplateLiteral(templatePattern, right, pattern) {
  return EncodeTypes(right, `${pattern}${UnwrapTemplateLiteralPattern(templatePattern)}`);
}
function EncodeTemplateLiteralDeferred(types, right, pattern) {
  const templateLiteral = TemplateLiteralAction(types, {});
  const result = EncodeType(templateLiteral, right, pattern);
  return result;
}
function EncodeEnum(values, right, pattern) {
  const evaluated = EvaluateEnum(values);
  return EncodeType(evaluated, right, pattern);
}
function EncodeUnion(types, right, pattern, result = []) {
  return guard_exports.ShiftLeft(types, (head, tail) => EncodeUnion(tail, right, pattern, [...result, EncodeType(head, [], "")]), () => EncodeTypes(right, `${pattern}(${JoinString(result)})`));
}
function EncodeType(type, right, pattern) {
  return IsEnum(type) ? EncodeEnum(type.enum, right, pattern) : IsInteger2(type) ? EncodeInteger(right, pattern) : IsLiteral(type) ? EncodeLiteral(type.const, right, pattern) : IsBigInt2(type) ? EncodeBigInt(right, pattern) : IsBoolean3(type) ? EncodeBoolean(right, pattern) : IsNumber3(type) ? EncodeNumber(right, pattern) : IsString3(type) ? EncodeString(right, pattern) : IsTemplateLiteral(type) ? EncodeTemplateLiteral(type.pattern, right, pattern) : IsTemplateLiteralDeferred(type) ? EncodeTemplateLiteralDeferred(type.parameters[0], right, pattern) : IsUnion(type) ? EncodeUnion(type.anyOf, right, pattern) : NeverPattern;
}
function EncodeTypes(types, pattern) {
  return guard_exports.ShiftLeft(types, (left, right) => EncodeType(left, right, pattern), () => pattern);
}
function EncodePattern(types) {
  const encoded = EncodeTypes(types, "");
  const result = `^${encoded}$`;
  return result;
}
function TemplateLiteralEncode(types) {
  const pattern = EncodePattern(types);
  const result = TemplateLiteralCreate(pattern);
  return result;
}

// node_modules/typebox/build/type/engine/template_literal/instantiate.mjs
function TemplateLiteralAction(types, options) {
  const result = CanInstantiate(types) ? memory_exports.Update(TemplateLiteralEncode(types), {}, options) : TemplateLiteralDeferred(types, options);
  return result;
}
function TemplateLiteralInstantiate(context, state, types, options) {
  const instantiatedTypes = InstantiateTypes(context, state, types);
  return TemplateLiteralAction(instantiatedTypes, options);
}

// node_modules/typebox/build/type/types/template_literal.mjs
function TemplateLiteralDeferred(types, options = {}) {
  return Deferred("TemplateLiteral", [types], options);
}
function IsTemplateLiteralDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "TemplateLiteral");
}
function TemplateLiteralFromTypes(types) {
  return TemplateLiteralAction(types, {});
}
function TemplateLiteralFromString(template) {
  const types = ParseTemplateIntoTypes(template);
  return TemplateLiteralFromTypes(types);
}
function TemplateLiteral2(input, options = {}) {
  const type = guard_exports.IsString(input) ? TemplateLiteralFromString(input) : TemplateLiteralFromTypes(input);
  return memory_exports.Update(type, {}, options);
}
function IsTemplateLiteral(value) {
  return IsKind(value, "TemplateLiteral");
}

// node_modules/typebox/build/type/extends/result.mjs
var result_exports = {};
__export(result_exports, {
  ExtendsFalse: () => ExtendsFalse,
  ExtendsTrue: () => ExtendsTrue,
  ExtendsUnion: () => ExtendsUnion,
  IsExtendsFalse: () => IsExtendsFalse,
  IsExtendsTrue: () => IsExtendsTrue,
  IsExtendsTrueLike: () => IsExtendsTrueLike,
  IsExtendsUnion: () => IsExtendsUnion,
  Match: () => Match3
});
function ExtendsUnion(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsUnion" }, { inferred });
}
function IsExtendsUnion(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsUnion") && guard_exports.IsObject(value.inferred);
}
function ExtendsTrue(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsTrue" }, { inferred });
}
function IsExtendsTrue(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsTrue") && guard_exports.IsObject(value.inferred);
}
function ExtendsFalse() {
  return memory_exports.Create({ ["~kind"]: "ExtendsFalse" }, {});
}
function IsExtendsFalse(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], "ExtendsFalse");
}
function IsExtendsTrueLike(value) {
  return IsExtendsUnion(value) || IsExtendsTrue(value);
}
function Match3(result, true_, false_) {
  return IsExtendsTrueLike(result) ? true_(result.inferred) : false_();
}

// node_modules/typebox/build/type/extends/extends_right.mjs
function ExtendsRightInfer(inferred, name, left, right) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => ExtendsTrue(memory_exports.Assign(memory_exports.Assign(inferred, checkInferred), { [name]: left })), () => ExtendsFalse());
}
function ExtendsRightAny(inferred, _left) {
  return ExtendsTrue(inferred);
}
function ExtendsRightDependent(inferred, left, if_, then_, else_) {
  return Match3(ExtendsLeft(inferred, left, if_), (inferred2) => Match3(ExtendsLeft(inferred2, left, then_), (inferred3) => ExtendsTrue(inferred3), () => ExtendsFalse()), () => Match3(ExtendsLeft(inferred, left, else_), (inferred2) => ExtendsTrue(inferred2), () => ExtendsFalse()));
}
function ExtendsRightEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightIntersect(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsRightIntersect(inferred2, left, tail), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsRightTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightUnion(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsRightUnion(inferred, left, tail)), () => ExtendsFalse());
}
function ExtendsRight(inferred, left, right) {
  return IsAny(right) ? ExtendsRightAny(inferred, left) : IsDependent(right) ? ExtendsRightDependent(inferred, left, right.if, right.then, right.else) : IsEnum(right) ? ExtendsRightEnum(inferred, left, right.enum) : IsInfer(right) ? ExtendsRightInfer(inferred, right.name, left, right.extends) : IsIntersect(right) ? ExtendsRightIntersect(inferred, left, right.allOf) : IsTemplateLiteral(right) ? ExtendsRightTemplateLiteral(inferred, left, right.pattern) : IsUnion(right) ? ExtendsRightUnion(inferred, left, right.anyOf) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/any.mjs
function ExtendsAny(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsUnion(inferred);
}

// node_modules/typebox/build/type/extends/array.mjs
function ExtendsImmutable(left, right) {
  const isImmutableLeft = IsImmutable(left);
  const isImmutableRight = IsImmutable(right);
  return isImmutableLeft && isImmutableRight ? true : !isImmutableLeft && isImmutableRight ? true : isImmutableLeft && !isImmutableRight ? false : true;
}
function ExtendsArray(inferred, arrayLeft, left, right) {
  return IsArray2(right) ? ExtendsImmutable(arrayLeft, right) ? ExtendsLeft(inferred, left, right.items) : ExtendsFalse() : ExtendsRight(inferred, arrayLeft, right);
}

// node_modules/typebox/build/type/extends/bigint.mjs
function ExtendsBigInt(inferred, left, right) {
  return IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/boolean.mjs
function ExtendsBoolean(inferred, left, right) {
  return IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/parameters.mjs
function ParameterCompare(inferred, left, leftRest, right, rightRest) {
  const checkLeft = IsInfer(right) ? left : right;
  const checkRight = IsInfer(right) ? right : left;
  const isLeftOptional = IsOptional(left);
  const isRightOptional = IsOptional(right);
  return !isLeftOptional && isRightOptional ? ExtendsFalse() : Match3(ExtendsLeft(inferred, checkLeft, checkRight), (inferred2) => ExtendsParameters(inferred2, leftRest, rightRest), () => ExtendsFalse());
}
function ParameterRight(inferred, left, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ParameterCompare(inferred, left, leftRest, head, tail), () => IsOptional(left) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function ParametersLeft(inferred, left, rightRest) {
  return guard_exports.ShiftLeft(left, (head, tail) => ParameterRight(inferred, head, tail, rightRest), () => ExtendsTrue(inferred));
}
function ExtendsParameters(inferred, left, right) {
  return ParametersLeft(inferred, left, right);
}

// node_modules/typebox/build/type/extends/return_type.mjs
function ExtendsReturnType(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsLeft(inferred, left, right);
}

// node_modules/typebox/build/type/extends/constructor.mjs
function ExtendsConstructor(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsConstructor2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["instanceType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/dependent.mjs
function ExtendsDependent(inferred, if_, then_, else_, right) {
  return Match3(ExtendsLeft(inferred, if_, right), () => ExtendsLeft(inferred, then_, right), () => ExtendsLeft(inferred, else_, right));
}

// node_modules/typebox/build/type/extends/enum.mjs
function ExtendsEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/function.mjs
function ExtendsFunction(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsFunction2(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["returnType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/integer.mjs
function ExtendsInteger(inferred, left, right) {
  return IsInteger2(right) ? ExtendsTrue(inferred) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/intersect.mjs
function ExtendsIntersect(inferred, left, right) {
  const evaluated = EvaluateIntersect(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/literal.mjs
function ExtendsLiteralValue(inferred, left, right) {
  return left === right ? ExtendsTrue(inferred) : ExtendsFalse();
}
function ExtendsLiteralBigInt(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralBoolean(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralNumber(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralString(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteral(inferred, left, right) {
  return guard_exports.IsBigInt(left.const) ? ExtendsLiteralBigInt(inferred, left.const, right) : guard_exports.IsBoolean(left.const) ? ExtendsLiteralBoolean(inferred, left.const, right) : guard_exports.IsNumber(left.const) ? ExtendsLiteralNumber(inferred, left.const, right) : guard_exports.IsString(left.const) ? ExtendsLiteralString(inferred, left.const, right) : Unreachable();
}

// node_modules/typebox/build/type/extends/never.mjs
function ExtendsNever(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : ExtendsTrue(inferred);
}

// node_modules/typebox/build/type/extends/null.mjs
function ExtendsNull(inferred, left, right) {
  return IsNull2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/number.mjs
function ExtendsNumber(inferred, left, right) {
  return IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/object.mjs
function ExtendsPropertyOptional(inferred, left, right) {
  return IsOptional(left) ? IsOptional(right) ? ExtendsTrue(inferred) : ExtendsFalse() : ExtendsTrue(inferred);
}
function ExtendsProperty(inferred, left, right) {
  return (
    // Right TInfer<TNever> is TExtendsFalse
    IsInfer(right) && IsNever(right.extends) ? ExtendsFalse() : Match3(ExtendsLeft(inferred, left, right), (inferred2) => ExtendsPropertyOptional(inferred2, left, right), () => ExtendsFalse())
  );
}
function ExtractInferredProperties(keys, properties) {
  return keys.reduce((result, key) => {
    return key in properties ? IsExtendsTrueLike(properties[key]) ? { ...result, ...properties[key].inferred } : Unreachable() : Unreachable();
  }, {});
}
function ExtendsPropertiesComparer(inferred, left, right) {
  const properties = {};
  for (const rightKey of guard_exports.Keys(right)) {
    properties[rightKey] = rightKey in left ? ExtendsProperty({}, left[rightKey], right[rightKey]) : IsOptional(right[rightKey]) ? IsInfer(right[rightKey]) ? ExtendsTrue(memory_exports.Assign(inferred, { [right[rightKey].name]: right[rightKey].extends })) : ExtendsTrue(inferred) : ExtendsFalse();
  }
  const checked = guard_exports.Values(properties).every((result) => IsExtendsTrueLike(result));
  const extracted = checked ? ExtractInferredProperties(guard_exports.Keys(properties), properties) : {};
  return checked ? ExtendsTrue(extracted) : ExtendsFalse();
}
function ExtendsProperties(inferred, left, right) {
  const compared = ExtendsPropertiesComparer(inferred, left, right);
  return IsExtendsTrueLike(compared) ? ExtendsTrue(memory_exports.Assign(inferred, compared.inferred)) : ExtendsFalse();
}
function ExtendsObjectToObject(inferred, left, right) {
  return ExtendsProperties(inferred, left, right);
}
function RecordMergeInferred(left, right) {
  return guard_exports.Keys(right).reduce((result, key) => {
    return {
      ...result,
      [key]: guard_exports.HasPropertyKey(left, key) ? IsUnion(result[key]) ? Union([...result[key].anyOf, right[key]]) : Union([left[key], right[key]]) : right[key]
    };
  }, left);
}
function ExtendsRecordComparer(properties, keys, type, result) {
  return guard_exports.ShiftLeft(keys, (left, right) => Match3(ExtendsLeft({}, properties[left], type), (inferred) => ExtendsRecordComparer(properties, right, type, RecordMergeInferred(result, inferred)), () => ExtendsFalse()), () => ExtendsTrue(result));
}
function ExtendsObjectToRecord(inferred, properties, _pattern, value) {
  const keys = guard_exports.Keys(properties);
  const result = ExtendsRecordComparer(properties, keys, value, inferred);
  return result;
}
function ExtendsObject(inferred, left, right) {
  return IsRecord(right) ? ExtendsObjectToRecord(inferred, left, RecordPattern(right), RecordValue(right)) : IsObject2(right) ? ExtendsObjectToObject(inferred, left, right.properties) : ExtendsRight(inferred, _Object_(left), right);
}

// node_modules/typebox/build/type/extends/record.mjs
function FromObject3(inferred, properties) {
  return guard_exports.IsEqual(guard_exports.Keys(properties).length, 0) ? ExtendsTrue(inferred) : ExtendsFalse();
}
function FromRecord(inferred, _leftKey, leftValue, _rightKey, rightValue) {
  return ExtendsLeft(inferred, leftValue, rightValue);
}
function ExtendsRecord(inferred, leftPattern, leftValue, right) {
  return IsRecord(right) ? FromRecord(inferred, RecordPatternToType(leftPattern), leftValue, RecordPatternToType(RecordPattern(right)), RecordValue(right)) : IsObject2(right) ? FromObject3(inferred, right.properties) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/string.mjs
function ExtendsString(inferred, left, right) {
  return IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/symbol.mjs
function ExtendsSymbol(inferred, left, right) {
  return IsSymbol2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/template_literal.mjs
function ExtendsTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/typebox/build/type/extends/inference.mjs
function Inferrable(name, type) {
  return memory_exports.Create({ "~kind": "Inferrable" }, { name, type }, {});
}
function IsInferable(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "name") && guard_exports.HasPropertyKey(value, "type") && guard_exports.IsEqual(value["~kind"], "Inferrable") && guard_exports.IsString(value.name) && guard_exports.IsObject(value.type);
}
function TryRestInferable(type) {
  return IsRest(type) ? IsInfer(type.items) ? IsArray2(type.items.extends) ? Inferrable(type.items.name, type.items.extends.items) : IsUnknown(type.items.extends) ? Inferrable(type.items.name, type.items.extends) : void 0 : Unreachable() : void 0;
}
function TryInferable(type) {
  return IsInfer(type) ? Inferrable(type.name, type.extends) : void 0;
}
function TryInferResults(rest, right, result = []) {
  return guard_exports.ShiftLeft(rest, (head, tail) => Match3(ExtendsLeft({}, head, right), () => TryInferResults(tail, right, [...result, head]), () => void 0), () => result);
}
function InferTupleResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Tuple(results) })) : ExtendsFalse();
}
function InferUnionResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Union(results) })) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/tuple.mjs
function Reverse(types) {
  return [...types].reverse();
}
function ApplyReverse(types, reversed) {
  return reversed ? Reverse(types) : types;
}
function Reversed(types) {
  const first = types.length > 0 ? types[0] : void 0;
  const inferrable = IsSchema(first) ? TryRestInferable(first) : void 0;
  return IsSchema(inferrable);
}
function ElementsCompare(inferred, reversed, left, leftRest, right, rightRest) {
  return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => Elements(checkInferred, reversed, leftRest, rightRest), () => ExtendsFalse());
}
function ElementsLeft(inferred, reversed, leftRest, right, rightRest) {
  const inferable = TryRestInferable(right);
  return (
    // Rest Inferrable Right Means we delegate to TInferTupleResult to Generate a Result
    IsInferable(inferable) ? InferTupleResult(inferred, inferable["name"], ApplyReverse(leftRest, reversed), inferable["type"]) : guard_exports.ShiftLeft(leftRest, (head, tail) => ElementsCompare(inferred, reversed, head, tail, right, rightRest), () => ExtendsFalse())
  );
}
function ElementsRight(inferred, reversed, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ElementsLeft(inferred, reversed, leftRest, head, tail), () => guard_exports.IsEqual(leftRest.length, 0) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function Elements(inferred, reversed, leftRest, rightRest) {
  return ElementsRight(inferred, reversed, leftRest, rightRest);
}
function ExtendsTupleToTuple(inferred, left, right) {
  const instantiatedRight = InstantiateElements(inferred, State([], []), right);
  const reversed = Reversed(instantiatedRight);
  return Elements(inferred, reversed, ApplyReverse(left, reversed), ApplyReverse(instantiatedRight, reversed));
}
function ExtendsTupleToArray(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable["name"], left, inferrable["type"]) : guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsLeft(inferred, head, right), (inferred2) => ExtendsTupleToArray(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsTuple(inferred, left, right) {
  const instantiatedLeft = InstantiateElements(inferred, State([], []), left);
  return IsTuple(right) ? ExtendsTupleToTuple(inferred, instantiatedLeft, right.items) : IsArray2(right) ? ExtendsTupleToArray(inferred, instantiatedLeft, right.items) : ExtendsRight(inferred, Tuple(instantiatedLeft), right);
}

// node_modules/typebox/build/type/extends/undefined.mjs
function ExtendsUndefined(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : IsUndefined2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/union.mjs
function ExtendsUnionSome(inferred, type, unionTypes) {
  return guard_exports.ShiftLeft(unionTypes, (head, tail) => Match3(ExtendsLeft(inferred, type, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsUnionSome(inferred, type, tail)), () => ExtendsFalse());
}
function ExtendsUnionLeft(inferred, left, right) {
  return guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsUnionSome(inferred, head, right), (inferred2) => ExtendsUnionLeft(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsUnion2(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable.name, left, inferrable.type) : IsUnion(right) ? ExtendsUnionLeft(inferred, left, right.anyOf) : ExtendsUnionLeft(inferred, left, [right]);
}

// node_modules/typebox/build/type/extends/unknown.mjs
function ExtendsUnknown(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/typebox/build/type/extends/void.mjs
function ExtendsVoid(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/typebox/build/type/extends/extends_left.mjs
function ExtendsLeft(inferred, left, right) {
  return IsAny(left) ? ExtendsAny(inferred, left, right) : IsArray2(left) ? ExtendsArray(inferred, left, left.items, right) : IsBigInt2(left) ? ExtendsBigInt(inferred, left, right) : IsBoolean3(left) ? ExtendsBoolean(inferred, left, right) : IsConstructor2(left) ? ExtendsConstructor(inferred, left.parameters, left.instanceType, right) : IsDependent(left) ? ExtendsDependent(inferred, left.if, left.then, left.else, right) : IsEnum(left) ? ExtendsEnum(inferred, left.enum, right) : IsFunction2(left) ? ExtendsFunction(inferred, left.parameters, left.returnType, right) : IsInteger2(left) ? ExtendsInteger(inferred, left, right) : IsIntersect(left) ? ExtendsIntersect(inferred, left.allOf, right) : IsLiteral(left) ? ExtendsLiteral(inferred, left, right) : IsNever(left) ? ExtendsNever(inferred, left, right) : IsNull2(left) ? ExtendsNull(inferred, left, right) : IsNumber3(left) ? ExtendsNumber(inferred, left, right) : IsObject2(left) ? ExtendsObject(inferred, left.properties, right) : IsRecord(left) ? ExtendsRecord(inferred, RecordPattern(left), RecordValue(left), right) : IsString3(left) ? ExtendsString(inferred, left, right) : IsSymbol2(left) ? ExtendsSymbol(inferred, left, right) : IsTemplateLiteral(left) ? ExtendsTemplateLiteral(inferred, left.pattern, right) : IsTuple(left) ? ExtendsTuple(inferred, left.items, right) : IsUndefined2(left) ? ExtendsUndefined(inferred, left, right) : IsUnion(left) ? ExtendsUnion2(inferred, left.anyOf, right) : IsUnknown(left) ? ExtendsUnknown(inferred, left, right) : IsVoid(left) ? ExtendsVoid(inferred, left, right) : ExtendsFalse();
}

// node_modules/typebox/build/type/engine/interface/instantiate.mjs
function InterfaceOperation(heritage, properties) {
  const result = EvaluateIntersect([...heritage, _Object_(properties)]);
  return result;
}
function InterfaceAction(heritage, properties, options) {
  const result = CanInstantiate(heritage) ? memory_exports.Update(InterfaceOperation(heritage, properties), {}, options) : InterfaceDeferred(heritage, properties, options);
  return result;
}
function InterfaceInstantiate(context, state, heritage, properties, options) {
  const instantiatedHeritage = InstantiateTypes(context, state, heritage);
  const instantiatedProperties = InstantiateProperties(context, state, properties);
  return InterfaceAction(instantiatedHeritage, instantiatedProperties, options);
}

// node_modules/typebox/build/type/action/interface.mjs
function InterfaceDeferred(heritage, properties, options = {}) {
  return Deferred("Interface", [heritage, properties], options);
}
function IsInterfaceDeferred(value) {
  return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "Interface");
}
function Interface(heritage, properties, options = {}) {
  return InterfaceAction(heritage, properties, options);
}

// node_modules/typebox/build/type/engine/cyclic/check.mjs
function FromRef(stack, context, ref) {
  return stack.includes(ref) ? true : FromType3([...stack, ref], context, context[ref]);
}
function FromProperties(stack, context, properties) {
  const types = PropertyValues(properties);
  return FromTypes2(stack, context, types);
}
function FromTypes2(stack, context, types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType3(stack, context, left) ? true : FromTypes2(stack, context, right), () => false);
}
function FromType3(stack, context, type) {
  return IsRef(type) ? FromRef(stack, context, type.$ref) : IsArray2(type) ? FromType3(stack, context, type.items) : IsConstructor2(type) ? FromTypes2(stack, context, [...type.parameters, type.instanceType]) : IsFunction2(type) ? FromTypes2(stack, context, [...type.parameters, type.returnType]) : IsInterfaceDeferred(type) ? FromProperties(stack, context, type.parameters[1]) : IsIntersect(type) ? FromTypes2(stack, context, type.allOf) : IsObject2(type) ? FromProperties(stack, context, type.properties) : IsUnion(type) ? FromTypes2(stack, context, type.anyOf) : IsTuple(type) ? FromTypes2(stack, context, type.items) : IsRecord(type) ? FromType3(stack, context, RecordValue(type)) : false;
}
function CyclicCheck(stack, context, type) {
  const result = FromType3(stack, context, type);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/candidates.mjs
function ResolveCandidateKeys(context, keys) {
  return keys.reduce((result, left) => {
    return CyclicCheck([left], context, context[left]) ? [...result, left] : result;
  }, []);
}
function CyclicCandidates(context) {
  const keys = PropertyKeys(context);
  const result = ResolveCandidateKeys(context, keys);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/dependencies.mjs
function FromRef2(context, ref, result) {
  return result.includes(ref) ? result : ref in context ? FromType4(context, context[ref], [...result, ref]) : Unreachable();
}
function FromProperties2(context, properties, result) {
  const types = PropertyValues(properties);
  return FromTypes3(context, types, result);
}
function FromTypes3(context, types, result) {
  return types.reduce((result2, left) => {
    return FromType4(context, left, result2);
  }, result);
}
function FromType4(context, type, result) {
  return IsRef(type) ? FromRef2(context, type.$ref, result) : IsArray2(type) ? FromType4(context, type.items, result) : IsConstructor2(type) ? FromTypes3(context, [...type.parameters, type.instanceType], result) : IsFunction2(type) ? FromTypes3(context, [...type.parameters, type.returnType], result) : IsInterfaceDeferred(type) ? FromProperties2(context, type.parameters[1], result) : IsIntersect(type) ? FromTypes3(context, type.allOf, result) : IsObject2(type) ? FromProperties2(context, type.properties, result) : IsUnion(type) ? FromTypes3(context, type.anyOf, result) : IsTuple(type) ? FromTypes3(context, type.items, result) : IsRecord(type) ? FromType4(context, RecordValue(type), result) : result;
}
function CyclicDependencies(context, key, type) {
  const result = FromType4(context, type, [key]);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/extends.mjs
function FromRef3(_ref) {
  return Any();
}
function FromProperties3(properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: FromType5(properties[key]) };
  }, {});
}
function FromTypes4(types) {
  return types.reduce((result, left) => {
    return [...result, FromType5(left)];
  }, []);
}
function FromType5(type) {
  return IsRef(type) ? FromRef3(type.$ref) : IsArray2(type) ? _Array_(FromType5(type.items), ArrayOptions(type)) : IsConstructor2(type) ? Constructor(FromTypes4(type.parameters), FromType5(type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes4(type.parameters), FromType5(type.returnType)) : IsIntersect(type) ? Intersect(FromTypes4(type.allOf)) : IsObject2(type) ? _Object_(FromProperties3(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType5(RecordValue(type))) : IsUnion(type) ? Union(FromTypes4(type.anyOf)) : IsTuple(type) ? Tuple(FromTypes4(type.items)) : type;
}
function CyclicAnyFromParameters(defs, ref) {
  return ref in defs ? FromType5(defs[ref]) : Unknown();
}
function CyclicExtends(type) {
  return CyclicAnyFromParameters(type.$defs, type.$ref);
}

// node_modules/typebox/build/type/engine/cyclic/instantiate.mjs
function CyclicInterface(context, heritage, properties) {
  const instantiatedHeritage = InstantiateTypes(context, State([], []), heritage);
  const instantiatedProperties = InstantiateProperties({}, State([], []), properties);
  const evaluatedInterface = EvaluateIntersect([...instantiatedHeritage, _Object_(instantiatedProperties)]);
  return evaluatedInterface;
}
function CyclicDefinitions(context, dependencies) {
  const keys = guard_exports.Keys(context).filter((key) => dependencies.includes(key));
  return keys.reduce((result, key) => {
    const type = context[key];
    const instantiatedType = IsInterfaceDeferred(type) ? CyclicInterface(context, type.parameters[0], type.parameters[1]) : type;
    return { ...result, [key]: instantiatedType };
  }, {});
}
function InstantiateCyclic(context, ref, type) {
  const dependencies = CyclicDependencies(context, ref, type);
  const definitions = CyclicDefinitions(context, dependencies);
  const result = Cyclic(definitions, ref);
  return result;
}

// node_modules/typebox/build/type/engine/cyclic/target.mjs
function Resolve(defs, ref) {
  return ref in defs ? IsRef(defs[ref]) ? Resolve(defs, defs[ref].$ref) : defs[ref] : Never();
}
function CyclicTarget(defs, ref) {
  const result = Resolve(defs, ref);
  return result;
}

// node_modules/typebox/build/type/extends/extends.mjs
function Canonical(type) {
  return IsCyclic(type) ? CyclicExtends(type) : IsUnsafe(type) ? Unknown() : type;
}
function Extends(inferred, left, right) {
  const canonicalLeft = Canonical(left);
  const canonicalRight = Canonical(right);
  return ExtendsLeft(inferred, canonicalLeft, canonicalRight);
}

// node_modules/typebox/build/type/engine/evaluate/compare.mjs
var ResultEqual = "equal";
var ResultDisjoint = "disjoint";
var ResultLeftInside = "left-inside";
var ResultRightInside = "right-inside";
function Compare(left, right) {
  const extendsCheck = [
    IsUnknown(left) ? result_exports.ExtendsFalse() : Extends({}, left, right),
    IsUnknown(left) ? result_exports.ExtendsTrue({}) : Extends({}, right, left)
  ];
  return result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? ResultEqual : result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsFalse(extendsCheck[1]) ? ResultLeftInside : result_exports.IsExtendsFalse(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? ResultRightInside : ResultDisjoint;
}

// node_modules/typebox/build/type/engine/evaluate/broaden.mjs
function BroadFilter(type, types) {
  return types.filter((left) => {
    return Compare(type, left) === ResultRightInside ? false : true;
  });
}
function IsBroadestType(type, types) {
  const result = types.some((left) => {
    const result2 = Compare(type, left);
    return guard_exports.IsEqual(result2, ResultLeftInside) || guard_exports.IsEqual(result2, ResultEqual);
  });
  return guard_exports.IsEqual(result, false);
}
function BroadenType(type, types) {
  const evaluated = EvaluateType(type);
  return IsAny(evaluated) ? [evaluated] : IsBroadestType(evaluated, types) ? [...BroadFilter(evaluated, types), evaluated] : types;
}
function BroadenTypes(types) {
  return types.reduce((result, left) => {
    return IsObject2(left) ? [...result, left] : (
      // push
      IsNever(left) ? result : (
        // ignore
        BroadenType(left, result)
      )
    );
  }, []);
}
function Broaden(types) {
  const broadened = BroadenTypes(types);
  const flattened = Flatten(broadened);
  return flattened;
}

// node_modules/typebox/build/type/engine/evaluate/instantiate.mjs
function EvaluateAction(type, options) {
  const result = memory_exports.Update(EvaluateType(type), {}, options);
  return result;
}
function EvaluateInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return EvaluateAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/call/distribute_arguments.mjs
function CollectDistributionNames(expression, result = []) {
  return (
    // Conditional
    IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? IsRef(expression.parameters[0]) ? CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], [...result, expression.parameters[0]["$ref"]])) : CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], result)) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? IsDeferred(expression.parameters[1]) && guard_exports.IsEqual(expression.parameters[1].action, "KeyOf") && IsRef(expression.parameters[1].parameters[0]) ? [...result, expression.parameters[1].parameters[0]["$ref"]] : result : result
  );
}
function BuildDistributionArray(parameters, names) {
  return parameters.reduce((result, left) => [...result, names.includes(left.name)], []);
}
function ZipDistributionArray(arguments_, distributionArray, result = []) {
  return guard_exports.ShiftLeft(arguments_, (argumentLeft, argumentRight) => guard_exports.ShiftLeft(distributionArray, (booleanLeft, booleanRight) => ZipDistributionArray(argumentRight, booleanRight, [...result, [booleanLeft, argumentLeft]]), () => result), () => result);
}
function Expand(type) {
  return IsUnion(type) ? [...type.anyOf] : [type];
}
function Append(current, type) {
  return current.reduce((result, left) => [...result, [...left, type]], []);
}
function Cross(current, variants) {
  return variants.reduce((result, left) => {
    return [...result, ...Append(current, left)];
  }, []);
}
function Distribute2(zipped) {
  return zipped.reduce((result, left) => {
    return guard_exports.IsEqual(left[0], true) ? Cross(result, Expand(left[1])) : Cross(result, [left[1]]);
  }, [[]]);
}
function DistributeArguments(parameters, arguments_, expression) {
  const distributionNames = CollectDistributionNames(expression);
  const distributionArray = BuildDistributionArray(parameters, distributionNames);
  const zippedArguments = ZipDistributionArray(arguments_, distributionArray);
  return IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? Distribute2(zippedArguments) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? Distribute2(zippedArguments) : [arguments_];
}

// node_modules/typebox/build/type/engine/call/resolve_target.mjs
function FromNotResolvable() {
  return ["(not-resolvable)", Never()];
}
function FromNotGeneric() {
  return ["(not-generic)", Never()];
}
function FromGeneric(name, parameters, expression) {
  return [name, Generic(parameters, expression)];
}
function FromRef4(context, ref, arguments_) {
  return ref in context ? FromType6(context, ref, context[ref], arguments_) : FromNotResolvable();
}
function FromType6(context, name, target, arguments_) {
  return IsGeneric(target) ? FromGeneric(name, target.parameters, target.expression) : IsRef(target) ? FromRef4(context, target.$ref, arguments_) : FromNotGeneric();
}
function ResolveTarget(context, target, arguments_) {
  return FromType6(context, "(anonymous)", target, arguments_);
}

// node_modules/typebox/build/type/engine/call/resolve_arguments.mjs
function AssertArgumentExtends(name, type, extends_) {
  if (IsInfer(type) || IsCall(type) || result_exports.IsExtendsTrueLike(Extends({}, type, extends_)))
    return;
  const cause = { parameter: name, expect: extends_, actual: type };
  throw new Error(`Argument for parameter ${name} does not satisfy constraint`, { cause });
}
function BindArgument(context, state, name, extends_, type) {
  const instantiatedArgument = InstantiateType(context, state, type);
  AssertArgumentExtends(name, instantiatedArgument, extends_);
  return memory_exports.Assign(context, { [name]: instantiatedArgument });
}
function BindArguments(context, state, parameterLeft, parameterRight, arguments_) {
  const instantiatedExtends = InstantiateType(context, state, parameterLeft.extends);
  const instantiatedEquals = InstantiateType(context, state, parameterLeft.equals);
  return guard_exports.ShiftLeft(arguments_, (left, right) => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, left), state, parameterRight, right), () => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, instantiatedEquals), state, parameterRight, []));
}
function BindParameters(context, state, parameters, arguments_) {
  return guard_exports.ShiftLeft(parameters, (left, right) => BindArguments(context, state, left, right, arguments_), () => context);
}
function ResolveArgumentsContext(context, state, parameters, arguments_) {
  return BindParameters(context, state, parameters, arguments_);
}

// node_modules/typebox/build/type/engine/call/instantiate.mjs
function Peek(state) {
  const result = guard_exports.IsGreaterThan(state.callstack.length, 0) ? state.callstack[state.callstack.length - 1] : "";
  return result;
}
function IsTailCall(state, name) {
  const result = guard_exports.IsEqual(Peek(state), name);
  return result;
}
function CallDispatch(context, state, target, parameters, expression, arguments_) {
  const argumentsContext = ResolveArgumentsContext(context, state, parameters, arguments_);
  const returnType = InstantiateType(argumentsContext, State([...state["callstack"], target["$ref"]], state["visited"]), expression);
  return InstantiateType(argumentsContext, State([], []), returnType);
}
function CallDistributed(context, state, target, parameters, expression, distributedArguments) {
  return distributedArguments.reduce((result, arguments_) => [...result, CallDispatch(context, state, target, parameters, expression, arguments_)], []);
}
function CallImmediate(context, state, target, parameters, expression, arguments_) {
  const distributedArguments = DistributeArguments(parameters, arguments_, expression);
  const returnTypes = CallDistributed(context, state, target, parameters, expression, distributedArguments);
  const result = guard_exports.IsEqual(returnTypes.length, 1) ? returnTypes[0] : EvaluateUnion(returnTypes);
  return result;
}
function CallInstantiate(context, state, target, arguments_) {
  const instantiatedArguments = InstantiateTypes(context, state, arguments_);
  const resolved = ResolveTarget(context, target, arguments_);
  const name = resolved[0];
  const type = resolved[1];
  const result = IsGeneric(type) ? IsTailCall(state, name) ? CallConstruct(Ref(name), instantiatedArguments) : CallImmediate(context, state, Ref(name), type.parameters, type.expression, instantiatedArguments) : CallConstruct(target, instantiatedArguments);
  return result;
}

// node_modules/typebox/build/type/types/call.mjs
function CallConstruct(target, arguments_) {
  return memory_exports.Create({ ["~kind"]: "Call" }, { type: "call", target, arguments: arguments_ }, {});
}
function Call(target, arguments_) {
  return CallInstantiate({}, State([], []), target, arguments_);
}
function IsCall(value) {
  return IsKind(value, "Call");
}

// node_modules/typebox/build/type/engine/immutable/instantiate_remove.mjs
function RemoveImmutableOperation(type) {
  return memory_exports.Discard(type, ["~immutable"]);
}
function RemoveImmutableAction(type, options) {
  const result = memory_exports.Update(RemoveImmutableOperation(type), {}, options);
  return result;
}
function RemoveImmutableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveImmutableAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/intrinsics/mapping.mjs
function ApplyMapping(mapping, value) {
  return mapping(value);
}

// node_modules/typebox/build/type/engine/intrinsics/from_literal.mjs
function FromLiteral3(mapping, value) {
  return guard_exports.IsString(value) ? Literal(ApplyMapping(mapping, value)) : Literal(value);
}

// node_modules/typebox/build/type/engine/intrinsics/from_template_literal.mjs
function FromTemplateLiteral(mapping, pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType7(mapping, evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/intrinsics/from_union.mjs
function FromUnion2(mapping, types) {
  const result = types.map((type) => FromType7(mapping, type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/intrinsics/from_type.mjs
function FromType7(mapping, type) {
  return IsLiteral(type) ? FromLiteral3(mapping, type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral(mapping, type.pattern) : IsUnion(type) ? FromUnion2(mapping, type.anyOf) : type;
}

// node_modules/typebox/build/type/action/capitalize.mjs
function CapitalizeDeferred(type, options = {}) {
  return Deferred("Capitalize", [type], options);
}
function Capitalize(type, options = {}) {
  return CapitalizeAction(type, options);
}

// node_modules/typebox/build/type/action/lowercase.mjs
function LowercaseDeferred(type, options = {}) {
  return Deferred("Lowercase", [type], options);
}
function Lowercase(type, options = {}) {
  return LowercaseAction(type, options);
}

// node_modules/typebox/build/type/action/uncapitalize.mjs
function UncapitalizeDeferred(type, options = {}) {
  return Deferred("Uncapitalize", [type], options);
}
function Uncapitalize(type, options = {}) {
  return UncapitalizeAction(type, options);
}

// node_modules/typebox/build/type/action/uppercase.mjs
function UppercaseDeferred(type, options = {}) {
  return Deferred("Uppercase", [type], options);
}
function Uppercase(type, options = {}) {
  return UppercaseAction(type, options);
}

// node_modules/typebox/build/type/engine/intrinsics/instantiate.mjs
var CapitalizeMapping = (input) => input[0].toUpperCase() + input.slice(1);
var LowercaseMapping = (input) => input.toLowerCase();
var UncapitalizeMapping = (input) => input[0].toLowerCase() + input.slice(1);
var UppercaseMapping = (input) => input.toUpperCase();
function CapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(CapitalizeMapping, type), {}, options) : CapitalizeDeferred(type, options);
  return result;
}
function LowercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(LowercaseMapping, type), {}, options) : LowercaseDeferred(type, options);
  return result;
}
function UncapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UncapitalizeMapping, type), {}, options) : UncapitalizeDeferred(type, options);
  return result;
}
function UppercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UppercaseMapping, type), {}, options) : UppercaseDeferred(type, options);
  return result;
}
function CapitalizeInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return CapitalizeAction(instantiatedType, options);
}
function LowercaseInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return LowercaseAction(instantiatedType, options);
}
function UncapitalizeInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return UncapitalizeAction(instantiatedType, options);
}
function UppercaseInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return UppercaseAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/conditional.mjs
function ConditionalDeferred(left, right, true_, false_, options = {}) {
  return Deferred("Conditional", [left, right, true_, false_], options);
}
function Conditional(left, right, true_, false_, options = {}) {
  return ConditionalAction({}, State([], []), left, right, true_, false_, options);
}

// node_modules/typebox/build/type/engine/conditional/instantiate.mjs
function ConditionalOperation(context, state, left, right, true_, false_) {
  const extendsResult = Extends(context, left, right);
  return result_exports.IsExtendsUnion(extendsResult) ? Union([InstantiateType(extendsResult.inferred, state, true_), InstantiateType(context, state, false_)]) : result_exports.IsExtendsTrue(extendsResult) ? InstantiateType(extendsResult.inferred, state, true_) : InstantiateType(context, state, false_);
}
function ConditionalAction(context, state, left, right, true_, false_, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ConditionalOperation(context, state, left, right, true_, false_), {}, options) : ConditionalDeferred(left, right, true_, false_, options);
  return result;
}
function ConditionalInstantiate(context, state, left, right, true_, false_, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ConditionalAction(context, state, instantiatedLeft, instantiatedRight, true_, false_, options);
}

// node_modules/typebox/build/type/action/constructor_parameters.mjs
function ConstructorParametersDeferred(type, options = {}) {
  return Deferred("ConstructorParameters", [type], options);
}
function ConstructorParameters(type, options = {}) {
  return ConstructorParametersAction(type, options);
}

// node_modules/typebox/build/type/engine/constructor_parameters/instantiate.mjs
function ConstructorParametersOperation(type) {
  const parameters = IsConstructor2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ConstructorParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ConstructorParametersOperation(type), {}, options) : ConstructorParametersDeferred(type, options);
  return result;
}
function ConstructorParametersInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ConstructorParametersAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/exclude.mjs
function ExcludeDeferred(left, right, options = {}) {
  return Deferred("Exclude", [left, right], options);
}
function Exclude(left, right, options = {}) {
  return ExcludeAction(left, right, options);
}

// node_modules/typebox/build/type/engine/exclude/instantiate.mjs
function ExcludeAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExcludeOperation(left, right), {}, options) : ExcludeDeferred(left, right, options);
  return result;
}
function ExcludeInstantiate(context, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExcludeAction(instantiatedLeft, instantiatedRight, options);
}

// node_modules/typebox/build/type/action/extract.mjs
function ExtractDeferred(left, right, options = {}) {
  return Deferred("Extract", [left, right], options);
}
function Extract(left, right, options = {}) {
  return ExtractAction(left, right, options);
}

// node_modules/typebox/build/type/engine/extract/operation.mjs
function ExtractType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [left] : [];
  return result;
}
function ExtractUnion(types, right) {
  return types.reduce((result, head) => {
    return [...result, ...ExtractType(head, right)];
  }, []);
}
function ExtractOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExtractUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/typebox/build/type/engine/extract/instantiate.mjs
function ExtractAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExtractOperation(left, right), {}, options) : ExtractDeferred(left, right, options);
  return result;
}
function ExtractInstantiate(context, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExtractAction(instantiatedLeft, instantiatedRight, options);
}

// node_modules/typebox/build/type/engine/helpers/keys_to_indexer.mjs
function KeysToLiterals(keys) {
  return keys.reduce((result, left) => {
    return IsLiteralValue(left) ? [...result, Literal(left)] : result;
  }, []);
}
function KeysToIndexer(keys) {
  const literals = KeysToLiterals(keys);
  const result = Union(literals);
  return result;
}

// node_modules/typebox/build/type/action/indexed.mjs
function IndexDeferred(type, indexer, options = {}) {
  return Deferred("Index", [type, indexer], options);
}
function Index(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return IndexAction(type, indexer, options);
}

// node_modules/typebox/build/type/engine/object/from_cyclic.mjs
function FromCyclic(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType8(target);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_dependent.mjs
function FromDependent(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType8(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_intersect.mjs
function CollapseIntersectProperties(left, right) {
  const leftKeys = guard_exports.Keys(left).filter((key) => !guard_exports.HasPropertyKey(right, key));
  const rightKeys = guard_exports.Keys(right).filter((key) => !guard_exports.HasPropertyKey(left, key));
  const sharedKeys = guard_exports.Keys(left).filter((key) => guard_exports.HasPropertyKey(right, key));
  const leftProperties = leftKeys.reduce((result, key) => ({ ...result, [key]: left[key] }), {});
  const rightProperties = rightKeys.reduce((result, key) => ({ ...result, [key]: right[key] }), {});
  const sharedProperties = sharedKeys.reduce((result, key) => ({ ...result, [key]: EvaluateIntersect([left[key], right[key]]) }), {});
  const unique = memory_exports.Assign(leftProperties, rightProperties);
  const shared = memory_exports.Assign(unique, sharedProperties);
  return shared;
}
function FromIntersect(types) {
  return types.reduce((result, left) => {
    return CollapseIntersectProperties(result, FromType8(left));
  }, {});
}

// node_modules/typebox/build/type/engine/object/from_object.mjs
function FromObject4(properties) {
  return properties;
}

// node_modules/typebox/build/type/engine/object/from_tuple.mjs
function FromTuple(types) {
  const object = TupleToObject(Tuple(types));
  const result = FromType8(object);
  return result;
}

// node_modules/typebox/build/type/engine/object/from_union.mjs
function CollapseUnionProperties(left, right) {
  const sharedKeys = guard_exports.Keys(left).filter((key) => key in right);
  const result = sharedKeys.reduce((result2, key) => {
    return { ...result2, [key]: EvaluateUnion([left[key], right[key]]) };
  }, {});
  return result;
}
function ReduceVariants(types, result) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, CollapseUnionProperties(result, FromType8(left))), () => result);
}
function FromUnion3(types) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, FromType8(left)), () => Unreachable());
}

// node_modules/typebox/build/type/engine/object/from_type.mjs
function FromType8(type) {
  return IsCyclic(type) ? FromCyclic(type.$defs, type.$ref) : IsDependent(type) ? FromDependent(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect(type.allOf) : IsUnion(type) ? FromUnion3(type.anyOf) : IsTuple(type) ? FromTuple(type.items) : IsObject2(type) ? FromObject4(type.properties) : {};
}

// node_modules/typebox/build/type/engine/object/collapse.mjs
function CollapseToObject(type) {
  const properties = FromType8(type);
  const result = _Object_(properties);
  return result;
}

// node_modules/typebox/build/type/engine/helpers/keys.mjs
var integerKeyPattern = new RegExp("^(?:0|[1-9][0-9]*)$");
function ConvertToIntegerKey(value) {
  const normal = `${value}`;
  return integerKeyPattern.test(normal) ? parseInt(normal) : value;
}

// node_modules/typebox/build/type/engine/indexed/from_array.mjs
function NormalizeLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function NormalizeIndexerTypes(types) {
  return types.map((type) => NormalizeIndexer(type));
}
function NormalizeIndexer(type) {
  return IsIntersect(type) ? Intersect(NormalizeIndexerTypes(type.allOf)) : IsUnion(type) ? Union(NormalizeIndexerTypes(type.anyOf)) : IsLiteral(type) ? NormalizeLiteral(type.const) : type;
}
function FromArray3(type, indexer) {
  const normalizedIndexer = NormalizeIndexer(indexer);
  const check = Extends({}, normalizedIndexer, Number2());
  const result = (
    // indexer
    result_exports.IsExtendsTrueLike(check) ? type : IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Number2() : Never()
  );
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_cyclic.mjs
function FromCyclic2(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType9(target);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_dependent.mjs
function FromDependent2(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_enum.mjs
function FromEnum(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_intersect.mjs
function FromIntersect2(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_literal.mjs
function FromLiteral4(value) {
  const result = [`${value}`];
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_template_literal.mjs
function FromTemplateLiteral2(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/indexable/from_union.mjs
function FromUnion4(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType9(left)];
  }, []);
}

// node_modules/typebox/build/type/engine/indexable/from_type.mjs
function FromType9(type) {
  return IsCyclic(type) ? FromCyclic2(type.$defs, type.$ref) : IsDependent(type) ? FromDependent2(type.if, type.then, type.else) : IsEnum(type) ? FromEnum(type.enum) : IsIntersect(type) ? FromIntersect2(type.allOf) : IsLiteral(type) ? FromLiteral4(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral2(type.pattern) : IsUnion(type) ? FromUnion4(type.anyOf) : [];
}

// node_modules/typebox/build/type/engine/indexable/to_indexable_keys.mjs
function ToIndexableKeys(type) {
  const result = FromType9(type);
  return result;
}

// node_modules/typebox/build/type/engine/this/expand_this.mjs
function FromTypes5(properties, types) {
  return types.map((type) => FromType10(properties, type));
}
function FromType10(properties, type) {
  return IsArray2(type) ? _Array_(FromType10(properties, type.items)) : IsConstructor2(type) ? Constructor(FromTypes5(properties, type.parameters), FromType10(properties, type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes5(properties, type.parameters), FromType10(properties, type.returnType)) : IsTuple(type) ? Tuple(FromTypes5(properties, type.items)) : IsUnion(type) ? Union(FromTypes5(properties, type.anyOf)) : IsIntersect(type) ? Intersect(FromTypes5(properties, type.allOf)) : IsThis(type) ? _Object_(properties) : type;
}
function ExpandThis(properties, type) {
  const result = FromType10(properties, type);
  return result;
}

// node_modules/typebox/build/type/engine/indexed/from_object.mjs
function IndexProperty(properties, key) {
  const selectedType = key in properties ? properties[key] : Never();
  const result = ExpandThis(properties, selectedType);
  return result;
}
function IndexProperties(properties, keys) {
  return keys.reduce((result, left) => {
    return [...result, IndexProperty(properties, left)];
  }, []);
}
function FromIndexer(properties, indexer) {
  const keys = ToIndexableKeys(indexer);
  const variants = IndexProperties(properties, keys);
  const result = EvaluateUnion(variants);
  return result;
}
var NumericKeyPattern = new RegExp(IntegerKey);
function NumericKeys(keys) {
  const result = keys.filter((key) => NumericKeyPattern.test(key));
  return result;
}
function FromIndexerNumber(properties) {
  const keys = PropertyKeys(properties);
  const numericKeys = NumericKeys(keys);
  const variants = IndexProperties(properties, numericKeys);
  const result = EvaluateUnion(variants);
  return result;
}
function FromObject5(properties, indexer) {
  const result = IsNumber3(indexer) ? FromIndexerNumber(properties) : FromIndexer(properties, indexer);
  return result;
}

// node_modules/typebox/build/type/engine/indexed/array_indexer.mjs
function ConvertLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function ArrayIndexerTypes(types) {
  return types.map((type) => FormatArrayIndexer(type));
}
function FormatArrayIndexer(type) {
  return IsIntersect(type) ? Intersect(ArrayIndexerTypes(type.allOf)) : IsUnion(type) ? Union(ArrayIndexerTypes(type.anyOf)) : IsLiteral(type) ? ConvertLiteral(type.const) : type;
}

// node_modules/typebox/build/type/engine/indexed/from_tuple.mjs
function IndexElementsWithIndexer(types, indexer) {
  return types.reduceRight((result, right, index) => {
    const check = Extends({}, Literal(index), indexer);
    return result_exports.IsExtendsTrueLike(check) ? [right, ...result] : result;
  }, []);
}
function FromTupleWithIndexer(types, indexer) {
  const formattedArrayIndexer = FormatArrayIndexer(indexer);
  const elements = IndexElementsWithIndexer(types, formattedArrayIndexer);
  return EvaluateUnionFast(elements);
}
function FromTupleWithoutIndexer(types) {
  return EvaluateUnionFast(types);
}
function FromTuple2(types, indexer) {
  return (
    // length (intrinsic)
    IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Literal(types.length) : IsNumber3(indexer) || IsInteger2(indexer) ? FromTupleWithoutIndexer(types) : FromTupleWithIndexer(types, indexer)
  );
}

// node_modules/typebox/build/type/engine/indexed/from_type.mjs
function FromType11(type, indexer) {
  return IsArray2(type) ? FromArray3(type.items, indexer) : IsObject2(type) ? FromObject5(type.properties, indexer) : IsTuple(type) ? FromTuple2(type.items, indexer) : Never();
}

// node_modules/typebox/build/type/engine/indexed/instantiate.mjs
function NormalizeType(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function IndexAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType11(NormalizeType(type), indexer), {}, options) : IndexDeferred(type, indexer, options);
  return result;
}
function IndexInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return IndexAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/typebox/build/type/action/instance_type.mjs
function InstanceTypeDeferred(type, options = {}) {
  return Deferred("InstanceType", [type], options);
}
function InstanceType(type, options = {}) {
  return InstanceTypeAction(type, options);
}

// node_modules/typebox/build/type/engine/instance_type/instantiate.mjs
function InstanceTypeOperation(type) {
  return IsConstructor2(type) ? type["instanceType"] : Never();
}
function InstanceTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(InstanceTypeOperation(type), {}, options) : InstanceTypeDeferred(type, options);
  return result;
}
function InstanceTypeInstantiate(context, state, type, options = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return InstanceTypeAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/keyof.mjs
function KeyOfDeferred(type, options = {}) {
  return Deferred("KeyOf", [type], options);
}
function KeyOf2(type, options = {}) {
  return KeyOfAction(type, options);
}

// node_modules/typebox/build/type/engine/keyof/from_any.mjs
function FromAny() {
  return Union([Number2(), String2(), Symbol2()]);
}

// node_modules/typebox/build/type/engine/keyof/from_array.mjs
function FromArray4(_type) {
  return Number2();
}

// node_modules/typebox/build/type/engine/keyof/from_object.mjs
function FromPropertyKeys(keys) {
  const result = keys.reduce((result2, left) => {
    return IsLiteralValue(left) ? [...result2, Literal(ConvertToIntegerKey(left))] : Unreachable();
  }, []);
  return result;
}
function FromObject6(properties) {
  const propertyKeys = guard_exports.Keys(properties);
  const variants = FromPropertyKeys(propertyKeys);
  const result = EvaluateUnionFast(variants);
  return result;
}

// node_modules/typebox/build/type/engine/keyof/from_record.mjs
function FromRecord2(type) {
  return RecordKey(type);
}

// node_modules/typebox/build/type/engine/keyof/from_tuple.mjs
function FromTuple3(types) {
  const result = types.map((_, index) => Literal(index));
  return EvaluateUnionFast(result);
}

// node_modules/typebox/build/type/engine/keyof/from_type.mjs
function FromType12(type) {
  return IsAny(type) ? FromAny() : IsArray2(type) ? FromArray4(type.items) : IsObject2(type) ? FromObject6(type.properties) : IsRecord(type) ? FromRecord2(type) : IsTuple(type) ? FromTuple3(type.items) : Never();
}

// node_modules/typebox/build/type/engine/keyof/instantiate.mjs
function NormalizeType2(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function KeyOfAction(type, options) {
  return CanInstantiate([type]) ? memory_exports.Update(FromType12(NormalizeType2(type)), {}, options) : KeyOfDeferred(type, options);
}
function KeyOfInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return KeyOfAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/mapped.mjs
function MappedDeferred(identifier, type, as, property, options = {}) {
  return Deferred("Mapped", [identifier, type, as, property], options);
}
function Mapped(identifier, type, as, property, options = {}) {
  return MappedAction({}, State([], []), identifier, type, as, property, options);
}

// node_modules/typebox/build/type/engine/mapped/mapped_variants.mjs
function FromTemplateLiteral3(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType13(evaluated);
  return result;
}
function FromUnion5(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType13(left)];
  }, []);
}
function FromEnum2(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType13(evaluated);
  return result;
}
function FromLiteral5(value) {
  const result = guard_exports.IsNumber(value) ? [Literal(`${value}`)] : [Literal(value)];
  return result;
}
function FromType13(type) {
  const result = IsEnum(type) ? FromEnum2(type.enum) : IsLiteral(type) ? FromLiteral5(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral3(type.pattern) : IsUnion(type) ? FromUnion5(type.anyOf) : [type];
  return result;
}
function MappedVariants(type) {
  const result = FromType13(type);
  return result;
}

// node_modules/typebox/build/type/engine/mapped/mapped_operation.mjs
function CanonicalAs(instantiatedAs) {
  const result = IsTemplateLiteral(instantiatedAs) ? EvaluateTemplateLiteral(instantiatedAs.pattern) : instantiatedAs;
  return result;
}
function MappedVariant(context, state, identifier, variant, as, property) {
  const variantContext = memory_exports.Assign(context, { [identifier["name"]]: variant });
  const instantiatedAs = InstantiateType(variantContext, state, as);
  const canonicalAs = CanonicalAs(instantiatedAs);
  const instantiatedProperty = InstantiateType(variantContext, state, property);
  return IsLiteralNumber(canonicalAs) || IsLiteralString(canonicalAs) ? { [canonicalAs.const]: instantiatedProperty } : {};
}
function MappedProperties(context, state, identifier, variants, as, property) {
  return variants.reduce((result, left) => {
    return [...result, MappedVariant(context, state, identifier, left, as, property)];
  }, []);
}
function MappedObjects(properties) {
  return properties.reduce((result, left) => {
    return [...result, _Object_(left)];
  }, []);
}
function MappedOperation(context, state, identifier, type, as, property) {
  const variants = MappedVariants(type);
  const mappedProperties = MappedProperties(context, state, identifier, variants, as, property);
  const mappedObjects = MappedObjects(mappedProperties);
  const result = EvaluateIntersect(mappedObjects);
  return result;
}

// node_modules/typebox/build/type/engine/mapped/instantiate.mjs
function MappedAction(context, state, identifier, type, as, property, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(MappedOperation(context, state, identifier, type, as, property), {}, options) : MappedDeferred(identifier, type, as, property, options);
  return result;
}
function MappedInstantiate(context, state, identifier, type, as, property, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return MappedAction(context, state, identifier, instantiatedType, as, property, options);
}

// node_modules/typebox/build/type/engine/module/instantiate.mjs
function InstantiateCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateCyclic(declarationContext, key, declarations[key]) };
  }, {});
}
function InstantiateNonCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => !cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateType(declarationContext, State([], []), declarations[key]) };
  }, {});
}
function InstantiateModule(context, declarations, options) {
  const cyclicCandidates = CyclicCandidates(declarations);
  const instantiatedCyclics = InstantiateCyclics(context, declarations, cyclicCandidates);
  const instantiatedNonCyclics = InstantiateNonCyclics(context, declarations, cyclicCandidates);
  const instantiatedModule = { ...instantiatedCyclics, ...instantiatedNonCyclics };
  return memory_exports.Update(instantiatedModule, {}, options);
}
function ModuleInstantiate(context, _state, declarations, options) {
  const instantiatedModule = InstantiateModule(context, declarations, options);
  return instantiatedModule;
}

// node_modules/typebox/build/type/action/non_nullable.mjs
function NonNullableDeferred(type, options = {}) {
  return Deferred("NonNullable", [type], options);
}
function NonNullable(type, options = {}) {
  return NonNullableAction(type, options);
}

// node_modules/typebox/build/type/engine/non_nullable/instantiate.mjs
function NonNullableOperation(type) {
  const excluded = Union([Null(), Undefined()]);
  return ExcludeAction(type, excluded, {});
}
function NonNullableAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(NonNullableOperation(type), {}, options) : NonNullableDeferred(type, options);
  return result;
}
function NonNullableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return NonNullableAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/omit.mjs
function OmitDeferred(type, indexer, options = {}) {
  return Deferred("Omit", [type, indexer], options);
}
function Omit(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return OmitAction(type, indexer, options);
}

// node_modules/typebox/build/type/engine/indexable/to_indexable.mjs
function ToIndexable(type) {
  const collapsed = CollapseToObject(type);
  const result = IsObject2(collapsed) ? collapsed.properties : Unreachable();
  return result;
}

// node_modules/typebox/build/type/engine/omit/from_type.mjs
function FromKeys(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? result2 : { ...result2, [key]: properties[key] };
  }, {});
  return result;
}
function FromType14(type, indexer) {
  const indexable = ToIndexable(type);
  const indexableKeys = ToIndexableKeys(indexer);
  const omitted = FromKeys(indexable, indexableKeys);
  const result = _Object_(omitted);
  return result;
}

// node_modules/typebox/build/type/engine/omit/instantiate.mjs
function OmitAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType14(type, indexer), {}, options) : OmitDeferred(type, indexer, options);
  return result;
}
function OmitInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return OmitAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/typebox/build/type/action/parameters.mjs
function ParametersDeferred(type, options = {}) {
  return Deferred("Parameters", [type], options);
}
function Parameters(type, options = {}) {
  return ParametersAction(type, options);
}

// node_modules/typebox/build/type/engine/parameters/instantiate.mjs
function ParametersOperation(type) {
  const parameters = IsFunction2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ParametersOperation(type), {}, options) : ParametersDeferred(type, options);
  return result;
}
function ParametersInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ParametersAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/partial.mjs
function PartialDeferred(type, options = {}) {
  return Deferred("Partial", [type], options);
}
function Partial(type, options = {}) {
  return PartialAction(type, options);
}

// node_modules/typebox/build/type/engine/partial/from_cyclic.mjs
function FromCyclic3(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType15(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_dependent.mjs
function FromDependent3(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_intersect.mjs
function FromIntersect3(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_union.mjs
function FromUnion6(types) {
  const result = types.map((type) => FromType15(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/partial/from_object.mjs
function FromObject7(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/partial/from_type.mjs
function FromType15(type) {
  return IsCyclic(type) ? FromCyclic3(type.$defs, type.$ref) : IsDependent(type) ? FromDependent3(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect3(type.allOf) : IsUnion(type) ? FromUnion6(type.anyOf) : IsObject2(type) ? FromObject7(type.properties) : _Object_({});
}

// node_modules/typebox/build/type/engine/partial/instantiate.mjs
function PartialAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType15(type), {}, options) : PartialDeferred(type, options);
  return result;
}
function PartialInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return PartialAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/pick.mjs
function PickDeferred(type, indexer, options = {}) {
  return Deferred("Pick", [type, indexer], options);
}
function Pick(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return PickAction(type, indexer, options);
}

// node_modules/typebox/build/type/engine/pick/from_type.mjs
function FromKeys2(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? memory_exports.Assign(result2, { [key]: properties[key] }) : result2;
  }, {});
  return result;
}
function FromType16(type, indexer) {
  const indexable = ToIndexable(type);
  const keys = ToIndexableKeys(indexer);
  const applied = FromKeys2(indexable, keys);
  const result = _Object_(applied);
  return result;
}

// node_modules/typebox/build/type/engine/pick/instantiate.mjs
function PickAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType16(type, indexer), {}, options) : PickDeferred(type, indexer, options);
  return result;
}
function PickInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return PickAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/typebox/build/type/action/readonly_object.mjs
function ReadonlyObjectDeferred(type, options = {}) {
  return Deferred("ReadonlyObject", [type], options);
}
function ReadonlyObject(type, options = {}) {
  return ReadonlyObjectAction(type, options);
}
var ReadonlyType = ReadonlyObject;

// node_modules/typebox/build/type/engine/readonly_object/from_array.mjs
function FromArray5(type) {
  const result = AddImmutable(_Array_(type));
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_cyclic.mjs
function FromCyclic4(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType17(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_dependent.mjs
function FromDependent4(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_intersect.mjs
function FromIntersect4(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_object.mjs
function FromObject8(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddReadonly(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_tuple.mjs
function FromTuple4(types) {
  const result = AddImmutable(Tuple(types));
  return result;
}

// node_modules/typebox/build/type/engine/readonly_object/from_union.mjs
function FromUnion7(types) {
  const result = types.map((type) => FromType17(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/readonly_object/from_type.mjs
function FromType17(type) {
  return IsArray2(type) ? FromArray5(type.items) : IsCyclic(type) ? FromCyclic4(type.$defs, type.$ref) : IsDependent(type) ? FromDependent4(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect4(type.allOf) : IsObject2(type) ? FromObject8(type.properties) : IsTuple(type) ? FromTuple4(type.items) : IsUnion(type) ? FromUnion7(type.anyOf) : type;
}

// node_modules/typebox/build/type/engine/readonly_object/instantiate.mjs
function ReadonlyObjectAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType17(type), {}, options) : ReadonlyObjectDeferred(type);
  return result;
}
function ReadonlyObjectInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReadonlyObjectAction(instantiatedType, options);
}

// node_modules/typebox/build/type/engine/ref/instantiate.mjs
function RefInstantiate(context, state, type, ref) {
  return state.visited.includes(ref) ? type : ref in context ? InstantiateType(context, State(state["callstack"], [...state["visited"], ref]), context[ref]) : type;
}

// node_modules/typebox/build/type/engine/required/from_cyclic.mjs
function FromCyclic5(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType18(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_dependent.mjs
function FromDependent5(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_intersect.mjs
function FromIntersect5(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_union.mjs
function FromUnion8(types) {
  const result = types.map((type) => FromType18(type));
  return Union(result);
}

// node_modules/typebox/build/type/engine/required/from_object.mjs
function FromObject9(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: RemoveOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/typebox/build/type/engine/required/from_type.mjs
function FromType18(type) {
  return IsCyclic(type) ? FromCyclic5(type.$defs, type.$ref) : IsDependent(type) ? FromDependent5(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect5(type.allOf) : IsUnion(type) ? FromUnion8(type.anyOf) : IsObject2(type) ? FromObject9(type.properties) : _Object_({});
}

// node_modules/typebox/build/type/action/required.mjs
function RequiredDeferred(type, options = {}) {
  return Deferred("Required", [type], options);
}
function Required(type, options = {}) {
  return RequiredAction(type, options);
}

// node_modules/typebox/build/type/engine/required/instantiate.mjs
function RequiredAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType18(type), {}, options) : RequiredDeferred(type, options);
  return result;
}
function RequiredInstantiate(context, state, type, options) {
  const instaniatedType = InstantiateType(context, state, type);
  return RequiredAction(instaniatedType, options);
}

// node_modules/typebox/build/type/action/return_type.mjs
function ReturnTypeDeferred(type, options = {}) {
  return Deferred("ReturnType", [type], options);
}
function ReturnType(type, options = {}) {
  return ReturnTypeAction(type, options);
}

// node_modules/typebox/build/type/engine/return_type/instantiate.mjs
function ReturnTypeOperation(type) {
  return IsFunction2(type) ? type["returnType"] : Never();
}
function ReturnTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ReturnTypeOperation(type), {}, options) : ReturnTypeDeferred(type, options);
  return result;
}
function ReturnTypeInstantiate(context, state, type, options = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReturnTypeAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/with.mjs
function WithDeferred(type, options) {
  return Deferred("With", [type, options], {});
}
function With2(type, options) {
  return WithAction(type, options);
}

// node_modules/typebox/build/type/engine/with/instantiate.mjs
function WithAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(type, {}, options) : WithDeferred(type, options);
  return result;
}
function WithInstantiate(context, state, type, options) {
  const instaniatedType = InstantiateType(context, state, type);
  return WithAction(instaniatedType, options);
}

// node_modules/typebox/build/type/engine/rest/spread.mjs
function SpreadElement(type) {
  const result = IsRest(type) ? IsTuple(type.items) ? RestSpread(type.items.items) : IsInfer(type.items) ? [type] : IsRef(type.items) ? [type] : [Never()] : [type];
  return result;
}
function RestSpread(types) {
  const result = types.reduce((result2, left) => {
    return [...result2, ...SpreadElement(left)];
  }, []);
  return result;
}

// node_modules/typebox/build/type/engine/instantiate.mjs
function State(callstack, visited) {
  return { callstack, visited };
}
function CanInstantiate(types) {
  return guard_exports.ShiftLeft(types, (left, right) => IsRef(left) ? false : CanInstantiate(right), () => true);
}
function InstantiateProperties(context, state, properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: InstantiateType(context, state, properties[key]) };
  }, {});
}
function InstantiateElements(context, state, types) {
  const elements = InstantiateTypes(context, state, types);
  const result = RestSpread(elements);
  return result;
}
function InstantiateTypes(context, state, types) {
  return types.map((type) => InstantiateType(context, state, type));
}
function WithModifiers(type, instantiatedType) {
  const withOptional = IsOptional(type) ? AddOptionalAction(instantiatedType, {}) : instantiatedType;
  const withReadonly = IsReadonly(type) ? AddReadonlyAction(withOptional, {}) : withOptional;
  const withImmutable = IsImmutable(type) ? AddImmutableAction(withReadonly, {}) : withReadonly;
  return withImmutable;
}
function InstantiateDeferred(context, state, action, parameters, options) {
  return (
    // Modifiers
    guard_exports.IsEqual(action, "AddImmutable") ? AddImmutableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveImmutable") ? RemoveImmutableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "AddReadonly") ? AddReadonlyInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveReadonly") ? RemoveReadonlyInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "AddOptional") ? AddOptionalInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveOptional") ? RemoveOptionalInstantiate(context, state, parameters[0], options) : (
      // Actions
      guard_exports.IsEqual(action, "Capitalize") ? CapitalizeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Conditional") ? ConditionalInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "ConstructorParameters") ? ConstructorParametersInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Evaluate") ? EvaluateInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Exclude") ? ExcludeInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Extract") ? ExtractInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Index") ? IndexInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "InstanceType") ? InstanceTypeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Interface") ? InterfaceInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "KeyOf") ? KeyOfInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Lowercase") ? LowercaseInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Mapped") ? MappedInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "Module") ? ModuleInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "NonNullable") ? NonNullableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Pick") ? PickInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Parameters") ? ParametersInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Partial") ? PartialInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Omit") ? OmitInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "ReadonlyObject") ? ReadonlyObjectInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Record") ? RecordInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Required") ? RequiredInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "ReturnType") ? ReturnTypeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "TemplateLiteral") ? TemplateLiteralInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Uncapitalize") ? UncapitalizeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Uppercase") ? UppercaseInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "With") ? WithInstantiate(context, state, parameters[0], parameters[1]) : Deferred(action, parameters, options)
    )
  );
}
function InstantiateImmediate(context, state, type) {
  const instantiatedType = IsRef(type) ? RefInstantiate(context, state, type, type.$ref) : IsArray2(type) ? _Array_(InstantiateType(context, state, type.items), ArrayOptions(type)) : IsCall(type) ? CallInstantiate(context, state, type.target, type.arguments) : IsConstructor2(type) ? Constructor(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.instanceType), ConstructorOptions(type)) : IsFunction2(type) ? _Function_(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.returnType), FunctionOptions(type)) : IsDependent(type) ? Dependent(InstantiateType(context, state, type.if), InstantiateType(context, state, type.then), InstantiateType(context, state, type.else), DependentOptions(type)) : IsIntersect(type) ? Intersect(InstantiateTypes(context, state, type.allOf), IntersectOptions(type)) : IsObject2(type) ? _Object_(InstantiateProperties(context, state, type.properties), ObjectOptions(type)) : IsRecord(type) ? RecordFromPattern(RecordPattern(type), InstantiateType(context, state, RecordValue(type))) : IsRest(type) ? Rest(InstantiateType(context, state, type.items)) : IsTuple(type) ? Tuple(InstantiateElements(context, state, type.items), TupleOptions(type)) : IsUnion(type) ? Union(InstantiateTypes(context, state, type.anyOf), UnionOptions(type)) : type;
  const withModifiers = WithModifiers(type, instantiatedType);
  return withModifiers;
}
function InstantiateType(context, state, type) {
  const result = IsDeferred(type) ? InstantiateDeferred(context, state, type.action, type.parameters, type.options) : InstantiateImmediate(context, state, type);
  return result;
}
function Instantiate(context, type) {
  return InstantiateType(context, State([], []), type);
}

// node_modules/typebox/build/type/engine/immutable/instantiate_add.mjs
function AddImmutableOperation(type) {
  return memory_exports.Update(type, { "~immutable": true }, {});
}
function AddImmutableAction(type, options) {
  const result = memory_exports.Update(AddImmutableOperation(type), {}, options);
  return result;
}
function AddImmutableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddImmutableAction(instantiatedType, options);
}

// node_modules/typebox/build/type/action/_add_immutable.mjs
function AddImmutableDeferred(type, options = {}) {
  return Deferred("AddImmutable", [type], options);
}
function AddImmutable(type, options = {}) {
  return AddImmutableAction(type, options);
}

// node_modules/typebox/build/type/action/evaluate.mjs
function EvaluateDeferred(type, options = {}) {
  return Deferred("Evaluate", [type], options);
}
function Evaluate(type, options = {}) {
  return EvaluateAction(type, options);
}

// node_modules/typebox/build/type/action/module.mjs
function ModuleDeferred(declarations, options = {}) {
  return Deferred("Module", [declarations], options);
}
function Module2(declarations, options = {}) {
  return ModuleInstantiate({}, State([], []), declarations, options);
}

// node_modules/typebox/build/type/engine/priority/priority.mjs
function Comparer(left, right) {
  const compareResult = Compare(left, right);
  const result = guard_exports.IsEqual(compareResult, "right-inside") ? 1 : guard_exports.IsEqual(compareResult, "disjoint") ? 1 : 0;
  return result;
}
function Insert(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => guard_exports.IsEqual(Comparer(type, left), 1) ? Insert(type, right, [...result, left]) : [...result, type, ...types], () => [...result, type]);
}
function Sort(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => Sort(right, Insert(left, result)), () => result);
}
function Priority(types) {
  const result = Sort(types);
  return result;
}

// node_modules/typebox/build/type/script/script.mjs
function Script2(...args) {
  const [context, input, options] = arguments_exports.Match(args, {
    2: (script, options2) => guard_exports.IsString(script) ? [{}, script, options2] : [script, options2, {}],
    3: (context2, script, options2) => [context2, script, options2],
    1: (script) => [{}, script, {}]
  });
  const result = Script(input);
  const parsed = guard_exports.IsArray(result) && guard_exports.IsEqual(result.length, 2) ? InstantiateType(context, State([], []), result[0]) : Never();
  return memory_exports.Update(parsed, {}, options);
}

// node_modules/typebox/build/typebox.mjs
var typebox_exports = {};
__export(typebox_exports, {
  Any: () => Any,
  Array: () => _Array_,
  BigInt: () => BigInt2,
  Boolean: () => Boolean2,
  Call: () => Call,
  Capitalize: () => Capitalize,
  Codec: () => Codec,
  Conditional: () => Conditional,
  Constructor: () => Constructor,
  ConstructorParameters: () => ConstructorParameters,
  Cyclic: () => Cyclic,
  Decode: () => Decode,
  DecodeBuilder: () => DecodeBuilder,
  Dependent: () => Dependent,
  Encode: () => Encode,
  EncodeBuilder: () => EncodeBuilder,
  Enum: () => Enum,
  Evaluate: () => Evaluate,
  Exclude: () => Exclude,
  Extends: () => Extends,
  ExtendsResult: () => result_exports,
  Extract: () => Extract,
  Function: () => _Function_,
  Generic: () => Generic,
  Identifier: () => Identifier,
  Immutable: () => Immutable,
  Index: () => Index,
  Infer: () => Infer,
  InstanceType: () => InstanceType,
  Instantiate: () => Instantiate,
  Integer: () => Integer,
  Interface: () => Interface,
  Intersect: () => Intersect,
  IsAny: () => IsAny,
  IsArray: () => IsArray2,
  IsBigInt: () => IsBigInt2,
  IsBoolean: () => IsBoolean3,
  IsCall: () => IsCall,
  IsCodec: () => IsCodec,
  IsConstructor: () => IsConstructor2,
  IsCyclic: () => IsCyclic,
  IsDependent: () => IsDependent,
  IsEnum: () => IsEnum,
  IsEnumValue: () => IsEnumValue,
  IsFunction: () => IsFunction2,
  IsGeneric: () => IsGeneric,
  IsIdentifier: () => IsIdentifier,
  IsImmutable: () => IsImmutable,
  IsInfer: () => IsInfer,
  IsInteger: () => IsInteger2,
  IsIntersect: () => IsIntersect,
  IsKind: () => IsKind,
  IsLiteral: () => IsLiteral,
  IsNever: () => IsNever,
  IsNull: () => IsNull2,
  IsNumber: () => IsNumber3,
  IsObject: () => IsObject2,
  IsOptional: () => IsOptional,
  IsParameter: () => IsParameter,
  IsReadonly: () => IsReadonly,
  IsRecord: () => IsRecord,
  IsRef: () => IsRef,
  IsRefine: () => IsRefine,
  IsRest: () => IsRest,
  IsSchema: () => IsSchema,
  IsString: () => IsString3,
  IsSymbol: () => IsSymbol2,
  IsTemplateLiteral: () => IsTemplateLiteral,
  IsThis: () => IsThis,
  IsTuple: () => IsTuple,
  IsUndefined: () => IsUndefined2,
  IsUnion: () => IsUnion,
  IsUnknown: () => IsUnknown,
  IsUnsafe: () => IsUnsafe,
  IsVoid: () => IsVoid,
  KeyOf: () => KeyOf2,
  Literal: () => Literal,
  Lowercase: () => Lowercase,
  Mapped: () => Mapped,
  Module: () => Module2,
  Never: () => Never,
  NonNullable: () => NonNullable,
  Null: () => Null,
  Number: () => Number2,
  Object: () => _Object_,
  Omit: () => Omit,
  Optional: () => Optional,
  Parameter: () => Parameter,
  Parameters: () => Parameters,
  Partial: () => Partial,
  Pick: () => Pick,
  Readonly: () => Readonly,
  ReadonlyObject: () => ReadonlyObject,
  ReadonlyType: () => ReadonlyType,
  Record: () => Record,
  RecordKey: () => RecordKey,
  RecordPattern: () => RecordPattern,
  RecordValue: () => RecordValue,
  Ref: () => Ref,
  Refine: () => Refine,
  Required: () => Required,
  Rest: () => Rest,
  ReturnType: () => ReturnType,
  Script: () => Script2,
  String: () => String2,
  Symbol: () => Symbol2,
  TemplateLiteral: () => TemplateLiteral2,
  This: () => This,
  Tuple: () => Tuple,
  Uncapitalize: () => Uncapitalize,
  Undefined: () => Undefined,
  Union: () => Union,
  Unknown: () => Unknown,
  Unsafe: () => Unsafe,
  Uppercase: () => Uppercase,
  Void: () => Void,
  With: () => With2
});

// packages/shared/src/causality.ts
var CAUSALITY_SCHEMA_VERSION = 1;
var SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
var CausalEnvelopeSchema = typebox_exports.Object(
  {
    schemaVersion: typebox_exports.Literal(CAUSALITY_SCHEMA_VERSION),
    eventId: typebox_exports.String({ minLength: 1, maxLength: 128, pattern: SAFE_ID.source }),
    causationId: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 128, pattern: SAFE_ID.source })),
    runAttemptId: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 128, pattern: SAFE_ID.source }))
  },
  { additionalProperties: false }
);

// packages/shared/src/research-status.ts
var RESEARCH_EVIDENCE_STATES = Object.freeze([
  "observed",
  "reproduced",
  "verified",
  "partial",
  "stale",
  "unsupported",
  "unknown",
  "blocked"
]);
var RESEARCH_CLAIM_STATES = Object.freeze([
  "supported",
  "mixed",
  "inferred",
  "hypothesis",
  "unsupported"
]);
var RESEARCH_CAPABILITY_STATES = Object.freeze([
  "candidate",
  "recommended",
  "registered",
  "enabled",
  "retired"
]);
var RESEARCH_REUSE_LEVELS = Object.freeze([
  "navigation-only",
  "evidence-eligible",
  "validated-capability",
  "reproduced-capability"
]);
var RESEARCH_VALIDATION_SCOPES = Object.freeze([
  "fixture",
  "integration",
  "real-data",
  "scientific-review"
]);
var RESEARCH_FRESHNESS_STATES = Object.freeze(["fresh", "stale", "unknown"]);

// packages/shared/src/research-skill-sources.json
var research_skill_sources_default = {
  schemaVersion: 1,
  sources: [
    {
      id: "nature",
      repository: "Yuan1z0825/nature-skills",
      commit: "2375e0abdf42158ef149256f2c64b1f759a0d274",
      archiveSha256: "d5017c0e6415275306f3b1774a70ffc88a865969adc10816eb8e9a795464b363",
      license: "Apache-2.0",
      licenseFiles: ["LICENSE"],
      skills: [
        {
          name: "nature-academic-search",
          path: "skills/nature-academic-search/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-citation",
          path: "skills/nature-citation/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-data",
          path: "skills/nature-data/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-downloader",
          path: "skills/nature-downloader/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-experiment-log",
          path: "skills/nature-experiment-log/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "nature-figure",
          path: "skills/nature-figure/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-image2ppt",
          path: "skills/nature-image2ppt/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-literature-pipeline",
          path: "skills/nature-literature-pipeline/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "nature-paper-card",
          path: "skills/nature-paper-card/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-paper-to-patent",
          path: "skills/nature-paper-to-patent/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-paper2ppt",
          path: "skills/nature-paper2ppt/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-polishing",
          path: "skills/nature-polishing/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "researchwrite",
          path: "skills/nature-proposal-writer/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "nature-reader",
          path: "skills/nature-reader/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-ref-verifier",
          path: "skills/nature-ref-verifier/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-response",
          path: "skills/nature-response/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-reviewer",
          path: "skills/nature-reviewer/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-shared",
          path: "skills/nature-shared/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-statistics",
          path: "skills/nature-statistics/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "nature-writing",
          path: "skills/nature-writing/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        }
      ],
      runtimeFiles: []
    },
    {
      id: "scientific",
      repository: "K-Dense-AI/scientific-agent-skills",
      commit: "330c8e764435a731eff571e3efdda70b363d0792",
      archiveSha256: "559c0a1c32666e08854e0276399cdb961d5ab5faf31183b2dc94382ee38c90f3",
      license: "MIT",
      licenseFiles: ["LICENSE.md"],
      skills: [
        {
          name: "adaptyv",
          path: "skills/adaptyv/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "aeon",
          path: "skills/aeon/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "alphagenome",
          path: "skills/alphagenome/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "analytical-method-validation",
          path: "skills/analytical-method-validation/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "anndata",
          path: "skills/anndata/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "arbor",
          path: "skills/arbor/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "arboreto",
          path: "skills/arboreto/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "astropy",
          path: "skills/astropy/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "autoskill",
          path: "skills/autoskill/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "benchling-integration",
          path: "skills/benchling-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "bgpt-paper-search",
          path: "skills/bgpt-paper-search/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "bids",
          path: "skills/bids/SKILL.md",
          license: "https://creativecommons.org/licenses/by/4.0/",
          bundled: true
        },
        {
          name: "biopython",
          path: "skills/biopython/SKILL.md",
          license: "Biopython License Agreement",
          bundled: false
        },
        {
          name: "bioservices",
          path: "skills/bioservices/SKILL.md",
          license: "GPLv3 license",
          bundled: false
        },
        {
          name: "bulk-rnaseq",
          path: "skills/bulk-rnaseq/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "cellxgene-census",
          path: "skills/cellxgene-census/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "cirq",
          path: "skills/cirq/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "citation-management",
          path: "skills/citation-management/SKILL.md",
          license: "MIT License",
          bundled: true
        },
        {
          name: "clinical-decision-support",
          path: "skills/clinical-decision-support/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "clinical-reports",
          path: "skills/clinical-reports/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "cobrapy",
          path: "skills/cobrapy/SKILL.md",
          license: "GPL-2.0 license",
          bundled: false
        },
        {
          name: "consciousness-council",
          path: "skills/consciousness-council/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "dask",
          path: "skills/dask/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "database-lookup",
          path: "skills/database-lookup/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "datalad",
          path: "skills/datalad/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "datamol",
          path: "skills/datamol/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "deepchem",
          path: "skills/deepchem/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "deepspot-m",
          path: "skills/deepspot-m/SKILL.md",
          license: "PolyForm-Noncommercial-1.0.0",
          bundled: false
        },
        {
          name: "deeptools",
          path: "skills/deeptools/SKILL.md",
          license: "BSD license",
          bundled: true
        },
        {
          name: "depmap",
          path: "skills/depmap/SKILL.md",
          license: "CC-BY-4.0",
          bundled: true
        },
        {
          name: "dhdna-profiler",
          path: "skills/dhdna-profiler/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "diffdock",
          path: "skills/diffdock/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "dnanexus-integration",
          path: "skills/dnanexus-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "docx",
          path: "skills/docx/SKILL.md",
          license: "Proprietary. LICENSE.txt has complete terms",
          bundled: false
        },
        {
          name: "esm",
          path: "skills/esm/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "etetoolkit",
          path: "skills/etetoolkit/SKILL.md",
          license: "GPL-3.0-or-later",
          bundled: false
        },
        {
          name: "exa-search",
          path: "skills/exa-search/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "experimental-design",
          path: "skills/experimental-design/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "exploratory-data-analysis",
          path: "skills/exploratory-data-analysis/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "flowio",
          path: "skills/flowio/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "fluidsim",
          path: "skills/fluidsim/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "folklore-variant-evidence",
          path: "skills/folklore-variant-evidence/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "generate-image",
          path: "skills/generate-image/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "geniml",
          path: "skills/geniml/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "genomic-coordinates",
          path: "skills/genomic-coordinates/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "genomic-intelligence",
          path: "skills/genomic-intelligence/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "geomaster",
          path: "skills/geomaster/SKILL.md",
          license: "MIT License",
          bundled: true
        },
        {
          name: "geopandas",
          path: "skills/geopandas/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "get-available-resources",
          path: "skills/get-available-resources/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "gget",
          path: "skills/gget/SKILL.md",
          license: "BSD-2-Clause license",
          bundled: true
        },
        {
          name: "ginkgo-cloud-lab",
          path: "skills/ginkgo-cloud-lab/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "glycoengineering",
          path: "skills/glycoengineering/SKILL.md",
          license: "Unknown",
          bundled: false
        },
        {
          name: "gtars",
          path: "skills/gtars/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "histolab",
          path: "skills/histolab/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "hugging-science",
          path: "skills/hugging-science/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "hypogenic",
          path: "skills/hypogenic/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "hypothesis-generation",
          path: "skills/hypothesis-generation/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "imaging-data-commons",
          path: "skills/imaging-data-commons/SKILL.md",
          license: "This skill is provided under the MIT License. IDC data itself has individual licensing (mostly CC-BY, some CC-NC) that must be respected when using the data.",
          bundled: false
        },
        {
          name: "infographics",
          path: "skills/infographics/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "iso-standards-readiness",
          path: "skills/iso-standards-readiness/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "lab-hardware-cad",
          path: "skills/lab-hardware-cad/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "labarchive-integration",
          path: "skills/labarchive-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "lamindb",
          path: "skills/lamindb/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "latchbio-integration",
          path: "skills/latchbio-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "latex-posters",
          path: "skills/latex-posters/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "liteparse",
          path: "skills/liteparse/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "literature-review",
          path: "skills/literature-review/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "markdown-mermaid-writing",
          path: "skills/markdown-mermaid-writing/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "market-research-reports",
          path: "skills/market-research-reports/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "markitdown",
          path: "skills/markitdown/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "matchms",
          path: "skills/matchms/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "matlab",
          path: "skills/matlab/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "matplotlib",
          path: "skills/matplotlib/SKILL.md",
          license: "https://github.com/matplotlib/matplotlib/tree/main/LICENSE",
          bundled: false
        },
        {
          name: "medchem",
          path: "skills/medchem/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "modal",
          path: "skills/modal/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "molecular-dynamics",
          path: "skills/molecular-dynamics/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "molfeat",
          path: "skills/molfeat/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "ncats-arax",
          path: "skills/ncats-arax/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "networkx",
          path: "skills/networkx/SKILL.md",
          license: "3-clause BSD license",
          bundled: true
        },
        {
          name: "neurokit2",
          path: "skills/neurokit2/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "neuropixels-analysis",
          path: "skills/neuropixels-analysis/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "nextflow",
          path: "skills/nextflow/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "omero-integration",
          path: "skills/omero-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "onekgpd",
          path: "skills/onekgpd/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "ontology-term-resolution",
          path: "skills/ontology-term-resolution/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "open-notebook",
          path: "skills/open-notebook/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "openpiv",
          path: "skills/openpiv/SKILL.md",
          license: "BSD-3-Clause",
          bundled: true
        },
        {
          name: "opentrons-integration",
          path: "skills/opentrons-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "optimize-for-gpu",
          path: "skills/optimize-for-gpu/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pacsomatic",
          path: "skills/pacsomatic/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "paper-lookup",
          path: "skills/paper-lookup/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "paperclip",
          path: "skills/paperclip/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "paperzilla",
          path: "skills/paperzilla/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "parallel-web",
          path: "skills/parallel-web/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pathml",
          path: "skills/pathml/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pathogen-variant-surveillance",
          path: "skills/pathogen-variant-surveillance/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pathway-enrichment",
          path: "skills/pathway-enrichment/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pdf",
          path: "skills/pdf/SKILL.md",
          license: "Proprietary. LICENSE.txt has complete terms",
          bundled: false
        },
        {
          name: "peer-review",
          path: "skills/peer-review/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pennylane",
          path: "skills/pennylane/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "phylogenetics",
          path: "skills/phylogenetics/SKILL.md",
          license: "Unknown",
          bundled: false
        },
        {
          name: "pi-agent",
          path: "skills/pi-agent/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pkpd-modeling",
          path: "skills/pkpd-modeling/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "polars",
          path: "skills/polars/SKILL.md",
          license: "https://github.com/pola-rs/polars/blob/main/LICENSE",
          bundled: false
        },
        {
          name: "polars-bio",
          path: "skills/polars-bio/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "pptx",
          path: "skills/pptx/SKILL.md",
          license: "Proprietary. LICENSE.txt has complete terms",
          bundled: false
        },
        {
          name: "pptx-posters",
          path: "skills/pptx-posters/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "primekg",
          path: "skills/primekg/SKILL.md",
          license: "Unknown",
          bundled: false
        },
        {
          name: "protocolsio-integration",
          path: "skills/protocolsio-integration/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pufferlib",
          path: "skills/pufferlib/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pydeseq2",
          path: "skills/pydeseq2/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "pydicom",
          path: "skills/pydicom/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pyhealth",
          path: "skills/pyhealth/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pylabrobot",
          path: "skills/pylabrobot/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pymatgen",
          path: "skills/pymatgen/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pymc",
          path: "skills/pymc/SKILL.md",
          license: "Apache License, Version 2.0",
          bundled: true
        },
        {
          name: "pymoo",
          path: "skills/pymoo/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "pyopenms",
          path: "skills/pyopenms/SKILL.md",
          license: "3 clause BSD license",
          bundled: true
        },
        {
          name: "pysam",
          path: "skills/pysam/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pytdc",
          path: "skills/pytdc/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "pytorch-lightning",
          path: "skills/pytorch-lightning/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "pyzotero",
          path: "skills/pyzotero/SKILL.md",
          license: "MIT License",
          bundled: true
        },
        {
          name: "qiskit",
          path: "skills/qiskit/SKILL.md",
          license: "Apache-2.0",
          bundled: true
        },
        {
          name: "qutip",
          path: "skills/qutip/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "rdkit",
          path: "skills/rdkit/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "relsa-severity-assessment",
          path: "skills/relsa-severity-assessment/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "research-grants",
          path: "skills/research-grants/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "research-lookup",
          path: "skills/research-lookup/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "rowan",
          path: "skills/rowan/SKILL.md",
          license: "Proprietary (API key required)",
          bundled: false
        },
        {
          name: "scanpy",
          path: "skills/scanpy/SKILL.md",
          license: "BSD-3-Clause",
          bundled: true
        },
        {
          name: "scholar-evaluation",
          path: "skills/scholar-evaluation/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "scientific-brainstorming",
          path: "skills/scientific-brainstorming/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "scientific-critical-thinking",
          path: "skills/scientific-critical-thinking/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "scientific-schematics",
          path: "skills/scientific-schematics/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "scientific-slides",
          path: "skills/scientific-slides/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "scientific-visualization",
          path: "skills/scientific-visualization/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "scientific-writing",
          path: "skills/scientific-writing/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "scikit-bio",
          path: "skills/scikit-bio/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "scikit-learn",
          path: "skills/scikit-learn/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "scikit-survival",
          path: "skills/scikit-survival/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "scvelo",
          path: "skills/scvelo/SKILL.md",
          license: "BSD-3-Clause",
          bundled: true
        },
        {
          name: "scvi-tools",
          path: "skills/scvi-tools/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "seaborn",
          path: "skills/seaborn/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "shap",
          path: "skills/shap/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "simpy",
          path: "skills/simpy/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "stable-baselines3",
          path: "skills/stable-baselines3/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "statistical-analysis",
          path: "skills/statistical-analysis/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "statistical-power",
          path: "skills/statistical-power/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "statsmodels",
          path: "skills/statsmodels/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "sympy",
          path: "skills/sympy/SKILL.md",
          license: "https://github.com/sympy/sympy/blob/master/LICENSE",
          bundled: false
        },
        {
          name: "tamarind",
          path: "skills/tamarind/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "tiledbvcf",
          path: "skills/tiledbvcf/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "timesfm-forecasting",
          path: "skills/timesfm-forecasting/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "torch-geometric",
          path: "skills/torch-geometric/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "torchdrug",
          path: "skills/torchdrug/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "transformers",
          path: "skills/transformers/SKILL.md",
          license: "Apache-2.0 license",
          bundled: true
        },
        {
          name: "treatment-plans",
          path: "skills/treatment-plans/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "umap-learn",
          path: "skills/umap-learn/SKILL.md",
          license: "BSD-3-Clause license",
          bundled: true
        },
        {
          name: "uncertainty-and-units",
          path: "skills/uncertainty-and-units/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "usfiscaldata",
          path: "skills/usfiscaldata/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "vaex",
          path: "skills/vaex/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "venue-templates",
          path: "skills/venue-templates/SKILL.md",
          license: "MIT license",
          bundled: true
        },
        {
          name: "waypoint-bio",
          path: "skills/waypoint-bio/SKILL.md",
          license: "MIT",
          bundled: true
        },
        {
          name: "what-if-oracle",
          path: "skills/what-if-oracle/SKILL.md",
          license: "CC BY-NC-SA 4.0",
          bundled: false
        },
        {
          name: "xlsx",
          path: "skills/xlsx/SKILL.md",
          license: "Proprietary. LICENSE.txt has complete terms",
          bundled: false
        },
        {
          name: "zarr-python",
          path: "skills/zarr-python/SKILL.md",
          license: "MIT license",
          bundled: true
        }
      ],
      runtimeFiles: []
    },
    {
      id: "academic",
      repository: "Imbad0202/academic-research-skills",
      commit: "3c546bc08c56f79e0068f1ea4f0acedf5bf69b5e",
      archiveSha256: "98aa80d4d160c6e92d7b73d902998ffcb8599b8ab89f0b6727ae738584838217",
      license: "CC-BY-NC-4.0",
      licenseFiles: ["LICENSE", "NOTICE.md"],
      skills: [
        {
          name: "academic-paper",
          path: "academic-paper/SKILL.md",
          license: "CC-BY-NC-4.0",
          bundled: true
        },
        {
          name: "academic-paper-reviewer",
          path: "academic-paper-reviewer/SKILL.md",
          license: "CC-BY-NC-4.0",
          bundled: true
        },
        {
          name: "academic-pipeline",
          path: "academic-pipeline/SKILL.md",
          license: "CC-BY-NC-4.0",
          bundled: true
        },
        {
          name: "deep-research",
          path: "deep-research/SKILL.md",
          license: "CC-BY-NC-4.0",
          bundled: true
        }
      ],
      runtimeFiles: [
        {
          path: "MODE_REGISTRY.md",
          sha256: "fe3974f9cd139801c935f9dffb0031e73901f3548cb3c887f1a15a1001a1eb5d"
        },
        {
          path: "commands/ars-3w.md",
          sha256: "2db86727d54541ef4ea605805018b6c68ee2aa497cfdc2844dff3015d6e23b94"
        },
        {
          path: "commands/ars-abstract.md",
          sha256: "c2040a286ac382001a61ea81c7f6fb165716320406ec31379ce1f1eda5cc2104"
        },
        {
          path: "commands/ars-cache-invalidate.md",
          sha256: "60c6dc0d42eaf881d52e781dc1528904438b9a6ab23a5f0d8f56d426f311933e"
        },
        {
          path: "commands/ars-citation-check.md",
          sha256: "5834a3cf8ca5caae07ec85dbbe833ca09930e64b2eb60adaeabadbbe8bef6435"
        },
        {
          path: "commands/ars-disclosure.md",
          sha256: "5108d232b745ba085e45f94ca85f468abdf4bc8370180634c7bfc7fd9cb8fdfb"
        },
        {
          path: "commands/ars-format-convert.md",
          sha256: "49364fcd2a0a5b96ed3e979931b6db73f18ca0667d79268ef5c33b60f16e4b5c"
        },
        {
          path: "commands/ars-full.md",
          sha256: "b310bb23b83fc7b11460068b22fd5d56b28d8c151f524956fb5f5feee15e2606"
        },
        {
          path: "commands/ars-lit-review.md",
          sha256: "08cacaa17125aa386774683ad2bc8c360c003ab1323dfc931941f7f16768dbc8"
        },
        {
          path: "commands/ars-mark-read.md",
          sha256: "1272790ecd5a34835fc90584b48b6aa06985fb609410f191c1b55c9ad4259de1"
        },
        {
          path: "commands/ars-outline.md",
          sha256: "f1c993aa598ef67337109c8367c800d43cbcae760c0bdc2fe7c5bb469e395a05"
        },
        {
          path: "commands/ars-plan.md",
          sha256: "c231143a84bbe086091f5fcd94b1f3117fd91a00fa2e8c19707f386be49909b1"
        },
        {
          path: "commands/ars-rebuttal-audit.md",
          sha256: "4b48c4cd799417fe5d5cd62f55fc87050a562d47d5a7084ee6446454f0908ba4"
        },
        {
          path: "commands/ars-reviewer.md",
          sha256: "c8316335cfa054962afc6dd87a6a45036d0c07efe8c1d1911f013498d036c17b"
        },
        {
          path: "commands/ars-revision-coach.md",
          sha256: "975591bf5e9fd1d4a697798844c6d1604a6f1d5220da24b090b3d895c8125745"
        },
        {
          path: "commands/ars-revision.md",
          sha256: "7135f32bca5cc125539de4d8170ea673d2bb73cdccd9272d2d72f514b5290fb0"
        },
        {
          path: "commands/ars-unmark-read.md",
          sha256: "4ce45672f07da9d48bb3350b273523e1b0e9cb021ddf1849ca1b7d8cc8d896ca"
        },
        {
          path: "package.json",
          sha256: "5497d262a2af42e25d0e31ab65f115735c2b85c6c256576494cafda760165550"
        },
        {
          path: "pi/package.json",
          sha256: "a4fceb32c55830f4cbd0116482414707de4a37067036bfa8243321186f06687a"
        },
        {
          path: "pi/wrapper.js",
          sha256: "4ec8a6884f87b55d2e201dbe93aaaabc0ba33a46ef9ae0677b212c53fcc9ce2a"
        }
      ]
    }
  ]
};

// packages/shared/src/workflow-profiles.json
var workflow_profiles_default = [
  {
    name: "nature-academic-search",
    direction: "evidence",
    subdomain: "\u8BC1\u636E\u68C0\u7D22\u4E0E\u7EFC\u8FF0",
    source: "nature"
  },
  {
    name: "nature-citation",
    direction: "evidence",
    subdomain: "\u5F15\u6587\u4E0E\u8BBA\u636E\u6838\u9A8C",
    source: "nature"
  },
  {
    name: "nature-data",
    direction: "writing",
    subdomain: "\u62A5\u544A\u89C4\u8303\u3001\u7EDF\u8BA1\u5448\u73B0\u4E0E\u6570\u636E\u58F0\u660E",
    source: "nature"
  },
  {
    name: "nature-downloader",
    direction: "evidence",
    subdomain: "\u83B7\u53D6\u3001\u9605\u8BFB\u4E0E\u8BBA\u6587\u5361",
    source: "nature"
  },
  {
    name: "nature-experiment-log",
    direction: "evidence",
    subdomain: "\u8BA2\u9605\u4E0E\u5B9E\u9A8C\u65E5\u5FD7",
    source: "nature"
  },
  {
    name: "nature-figure",
    direction: "presentation",
    subdomain: "\u6570\u636E\u56FE\u8868",
    source: "nature"
  },
  {
    name: "nature-image2ppt",
    direction: "presentation",
    subdomain: "\u5E7B\u706F\u7247\u4E0E\u6D77\u62A5",
    source: "nature"
  },
  {
    name: "nature-literature-pipeline",
    direction: "evidence",
    subdomain: "\u8BA2\u9605\u4E0E\u5B9E\u9A8C\u65E5\u5FD7",
    source: "nature"
  },
  {
    name: "nature-paper-card",
    direction: "evidence",
    subdomain: "\u83B7\u53D6\u3001\u9605\u8BFB\u4E0E\u8BBA\u6587\u5361",
    source: "nature"
  },
  {
    name: "nature-paper-to-patent",
    direction: "writing",
    subdomain: "\u4E13\u5229\u4E0E\u4E13\u4E1A\u62A5\u544A\uFF08\u53D7\u9650\u5206\u652F\uFF09",
    source: "nature"
  },
  {
    name: "nature-paper2ppt",
    direction: "presentation",
    subdomain: "\u5E7B\u706F\u7247\u4E0E\u6D77\u62A5",
    source: "nature"
  },
  {
    name: "nature-polishing",
    direction: "writing",
    subdomain: "\u6B63\u6587\u4E0E\u8BED\u8A00\u7F16\u8F91",
    source: "nature"
  },
  {
    name: "researchwrite",
    direction: "planning",
    subdomain: "\u9879\u76EE\u7533\u8BF7\u4E0E\u7814\u7A76\u8BA1\u5212",
    source: "nature"
  },
  {
    name: "nature-reader",
    direction: "evidence",
    subdomain: "\u83B7\u53D6\u3001\u9605\u8BFB\u4E0E\u8BBA\u6587\u5361",
    source: "nature"
  },
  {
    name: "nature-ref-verifier",
    direction: "evidence",
    subdomain: "\u5F15\u6587\u4E0E\u8BBA\u636E\u6838\u9A8C",
    source: "nature"
  },
  {
    name: "nature-response",
    direction: "writing",
    subdomain: "\u5BA1\u7A3F\u3001\u56DE\u590D\u4E0E\u8BC4\u4EF7",
    source: "nature"
  },
  {
    name: "nature-reviewer",
    direction: "writing",
    subdomain: "\u5BA1\u7A3F\u3001\u56DE\u590D\u4E0E\u8BC4\u4EF7",
    source: "nature"
  },
  {
    name: "nature-shared",
    direction: "internal",
    subdomain: "\u8BC1\u636E\u4E0E\u4EFB\u52A1\u63A7\u5236/\u5171\u4EAB\u8D44\u6E90",
    source: "nature"
  },
  {
    name: "nature-statistics",
    direction: "writing",
    subdomain: "\u62A5\u544A\u89C4\u8303\u3001\u7EDF\u8BA1\u5448\u73B0\u4E0E\u6570\u636E\u58F0\u660E",
    source: "nature"
  },
  {
    name: "nature-writing",
    direction: "writing",
    subdomain: "\u6B63\u6587\u4E0E\u8BED\u8A00\u7F16\u8F91",
    source: "nature"
  },
  {
    name: "adaptyv",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "aeon",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "alphagenome",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "analytical-method-validation",
    direction: "planning",
    subdomain: "\u65B9\u6CD5\u9A8C\u8BC1\u4E0E\u5408\u89C4\u51C6\u5907",
    source: "scientific"
  },
  {
    name: "anndata",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "arbor",
    direction: "engineering",
    subdomain: "\u81EA\u52A8\u4F18\u5316\u4E0E\u6280\u80FD\u63D0\u6848\uFF08\u663E\u5F0F\u6388\u6743\uFF09",
    source: "scientific"
  },
  {
    name: "arboreto",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "astropy",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "autoskill",
    direction: "engineering",
    subdomain: "\u81EA\u52A8\u4F18\u5316\u4E0E\u6280\u80FD\u63D0\u6848\uFF08\u663E\u5F0F\u6388\u6743\uFF09",
    source: "scientific"
  },
  {
    name: "benchling-integration",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "bgpt-paper-search",
    direction: "evidence",
    subdomain: "\u68C0\u7D22\u670D\u52A1\u9002\u914D",
    source: "scientific"
  },
  {
    name: "bids",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "biopython",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "bioservices",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "bulk-rnaseq",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "cellxgene-census",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "cirq",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "citation-management",
    direction: "evidence",
    subdomain: "\u5F15\u6587\u4E0E\u8BBA\u636E\u6838\u9A8C",
    source: "scientific"
  },
  {
    name: "clinical-decision-support",
    direction: "writing",
    subdomain: "\u4E13\u5229\u4E0E\u4E13\u4E1A\u62A5\u544A\uFF08\u53D7\u9650\u5206\u652F\uFF09",
    source: "scientific"
  },
  {
    name: "clinical-reports",
    direction: "writing",
    subdomain: "\u4E13\u5229\u4E0E\u4E13\u4E1A\u62A5\u544A\uFF08\u53D7\u9650\u5206\u652F\uFF09",
    source: "scientific"
  },
  {
    name: "cobrapy",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "consciousness-council",
    direction: "planning",
    subdomain: "\u63A2\u7D22\u6027\u63A8\u6F14\uFF08\u975E\u6838\u5FC3\uFF09",
    source: "scientific"
  },
  {
    name: "dask",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "database-lookup",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "datalad",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "datamol",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "deepchem",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "deepspot-m",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "deeptools",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "depmap",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "dhdna-profiler",
    direction: "planning",
    subdomain: "\u63A2\u7D22\u6027\u63A8\u6F14\uFF08\u975E\u6838\u5FC3\uFF09",
    source: "scientific"
  },
  {
    name: "diffdock",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "dnanexus-integration",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "docx",
    direction: "presentation",
    subdomain: "\u6587\u6863\u4E0E\u8868\u683C\u683C\u5F0F\uFF08\u5F85\u8BB8\u53EF\u590D\u6838\uFF09",
    source: "scientific"
  },
  {
    name: "esm",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "etetoolkit",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "exa-search",
    direction: "evidence",
    subdomain: "\u68C0\u7D22\u670D\u52A1\u9002\u914D",
    source: "scientific"
  },
  {
    name: "experimental-design",
    direction: "planning",
    subdomain: "\u9009\u9898\u3001\u5047\u8BBE\u4E0E\u5B9E\u9A8C\u8BBE\u8BA1",
    source: "scientific"
  },
  {
    name: "exploratory-data-analysis",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "flowio",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "fluidsim",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "folklore-variant-evidence",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "generate-image",
    direction: "presentation",
    subdomain: "\u89E3\u91CA\u56FE\u4E0E\u89C6\u89C9\u7D20\u6750",
    source: "scientific"
  },
  {
    name: "geniml",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "genomic-coordinates",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "genomic-intelligence",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "geomaster",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "geopandas",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "get-available-resources",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "gget",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "ginkgo-cloud-lab",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "glycoengineering",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "gtars",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "histolab",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "hugging-science",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "hypogenic",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "hypothesis-generation",
    direction: "planning",
    subdomain: "\u9009\u9898\u3001\u5047\u8BBE\u4E0E\u5B9E\u9A8C\u8BBE\u8BA1",
    source: "scientific"
  },
  {
    name: "imaging-data-commons",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "infographics",
    direction: "presentation",
    subdomain: "\u89E3\u91CA\u56FE\u4E0E\u89C6\u89C9\u7D20\u6750",
    source: "scientific"
  },
  {
    name: "iso-standards-readiness",
    direction: "planning",
    subdomain: "\u65B9\u6CD5\u9A8C\u8BC1\u4E0E\u5408\u89C4\u51C6\u5907",
    source: "scientific"
  },
  {
    name: "lab-hardware-cad",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "labarchive-integration",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "lamindb",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "latchbio-integration",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "latex-posters",
    direction: "presentation",
    subdomain: "\u5E7B\u706F\u7247\u4E0E\u6D77\u62A5",
    source: "scientific"
  },
  {
    name: "liteparse",
    direction: "evidence",
    subdomain: "\u83B7\u53D6\u3001\u9605\u8BFB\u4E0E\u8BBA\u6587\u5361",
    source: "scientific"
  },
  {
    name: "literature-review",
    direction: "evidence",
    subdomain: "\u8BC1\u636E\u68C0\u7D22\u4E0E\u7EFC\u8FF0",
    source: "scientific"
  },
  {
    name: "markdown-mermaid-writing",
    direction: "presentation",
    subdomain: "\u89E3\u91CA\u56FE\u4E0E\u89C6\u89C9\u7D20\u6750",
    source: "scientific"
  },
  {
    name: "market-research-reports",
    direction: "writing",
    subdomain: "\u4E13\u5229\u4E0E\u4E13\u4E1A\u62A5\u544A\uFF08\u53D7\u9650\u5206\u652F\uFF09",
    source: "scientific"
  },
  {
    name: "markitdown",
    direction: "evidence",
    subdomain: "\u83B7\u53D6\u3001\u9605\u8BFB\u4E0E\u8BBA\u6587\u5361",
    source: "scientific"
  },
  {
    name: "matchms",
    direction: "analysis",
    subdomain: "\u8D28\u8C31\u4E0E\u86CB\u767D\u7EC4",
    source: "scientific"
  },
  {
    name: "matlab",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "matplotlib",
    direction: "presentation",
    subdomain: "\u6570\u636E\u56FE\u8868",
    source: "scientific"
  },
  {
    name: "medchem",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "modal",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "molecular-dynamics",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "molfeat",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "ncats-arax",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "networkx",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "neurokit2",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "neuropixels-analysis",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "nextflow",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "omero-integration",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "onekgpd",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "ontology-term-resolution",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "open-notebook",
    direction: "evidence",
    subdomain: "\u77E5\u8BC6\u5E93\u4E0E\u6587\u732E\u5E93",
    source: "scientific"
  },
  {
    name: "openpiv",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "opentrons-integration",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "optimize-for-gpu",
    direction: "engineering",
    subdomain: "\u7B97\u529B\u3001\u4E91\u5E73\u53F0\u4E0E\u7BA1\u7EBF",
    source: "scientific"
  },
  {
    name: "pacsomatic",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "paper-lookup",
    direction: "evidence",
    subdomain: "\u8BC1\u636E\u68C0\u7D22\u4E0E\u7EFC\u8FF0",
    source: "scientific"
  },
  {
    name: "paperclip",
    direction: "evidence",
    subdomain: "\u68C0\u7D22\u670D\u52A1\u9002\u914D",
    source: "scientific"
  },
  {
    name: "paperzilla",
    direction: "evidence",
    subdomain: "\u68C0\u7D22\u670D\u52A1\u9002\u914D",
    source: "scientific"
  },
  {
    name: "parallel-web",
    direction: "evidence",
    subdomain: "\u68C0\u7D22\u670D\u52A1\u9002\u914D",
    source: "scientific"
  },
  {
    name: "pathml",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "pathogen-variant-surveillance",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "pathway-enrichment",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "pdf",
    direction: "presentation",
    subdomain: "\u6587\u6863\u4E0E\u8868\u683C\u683C\u5F0F\uFF08\u5F85\u8BB8\u53EF\u590D\u6838\uFF09",
    source: "scientific"
  },
  {
    name: "peer-review",
    direction: "writing",
    subdomain: "\u5BA1\u7A3F\u3001\u56DE\u590D\u4E0E\u8BC4\u4EF7",
    source: "scientific"
  },
  {
    name: "pennylane",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "phylogenetics",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "pi-agent",
    direction: "engineering",
    subdomain: "\u4EA4\u63A5\u4E0E\u5E94\u7528\u5B9A\u5236",
    source: "scientific"
  },
  {
    name: "pkpd-modeling",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "polars-bio",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "polars",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "pptx-posters",
    direction: "presentation",
    subdomain: "\u5E7B\u706F\u7247\u4E0E\u6D77\u62A5",
    source: "scientific"
  },
  {
    name: "pptx",
    direction: "presentation",
    subdomain: "\u6587\u6863\u4E0E\u8868\u683C\u683C\u5F0F\uFF08\u5F85\u8BB8\u53EF\u590D\u6838\uFF09",
    source: "scientific"
  },
  {
    name: "primekg",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "protocolsio-integration",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "pufferlib",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "pydeseq2",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "pydicom",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "pyhealth",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "pylabrobot",
    direction: "engineering",
    subdomain: "\u5B9E\u9A8C\u5E73\u53F0\u3001\u8BB0\u5F55\u7CFB\u7EDF\u4E0E\u8BBE\u5907",
    source: "scientific"
  },
  {
    name: "pymatgen",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "pymc",
    direction: "analysis",
    subdomain: "\u7EDF\u8BA1\u5EFA\u6A21\u4E0E\u4E0D\u786E\u5B9A\u6027",
    source: "scientific"
  },
  {
    name: "pymoo",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "pyopenms",
    direction: "analysis",
    subdomain: "\u8D28\u8C31\u4E0E\u86CB\u767D\u7EC4",
    source: "scientific"
  },
  {
    name: "pysam",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "pytdc",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "pytorch-lightning",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "pyzotero",
    direction: "evidence",
    subdomain: "\u77E5\u8BC6\u5E93\u4E0E\u6587\u732E\u5E93",
    source: "scientific"
  },
  {
    name: "qiskit",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "qutip",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "rdkit",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "relsa-severity-assessment",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "research-grants",
    direction: "planning",
    subdomain: "\u9879\u76EE\u7533\u8BF7\u4E0E\u7814\u7A76\u8BA1\u5212",
    source: "scientific"
  },
  {
    name: "research-lookup",
    direction: "evidence",
    subdomain: "\u8BC1\u636E\u68C0\u7D22\u4E0E\u7EFC\u8FF0",
    source: "scientific"
  },
  {
    name: "rowan",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "scanpy",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "scholar-evaluation",
    direction: "writing",
    subdomain: "\u5BA1\u7A3F\u3001\u56DE\u590D\u4E0E\u8BC4\u4EF7",
    source: "scientific"
  },
  {
    name: "scientific-brainstorming",
    direction: "planning",
    subdomain: "\u9009\u9898\u3001\u5047\u8BBE\u4E0E\u5B9E\u9A8C\u8BBE\u8BA1",
    source: "scientific"
  },
  {
    name: "scientific-critical-thinking",
    direction: "evidence",
    subdomain: "\u5F15\u6587\u4E0E\u8BBA\u636E\u6838\u9A8C",
    source: "scientific"
  },
  {
    name: "scientific-schematics",
    direction: "presentation",
    subdomain: "\u89E3\u91CA\u56FE\u4E0E\u89C6\u89C9\u7D20\u6750",
    source: "scientific"
  },
  {
    name: "scientific-slides",
    direction: "presentation",
    subdomain: "\u5E7B\u706F\u7247\u4E0E\u6D77\u62A5",
    source: "scientific"
  },
  {
    name: "scientific-visualization",
    direction: "presentation",
    subdomain: "\u6570\u636E\u56FE\u8868",
    source: "scientific"
  },
  {
    name: "scientific-writing",
    direction: "writing",
    subdomain: "\u6B63\u6587\u4E0E\u8BED\u8A00\u7F16\u8F91",
    source: "scientific"
  },
  {
    name: "scikit-bio",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "scikit-learn",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "scikit-survival",
    direction: "analysis",
    subdomain: "\u5F71\u50CF\u3001\u751F\u7406\u4E0E\u533B\u5B66\u7814\u7A76",
    source: "scientific"
  },
  {
    name: "scvelo",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "scvi-tools",
    direction: "analysis",
    subdomain: "\u8F6C\u5F55\u7EC4\u4E0E\u5355\u7EC6\u80DE",
    source: "scientific"
  },
  {
    name: "seaborn",
    direction: "presentation",
    subdomain: "\u6570\u636E\u56FE\u8868",
    source: "scientific"
  },
  {
    name: "shap",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "simpy",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "stable-baselines3",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "statistical-analysis",
    direction: "analysis",
    subdomain: "\u7EDF\u8BA1\u5EFA\u6A21\u4E0E\u4E0D\u786E\u5B9A\u6027",
    source: "scientific"
  },
  {
    name: "statistical-power",
    direction: "planning",
    subdomain: "\u9009\u9898\u3001\u5047\u8BBE\u4E0E\u5B9E\u9A8C\u8BBE\u8BA1",
    source: "scientific"
  },
  {
    name: "statsmodels",
    direction: "analysis",
    subdomain: "\u7EDF\u8BA1\u5EFA\u6A21\u4E0E\u4E0D\u786E\u5B9A\u6027",
    source: "scientific"
  },
  {
    name: "sympy",
    direction: "analysis",
    subdomain: "\u7269\u7406\u3001\u5730\u7406\u3001\u6750\u6599\u4E0E\u91CF\u5B50",
    source: "scientific"
  },
  {
    name: "tamarind",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "tiledbvcf",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "timesfm-forecasting",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "torch-geometric",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "torchdrug",
    direction: "analysis",
    subdomain: "\u5316\u5B66\u3001\u5206\u5B50\u4E0E\u836F\u7269",
    source: "scientific"
  },
  {
    name: "transformers",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "treatment-plans",
    direction: "writing",
    subdomain: "\u4E13\u5229\u4E0E\u4E13\u4E1A\u62A5\u544A\uFF08\u53D7\u9650\u5206\u652F\uFF09",
    source: "scientific"
  },
  {
    name: "umap-learn",
    direction: "analysis",
    subdomain: "\u673A\u5668\u5B66\u4E60\u3001\u65F6\u95F4\u5E8F\u5217\u4E0E\u89E3\u91CA",
    source: "scientific"
  },
  {
    name: "uncertainty-and-units",
    direction: "analysis",
    subdomain: "\u7EDF\u8BA1\u5EFA\u6A21\u4E0E\u4E0D\u786E\u5B9A\u6027",
    source: "scientific"
  },
  {
    name: "usfiscaldata",
    direction: "evidence",
    subdomain: "\u4E13\u4E1A\u6570\u636E\u5E93\u4E0E\u6807\u8BC6",
    source: "scientific"
  },
  {
    name: "vaex",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "venue-templates",
    direction: "writing",
    subdomain: "\u62A5\u544A\u89C4\u8303\u3001\u7EDF\u8BA1\u5448\u73B0\u4E0E\u6570\u636E\u58F0\u660E",
    source: "scientific"
  },
  {
    name: "waypoint-bio",
    direction: "analysis",
    subdomain: "\u57FA\u56E0\u7EC4\u3001\u5E8F\u5217\u4E0E\u8FDB\u5316",
    source: "scientific"
  },
  {
    name: "what-if-oracle",
    direction: "planning",
    subdomain: "\u63A2\u7D22\u6027\u63A8\u6F14\uFF08\u975E\u6838\u5FC3\uFF09",
    source: "scientific"
  },
  {
    name: "xlsx",
    direction: "presentation",
    subdomain: "\u6587\u6863\u4E0E\u8868\u683C\u683C\u5F0F\uFF08\u5F85\u8BB8\u53EF\u590D\u6838\uFF09",
    source: "scientific"
  },
  {
    name: "zarr-python",
    direction: "analysis",
    subdomain: "\u6570\u636E\u6574\u7406\u3001\u5B58\u50A8\u4E0E\u6EAF\u6E90",
    source: "scientific"
  },
  {
    name: "academic-paper-reviewer",
    direction: "writing",
    subdomain: "\u5BA1\u7A3F\u3001\u56DE\u590D\u4E0E\u8BC4\u4EF7",
    source: "academic"
  },
  {
    name: "academic-paper",
    direction: "writing",
    subdomain: "\u6B63\u6587\u4E0E\u8BED\u8A00\u7F16\u8F91",
    source: "academic"
  },
  {
    name: "academic-pipeline",
    direction: "planning",
    subdomain: "\u5B8C\u6574\u79D1\u7814\u8BA1\u5212\uFF08\u663E\u5F0F\u6A21\u5F0F\uFF09",
    source: "academic"
  },
  {
    name: "deep-research",
    direction: "evidence",
    subdomain: "\u8BC1\u636E\u68C0\u7D22\u4E0E\u7EFC\u8FF0",
    source: "academic"
  },
  {
    name: "research-show-me",
    direction: "presentation",
    subdomain: "\u89E3\u91CA\u56FE\u4E0E\u89C6\u89C9\u7D20\u6750",
    source: "project"
  },
  {
    name: "research-vault",
    direction: "evidence",
    subdomain: "\u77E5\u8BC6\u5E93\u4E0E\u6587\u732E\u5E93",
    source: "project"
  },
  {
    name: "research-workflow",
    direction: "internal",
    subdomain: "\u8BC1\u636E\u4E0E\u4EFB\u52A1\u63A7\u5236/\u5171\u4EAB\u8D44\u6E90",
    source: "project"
  },
  {
    name: "zotero-literature",
    direction: "evidence",
    subdomain: "\u77E5\u8BC6\u5E93\u4E0E\u6587\u732E\u5E93",
    source: "project"
  },
  {
    name: "channel-pickup",
    direction: "engineering",
    subdomain: "\u4EA4\u63A5\u4E0E\u5E94\u7528\u5B9A\u5236",
    source: "project"
  },
  {
    name: "design-handoff",
    direction: "engineering",
    subdomain: "\u4EA4\u63A5\u4E0E\u5E94\u7528\u5B9A\u5236",
    source: "project"
  },
  {
    name: "drone-ui-plugin",
    direction: "engineering",
    subdomain: "\u4EA4\u63A5\u4E0E\u5E94\u7528\u5B9A\u5236",
    source: "project"
  }
];

// packages/shared/src/workflow-catalog.ts
var WORKFLOW_PROFILES = workflow_profiles_default;
var byName = new Map(WORKFLOW_PROFILES.map((p) => [p.name, p]));
var WORKFLOW_STAGES = [
  {
    id: "ideation",
    direction: "planning",
    label: {
      zh: "\u79D1\u7814\u9009\u9898\u4E0E\u5047\u8BBE",
      en: "Questions and hypotheses"
    },
    commands: ["skill:hypothesis-generation", "skill:scientific-brainstorming"],
    contract: "Question, rival hypotheses, discriminating evidence; no claim of completed experiments."
  },
  {
    id: "methods",
    direction: "planning",
    label: {
      zh: "\u5B9E\u9A8C\u8BBE\u8BA1",
      en: "Experimental design"
    },
    commands: ["skill:experimental-design"],
    contract: "Design, experimental units, controls and assumptions before data collection."
  },
  {
    id: "power",
    direction: "planning",
    label: {
      zh: "\u6837\u672C\u91CF\u4E0E\u7EDF\u8BA1\u6548\u80FD",
      en: "Sample size and power"
    },
    commands: ["skill:statistical-power"],
    contract: "Prospective sample-size assumptions, effect size and uncertainty."
  },
  {
    id: "grants",
    direction: "planning",
    label: {
      zh: "\u5F00\u9898\u4E0E\u9879\u76EE\u7533\u8BF7",
      en: "Proposals and grants"
    },
    commands: ["skill:researchwrite", "skill:research-grants"],
    contract: "Evidence-grounded proposal; preserve the selected funder or opening-report format."
  },
  {
    id: "pipeline",
    direction: "planning",
    label: {
      zh: "ARS \u5B8C\u6574\u9879\u76EE \xB7 \u9010\u9636\u6BB5\u786E\u8BA4",
      en: "ARS full project \xB7 stage confirmations"
    },
    commands: ["ars-full"],
    contract: "ARS original stage confirmations and resume semantics; host owns task state."
  },
  {
    id: "search",
    direction: "evidence",
    label: {
      zh: "\u6587\u732E\u53D1\u73B0",
      en: "Literature discovery"
    },
    commands: ["skill:nature-academic-search", "skill:paper-lookup", "skill:research-lookup"],
    contract: "Bounded search scope, provenance and failures; a search hit is not a source read."
  },
  {
    id: "reading",
    direction: "evidence",
    label: {
      zh: "\u8BBA\u6587\u9605\u8BFB\u4E0E\u5BF9\u7167\u7FFB\u8BD1",
      en: "Paper reading and translation"
    },
    commands: ["skill:nature-reader"],
    contract: "Source-linked reading within requested scope; do not translate the full paper for a local question."
  },
  {
    id: "paperCard",
    direction: "evidence",
    label: {
      zh: "\u8BBA\u6587\u8BC1\u636E\u5361",
      en: "Evidence-grounded paper card"
    },
    commands: ["skill:nature-paper-card"],
    contract: "Reuse supplied reader source maps; mark unsupported sections rather than invent evidence."
  },
  {
    id: "synthesis",
    direction: "evidence",
    label: {
      zh: "\u7CFB\u7EDF\u6587\u732E\u7EFC\u8FF0",
      en: "Systematic literature review"
    },
    commands: ["skill:literature-review"],
    contract: "Search, eligibility and synthesis; no mandatory AI images, payments or uploads."
  },
  {
    id: "citation",
    direction: "evidence",
    label: {
      zh: "\u5F15\u6587\u6838\u9A8C\u4E0E\u5BFC\u51FA",
      en: "Citation verification and export"
    },
    commands: ["skill:nature-ref-verifier", "skill:citation-management"],
    contract: "Bibliographic identity and formatting are distinct from scientific claim support."
  },
  {
    id: "library",
    direction: "evidence",
    label: {
      zh: "Zotero \u6587\u732E\u5E93",
      en: "Zotero library"
    },
    commands: ["skill:zotero-literature"],
    contract: "Use host-controlled library writes and separate Zotero/Vault receipts."
  },
  {
    id: "vault",
    direction: "evidence",
    label: {
      zh: "\u77E5\u8BC6\u5E93\u68C0\u7D22\u4E0E\u7EF4\u62A4",
      en: "Knowledge retrieval and maintenance"
    },
    commands: ["skill:research-vault"],
    contract: "Keep application binding, evidence reads and Wiki approval under host control."
  },
  {
    id: "subscription",
    direction: "evidence",
    label: {
      zh: "\u6587\u732E\u8BA2\u9605 \xB7 \u9700\u6388\u6743\u63A8\u9001",
      en: "Literature feeds \xB7 authorized delivery"
    },
    commands: ["skill:nature-literature-pipeline"],
    contract: "Subscription is not publication orchestration; scheduling and delivery require authorization."
  },
  {
    id: "explore",
    direction: "analysis",
    label: {
      zh: "\u6570\u636E\u63A2\u7D22\u4E0E\u8D28\u91CF\u68C0\u67E5",
      en: "Data exploration and QC"
    },
    commands: ["skill:exploratory-data-analysis"],
    contract: "Inspect supplied data locally and disclose supported formats and actual executed checks."
  },
  {
    id: "statistics",
    direction: "analysis",
    label: {
      zh: "\u7EDF\u8BA1\u5206\u6790",
      en: "Statistical analysis"
    },
    commands: ["skill:statistical-analysis"],
    contract: "Assumptions, effect sizes, uncertainty and provenance; do not infer analysis from manuscript prose."
  },
  {
    id: "rnaseq",
    direction: "analysis",
    label: {
      zh: "Bulk RNA-seq",
      en: "Bulk RNA-seq"
    },
    commands: ["skill:bulk-rnaseq"],
    contract: "Enter at the supplied input stage; existing counts must not trigger a fresh FASTQ pipeline."
  },
  {
    id: "de",
    direction: "analysis",
    label: {
      zh: "\u5DF2\u6709\u8BA1\u6570\u7684\u5DEE\u5F02\u8868\u8FBE",
      en: "Differential expression from counts"
    },
    commands: ["skill:pydeseq2"],
    contract: "Validate counts, biological replicates, design and contrasts before differential expression."
  },
  {
    id: "enrichment",
    direction: "analysis",
    label: {
      zh: "\u901A\u8DEF\u4E0E\u57FA\u56E0\u96C6\u5BCC\u96C6",
      en: "Pathway enrichment"
    },
    commands: ["skill:pathway-enrichment"],
    contract: "Preserve gene identifiers, method and background universe."
  },
  {
    id: "singlecell",
    direction: "analysis",
    label: {
      zh: "\u5355\u7EC6\u80DE\u6807\u51C6\u5206\u6790",
      en: "Standard single-cell analysis"
    },
    commands: ["skill:scanpy"],
    contract: "Standard analysis; keep AnnData structure and specialized models as distinct modules."
  },
  {
    id: "bioinformatics",
    direction: "analysis",
    label: {
      zh: "\u5E8F\u5217\u3001\u540C\u6E90\u4E0E\u7ED3\u6784\u57DF\u5206\u6790",
      en: "Sequence, homology and domain analysis"
    },
    commands: ["skill:scikit-bio", "skill:waypoint-bio"],
    contract: "Resolve species and accessions first, preserve database/release evidence, use a reproducible alignment or annotation method, and report unsupported species or missing annotations instead of improvising an unbounded remote script."
  },
  {
    id: "phylogeny",
    direction: "analysis",
    label: {
      zh: "\u7CFB\u7EDF\u53D1\u80B2\u5EFA\u6811\u4E0E\u6E32\u67D3",
      en: "Phylogenetic tree building and rendering"
    },
    commands: ["skill:phylogenetics", "skill:etetoolkit"],
    contract: "Resolve taxa and accessions first, align (MAFFT), trim (trimAl) and infer the tree (IQ-TREE/FastTree) with recorded versions and models, then render with ETE; if a tool is missing, check bio_environment and propose a mamba/bioconda environment instead of stopping."
  },
  {
    id: "chemistry",
    direction: "analysis",
    label: {
      zh: "\u5316\u5B66\u4FE1\u606F\u4E0E\u5206\u5B50\u5904\u7406",
      en: "Cheminformatics"
    },
    commands: ["skill:rdkit", "skill:datamol"],
    contract: "Choose molecular operations explicitly; docking, dynamics and property prediction are different tasks."
  },
  {
    id: "writing",
    direction: "writing",
    label: {
      zh: "\u8BBA\u6587\u8D77\u8349\u4E0E\u91CD\u6784",
      en: "Draft or restructure a manuscript"
    },
    commands: ["skill:nature-writing", "skill:scientific-writing"],
    contract: "Complete the requested section; preserve evidence scope and do not force a full pipeline."
  },
  {
    id: "polishing",
    direction: "writing",
    label: {
      zh: "\u8BED\u8A00\u6DA6\u8272\u4E0E\u5B66\u672F\u7FFB\u8BD1",
      en: "Polish or translate prose"
    },
    commands: ["skill:nature-polishing"],
    contract: "Preserve facts and terminology; no new study design or automatic full rewrite."
  },
  {
    id: "review",
    direction: "writing",
    label: {
      zh: "\u666E\u901A\u5BA1\u6821",
      en: "Manuscript assessment"
    },
    commands: ["skill:peer-review"],
    contract: "Evidence-bounded assessment with confidentiality and venue-policy checks."
  },
  {
    id: "blindReview",
    direction: "writing",
    label: {
      zh: "Nature \u4E09\u4EFD\u4E92\u76F2\u8BC4\u5BA1",
      en: "Nature: three blind reviews"
    },
    commands: ["skill:nature-reviewer"],
    contract: "Three genuinely isolated reports frozen before synthesis; disclose inability to isolate."
  },
  {
    id: "arsReview",
    direction: "writing",
    label: {
      zh: "ARS \u4E94\u5E2D\u89D2\u8272\u8BC4\u8BAE",
      en: "ARS: five-seat role-separated panel"
    },
    commands: ["ars-reviewer"],
    contract: "Original five-seat contract and provenance; role separation is not independent error processes."
  },
  {
    id: "response",
    direction: "writing",
    label: {
      zh: "\u9010\u70B9\u56DE\u590D\u4E0E\u8FD4\u4FEE",
      en: "Respond to reviewers"
    },
    commands: ["skill:nature-response"],
    contract: "Respond to actual reviewer comments and trace manuscript changes; do not run another review panel."
  },
  {
    id: "reporting",
    direction: "writing",
    label: {
      zh: "\u7EDF\u8BA1\u62A5\u544A\u5BA1\u67E5",
      en: "Statistical reporting audit"
    },
    commands: ["skill:nature-statistics"],
    contract: "Review reported units, replication and uncertainty; compute only if requested with data."
  },
  {
    id: "availability",
    direction: "writing",
    label: {
      zh: "\u6570\u636E\u4E0E\u4EE3\u7801\u53EF\u7528\u6027\u58F0\u660E",
      en: "Data/code availability statements"
    },
    commands: ["skill:nature-data"],
    contract: "Availability/FAIR statements, not data cleaning; never invent accessions or permissions."
  },
  {
    id: "patent",
    direction: "writing",
    label: {
      zh: "\u4E13\u5229\u6280\u672F\u4EA4\u5E95",
      en: "Patent disclosure drafting"
    },
    commands: ["skill:nature-paper-to-patent"],
    contract: "Source-grounded disclosure with original stage gates; do not infer inventorship or rights."
  },
  {
    id: "figures",
    direction: "presentation",
    label: {
      zh: "\u771F\u5B9E\u6570\u636E\u56FE\u8868",
      en: "Data-backed figures"
    },
    commands: ["skill:nature-figure", "skill:scientific-visualization"],
    contract: "Truthful data, uncertainty and accessible figures; AI diagrams are not data plots."
  },
  {
    id: "slides",
    direction: "presentation",
    label: {
      zh: "\u8BBA\u6587\u6C47\u62A5\u4E0E\u6F14\u793A",
      en: "Research presentations"
    },
    commands: ["skill:nature-paper2ppt", "skill:scientific-slides"],
    contract: "Preserve source figures, speaker notes and requested output format."
  },
  {
    id: "reconstruct",
    direction: "presentation",
    label: {
      zh: "\u56FE\u7247\u91CD\u5EFA\u53EF\u7F16\u8F91 PPT",
      en: "Editable slides from images"
    },
    commands: ["skill:nature-image2ppt"],
    contract: "Reconstruct object-level editable slides; this is not authoring a new deck."
  },
  {
    id: "poster",
    direction: "presentation",
    label: {
      zh: "LaTeX \u5B66\u672F\u6D77\u62A5",
      en: "LaTeX research poster"
    },
    commands: ["skill:latex-posters"],
    contract: "Deliver the requested poster format using authorized content and assets."
  },
  {
    id: "pptPoster",
    direction: "presentation",
    label: {
      zh: "\u53EF\u7F16\u8F91 PPT \u6D77\u62A5",
      en: "Editable PowerPoint poster"
    },
    commands: ["skill:pptx-posters"],
    contract: "Preserve editable poster objects; do not silently substitute a PDF-only artifact."
  },
  {
    id: "explainer",
    direction: "presentation",
    label: {
      zh: "\u6765\u6E90\u53EF\u8FFD\u6EAF\u7684\u89E3\u91CA\u9875",
      en: "Source-grounded explainer"
    },
    commands: ["skill:research-show-me"],
    contract: "Static self-contained presentation, not evidence; use authorized artifact sinks."
  },
  {
    id: "handoff",
    direction: "engineering",
    label: {
      zh: "\u8BBE\u8BA1\u5E76\u4EA4\u63A5\u4EFB\u52A1",
      en: "Design and hand off work"
    },
    commands: ["skill:design-handoff"],
    contract: "Produce spec, plan and HANDOFF; notify in batches and preserve channel protocol."
  },
  {
    id: "pickup",
    direction: "engineering",
    label: {
      zh: "\u63A5\u624B\u5DF2\u6709\u4EA4\u63A5",
      en: "Pick up a handoff"
    },
    commands: ["skill:channel-pickup"],
    contract: "Read HANDOFF/spec/plan; verify changes, report completion and unsubscribe at termination."
  },
  {
    id: "plugin",
    direction: "engineering",
    label: {
      zh: "\u5B9A\u5236 Drone \u754C\u9762",
      en: "Customize Drone UI"
    },
    commands: ["skill:drone-ui-plugin"],
    contract: "Respect UI plugin SPEC, sandbox and user-only enablement; do not auto-enable."
  },
  {
    id: "resources",
    direction: "engineering",
    label: {
      zh: "\u68C0\u67E5\u8BA1\u7B97\u8D44\u6E90",
      en: "Inspect compute resources"
    },
    commands: ["skill:get-available-resources"],
    contract: "Bounded inventory only; no installation, cloud job or paid resource reservation."
  },
  {
    id: "nextflow",
    direction: "engineering",
    label: {
      zh: "Nextflow \u7BA1\u7EBF",
      en: "Nextflow pipelines"
    },
    commands: ["skill:nextflow"],
    contract: "Preserve samplesheets, executor/container versions and execution authorization."
  }
];
var WORKFLOW_OWNER_NAMES = /* @__PURE__ */ new Set([
  ...WORKFLOW_STAGES.flatMap((s) => s.commands.filter((n) => n.startsWith("skill:")).map((n) => n.slice(6))),
  "academic-paper",
  "academic-paper-reviewer",
  "academic-pipeline",
  "deep-research"
]);

// packages/shared/src/research-skills.ts
var RESEARCH_SKILL_SOURCES = research_skill_sources_default.sources;
var profiles = new Map(
  research_skill_sources_default.sources.flatMap(
    (source) => source.skills.map(
      (skill) => [skill.name, { ...skill, source: source.id }]
    )
  )
);

// packages/shared/src/skill-catalog.ts
var groups = {
  knowledge: ["research-vault", "nature-experiment-log"],
  research: [
    "research-workflow",
    "zotero-literature",
    "bio-environment",
    "research",
    "nature-academic-search",
    "nature-downloader",
    "nature-literature-pipeline",
    "nature-paper-card",
    "nature-reader",
    "nature-ref-verifier",
    "nature-statistics"
  ],
  writing: [
    "nature-citation",
    "nature-data",
    "nature-paper-to-patent",
    "nature-polishing",
    "nature-response",
    "nature-reviewer",
    "nature-writing",
    "researchwrite",
    "writing-beats",
    "writing-for-agents",
    "writing-fragments",
    "writing-great-skills",
    "writing-shape"
  ],
  presentation: [
    "show-me",
    "teach",
    "nature-figure",
    "nature-image2ppt",
    "nature-paper2ppt",
    "drone-ui-plugin"
  ],
  engineering: [
    "code-review",
    "codebase-design",
    "diagnosing-bugs",
    "domain-modeling",
    "git-guardrails-claude-code",
    "grill-me",
    "grill-with-docs",
    "grilling",
    "implement",
    "implement-spec",
    "improve-codebase-architecture",
    "loop-me",
    "migrate-to-shoehorn",
    "prototype",
    "resolving-merge-conflicts",
    "retro",
    "scaffold-exercises",
    "tdd",
    "to-questionnaire",
    "to-spec",
    "to-tickets",
    "triage",
    "wait-what",
    "wayfinder"
  ],
  collaboration: [
    "channel-pickup",
    "design-handoff",
    "claude-handoff",
    "codexhost-delegation",
    "handoff",
    "council-mode",
    "pi-subagents",
    "ask-user",
    "ask-matt",
    "find-skills",
    "wizard",
    "mcp-scripting"
  ],
  support: ["nature-shared"]
};
var categoryByName = new Map(
  Object.entries(groups).flatMap(
    ([category, names]) => (names ?? []).map((name) => [name, category])
  )
);

// packages/shared/src/compute.ts
var ComputeIdSchema = typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" });
var ComputeHostKindSchema = typebox_exports.Union([
  typebox_exports.Literal("ssh"),
  typebox_exports.Literal("scheduler"),
  typebox_exports.Literal("local")
]);
var ComputeHealthStatusSchema = typebox_exports.Union([
  typebox_exports.Literal("unknown"),
  typebox_exports.Literal("checking"),
  typebox_exports.Literal("healthy"),
  typebox_exports.Literal("degraded"),
  typebox_exports.Literal("offline"),
  typebox_exports.Literal("blocked")
]);
var ComputeAuthStateSchema = typebox_exports.Union([
  typebox_exports.Literal("not_configured"),
  typebox_exports.Literal("ready"),
  typebox_exports.Literal("needs_login"),
  typebox_exports.Literal("rejected")
]);
var ComputeCapabilitySchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    version: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 })),
    available: typebox_exports.Boolean(),
    details: typebox_exports.Optional(typebox_exports.String({ maxLength: 512 }))
  },
  { additionalProperties: false }
);
var ComputeResourcesSchema = typebox_exports.Object(
  {
    cpuCores: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 1e6 })),
    memoryBytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    gpuCount: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0, maximum: 1e6 })),
    diskFreeBytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
  },
  { additionalProperties: false }
);
var ComputeHostSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    alias: typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._-]+$" }),
    displayName: typebox_exports.String({ minLength: 1, maxLength: 160 }),
    kind: ComputeHostKindSchema,
    endpoint: typebox_exports.Optional(typebox_exports.String({ maxLength: 512, pattern: "^[^@]*$" })),
    port: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 65535 })),
    user: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 })),
    platform: typebox_exports.Optional(typebox_exports.String({ maxLength: 64 })),
    arch: typebox_exports.Optional(typebox_exports.String({ maxLength: 64 })),
    workspaceRoot: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    authState: ComputeAuthStateSchema,
    managed: typebox_exports.Boolean(),
    health: typebox_exports.Object(
      {
        status: ComputeHealthStatusSchema,
        checkedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
        latencyMs: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
        version: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 })),
        details: typebox_exports.Optional(typebox_exports.String({ maxLength: 512 })),
        errorCode: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 }))
      },
      { additionalProperties: false }
    ),
    capabilities: typebox_exports.Array(ComputeCapabilitySchema, { maxItems: 256 }),
    resources: typebox_exports.Optional(ComputeResourcesSchema),
    createdAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    updatedAt: typebox_exports.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);
var ComputeHostInputSchema = typebox_exports.Object(
  {
    alias: typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._-]+$" }),
    displayName: typebox_exports.String({ minLength: 1, maxLength: 160 }),
    kind: ComputeHostKindSchema,
    endpoint: typebox_exports.Optional(typebox_exports.String({ maxLength: 512, pattern: "^[^@]*$" })),
    port: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 65535 })),
    user: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 })),
    identityFile: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    jumpHosts: typebox_exports.Optional(
      typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._-]+$" }), { maxItems: 8 })
    ),
    hostKeyFingerprint: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    workspaceRoot: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    managed: typebox_exports.Optional(typebox_exports.Boolean())
  },
  { additionalProperties: false }
);
var ComputeBudgetSchema = typebox_exports.Object(
  {
    /** Total CPU core-hours allowed for this task. */
    maxCoreHours: typebox_exports.Number({ minimum: 0, maximum: 1e9 }),
    /** Longest wall-clock duration of one job. */
    maxWalltimeMinutes: typebox_exports.Integer({ minimum: 1, maximum: 2e6 }),
    maxConcurrentJobs: typebox_exports.Integer({ minimum: 1, maximum: 1e4 }),
    maxDiskGb: typebox_exports.Integer({ minimum: 1, maximum: 1e6 })
  },
  { additionalProperties: false }
);
var ComputeSha256Schema = typebox_exports.String({ pattern: "^[a-fA-F0-9]{64}$" });
var ComputeDatasetFileSchema = typebox_exports.Object(
  {
    path: typebox_exports.String({ minLength: 1, maxLength: 1024 }),
    bytes: typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    sha256: ComputeSha256Schema,
    mediaType: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 }))
  },
  { additionalProperties: false }
);
var ComputeDatasetSourceSchema = typebox_exports.Object(
  {
    kind: typebox_exports.Union([
      typebox_exports.Literal("local"),
      typebox_exports.Literal("public"),
      typebox_exports.Literal("generated"),
      typebox_exports.Literal("imported")
    ]),
    uri: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 2048 })),
    accession: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    license: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 512 }))
  },
  { additionalProperties: false }
);
var ComputeDatasetVersionSchema = typebox_exports.Object(
  {
    datasetId: ComputeIdSchema,
    versionId: typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^sha256:[a-fA-F0-9]{64}$" }),
    contentSha256: ComputeSha256Schema,
    schemaVersion: typebox_exports.Integer({ minimum: 1, maximum: 100 }),
    files: typebox_exports.Array(ComputeDatasetFileSchema, { maxItems: 1e6 }),
    sizeBytes: typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    source: typebox_exports.Optional(ComputeDatasetSourceSchema),
    createdAt: typebox_exports.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);
var ComputeDatasetVersionRefSchema = typebox_exports.Object(
  {
    datasetId: ComputeIdSchema,
    versionId: typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^sha256:[a-fA-F0-9]{64}$" })
  },
  { additionalProperties: false }
);
var ComputeSampleColumnSchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    type: typebox_exports.Union([
      typebox_exports.Literal("string"),
      typebox_exports.Literal("integer"),
      typebox_exports.Literal("number"),
      typebox_exports.Literal("boolean")
    ]),
    required: typebox_exports.Optional(typebox_exports.Boolean()),
    unique: typebox_exports.Optional(typebox_exports.Boolean()),
    allowedValues: typebox_exports.Optional(
      typebox_exports.Array(typebox_exports.Union([typebox_exports.String(), typebox_exports.Number(), typebox_exports.Boolean()]), { maxItems: 512 })
    )
  },
  { additionalProperties: false }
);
var ComputeSampleSheetSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    version: typebox_exports.Integer({ minimum: 1, maximum: 100 }),
    idColumn: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    columns: typebox_exports.Array(ComputeSampleColumnSchema, { minItems: 1, maxItems: 512 })
  },
  { additionalProperties: false }
);
var ComputeStatisticalAnalysisPlanSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    version: typebox_exports.Integer({ minimum: 1, maximum: 100 }),
    outcome: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    design: typebox_exports.Union([
      typebox_exports.Literal("two-group"),
      typebox_exports.Literal("paired"),
      typebox_exports.Literal("factorial"),
      typebox_exports.Literal("regression")
    ]),
    primaryTest: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    alpha: typebox_exports.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1 }),
    targetPower: typebox_exports.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1 }),
    effectSize: typebox_exports.Number({ exclusiveMinimum: 0 }),
    totalSampleSize: typebox_exports.Optional(typebox_exports.Integer({ minimum: 2, maximum: 1e7 })),
    perGroupSampleSize: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 5e6 })),
    groups: typebox_exports.Optional(
      typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { minItems: 2, maxItems: 256 })
    ),
    covariates: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 })),
    datasetVersion: typebox_exports.Optional(ComputeDatasetVersionRefSchema),
    sampleSheetSchemaId: typebox_exports.Optional(ComputeIdSchema)
  },
  { additionalProperties: false }
);
var ComputeDescriptiveAnalysisPlanSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    version: typebox_exports.Integer({ minimum: 1, maximum: 100 }),
    outcome: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    design: typebox_exports.Literal("descriptive"),
    primaryTest: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    datasetVersion: typebox_exports.Optional(ComputeDatasetVersionRefSchema),
    sampleSheetSchemaId: typebox_exports.Optional(ComputeIdSchema)
  },
  { additionalProperties: false }
);
var ComputeAnalysisPlanSchema = typebox_exports.Union([
  ComputeStatisticalAnalysisPlanSchema,
  ComputeDescriptiveAnalysisPlanSchema
]);
var ComputePublicDataFetchRecordSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    uri: typebox_exports.String({ minLength: 1, maxLength: 2048 }),
    accession: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    source: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    license: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 512 })),
    termsAccepted: typebox_exports.Boolean(),
    fetchedAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    bytes: typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    sha256: ComputeSha256Schema
  },
  { additionalProperties: false }
);
var ComputeDataDesignContractSchema = typebox_exports.Object(
  {
    datasetVersion: ComputeDatasetVersionRefSchema,
    sampleSheetSchemaId: ComputeIdSchema,
    sampleSheetSha256: ComputeSha256Schema,
    analysisPlanId: ComputeIdSchema,
    analysisPlanSha256: ComputeSha256Schema,
    fetchRecordIds: typebox_exports.Optional(typebox_exports.Array(ComputeIdSchema, { maxItems: 256 }))
  },
  { additionalProperties: false }
);
var ComputeAuthorizationSchema = typebox_exports.Object(
  {
    hosts: typebox_exports.Array(ComputeIdSchema, { minItems: 1, maxItems: 32 }),
    remoteRead: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 }),
    remoteWrite: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 }),
    budget: ComputeBudgetSchema,
    workflows: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 256 }), { maxItems: 128 }),
    agentCode: typebox_exports.Optional(typebox_exports.Boolean()),
    /** B7 records are optional for legacy compute tasks and required by B7-aware hosts. */
    dataDesign: typebox_exports.Optional(ComputeDataDesignContractSchema)
  },
  { additionalProperties: false }
);
var ComputeUsageSchema = typebox_exports.Object(
  {
    coreHours: typebox_exports.Number({ minimum: 0 }),
    activeJobs: typebox_exports.Integer({ minimum: 0 }),
    diskBytes: typebox_exports.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);
var ComputeJobProcessSchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    label: typebox_exports.Optional(typebox_exports.String({ maxLength: 160 })),
    total: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    completed: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    running: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    queued: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    failed: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    cached: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 }))
  },
  { additionalProperties: false }
);
var ComputeJobProgressSchema = typebox_exports.Object(
  {
    stage: typebox_exports.Optional(typebox_exports.String({ maxLength: 160 })),
    completedTasks: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    totalTasks: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    runningTasks: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    queuedTasks: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    failedTasks: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    processes: typebox_exports.Array(ComputeJobProcessSchema, { maxItems: 512 }),
    tracePath: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    timelinePath: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    reportPath: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    multiqcPath: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    failureReason: typebox_exports.Optional(typebox_exports.String({ maxLength: 1e3 }))
  },
  { additionalProperties: false }
);
var ComputeJobSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    hostId: ComputeIdSchema,
    taskId: typebox_exports.Optional(ComputeIdSchema),
    sessionId: typebox_exports.Optional(ComputeIdSchema),
    state: typebox_exports.Union([
      typebox_exports.Literal("queued"),
      typebox_exports.Literal("running"),
      typebox_exports.Literal("succeeded"),
      typebox_exports.Literal("failed"),
      typebox_exports.Literal("cancelled"),
      typebox_exports.Literal("unknown")
    ]),
    label: typebox_exports.Optional(typebox_exports.String({ maxLength: 160 })),
    startedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    finishedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    exitCode: typebox_exports.Optional(typebox_exports.Integer()),
    budget: typebox_exports.Object(
      {
        coreHours: typebox_exports.Number({ minimum: 0 }),
        wallMinutes: typebox_exports.Number({ minimum: 0 }),
        diskBytes: typebox_exports.Number({ minimum: 0 })
      },
      { additionalProperties: false }
    ),
    publicSummary: typebox_exports.Optional(typebox_exports.String({ maxLength: 1e3 })),
    progress: typebox_exports.Optional(ComputeJobProgressSchema),
    artifacts: typebox_exports.Array(
      typebox_exports.Object(
        {
          name: typebox_exports.String({ minLength: 1, maxLength: 256 }),
          path: typebox_exports.String({ maxLength: 1024 }),
          sha256: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 }))
        },
        { additionalProperties: false }
      ),
      { maxItems: 256 }
    ),
    updatedAt: typebox_exports.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);
var ComputeJobInputSchema = typebox_exports.Object(
  {
    hostId: ComputeIdSchema,
    idempotencyKey: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    remoteWorkDir: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    workflow: typebox_exports.Object(
      {
        name: typebox_exports.String({ minLength: 1, maxLength: 256 }),
        version: typebox_exports.String({ minLength: 1, maxLength: 128 }),
        source: typebox_exports.Optional(typebox_exports.String({ maxLength: 256 })),
        specHash: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 }))
      },
      { additionalProperties: false }
    ),
    resources: typebox_exports.Optional(
      typebox_exports.Object(
        {
          cpus: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 1e6 })),
          memoryBytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
          wallTimeSeconds: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 1728e5 }))
        },
        { additionalProperties: false }
      )
    ),
    readPaths: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 })),
    writePaths: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 })),
    outputs: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 1024 }), { maxItems: 256 }))
  },
  { additionalProperties: false }
);
var ComputeLogChunkSchema = typebox_exports.Object(
  {
    jobId: ComputeIdSchema,
    cursor: typebox_exports.String({ minLength: 0, maxLength: 256 }),
    text: typebox_exports.String({ maxLength: 1048576 }),
    truncated: typebox_exports.Boolean(),
    at: typebox_exports.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);
var ComputeTerminalSchema = typebox_exports.Object(
  {
    id: ComputeIdSchema,
    hostId: ComputeIdSchema,
    jobId: typebox_exports.Optional(ComputeIdSchema),
    cwd: typebox_exports.String({ maxLength: 1024 }),
    mode: typebox_exports.Union([typebox_exports.Literal("shell"), typebox_exports.Literal("command")]),
    state: typebox_exports.Union([
      typebox_exports.Literal("connecting"),
      typebox_exports.Literal("open"),
      typebox_exports.Literal("needs_login"),
      typebox_exports.Literal("closed"),
      typebox_exports.Literal("error")
    ]),
    output: typebox_exports.String({ maxLength: 131072 }),
    truncated: typebox_exports.Boolean(),
    startedAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    endedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 }))
  },
  { additionalProperties: false }
);
var ComputeOnboardingStepSchema = typebox_exports.Union([
  typebox_exports.Literal("model"),
  typebox_exports.Literal("project"),
  typebox_exports.Literal("knowledge"),
  typebox_exports.Literal("literature"),
  typebox_exports.Literal("mcp"),
  typebox_exports.Literal("remote-host"),
  typebox_exports.Literal("example-task")
]);
var ComputeOnboardingStatusSchema = typebox_exports.Object(
  {
    step: ComputeOnboardingStepSchema,
    state: typebox_exports.Union([
      typebox_exports.Literal("ready"),
      typebox_exports.Literal("needs_action"),
      typebox_exports.Literal("not_configured"),
      typebox_exports.Literal("checking")
    ]),
    summary: typebox_exports.String({ maxLength: 512 }),
    checkedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    action: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 }))
  },
  { additionalProperties: false }
);
var ProfileId = typebox_exports.String({ minLength: 1, maxLength: 256 });
var ProfileAlias = typebox_exports.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" });
var ComputeHostProfileSchema = typebox_exports.Object(
  {
    alias: ProfileAlias,
    host: ProfileId,
    port: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 65535 })),
    username: typebox_exports.Optional(ProfileId),
    transport: typebox_exports.Optional(typebox_exports.Union([typebox_exports.Literal("builtin-ssh"), typebox_exports.Literal("openssh")])),
    identityFile: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })),
    jumpHosts: typebox_exports.Optional(typebox_exports.Array(ProfileAlias, { maxItems: 8 })),
    hostKeyFingerprint: typebox_exports.Optional(typebox_exports.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);
var WorkflowModuleSchema = typebox_exports.Object(
  {
    id: ProfileId,
    source: typebox_exports.Union([typebox_exports.Literal("nf-core"), typebox_exports.Literal("user"), typebox_exports.Literal("agent")]),
    name: ProfileId,
    version: ProfileId,
    commit: typebox_exports.Optional(ProfileId),
    containerDigest: typebox_exports.Optional(ProfileId)
  },
  { additionalProperties: false }
);
var WorkflowStepSchema = typebox_exports.Object(
  {
    id: ProfileId,
    module: WorkflowModuleSchema,
    dependsOn: typebox_exports.Optional(typebox_exports.Array(ProfileId)),
    parameters: typebox_exports.Optional(
      typebox_exports.Record(typebox_exports.String(), typebox_exports.Union([typebox_exports.String(), typebox_exports.Number(), typebox_exports.Boolean()]))
    )
  },
  { additionalProperties: false }
);
var WorkflowSpecSchema = typebox_exports.Object(
  {
    version: typebox_exports.Literal(1),
    modules: typebox_exports.Array(WorkflowModuleSchema),
    steps: typebox_exports.Array(WorkflowStepSchema),
    inputs: typebox_exports.Optional(typebox_exports.Record(typebox_exports.String(), typebox_exports.String())),
    outputs: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String()))
  },
  { additionalProperties: false }
);
var WorkflowRefSchema = typebox_exports.Object(
  {
    name: ProfileId,
    version: ProfileId,
    source: typebox_exports.Optional(ProfileId),
    specHash: typebox_exports.Optional(ProfileId)
  },
  { additionalProperties: false }
);
var ArtifactExpectationSchema = typebox_exports.Object(
  {
    path: typebox_exports.String({ minLength: 1 }),
    bytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    sha256: typebox_exports.Optional(typebox_exports.String({ pattern: "^[a-fA-F0-9]{64}$" })),
    maxBytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 }))
  },
  { additionalProperties: false }
);
var JobSpecSchema = typebox_exports.Object(
  {
    jobId: typebox_exports.Optional(ProfileId),
    idempotencyKey: typebox_exports.Optional(ProfileId),
    hostAlias: ProfileAlias,
    workflow: typebox_exports.Union([WorkflowSpecSchema, WorkflowRefSchema]),
    workDir: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })),
    remoteWorkDir: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })),
    resources: typebox_exports.Optional(
      typebox_exports.Object(
        {
          cpus: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1 })),
          memoryBytes: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
          wallTimeSeconds: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1 }))
        },
        { additionalProperties: false }
      )
    ),
    remoteRead: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String())),
    remoteWrite: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String())),
    outputs: typebox_exports.Optional(typebox_exports.Array(typebox_exports.Union([typebox_exports.String(), ArtifactExpectationSchema])))
  },
  { additionalProperties: false }
);

// packages/shared/src/discovery.ts
var DiscoveryKernelLanguageSchema = typebox_exports.Union([typebox_exports.Literal("python"), typebox_exports.Literal("r")]);
var DiscoveryDataClassificationSchema = typebox_exports.Union([
  typebox_exports.Literal("public"),
  typebox_exports.Literal("internal"),
  typebox_exports.Literal("controlled"),
  typebox_exports.Literal("restricted")
]);
var DiscoveryKernelStatusSchema = typebox_exports.Union([
  typebox_exports.Literal("ready"),
  typebox_exports.Literal("running"),
  typebox_exports.Literal("closed"),
  typebox_exports.Literal("idle-timeout"),
  typebox_exports.Literal("needs-container")
]);
var DiscoveryRunnerKindSchema = typebox_exports.Union([
  typebox_exports.Literal("container"),
  typebox_exports.Literal("fixture"),
  typebox_exports.Literal("unavailable")
]);
var DiscoveryCapabilitiesSchema = typebox_exports.Object(
  {
    kind: DiscoveryRunnerKindSchema,
    languages: typebox_exports.Array(DiscoveryKernelLanguageSchema, { maxItems: 2 }),
    networkDisabled: typebox_exports.Boolean(),
    writesOnlyToRunDirectory: typebox_exports.Boolean()
  },
  { additionalProperties: false }
);
var DiscoveryKernelSessionSchema = typebox_exports.Object(
  {
    sessionId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    language: DiscoveryKernelLanguageSchema,
    dataClassification: DiscoveryDataClassificationSchema,
    runDirectory: typebox_exports.String({ pattern: "^runs/" }),
    status: DiscoveryKernelStatusSchema,
    executionCount: typebox_exports.Integer({ minimum: 0 }),
    remainingExecutions: typebox_exports.Integer({ minimum: 0 }),
    expiresAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    capabilities: DiscoveryCapabilitiesSchema
  },
  { additionalProperties: false }
);
var DiscoveryExecutionSchema = typebox_exports.Object(
  {
    id: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    status: typebox_exports.Union([typebox_exports.Literal("succeeded"), typebox_exports.Literal("failed"), typebox_exports.Literal("blocked")]),
    output: typebox_exports.String({ maxLength: 1e6 }),
    outputClassification: DiscoveryDataClassificationSchema,
    contentKinds: typebox_exports.Array(
      typebox_exports.Union([typebox_exports.Literal("summary"), typebox_exports.Literal("plot"), typebox_exports.Literal("table"), typebox_exports.Literal("raw")]),
      { maxItems: 4 }
    ),
    producedBytes: typebox_exports.Integer({ minimum: 0 }),
    redactedBytes: typebox_exports.Integer({ minimum: 0 }),
    blockedReason: typebox_exports.Optional(typebox_exports.String({ maxLength: 256 }))
  },
  { additionalProperties: false }
);
var DiscoveryCriticQuestionSchema = typebox_exports.Object(
  {
    checklistItem: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    question: typebox_exports.String({ minLength: 1, maxLength: 1e4 }),
    severity: typebox_exports.Union([typebox_exports.Literal("high"), typebox_exports.Literal("medium"), typebox_exports.Literal("low")]),
    evidenceArtifactIds: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 128 })
  },
  { additionalProperties: false }
);
var DiscoveryCriticReviewSchema = typebox_exports.Object(
  {
    findingId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    status: typebox_exports.Union([
      typebox_exports.Literal("complete"),
      typebox_exports.Literal("blocked"),
      typebox_exports.Literal("needs-independent-provider")
    ]),
    providerId: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 128 })),
    questions: typebox_exports.Array(DiscoveryCriticQuestionSchema, { maxItems: 256 }),
    reason: typebox_exports.Optional(typebox_exports.String({ maxLength: 1e4 }))
  },
  { additionalProperties: false }
);
var DiscoveryMultipathAssessmentSchema = typebox_exports.Object(
  {
    planId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    findingId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    grade: typebox_exports.Union([
      typebox_exports.Literal("robust"),
      typebox_exports.Literal("sensitive"),
      typebox_exports.Literal("unstable"),
      typebox_exports.Literal("unknown")
    ]),
    intent: typebox_exports.Union([typebox_exports.Literal("exploratory"), typebox_exports.Literal("confirmatory")]),
    attemptCount: typebox_exports.Integer({ minimum: 0 }),
    consistentCount: typebox_exports.Integer({ minimum: 0 }),
    consistency: typebox_exports.Number({ minimum: 0, maximum: 1 })
  },
  { additionalProperties: false }
);
var DiscoveryExplorationPlanSchema = typebox_exports.Object(
  {
    id: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    projectId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    hypothesisId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    prior: typebox_exports.Unknown(),
    budget: typebox_exports.Object(
      {
        maxExecutions: typebox_exports.Integer({ minimum: 1 }),
        maxWallTimeMs: typebox_exports.Integer({ minimum: 1 }),
        maxOutputBytes: typebox_exports.Integer({ minimum: 1 }),
        maxCostUnits: typebox_exports.Number({ exclusiveMinimum: 0 })
      },
      { additionalProperties: false }
    ),
    rankedCandidateIds: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 1024 }),
    createdAt: typebox_exports.String({ minLength: 1, maxLength: 64 })
  },
  { additionalProperties: false }
);
var DiscoveryEvaluationMetricSchema = typebox_exports.Union([
  typebox_exports.Literal("bixbench-regression"),
  typebox_exports.Literal("rediscovery-rate"),
  typebox_exports.Literal("inconsistency-interception-rate"),
  typebox_exports.Literal("confounder-detection-rate"),
  typebox_exports.Literal("clue-hit-rate"),
  typebox_exports.Literal("verification-time-ms"),
  typebox_exports.Literal("repeated-failure-count")
]);
var DiscoveryEvaluationSchema = typebox_exports.Object(
  {
    runId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    status: typebox_exports.Union([typebox_exports.Literal("complete"), typebox_exports.Literal("needs-data"), typebox_exports.Literal("blocked")]),
    startedAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    finishedAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    missingData: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 }),
    blockedCases: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 }),
    metrics: typebox_exports.Array(
      typebox_exports.Object(
        {
          metric: DiscoveryEvaluationMetricSchema,
          value: typebox_exports.Number({ minimum: 0 }),
          baseline: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
          delta: typebox_exports.Optional(typebox_exports.Number()),
          passed: typebox_exports.Boolean(),
          baselineAvailable: typebox_exports.Boolean(),
          caseIds: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 })
        },
        { additionalProperties: false }
      ),
      { maxItems: 16 }
    )
  },
  { additionalProperties: false }
);

// packages/shared/src/execution.ts
var ExecutionRouteSchema = typebox_exports.Object(
  {
    version: typebox_exports.Literal(1),
    routeId: typebox_exports.Literal("rnaseq"),
    /** Original user text, bounded for display and audit. */
    intent: typebox_exports.String({ minLength: 1, maxLength: 400 }),
    /** Stable task/workflow direction. */
    workflow: typebox_exports.Literal("rnaseq"),
    pipeline: typebox_exports.Literal("nf-core/rnaseq"),
    inputStage: typebox_exports.Literal("fastq"),
    profile: typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$" }),
    samplesheet: typebox_exports.String({ minLength: 1, maxLength: 1024 }),
    genome: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_.-]+$" })),
    outdir: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    remoteWorkDir: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    strandedness: typebox_exports.Optional(
      typebox_exports.Union([typebox_exports.Literal("unstranded"), typebox_exports.Literal("forward"), typebox_exports.Literal("reverse")])
    )
  },
  { additionalProperties: false }
);
var ComputeTaskBindingSchema = typebox_exports.Object(
  {
    version: typebox_exports.Literal(1),
    taskId: typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
    routeId: typebox_exports.Literal("rnaseq"),
    workflowId: typebox_exports.Literal("rnaseq"),
    pipeline: typebox_exports.Literal("nf-core/rnaseq"),
    hostAlias: typebox_exports.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }),
    workflowSpecSha256: typebox_exports.String({ pattern: "^[a-fA-F0-9]{64}$" }),
    samplesheet: typebox_exports.String({ minLength: 1, maxLength: 1024 }),
    outdir: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    remoteWorkDir: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    revision: typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$" }),
    profile: typebox_exports.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$" }),
    executionMode: typebox_exports.Union([typebox_exports.Literal("fixture"), typebox_exports.Literal("production")]),
    idempotencyKey: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    lineage: typebox_exports.Optional(CausalEnvelopeSchema)
  },
  { additionalProperties: false }
);
var ExecutionReceiptStatusSchema = typebox_exports.Union([
  typebox_exports.Literal("preflight_passed"),
  typebox_exports.Literal("submitted"),
  typebox_exports.Literal("queued"),
  typebox_exports.Literal("running"),
  typebox_exports.Literal("succeeded"),
  typebox_exports.Literal("failed"),
  typebox_exports.Literal("unknown"),
  typebox_exports.Literal("blocked")
]);
var ExecutionReceiptSchema = typebox_exports.Object(
  {
    version: typebox_exports.Literal(1),
    executionId: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    status: ExecutionReceiptStatusSchema,
    fixture: typebox_exports.Boolean(),
    route: typebox_exports.Optional(ExecutionRouteSchema),
    binding: typebox_exports.Optional(ComputeTaskBindingSchema),
    workflowSpecSha256: typebox_exports.String({ pattern: "^[a-fA-F0-9]{64}$" }),
    preflight: typebox_exports.Object(
      {
        ok: typebox_exports.Boolean(),
        errors: typebox_exports.Array(typebox_exports.String({ maxLength: 512 }), { maxItems: 64 }),
        warnings: typebox_exports.Array(typebox_exports.String({ maxLength: 512 }), { maxItems: 64 })
      },
      { additionalProperties: false }
    ),
    jobId: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 128 })),
    remoteId: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 256 })),
    createdAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    submittedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    finishedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
    error: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 1024 })),
    lineage: typebox_exports.Optional(CausalEnvelopeSchema)
  },
  { additionalProperties: false }
);

// packages/shared/src/file-types.ts
var TEXT_KINDS = /* @__PURE__ */ new Set([
  "text",
  "code",
  "markdown",
  "json",
  "table",
  "notebook",
  "mermaid",
  "sequence",
  "alignment",
  "tree",
  "html",
  "svg",
  "typst",
  "latex",
  "molecule"
]);
var ROWS = [
  ["txt log out err fai dict", "text/plain", "text"],
  ["md markdown mdown rmd", "text/markdown", "markdown", "markdown"],
  ["json", "application/json", "json", "json"],
  ["jsonl ndjson", "application/x-ndjson", "code", "json"],
  ["csv", "text/csv", "table"],
  ["tsv gff gff3 gtf bed bedgraph vcf sam", "text/tab-separated-values", "table"],
  ["ipynb", "application/x-ipynb+json", "notebook", "json"],
  ["mmd mermaid", "text/vnd.mermaid", "mermaid", "mermaid"],
  ["fa fasta fna faa ffn frn fas fq fastq", "text/x-fasta", "sequence"],
  ["aln clustal clw sto stk stockholm phy phylip afa msa mfa", "text/plain", "alignment"],
  ["nwk newick tree treefile tre contree", "text/x-newick", "tree"],
  ["html htm", "text/html", "html", "html"],
  ["svg", "image/svg+xml", "svg", "xml"],
  ["typ", "text/x-typst", "typst", "typst"],
  ["tex latex", "text/x-latex", "latex", "latex"],
  ["pdb cif mmcif sdf mol mol2 xyz", "chemical/x-pdb", "molecule"],
  ["png", "image/png", "image"],
  ["jpg jpeg", "image/jpeg", "image"],
  ["gif", "image/gif", "image"],
  ["webp", "image/webp", "image"],
  ["bmp", "image/bmp", "image"],
  ["ico", "image/x-icon", "image"],
  ["avif", "image/avif", "image"],
  ["pdf", "application/pdf", "pdf"],
  ["mp3", "audio/mpeg", "audio"],
  ["wav", "audio/wav", "audio"],
  ["ogg oga", "audio/ogg", "audio"],
  ["flac", "audio/flac", "audio"],
  ["m4a aac", "audio/mp4", "audio"],
  ["mp4 m4v", "video/mp4", "video"],
  ["webm", "video/webm", "video"],
  ["mov", "video/quicktime", "video"],
  ["npy", "application/x-npy", "array"],
  ["stl", "model/stl", "mesh"],
  ["obj", "model/obj", "mesh"],
  ["tif tiff", "image/tiff", "tiff"],
  ["nii", "application/x-nifti", "volume"],
  ["mrc map rec ccp4", "application/x-mrc", "volume"],
  ["py pyi pyw ipy smk", "text/x-python", "code", "python"],
  ["r rprofile rhistory rscript", "text/x-r", "code", "r"],
  ["js mjs cjs", "text/javascript", "code", "javascript"],
  ["jsx", "text/javascript", "code", "jsx"],
  ["ts mts cts", "text/typescript", "code", "typescript"],
  ["tsx", "text/typescript", "code", "tsx"],
  ["yml yaml", "text/yaml", "code", "yaml"],
  ["toml", "text/toml", "code", "toml"],
  ["sh bash zsh", "text/x-shellscript", "code", "bash"],
  ["fish", "text/x-shellscript", "code", "fish"],
  ["ps1", "text/plain", "code", "powershell"],
  ["sql", "text/x-sql", "code", "sql"],
  ["c h", "text/x-c", "code", "c"],
  ["cpp hpp cc cxx", "text/x-c++", "code", "cpp"],
  ["java", "text/x-java", "code", "java"],
  ["go", "text/x-go", "code", "go"],
  ["rs", "text/x-rust", "code", "rust"],
  ["css", "text/css", "code", "css"],
  ["scss", "text/x-scss", "code", "scss"],
  ["xml", "application/xml", "code", "xml"],
  ["jl", "text/x-julia", "code", "julia"],
  ["nf", "text/plain", "code", "groovy"],
  ["zip tar 7z rar exe dll so dylib bin", "application/octet-stream", "binary"]
];
var RENDERED_WITH_SOURCE = /* @__PURE__ */ new Set([
  "markdown",
  "json",
  "table",
  "notebook",
  "mermaid",
  "sequence",
  "alignment",
  "tree",
  "html",
  "svg",
  "typst",
  "latex",
  "molecule"
]);
var REGISTRY = /* @__PURE__ */ new Map();
for (const [exts, mime, previewKind, language = "text"] of ROWS)
  for (const ext of exts.split(" "))
    REGISTRY.set(ext, {
      ext,
      mime,
      text: TEXT_KINDS.has(previewKind),
      language,
      previewKind,
      hasSource: RENDERED_WITH_SOURCE.has(previewKind)
    });
var UNKNOWN_FILE_TYPE = Object.freeze({
  ext: "",
  mime: "application/octet-stream",
  text: false,
  language: "text",
  previewKind: "binary",
  hasSource: false
});

// packages/shared/src/harness.ts
var HARNESS_CONTRACT = [
  "Drone harness contract:",
  "- Inspect before assuming: read the relevant files, specifications, and tool results before choosing a method.",
  "- Verify important claims, numbers, and outputs against current evidence or measured results.",
  "- Preserve source data and existing work; keep partial results and state the blocker when a step fails.",
  "- Track the requested deliverables and check the final files under the conditions that will consume them.",
  "- Report evidence and limitations, unresolved questions, and the next observable action precisely.",
  "- Use the available tools and permissions; do not claim work, evidence, or review that did not happen.",
  "- Keep progress updates concise and public. The final answer follows the answer mode below; for code or file work it also names the changed files and checks run.",
  "- Private reasoning stays private; expose actions, observations, decisions, and conclusions that the evidence supports."
].join("\n");
var SCIENCE_CONTRACT = [
  "Scientific contract:",
  "- Inspect relevant files, data, and source records before assuming or fitting.",
  "- Keep observations, interpretations, hypotheses, and unknowns separate.",
  "- Check numbers and generated outputs against the current source or a fresh run.",
  "- Preserve source data and write new results beside existing work; do not silently overwrite or delete.",
  "- Treat simulated data, teacher outputs, pseudo-labels, and self-generated validators as assumptions, not real-world error checks.",
  "- State missing evidence, failed checks, and remaining limitations in the final answer."
].join("\n");
var RESPONSE_CONTRACT = [
  "Response contract:",
  "- Progress narration between tools is short and only reports a new observation, choice, result, or blocker.",
  "- The final answer is the user-facing answer; its length and structure follow the answer mode.",
  "- Never claim a file was saved, a source was read, or a check passed unless the host returned that evidence.",
  "- Keep private reasoning private; expose observable actions, evidence, decisions, and conclusions."
].join("\n");
var OVERLOOKED_POINTS_RULE = 'Only if you found something substantive, end with a short section titled "\u53EF\u80FD\u88AB\u5FFD\u7565\u7684\u70B9" (or "Possibly overlooked" in English) with at most 3 items the user did not ask about: a contradiction between sources, an untested combination, a method from another field, a questionable default assumption, or a next implication of the conclusion. Mark each item as speculative, name its basis (a specific note or paper) and say what experiment or data would test it. Omit the section entirely rather than padding it.';
var QUICK_ANSWER_CONTRACT = [
  "Answer mode: quick.",
  "- Answer the question directly in a few sentences or a short list; no headings.",
  "- Keep only the caveat that changes how the answer should be used.",
  "- Cite a source (Vault path, DOI or URL) only for a specific fact that depends on it; never invent one."
].join("\n");
var ACADEMIC_ANSWER_CONTRACT = [
  "Answer mode: academic. Write the final answer as a scholarly synthesis, in the user's language:",
  "- Structure it as Background and question \u2192 Methods and evidence \u2192 Conclusion, with short headings.",
  "- Cite each substantive claim inline as (Author, Year). End with a numbered References list: authors, year, title, venue, DOI; when the reference has a note in the local Vault, add its Vault path.",
  "- Grade every claim explicitly as established (replicated or consensus), supported by evidence (one or a few studies), or speculative (hypothesis or inference); never upgrade weak evidence.",
  "- Use precise terms, units and numbers together with their conditions (organism, sample size, method) instead of vague qualifiers.",
  "- Never invent a reference, DOI, author or number. If a citation could not be checked against a source you actually read, say so next to it.",
  "- Say which parts came from the local knowledge base and which from the web.",
  `- ${OVERLOOKED_POINTS_RULE}`
].join("\n");

// packages/shared/src/host-api/define.ts
function defineDomain(name, spec) {
  const methods = Object.fromEntries(
    Object.entries(spec.methods).map(([methodName, method]) => [
      methodName,
      { ...method, access: method.access ?? "desktop" }
    ])
  );
  return {
    name,
    methods,
    events: spec.events ?? {}
  };
}

// packages/shared/src/decisions.ts
var DecisionKindSchema = typebox_exports.Union([
  typebox_exports.Literal("task-authorization"),
  typebox_exports.Literal("workflow-repair"),
  typebox_exports.Literal("subagent-dispatch"),
  typebox_exports.Literal("compute-submit"),
  typebox_exports.Literal("zotero-write"),
  typebox_exports.Literal("rebind")
]);
var DecisionRecordSchema = typebox_exports.Object(
  {
    id: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    schemaVersion: typebox_exports.Literal(2),
    projectId: typebox_exports.String({ minLength: 1, maxLength: 512 }),
    kind: DecisionKindSchema,
    summary: typebox_exports.String({ minLength: 1, maxLength: 2e3 }),
    basis: typebox_exports.Array(typebox_exports.String({ maxLength: 512 }), { maxItems: 32 }),
    affectedArtifactIds: typebox_exports.Array(typebox_exports.String({ maxLength: 256 }), { maxItems: 512 }),
    status: typebox_exports.Union([typebox_exports.Literal("active"), typebox_exports.Literal("revoked")]),
    revokedAt: typebox_exports.Optional(typebox_exports.String()),
    revokeReason: typebox_exports.Optional(typebox_exports.String({ maxLength: 2e3 })),
    createdAt: typebox_exports.String()
  },
  { additionalProperties: false }
);
var ProjectIdArgs = typebox_exports.Tuple([typebox_exports.String({ minLength: 1, maxLength: 512 })]);
var RevokeArgs = typebox_exports.Tuple([
  typebox_exports.String({ minLength: 1, maxLength: 256 }),
  typebox_exports.String({ minLength: 1, maxLength: 2e3 })
]);
var ConfirmArgs = typebox_exports.Tuple([
  typebox_exports.String({ minLength: 1, maxLength: 256 }),
  typebox_exports.String({ minLength: 1, maxLength: 2e3 })
]);
var DecisionsContract = defineDomain("decisions", {
  methods: {
    list: {
      args: ProjectIdArgs,
      result: typebox_exports.Array(DecisionRecordSchema, { maxItems: 4096 })
    },
    revoke: {
      args: RevokeArgs,
      result: DecisionRecordSchema
    },
    confirm: {
      args: ConfirmArgs,
      result: DecisionRecordSchema
    }
  },
  events: {}
});

// packages/shared/src/host-api/app.ts
var AppInfoSchema = typebox_exports.Object(
  {
    name: typebox_exports.String(),
    version: typebox_exports.String(),
    electron: typebox_exports.String(),
    chrome: typebox_exports.String(),
    node: typebox_exports.String(),
    platform: typebox_exports.String(),
    arch: typebox_exports.String(),
    repoUrl: typebox_exports.String()
  },
  { additionalProperties: false }
);
var DiagnosticsSnapshotSchema = typebox_exports.Unsafe({ type: "object" });
var SavedTabsSchema = typebox_exports.Unsafe({ type: "object" });
var UiStateSchema = typebox_exports.Unsafe({ type: "object" });
var ResourcePreviewResultSchema = typebox_exports.Unsafe({ type: "object" });
var FigureAnnotationSchema = typebox_exports.Unsafe(
  typebox_exports.Object(
    {
      id: typebox_exports.String({ minLength: 1, maxLength: 64 }),
      x: typebox_exports.Number({ minimum: 0, maximum: 1 }),
      y: typebox_exports.Number({ minimum: 0, maximum: 1 }),
      text: typebox_exports.String({ maxLength: 2e3 }),
      createdAt: typebox_exports.String({ maxLength: 64 })
    },
    { additionalProperties: false }
  )
);
var ImportedAttachmentSchema = typebox_exports.Object(
  { path: typebox_exports.String(), name: typebox_exports.String(), bytes: typebox_exports.Integer({ minimum: 0 }) },
  { additionalProperties: false }
);
var GitBranchesSchema = typebox_exports.Object(
  { current: typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()]), branches: typebox_exports.Array(typebox_exports.String()) },
  { additionalProperties: false }
);
var NullableString = typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()]);
var AppContract = defineDomain("app", {
  methods: {
    getInfo: {
      args: typebox_exports.Tuple([]),
      result: typebox_exports.Unsafe(AppInfoSchema)
    },
    getDiagnostics: {
      args: typebox_exports.Tuple([]),
      result: DiagnosticsSnapshotSchema
    },
    getDailyDir: {
      args: typebox_exports.Tuple([]),
      result: typebox_exports.String({ minLength: 1 })
    },
    openExternal: { args: typebox_exports.Tuple([typebox_exports.String()]), result: typebox_exports.Void() },
    filePreview: {
      args: typebox_exports.Union([
        typebox_exports.Tuple([typebox_exports.String()]),
        typebox_exports.Tuple([typebox_exports.String(), typebox_exports.String()]),
        typebox_exports.Tuple([typebox_exports.String(), typebox_exports.String(), typebox_exports.Boolean()])
      ]),
      result: ResourcePreviewResultSchema
    },
    htmlPreviewUrl: {
      args: typebox_exports.Union([typebox_exports.Tuple([typebox_exports.String()]), typebox_exports.Tuple([typebox_exports.String(), typebox_exports.String()])]),
      result: typebox_exports.String({ minLength: 1 })
    },
    getFigureAnnotations: {
      args: typebox_exports.Union([typebox_exports.Tuple([typebox_exports.String()]), typebox_exports.Tuple([typebox_exports.String(), typebox_exports.String()])]),
      result: typebox_exports.Array(FigureAnnotationSchema)
    },
    saveFigureAnnotations: {
      args: typebox_exports.Tuple([
        typebox_exports.String({ minLength: 1 }),
        typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()]),
        typebox_exports.Array(FigureAnnotationSchema, { maxItems: 200 })
      ]),
      result: typebox_exports.Array(FigureAnnotationSchema)
    },
    importDroppedFile: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 }), typebox_exports.String({ minLength: 1 })]),
      result: typebox_exports.Unsafe(ImportedAttachmentSchema)
    },
    resourceOpenExternal: {
      args: typebox_exports.Union([
        typebox_exports.Tuple([typebox_exports.String()]),
        typebox_exports.Tuple([typebox_exports.String(), typebox_exports.String()]),
        typebox_exports.Tuple([typebox_exports.String(), typebox_exports.String(), typebox_exports.Boolean()])
      ]),
      result: typebox_exports.Void()
    },
    /** 文件右键菜单的宿主动作（P7）：action, target, cwd, arg（rename 的新文件名） */
    fileAction: {
      args: typebox_exports.Tuple([
        typebox_exports.Union(
          ["download", "openDefault", "reveal", "openInEditor", "cut", "copy", "rename", "trash"].map(
            (a) => typebox_exports.Literal(a)
          )
        ),
        typebox_exports.String({ minLength: 1 }),
        NullableString,
        NullableString
      ]),
      result: NullableString
    },
    /** 本机环境探测（P10）：固定只读命令 */
    pickDownloadDir: { args: typebox_exports.Tuple([]), result: NullableString },
    /** 待答数角标（P14）：count, Windows overlay 图（data URL）或 null */
    setAttentionBadge: {
      args: typebox_exports.Tuple([typebox_exports.Integer({ minimum: 0, maximum: 999 }), NullableString]),
      result: typebox_exports.Void()
    },
    hostEnvironment: {
      args: typebox_exports.Tuple([]),
      result: typebox_exports.Unsafe(typebox_exports.Object({}, { additionalProperties: true }))
    },
    loadTabs: { args: typebox_exports.Tuple([]), result: typebox_exports.Union([SavedTabsSchema, typebox_exports.Null()]) },
    saveTabs: { args: typebox_exports.Tuple([SavedTabsSchema]), result: typebox_exports.Void() },
    loadUiState: { args: typebox_exports.Tuple([]), result: typebox_exports.Union([UiStateSchema, typebox_exports.Null()]) },
    saveUiState: {
      args: typebox_exports.Tuple([typebox_exports.Unsafe({ type: "object" })]),
      result: typebox_exports.Void()
    },
    pickBackgroundImage: { args: typebox_exports.Tuple([]), result: NullableString },
    checkForUpdates: { args: typebox_exports.Tuple([]), result: typebox_exports.Void() },
    downloadUpdate: { args: typebox_exports.Tuple([]), result: typebox_exports.Void() },
    installUpdate: { args: typebox_exports.Tuple([]), result: typebox_exports.Void() },
    updateResearchSkills: { args: typebox_exports.Tuple([]), result: typebox_exports.Void() },
    restartForResearchSkills: { args: typebox_exports.Tuple([]), result: typebox_exports.Void() },
    saveFileDialog: {
      args: typebox_exports.Tuple([typebox_exports.String(), typebox_exports.String()]),
      result: NullableString
    },
    pickPath: {
      args: typebox_exports.Union([
        typebox_exports.Tuple([typebox_exports.Union([typebox_exports.Literal("file"), typebox_exports.Literal("directory")])]),
        typebox_exports.Tuple([typebox_exports.Union([typebox_exports.Literal("file"), typebox_exports.Literal("directory")]), typebox_exports.String()])
      ]),
      result: NullableString
    },
    pickDirectory: { args: typebox_exports.Tuple([]), result: NullableString },
    getGitBranch: { args: typebox_exports.Tuple([typebox_exports.String()]), result: NullableString },
    listGitBranches: { args: typebox_exports.Tuple([typebox_exports.String()]), result: GitBranchesSchema },
    checkoutBranch: { args: typebox_exports.Tuple([typebox_exports.String(), typebox_exports.String()]), result: typebox_exports.String() }
  }
});

// packages/shared/src/host-api/compute.ts
var IdArgs = typebox_exports.Tuple([ComputeIdSchema]);
var EmptyArgs = typebox_exports.Tuple([]);
var HealthSnapshotSchema = typebox_exports.Object(
  {
    checkedAt: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    hosts: typebox_exports.Array(
      typebox_exports.Object(
        {
          id: ComputeIdSchema,
          alias: typebox_exports.String({ minLength: 1, maxLength: 64 }),
          status: ComputeHealthStatusSchema,
          checkedAt: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 64 })),
          latencyMs: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
          details: typebox_exports.Optional(typebox_exports.String({ maxLength: 512 })),
          errorCode: typebox_exports.Optional(typebox_exports.String({ maxLength: 128 }))
        },
        { additionalProperties: false }
      ),
      { maxItems: 256 }
    )
  },
  { additionalProperties: false }
);
var JobFilterSchema = typebox_exports.Object(
  {
    states: typebox_exports.Optional(
      typebox_exports.Array(
        typebox_exports.Union([
          typebox_exports.Literal("queued"),
          typebox_exports.Literal("running"),
          typebox_exports.Literal("succeeded"),
          typebox_exports.Literal("failed"),
          typebox_exports.Literal("cancelled"),
          typebox_exports.Literal("unknown")
        ]),
        { maxItems: 6 }
      )
    ),
    hostId: typebox_exports.Optional(ComputeIdSchema),
    limit: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 100 }))
  },
  { additionalProperties: false }
);
var LogArgsSchema = typebox_exports.Tuple([
  ComputeIdSchema,
  typebox_exports.Optional(typebox_exports.String({ minLength: 0, maxLength: 256 }))
]);
var TerminalOpenSchema = typebox_exports.Object(
  {
    hostId: ComputeIdSchema,
    cwd: typebox_exports.Optional(typebox_exports.String({ maxLength: 1024 })),
    mode: typebox_exports.Optional(typebox_exports.Union([typebox_exports.Literal("shell"), typebox_exports.Literal("command")]))
  },
  { additionalProperties: false }
);
var TerminalWriteSchema = typebox_exports.Tuple([ComputeIdSchema, typebox_exports.String({ maxLength: 16384 })]);
var OnboardingStepArgs = typebox_exports.Tuple([
  typebox_exports.Union([
    typebox_exports.Literal("model"),
    typebox_exports.Literal("project"),
    typebox_exports.Literal("knowledge"),
    typebox_exports.Literal("literature"),
    typebox_exports.Literal("mcp"),
    typebox_exports.Literal("remote-host"),
    typebox_exports.Literal("example-task")
  ])
]);
var ComputeContract = defineDomain("compute", {
  methods: {
    listHosts: { args: EmptyArgs, result: typebox_exports.Array(ComputeHostSchema, { maxItems: 256 }) },
    getHost: { args: IdArgs, result: typebox_exports.Union([ComputeHostSchema, typebox_exports.Null()]) },
    saveHost: { args: typebox_exports.Tuple([ComputeHostInputSchema]), result: ComputeHostSchema },
    removeHost: { args: IdArgs, result: typebox_exports.Void() },
    probeHost: { args: IdArgs, result: ComputeHostSchema },
    // LAN has no compute projection yet; keep these desktop-only until the
    // authenticated observer exposes the same schemas through its GET routes.
    getHealthSnapshot: { args: EmptyArgs, result: HealthSnapshotSchema },
    listJobs: {
      args: typebox_exports.Tuple([typebox_exports.Optional(JobFilterSchema)]),
      result: typebox_exports.Array(ComputeJobSchema, { maxItems: 100 })
    },
    getJob: { args: IdArgs, result: typebox_exports.Union([ComputeJobSchema, typebox_exports.Null()]) },
    submitJob: { args: typebox_exports.Tuple([ComputeJobInputSchema]), result: ComputeJobSchema },
    getLogs: { args: LogArgsSchema, result: ComputeLogChunkSchema },
    cancelJob: { args: IdArgs, result: typebox_exports.Void() },
    openTerminal: { args: typebox_exports.Tuple([TerminalOpenSchema]), result: ComputeTerminalSchema },
    getTerminal: { args: IdArgs, result: typebox_exports.Union([ComputeTerminalSchema, typebox_exports.Null()]) },
    writeTerminal: { args: TerminalWriteSchema, result: typebox_exports.Void() },
    closeTerminal: { args: IdArgs, result: typebox_exports.Void() },
    getOnboardingStatus: {
      args: EmptyArgs,
      result: typebox_exports.Array(ComputeOnboardingStatusSchema, { maxItems: 16 })
    },
    checkOnboardingStep: { args: OnboardingStepArgs, result: ComputeOnboardingStatusSchema }
  },
  events: {
    healthChanged: HealthSnapshotSchema,
    jobUpdated: ComputeJobSchema,
    logChunk: ComputeLogChunkSchema,
    terminalOutput: typebox_exports.Object(
      { terminalId: ComputeIdSchema, text: typebox_exports.String({ maxLength: 16384 }), truncated: typebox_exports.Boolean() },
      { additionalProperties: false }
    ),
    terminalClosed: typebox_exports.Object({ terminalId: ComputeIdSchema }, { additionalProperties: false })
  }
});

// packages/shared/src/host-api/discovery.ts
var EmptyArgs2 = typebox_exports.Tuple([]);
var IdArgs2 = typebox_exports.Tuple([typebox_exports.String({ minLength: 1, maxLength: 128 })]);
var LanguageArgs = typebox_exports.Tuple([DiscoveryKernelLanguageSchema]);
var DiscoveryContract = defineDomain("discovery", {
  methods: {
    getCapabilities: { args: LanguageArgs, result: DiscoveryCapabilitiesSchema },
    listKernelSessions: {
      args: EmptyArgs2,
      result: typebox_exports.Array(DiscoveryKernelSessionSchema, { maxItems: 256 })
    },
    getKernelSession: {
      args: IdArgs2,
      result: typebox_exports.Union([DiscoveryKernelSessionSchema, typebox_exports.Null()])
    },
    closeKernelSession: { args: IdArgs2, result: typebox_exports.Void() },
    listCriticReviews: {
      args: EmptyArgs2,
      result: typebox_exports.Array(DiscoveryCriticReviewSchema, { maxItems: 256 })
    },
    listMultipathAssessments: {
      args: EmptyArgs2,
      result: typebox_exports.Array(DiscoveryMultipathAssessmentSchema, { maxItems: 256 })
    },
    listExplorationPlans: {
      args: EmptyArgs2,
      result: typebox_exports.Array(DiscoveryExplorationPlanSchema, { maxItems: 256 })
    },
    listEvaluations: {
      args: EmptyArgs2,
      result: typebox_exports.Array(DiscoveryEvaluationSchema, { maxItems: 256 })
    }
  },
  events: {}
});

// packages/shared/src/host-api/evidence.ts
var Id = typebox_exports.String({ minLength: 1, maxLength: 256, pattern: "^[^\\u0000-\\u001f]+$" });
var Hash2 = typebox_exports.String({ pattern: "^[a-f0-9]{64}$" });
var Audience = typebox_exports.Union([typebox_exports.Literal("public"), typebox_exports.Literal("restricted"), typebox_exports.Literal("private")]);
var Checkpoint = typebox_exports.Object({
  id: Hash2,
  analysisId: Id,
  assay: typebox_exports.String(),
  createdAt: typebox_exports.String(),
  files: typebox_exports.Array(
    typebox_exports.Object({ path: typebox_exports.String(), kind: typebox_exports.String(), bytes: typebox_exports.Number(), sha256: Hash2 })
  ),
  environmentFingerprint: typebox_exports.Optional(typebox_exports.String()),
  replayReady: typebox_exports.Boolean()
});
var Branch = typebox_exports.Object({
  id: Id,
  checkpointId: Hash2,
  workspace: typebox_exports.String(),
  status: typebox_exports.Union([typebox_exports.Literal("preparing"), typebox_exports.Literal("ready"), typebox_exports.Literal("failed")])
});
var Replay = typebox_exports.Object({
  id: Id,
  checkpointId: Hash2,
  status: typebox_exports.Union([typebox_exports.Literal("reproduced"), typebox_exports.Literal("failed")]),
  detail: typebox_exports.String(),
  outputChecks: typebox_exports.Array(typebox_exports.Object({ path: typebox_exports.String(), matched: typebox_exports.Boolean() })),
  environmentMatched: typebox_exports.Boolean(),
  completedAt: typebox_exports.String()
});
var CapabilityEvidenceCard = typebox_exports.Object({
  id: Id,
  analysisId: Id,
  capabilityId: Id,
  requestRef: typebox_exports.Optional(Id),
  versionRef: typebox_exports.Optional(Id),
  /** Immutable execution snapshot; distinct from a validation evidence capsule. */
  checkpointRef: typebox_exports.Optional(Hash2),
  evidenceCapsuleRef: typebox_exports.Optional(Hash2),
  evidenceState: typebox_exports.Union([
    typebox_exports.Literal("observed"),
    typebox_exports.Literal("reproduced"),
    typebox_exports.Literal("verified"),
    typebox_exports.Literal("partial"),
    typebox_exports.Literal("stale"),
    typebox_exports.Literal("unsupported"),
    typebox_exports.Literal("unknown"),
    typebox_exports.Literal("blocked")
  ]),
  claimState: typebox_exports.Union([
    typebox_exports.Literal("supported"),
    typebox_exports.Literal("mixed"),
    typebox_exports.Literal("inferred"),
    typebox_exports.Literal("hypothesis"),
    typebox_exports.Literal("unsupported")
  ]),
  capabilityState: typebox_exports.Union([
    typebox_exports.Literal("candidate"),
    typebox_exports.Literal("recommended"),
    typebox_exports.Literal("registered"),
    typebox_exports.Literal("enabled"),
    typebox_exports.Literal("retired")
  ]),
  reuseLevel: typebox_exports.Union([
    typebox_exports.Literal("navigation-only"),
    typebox_exports.Literal("evidence-eligible"),
    typebox_exports.Literal("validated-capability"),
    typebox_exports.Literal("reproduced-capability")
  ]),
  validationScope: typebox_exports.Optional(
    typebox_exports.Union([
      typebox_exports.Literal("fixture"),
      typebox_exports.Literal("integration"),
      typebox_exports.Literal("real-data"),
      typebox_exports.Literal("scientific-review")
    ])
  ),
  freshness: typebox_exports.Union([typebox_exports.Literal("fresh"), typebox_exports.Literal("stale"), typebox_exports.Literal("unknown")]),
  scientificallyVerified: typebox_exports.Boolean(),
  gates: typebox_exports.Array(
    typebox_exports.Object({
      id: Id,
      status: typebox_exports.Union([typebox_exports.Literal("blocked"), typebox_exports.Literal("review"), typebox_exports.Literal("not-recorded")]),
      detail: typebox_exports.String()
    })
  ),
  runRefs: typebox_exports.Array(Id),
  artifactRefs: typebox_exports.Array(typebox_exports.Object({ path: typebox_exports.String(), sha256: Hash2 })),
  receiptRefs: typebox_exports.Array(Id)
});
var Overview = typebox_exports.Object({
  analyses: typebox_exports.Array(
    typebox_exports.Object({
      id: Id,
      question: typebox_exports.String(),
      assay: typebox_exports.String(),
      stage: typebox_exports.String(),
      artifactCount: typebox_exports.Number()
    })
  ),
  capabilities: typebox_exports.Array(CapabilityEvidenceCard),
  checkpoints: typebox_exports.Array(Checkpoint),
  branches: typebox_exports.Array(Branch),
  replays: typebox_exports.Array(Replay)
});
var EvidenceContract = defineDomain("evidence", {
  methods: {
    getEvidenceOverview: { args: typebox_exports.Tuple([]), result: Overview },
    freezeAnalysisEvidence: {
      args: typebox_exports.Tuple([
        Id,
        typebox_exports.String({ minLength: 1, maxLength: 4096, pattern: "^[^\\u0000-\\u001f]+$" })
      ]),
      result: Checkpoint
    },
    forkEvidenceCheckpoint: {
      args: typebox_exports.Tuple([Hash2, typebox_exports.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$" })]),
      result: Branch
    },
    exportEvidenceCapsule: {
      args: typebox_exports.Tuple([Hash2, Audience]),
      result: typebox_exports.Object({ path: typebox_exports.String(), sha256: Hash2, audience: Audience })
    },
    importEvidenceCapsule: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1, maxLength: 4096 })]),
      result: Checkpoint
    },
    replayEvidenceCheckpoint: { args: typebox_exports.Tuple([Hash2]), result: Replay }
  },
  events: {}
});

// packages/shared/src/host-api/inquiry.ts
var ProjectId = typebox_exports.Union([typebox_exports.String({ minLength: 1, maxLength: 4096 }), typebox_exports.Undefined()]);
var ArtifactId = typebox_exports.String({ minLength: 1, maxLength: 512, pattern: "^[^\\u0000-\\u001f\\u007f]+$" });
var ArtifactIdArgs = typebox_exports.Union([typebox_exports.Tuple([ArtifactId]), typebox_exports.Tuple([ArtifactId, ProjectId])]);
var ProjectArgs = typebox_exports.Union([typebox_exports.Tuple([]), typebox_exports.Tuple([ProjectId])]);
var ObjectResult = () => typebox_exports.Unsafe({ type: "object" });
var ArrayResult = () => typebox_exports.Array(ObjectResult(), { maxItems: 256 });
var UiErrorSchema = typebox_exports.Object(
  {
    code: typebox_exports.String({ minLength: 1, maxLength: 128 }),
    severity: typebox_exports.Union([typebox_exports.Literal("error"), typebox_exports.Literal("warning"), typebox_exports.Literal("info")]),
    source: typebox_exports.Literal("app"),
    titleKey: typebox_exports.String({ minLength: 1, maxLength: 256 }),
    detail: typebox_exports.Optional(typebox_exports.String({ maxLength: 4096 })),
    actions: typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 64 }), { maxItems: 8 }),
    timestamp: typebox_exports.Number()
  },
  { additionalProperties: true }
);
var InquiryContract = defineDomain("inquiry", {
  methods: {
    listArtifacts: { args: ProjectArgs, result: ArrayResult() },
    artifactProvenance: {
      args: ArtifactIdArgs,
      result: typebox_exports.Union([ObjectResult(), UiErrorSchema])
    },
    rerunArtifact: {
      args: ArtifactIdArgs,
      result: typebox_exports.Union([ObjectResult(), UiErrorSchema])
    }
  },
  events: {
    rerunUpdated: ObjectResult()
  }
});

// packages/shared/src/host-api/institutional.ts
var OptionalString = typebox_exports.Optional(typebox_exports.String());
var InstitutionalConfigSchema = typebox_exports.Object(
  {
    version: typebox_exports.Literal(1),
    ezproxyTemplate: OptionalString,
    openUrlResolver: OptionalString,
    institutionName: OptionalString,
    autoDownloadEnabled: typebox_exports.Boolean(),
    perTaskLimit: typebox_exports.Integer({ minimum: 1, maximum: 100 }),
    lastLoginAt: OptionalString,
    lastLoginUrl: OptionalString,
    configured: typebox_exports.Optional(typebox_exports.Boolean())
  },
  { additionalProperties: false }
);
var InstitutionalSessionSchema = typebox_exports.Object(
  {
    cookiesCount: typebox_exports.Integer({ minimum: 0 }),
    hasSessionCookies: typebox_exports.Boolean(),
    partition: typebox_exports.String({ minLength: 1 }),
    lastAccessAt: OptionalString
  },
  { additionalProperties: false }
);
var InstitutionalStatusSchema = typebox_exports.Object(
  {
    config: InstitutionalConfigSchema,
    session: InstitutionalSessionSchema,
    loggedIn: typebox_exports.Boolean(),
    electronAvailable: typebox_exports.Boolean()
  },
  { additionalProperties: false }
);
var InstitutionalSaveInputSchema = typebox_exports.Object(
  {
    ezproxyTemplate: OptionalString,
    openUrlResolver: OptionalString,
    institutionName: OptionalString,
    autoDownloadEnabled: typebox_exports.Optional(typebox_exports.Boolean()),
    perTaskLimit: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 100 }))
  },
  { additionalProperties: false }
);
var InstitutionalTestResultSchema = typebox_exports.Object(
  {
    url: typebox_exports.String({ minLength: 1 }),
    proxiedUrl: OptionalString,
    status: typebox_exports.Integer({ minimum: 0, maximum: 999 }),
    ok: typebox_exports.Boolean(),
    contentType: OptionalString,
    redirected: typebox_exports.Optional(typebox_exports.Boolean()),
    finalUrl: OptionalString,
    error: OptionalString,
    via: typebox_exports.Union([typebox_exports.Literal("direct"), typebox_exports.Literal("ezproxy"), typebox_exports.Literal("institutional_session")])
  },
  { additionalProperties: false }
);
var InstitutionalContract = defineDomain("institutional", {
  methods: {
    getStatus: { args: typebox_exports.Tuple([]), result: InstitutionalStatusSchema },
    saveConfig: { args: typebox_exports.Tuple([InstitutionalSaveInputSchema]), result: InstitutionalStatusSchema },
    openLogin: {
      args: typebox_exports.Union([typebox_exports.Tuple([]), typebox_exports.Tuple([typebox_exports.String()])]),
      result: typebox_exports.Object({ url: typebox_exports.String({ minLength: 1 }) }, { additionalProperties: false })
    },
    openUrl: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]),
      result: typebox_exports.Object({ url: typebox_exports.String({ minLength: 1 }) }, { additionalProperties: false })
    },
    clear: { args: typebox_exports.Tuple([]), result: InstitutionalStatusSchema },
    testAccess: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]),
      result: InstitutionalTestResultSchema
    }
  }
});

// packages/shared/src/host-api/knowledge.ts
var ObjectPayload = () => typebox_exports.Unsafe({ type: "object" });
var ResultObject = () => typebox_exports.Unsafe({ type: "object" });
var OneObject = () => typebox_exports.Tuple([ObjectPayload()]);
var OptionalObject = () => typebox_exports.Union([typebox_exports.Tuple([]), OneObject()]);
var SpecialistSettingsInput = typebox_exports.Object(
  {
    mode: typebox_exports.Union([typebox_exports.Literal("automatic"), typebox_exports.Literal("manual"), typebox_exports.Literal("off")]),
    revision: typebox_exports.Integer({ minimum: 0 }),
    bindingRevision: typebox_exports.Integer({ minimum: 0 }),
    maxRunsPerTurn: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    maxRunsPerSession: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    maxToolOperations: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    concurrency: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1 })),
    queueLimit: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    queueWaitMs: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    timeoutMs: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    maxTokensPerTurn: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    maxTokensPerSession: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    maxCostPerTurn: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
    maxCostPerSession: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 }))
  },
  { additionalProperties: false }
);
var ZoteroStatusSchema = typebox_exports.Object(
  {
    registered: typebox_exports.Boolean(),
    enabled: typebox_exports.Boolean(),
    command: typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()]),
    localApiReachable: typebox_exports.Boolean(),
    desktopDetected: typebox_exports.Boolean(),
    desktopPath: typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()]),
    docsUrl: typebox_exports.String({ minLength: 1 }),
    downloadUrl: typebox_exports.String({ minLength: 1 })
  },
  { additionalProperties: false }
);
var KnowledgeContract = defineDomain("knowledge", {
  methods: {
    getCloudStatus: {
      args: typebox_exports.Tuple([]),
      result: ResultObject()
    },
    probeCloud: {
      args: typebox_exports.Tuple([]),
      result: ResultObject()
    },
    initializeCloud: {
      args: typebox_exports.Tuple([]),
      result: ResultObject()
    },
    setCloudPassword: {
      args: typebox_exports.Tuple([
        typebox_exports.Object(
          { password: typebox_exports.Union([typebox_exports.String({ minLength: 1, maxLength: 256 }), typebox_exports.Null()]) },
          { additionalProperties: false }
        )
      ]),
      result: ResultObject()
    },
    readCloudNote: {
      args: typebox_exports.Tuple([
        typebox_exports.Object({ path: typebox_exports.String({ minLength: 1 }) }, { additionalProperties: false })
      ]),
      result: ResultObject()
    },
    writeCloudNote: {
      args: typebox_exports.Tuple([
        typebox_exports.Object(
          {
            path: typebox_exports.String({ minLength: 1 }),
            text: typebox_exports.String({ maxLength: 1024 * 1024 }),
            expectedVersion: typebox_exports.Optional(typebox_exports.String({ minLength: 1 }))
          },
          { additionalProperties: false }
        )
      ]),
      result: ResultObject()
    },
    syncCloud: {
      args: typebox_exports.Tuple([
        typebox_exports.Object(
          {
            cwd: typebox_exports.Optional(typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()])),
            mode: typebox_exports.Union([typebox_exports.Literal("pull"), typebox_exports.Literal("push")]),
            bindingRevision: typebox_exports.Integer({ minimum: 1 }),
            paths: typebox_exports.Array(typebox_exports.String({ minLength: 1 }), { minItems: 1, maxItems: 64 }),
            previews: typebox_exports.Optional(
              typebox_exports.Array(
                typebox_exports.Object(
                  {
                    path: typebox_exports.String({ minLength: 1 }),
                    localHash: typebox_exports.Union([typebox_exports.String({ minLength: 1 }), typebox_exports.Null()]),
                    remoteHash: typebox_exports.Union([typebox_exports.String({ minLength: 1 }), typebox_exports.Null()]),
                    remoteVersion: typebox_exports.Union([typebox_exports.String({ minLength: 1 }), typebox_exports.Null()])
                  },
                  { additionalProperties: false }
                ),
                { minItems: 1, maxItems: 64 }
              )
            ),
            resolution: typebox_exports.Optional(typebox_exports.Union([typebox_exports.Literal("local"), typebox_exports.Literal("remote")]))
          },
          { additionalProperties: false }
        )
      ]),
      result: ResultObject()
    },
    setSpecialistSettings: {
      args: typebox_exports.Tuple([SpecialistSettingsInput]),
      result: ResultObject()
    },
    getOverview: {
      args: OptionalObject(),
      result: ResultObject()
    },
    getResearchRuns: {
      args: OptionalObject(),
      result: ResultObject()
    },
    getResearchRun: {
      args: OneObject(),
      result: ResultObject()
    },
    previewSetup: {
      args: OneObject(),
      result: ResultObject()
    },
    startSetup: {
      args: OneObject(),
      result: typebox_exports.Void()
    },
    getJobs: {
      args: OptionalObject(),
      result: ResultObject()
    },
    getReviews: {
      args: OneObject(),
      result: ResultObject()
    },
    previewReview: {
      args: OneObject(),
      result: ResultObject()
    },
    reviewWithModel: {
      args: OneObject(),
      result: ResultObject()
    },
    cancelModelReview: {
      args: OneObject(),
      result: typebox_exports.Void()
    },
    decideReview: {
      args: OneObject(),
      result: ResultObject()
    },
    readNote: {
      args: OneObject(),
      result: ResultObject()
    },
    maintain: {
      args: OneObject(),
      result: typebox_exports.Unknown()
    },
    openTarget: {
      args: OneObject(),
      result: typebox_exports.Void()
    },
    resumeCheck: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]),
      result: typebox_exports.Void()
    },
    getSemanticStatus: {
      args: OptionalObject(),
      result: ResultObject()
    },
    saveSemanticSettings: {
      args: OneObject(),
      result: ResultObject()
    },
    testSemanticProvider: {
      args: OneObject(),
      result: ResultObject()
    },
    indexSemantic: {
      args: OneObject(),
      result: ResultObject()
    },
    cancelSemanticIndex: {
      args: OneObject(),
      result: typebox_exports.Void()
    },
    search: {
      args: OneObject(),
      result: ResultObject()
    },
    getNoteLinks: {
      args: OneObject(),
      result: ResultObject()
    },
    getGraph: {
      args: OneObject(),
      result: ResultObject()
    },
    getDailyDiscovery: {
      args: typebox_exports.Tuple([]),
      result: ResultObject()
    },
    updateDailyDiscovery: {
      args: OneObject(),
      result: ResultObject()
    },
    decideDailyIdea: {
      args: OneObject(),
      result: ResultObject()
    },
    getTopics: {
      args: OneObject(),
      result: ResultObject()
    },
    archiveTopic: {
      args: OneObject(),
      result: typebox_exports.Unknown()
    },
    getZoteroStatus: {
      args: typebox_exports.Tuple([]),
      result: ZoteroStatusSchema
    },
    getZoteroWebApi: {
      args: typebox_exports.Tuple([]),
      result: ResultObject()
    },
    saveZoteroWebApi: {
      args: typebox_exports.Tuple([
        typebox_exports.Object(
          {
            apiKey: typebox_exports.String({ minLength: 16, maxLength: 64 }),
            libraryType: typebox_exports.Optional(typebox_exports.Union([typebox_exports.Literal("users"), typebox_exports.Literal("groups")])),
            libraryId: typebox_exports.Optional(typebox_exports.String({ maxLength: 20 }))
          },
          { additionalProperties: false }
        )
      ]),
      result: ResultObject()
    },
    clearZoteroWebApi: {
      args: typebox_exports.Tuple([]),
      result: ResultObject()
    },
    getZoteroLocalWrite: {
      args: typebox_exports.Tuple([]),
      result: ResultObject()
    },
    authorizeZoteroLocalWrite: {
      args: typebox_exports.Tuple([]),
      result: ResultObject()
    },
    clearZoteroLocalWrite: {
      args: typebox_exports.Tuple([]),
      result: ResultObject()
    }
  },
  events: {
    event: ObjectPayload()
  }
});

// packages/shared/src/host-api/mcp.ts
var OptionalCwdArgs = typebox_exports.Union([
  typebox_exports.Tuple([]),
  typebox_exports.Tuple([typebox_exports.Union([typebox_exports.String(), typebox_exports.Undefined()])])
]);
var ServerStatusSchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1 }),
    status: typebox_exports.Union([
      typebox_exports.Literal("connected"),
      typebox_exports.Literal("cached"),
      typebox_exports.Literal("failed"),
      typebox_exports.Literal("needs-auth"),
      typebox_exports.Literal("not-connected"),
      typebox_exports.Literal("disabled"),
      typebox_exports.Literal("blocked")
    ]),
    toolCount: typebox_exports.Integer({ minimum: 0 }),
    directToolCount: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    resourceCount: typebox_exports.Optional(typebox_exports.Integer({ minimum: 0 })),
    failedAgoSeconds: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
    disabled: typebox_exports.Boolean(),
    listenState: typebox_exports.Optional(typebox_exports.String()),
    catalogStale: typebox_exports.Optional(typebox_exports.Boolean()),
    blockedReason: typebox_exports.Optional(typebox_exports.String())
  },
  { additionalProperties: false }
);
var StatusSchema = typebox_exports.Object(
  {
    version: typebox_exports.Literal(1),
    servers: typebox_exports.Array(ServerStatusSchema),
    totalTools: typebox_exports.Integer({ minimum: 0 }),
    totalResources: typebox_exports.Integer({ minimum: 0 }),
    connectedCount: typebox_exports.Integer({ minimum: 0 }),
    disabledCount: typebox_exports.Integer({ minimum: 0 }),
    runtime: typebox_exports.Optional(
      typebox_exports.Union([typebox_exports.Literal("missing"), typebox_exports.Literal("starting"), typebox_exports.Literal("running")])
    )
  },
  { additionalProperties: false }
);
var ConfigServerSchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1 }),
    transport: typebox_exports.Union([
      typebox_exports.Literal("stdio"),
      typebox_exports.Literal("http"),
      typebox_exports.Literal("socket"),
      typebox_exports.Literal("unknown")
    ]),
    command: typebox_exports.Optional(typebox_exports.String()),
    url: typebox_exports.Optional(typebox_exports.String()),
    disabled: typebox_exports.Boolean(),
    scope: typebox_exports.Union([typebox_exports.Literal("user"), typebox_exports.Literal("project")]),
    sourcePath: typebox_exports.String({ minLength: 1 })
  },
  { additionalProperties: false }
);
var ConfigSchema = typebox_exports.Object(
  {
    path: typebox_exports.String({ minLength: 1 }),
    cwd: typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()]),
    servers: typebox_exports.Array(ConfigServerSchema)
  },
  { additionalProperties: false }
);
var McpContract = defineDomain("mcp", {
  methods: {
    getStatus: {
      args: OptionalCwdArgs,
      result: typebox_exports.Unsafe(StatusSchema)
    },
    getConfig: {
      args: OptionalCwdArgs,
      result: typebox_exports.Unsafe(ConfigSchema)
    },
    setServerEnabled: {
      args: typebox_exports.Union([
        typebox_exports.Tuple([typebox_exports.String({ minLength: 1 }), typebox_exports.Boolean()]),
        typebox_exports.Tuple([
          typebox_exports.String({ minLength: 1 }),
          typebox_exports.Boolean(),
          typebox_exports.Union([typebox_exports.String(), typebox_exports.Undefined()])
        ])
      ]),
      result: typebox_exports.Unsafe(ConfigSchema)
    },
    openConfig: {
      args: OptionalCwdArgs,
      result: typebox_exports.Void()
    },
    addPreset: {
      args: typebox_exports.Tuple([typebox_exports.Union([typebox_exports.Literal("playwright"), typebox_exports.Literal("playwright-chrome")])]),
      result: typebox_exports.Unsafe(ConfigSchema)
    }
  }
});

// packages/shared/src/host-api/memory.ts
var MemoryProjectStatusSchema = typebox_exports.Object(
  {
    enabled: typebox_exports.Boolean(),
    count: typebox_exports.Integer({ minimum: 0 }),
    lastLoaded: typebox_exports.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
);
var status = typebox_exports.Unsafe(MemoryProjectStatusSchema);
var MemoryListItemSchema = typebox_exports.Object(
  {
    id: typebox_exports.Integer({ minimum: 1 }),
    kind: typebox_exports.String(),
    title: typebox_exports.String(),
    body: typebox_exports.String(),
    createdAt: typebox_exports.Integer({ minimum: 0 }),
    sessionId: typebox_exports.Optional(typebox_exports.String()),
    /** 已沉淀到知识库的笔记路径。 */
    promotedTo: typebox_exports.Optional(typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()]))
  },
  { additionalProperties: false }
);
var items = typebox_exports.Unsafe(typebox_exports.Array(MemoryListItemSchema));
var MemoryContract = defineDomain("memory", {
  methods: {
    getStatus: { args: typebox_exports.Tuple([typebox_exports.String()]), result: status, access: "desktop" },
    setEnabled: { args: typebox_exports.Tuple([typebox_exports.String(), typebox_exports.Boolean()]), result: status, access: "desktop" },
    clear: { args: typebox_exports.Tuple([typebox_exports.String()]), result: status, access: "desktop" },
    /** 最近的观察（最多 50 条）。 */
    list: { args: typebox_exports.Tuple([typebox_exports.String()]), result: items, access: "desktop" },
    /** 删除一条观察。 */
    remove: { args: typebox_exports.Tuple([typebox_exports.String(), typebox_exports.Integer()]), result: status, access: "desktop" },
    /** 提升为项目记忆：写入 <cwd>/.pi/memory/（可进 git 审阅），并从观察记忆移除以免重复注入。 */
    promote: { args: typebox_exports.Tuple([typebox_exports.String(), typebox_exports.Integer()]), result: status, access: "desktop" },
    /** 沉淀到知识库（单向）：写成本项目「记忆」分类笔记并带来源；原记录标记已沉淀、不再注入。 */
    promoteToKnowledge: {
      args: typebox_exports.Tuple([typebox_exports.String(), typebox_exports.Integer()]),
      result: typebox_exports.Object({ path: typebox_exports.String() }, { additionalProperties: false }),
      access: "desktop"
    }
  }
});

// packages/shared/src/host-api/packages.ts
var CatalogPackageTypeSchema = typebox_exports.Union([
  typebox_exports.Literal(""),
  typebox_exports.Literal("extension"),
  typebox_exports.Literal("skill"),
  typebox_exports.Literal("prompt"),
  typebox_exports.Literal("theme")
]);
var CatalogPackageSchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1 }),
    description: typebox_exports.String(),
    author: typebox_exports.String(),
    types: typebox_exports.Array(typebox_exports.String()),
    downloads: typebox_exports.Number({ minimum: 0 }),
    updatedAt: typebox_exports.Number(),
    installSource: typebox_exports.String({ minLength: 1 })
  },
  { additionalProperties: false }
);
var CatalogSearchResultSchema = typebox_exports.Object(
  {
    packages: typebox_exports.Array(CatalogPackageSchema),
    total: typebox_exports.Integer({ minimum: 0 }),
    page: typebox_exports.Integer({ minimum: 1 }),
    pageSize: typebox_exports.Integer({ minimum: 1 })
  },
  { additionalProperties: false }
);
var SearchCatalogArgsSchema = typebox_exports.Union([
  typebox_exports.Tuple([typebox_exports.String()]),
  typebox_exports.Tuple([typebox_exports.String(), typebox_exports.Union([CatalogPackageTypeSchema, typebox_exports.Undefined()])]),
  typebox_exports.Tuple([
    typebox_exports.String(),
    typebox_exports.Union([CatalogPackageTypeSchema, typebox_exports.Undefined()]),
    typebox_exports.Union([typebox_exports.Integer({ minimum: 1 }), typebox_exports.Undefined()])
  ])
]);
var ConfiguredPackageInfoSchema = typebox_exports.Object(
  {
    source: typebox_exports.String({ minLength: 1 }),
    scope: typebox_exports.Union([typebox_exports.Literal("user"), typebox_exports.Literal("project")])
  },
  { additionalProperties: false }
);
var PackagesContract = defineDomain("packages", {
  methods: {
    searchCatalog: {
      // Keep the legacy query/type/page call shape, including omitted optional
      // values used by the catalog store.
      args: SearchCatalogArgsSchema,
      result: typebox_exports.Unsafe(CatalogSearchResultSchema)
    },
    installPackage: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]),
      result: typebox_exports.Void()
    },
    removePackage: {
      args: typebox_exports.Tuple([
        typebox_exports.String({ minLength: 1 }),
        typebox_exports.Union([typebox_exports.Literal("user"), typebox_exports.Literal("project")])
      ]),
      result: typebox_exports.Void()
    },
    listConfiguredPackages: {
      args: typebox_exports.Tuple([]),
      result: typebox_exports.Array(typebox_exports.Unsafe(ConfiguredPackageInfoSchema))
    }
  }
});

// packages/shared/src/host-api/permissions.ts
var PermissionSettingsSnapshotSchema = typebox_exports.Unsafe({ type: "object" });
var PermissionSettingsSaveInputSchema = typebox_exports.Unsafe({
  type: "object",
  properties: {
    settings: { type: "object" },
    expectedMtimeMs: { anyOf: [{ type: "number" }, { type: "null" }] },
    force: { type: "boolean" }
  },
  required: ["settings", "expectedMtimeMs"]
});
var PermissionProbeInputSchema = typebox_exports.Unsafe({
  type: "object",
  properties: {
    tool: { type: "string", minLength: 1 },
    input: { type: "object" },
    settings: { type: "object" }
  },
  required: ["tool", "input"]
});
var PermissionSettingsSaveResultSchema = typebox_exports.Unsafe({ type: "object" });
var PermissionProbeResultSchema = typebox_exports.Unsafe({ type: "object" });
var PermissionAuditTailEntrySchema = typebox_exports.Unsafe({ type: "object" });
var AskResponseSchema = typebox_exports.Unsafe({ type: "object" });
var PermissionAnswerSchema = typebox_exports.Union([
  typebox_exports.Literal("allow"),
  typebox_exports.Literal("deny"),
  typebox_exports.Literal("allowAlways"),
  typebox_exports.Literal("allowDir"),
  typebox_exports.Literal("allowRun")
]);
var PermissionModeSchema = typebox_exports.Union([
  typebox_exports.Literal("default"),
  typebox_exports.Literal("strict"),
  typebox_exports.Literal("fullAccess")
]);
var ContextManagerModeSchema = typebox_exports.Union([typebox_exports.Literal("evaporation"), typebox_exports.Literal("off")]);
var PermissionConfigSchema = typebox_exports.Unsafe({ type: "object" });
var ContextManagerConfigSchema = typebox_exports.Unsafe({ type: "object" });
var ChannelWatchConfigSchema = typebox_exports.Unsafe({ type: "object" });
var PermissionsContract = defineDomain("permissions", {
  methods: {
    load: {
      args: typebox_exports.Tuple([]),
      result: PermissionSettingsSnapshotSchema
    },
    save: {
      args: typebox_exports.Tuple([PermissionSettingsSaveInputSchema]),
      result: PermissionSettingsSaveResultSchema
    },
    reset: {
      args: typebox_exports.Tuple([]),
      result: PermissionSettingsSnapshotSchema
    },
    probe: {
      args: typebox_exports.Tuple([PermissionProbeInputSchema]),
      result: PermissionProbeResultSchema
    },
    auditTail: {
      // TypeBox optional tuple items still produce minItems: 1 in v1.3;
      // express the zero/one argument forms explicitly for IPC callers.
      args: typebox_exports.Union([typebox_exports.Tuple([]), typebox_exports.Tuple([typebox_exports.Integer({ minimum: 1 })])]),
      result: typebox_exports.Array(PermissionAuditTailEntrySchema)
    },
    respondAsk: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 }), AskResponseSchema]),
      result: typebox_exports.Boolean()
    },
    respondPermission: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 }), PermissionAnswerSchema]),
      result: typebox_exports.Void()
    },
    getConfig: { args: typebox_exports.Tuple([]), result: PermissionConfigSchema },
    getMode: { args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]), result: PermissionModeSchema },
    setMode: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 }), PermissionModeSchema]),
      result: typebox_exports.Void()
    },
    contextManagerGetConfig: { args: typebox_exports.Tuple([]), result: ContextManagerConfigSchema },
    contextManagerSetMode: { args: typebox_exports.Tuple([ContextManagerModeSchema]), result: typebox_exports.Void() },
    channelWatchGetConfig: { args: typebox_exports.Tuple([]), result: ChannelWatchConfigSchema },
    channelWatchSetEnabled: { args: typebox_exports.Tuple([typebox_exports.Boolean()]), result: typebox_exports.Void() },
    respondTrust: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 }), typebox_exports.Integer()]),
      result: typebox_exports.Void()
    },
    openLocation: { args: typebox_exports.Tuple([]), result: typebox_exports.Void() }
  }
});

// packages/shared/src/host-api/research.ts
var Input = typebox_exports.Object(
  {
    cwd: typebox_exports.String({ minLength: 1, maxLength: 4096 }),
    relativePath: typebox_exports.String({ minLength: 1, maxLength: 4096 }),
    scope: typebox_exports.Optional(typebox_exports.Union([typebox_exports.Literal("project"), typebox_exports.Literal("workspace")])),
    expiresAt: typebox_exports.Optional(typebox_exports.String({ minLength: 20, maxLength: 64 }))
  },
  { additionalProperties: false }
);
var IdInput = typebox_exports.Object(
  { id: typebox_exports.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false }
);
var ListInput = typebox_exports.Object(
  { cwd: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 4096 })) },
  { additionalProperties: false }
);
var SearchInput = typebox_exports.Object(
  {
    query: typebox_exports.String({ minLength: 1, maxLength: 512 }),
    cwd: typebox_exports.Optional(typebox_exports.String({ minLength: 1, maxLength: 4096 })),
    connectorIds: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String({ minLength: 1, maxLength: 64 }), { maxItems: 16 })),
    limit: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 50 }))
  },
  { additionalProperties: false }
);
var Result = () => typebox_exports.Unsafe({ type: "object" });
var ListResult = typebox_exports.Object({ items: typebox_exports.Array(typebox_exports.Unsafe({ type: "object" })) });
var SearchResult = typebox_exports.Object({
  query: typebox_exports.String(),
  hits: typebox_exports.Array(typebox_exports.Unsafe({ type: "object" })),
  failures: typebox_exports.Array(typebox_exports.Unsafe({ type: "object" })),
  connectors: typebox_exports.Array(typebox_exports.String()),
  complete: typebox_exports.Boolean()
});
var ConnectorListResult = typebox_exports.Object({
  connectors: typebox_exports.Array(typebox_exports.Unsafe({ type: "object" }))
});
var ConnectorToggleInput = typebox_exports.Object(
  {
    id: typebox_exports.String({ minLength: 1, maxLength: 64 }),
    enabled: typebox_exports.Boolean()
  },
  { additionalProperties: false }
);
var ResearchContract = defineDomain("research", {
  methods: {
    captureResource: { args: typebox_exports.Tuple([Input]), result: Result() },
    approveCapture: { args: typebox_exports.Tuple([IdInput]), result: Result() },
    revokeCapture: { args: typebox_exports.Tuple([IdInput]), result: Result() },
    listCaptures: { args: typebox_exports.Union([typebox_exports.Tuple([]), typebox_exports.Tuple([ListInput])]), result: ListResult },
    searchResources: { args: typebox_exports.Tuple([SearchInput]), result: SearchResult },
    listConnectors: { args: typebox_exports.Tuple([]), result: ConnectorListResult },
    setConnectorEnabled: {
      args: typebox_exports.Tuple([ConnectorToggleInput]),
      result: Result()
    }
  },
  events: {}
});

// packages/shared/src/host-api/sessions.ts
var Id2 = typebox_exports.String({ minLength: 1 });
var CreateSessionOptionsSchema = typebox_exports.Object(
  {
    cwd: typebox_exports.String({ minLength: 1 }),
    provider: typebox_exports.Optional(Id2),
    modelId: typebox_exports.Optional(Id2),
    thinkingLevel: typebox_exports.Optional(Id2)
  },
  { additionalProperties: false }
);
var ImageInputSchema = typebox_exports.Object(
  {
    data: typebox_exports.String(),
    mimeType: Id2
  },
  { additionalProperties: false }
);
var SessionMetaSchema = typebox_exports.Object(
  {
    sessionId: Id2,
    cwd: Id2,
    active: typebox_exports.Boolean(),
    messageCount: typebox_exports.Integer({ minimum: 0 }),
    createdAt: typebox_exports.Number(),
    sessionFile: typebox_exports.Optional(typebox_exports.String()),
    name: typebox_exports.Optional(typebox_exports.String()),
    modelLabel: typebox_exports.Optional(typebox_exports.String()),
    model: typebox_exports.Optional(
      typebox_exports.Union([typebox_exports.Null(), typebox_exports.Object({ provider: Id2, modelId: Id2 }, { additionalProperties: false })])
    ),
    thinkingLevel: typebox_exports.Optional(typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()])),
    readOnly: typebox_exports.Optional(typebox_exports.Boolean()),
    modifiedAt: typebox_exports.Optional(typebox_exports.Number())
  },
  { additionalProperties: false }
);
var ReceiptIds = {
  clientMessageId: typebox_exports.Optional(typebox_exports.String()),
  assistantMessageId: typebox_exports.Optional(typebox_exports.String())
};
var PromptReceiptSchema = typebox_exports.Union([
  typebox_exports.Object({ kind: typebox_exports.Literal("agent"), ...ReceiptIds }, { additionalProperties: false }),
  typebox_exports.Object({ kind: typebox_exports.Literal("queued"), ...ReceiptIds }, { additionalProperties: false }),
  typebox_exports.Object({ kind: typebox_exports.Literal("command"), ...ReceiptIds }, { additionalProperties: false })
]);
var PromptIdsSchema = typebox_exports.Object(
  { clientMessageId: typebox_exports.String({ minLength: 1 }), assistantMessageId: typebox_exports.String({ minLength: 1 }) },
  { additionalProperties: false }
);
var QueuedMessagesSchema = typebox_exports.Object(
  { steering: typebox_exports.Array(typebox_exports.String()), followUp: typebox_exports.Array(typebox_exports.String()) },
  { additionalProperties: false }
);
var ExportFormatSchema = typebox_exports.Union([typebox_exports.Literal("html"), typebox_exports.Literal("jsonl")]);
var ForkRefSchema = typebox_exports.Object(
  { entryId: typebox_exports.Optional(Id2), text: typebox_exports.Optional(typebox_exports.String()) },
  { additionalProperties: false }
);
var RecallRefSchema = typebox_exports.Object(
  { entryId: typebox_exports.Optional(Id2), text: typebox_exports.Optional(typebox_exports.String()), timestamp: typebox_exports.Optional(typebox_exports.Number()) },
  { additionalProperties: false }
);
var RecallResultSchema = typebox_exports.Object(
  { text: typebox_exports.String(), images: typebox_exports.Array(ImageInputSchema) },
  { additionalProperties: false }
);
var ObjectResult2 = () => typebox_exports.Unsafe({ type: "object" });
var ArrayResult2 = () => typebox_exports.Unsafe({ type: "array" });
var SessionsContract = defineDomain("sessions", {
  methods: {
    createSession: {
      args: typebox_exports.Tuple([CreateSessionOptionsSchema]),
      result: typebox_exports.Unsafe(SessionMetaSchema)
    },
    listSessions: {
      args: typebox_exports.Union([typebox_exports.Tuple([]), typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })])]),
      result: typebox_exports.Array(typebox_exports.Unsafe(SessionMetaSchema))
    },
    listAllSessions: {
      args: typebox_exports.Tuple([]),
      result: typebox_exports.Array(typebox_exports.Unsafe(SessionMetaSchema))
    },
    openSession: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]),
      result: typebox_exports.Unsafe(SessionMetaSchema)
    },
    closeSession: { args: typebox_exports.Tuple([Id2]), result: typebox_exports.Void() },
    deleteSession: {
      args: typebox_exports.Union([typebox_exports.Tuple([Id2]), typebox_exports.Tuple([Id2, typebox_exports.String({ minLength: 1 })])]),
      result: typebox_exports.Void()
    },
    prompt: {
      args: typebox_exports.Union([
        typebox_exports.Tuple([Id2, typebox_exports.String()]),
        typebox_exports.Tuple([Id2, typebox_exports.String(), typebox_exports.Array(ImageInputSchema)]),
        typebox_exports.Tuple([Id2, typebox_exports.String(), typebox_exports.Array(ImageInputSchema), PromptIdsSchema])
      ]),
      result: typebox_exports.Unsafe(PromptReceiptSchema)
    },
    abort: { args: typebox_exports.Tuple([Id2]), result: typebox_exports.Void() },
    retry: {
      args: typebox_exports.Union([typebox_exports.Tuple([Id2, Id2]), typebox_exports.Tuple([Id2, Id2, typebox_exports.Number()])]),
      result: typebox_exports.Unsafe(PromptReceiptSchema)
    },
    setModel: { args: typebox_exports.Tuple([Id2, Id2, Id2]), result: typebox_exports.Void() },
    setThinkingLevel: { args: typebox_exports.Tuple([Id2, Id2]), result: typebox_exports.Void() },
    /** P18：模式即工具白名单（single / lead / swarm）；返回本次增减的工具，供 UI 提示 */
    setAgentMode: {
      args: typebox_exports.Tuple([
        Id2,
        typebox_exports.Union([typebox_exports.Literal("single"), typebox_exports.Literal("lead"), typebox_exports.Literal("swarm")])
      ]),
      result: typebox_exports.Object(
        { added: typebox_exports.Array(typebox_exports.String()), removed: typebox_exports.Array(typebox_exports.String()) },
        { additionalProperties: false }
      )
    },
    compact: {
      args: typebox_exports.Union([typebox_exports.Tuple([Id2]), typebox_exports.Tuple([Id2, typebox_exports.String()])]),
      result: typebox_exports.Void()
    },
    getStats: { args: typebox_exports.Tuple([Id2]), result: ObjectResult2() },
    getContextUsage: {
      args: typebox_exports.Tuple([Id2]),
      result: typebox_exports.Union([typebox_exports.Null(), ObjectResult2()])
    },
    clearQueue: { args: typebox_exports.Tuple([Id2]), result: QueuedMessagesSchema },
    getFollowUpMessages: { args: typebox_exports.Tuple([Id2]), result: typebox_exports.Array(typebox_exports.String()) },
    listSlashCommands: { args: typebox_exports.Tuple([Id2]), result: ArrayResult2() },
    listSlashCommandsForCwd: {
      args: typebox_exports.Union([typebox_exports.Tuple([]), typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })])]),
      result: ArrayResult2()
    },
    setSessionName: { args: typebox_exports.Tuple([Id2, typebox_exports.String()]), result: typebox_exports.Void() },
    exportSession: { args: typebox_exports.Tuple([Id2, ExportFormatSchema]), result: typebox_exports.String() },
    forkSession: {
      args: typebox_exports.Tuple([Id2, ForkRefSchema]),
      result: typebox_exports.Unsafe(SessionMetaSchema)
    },
    recallMessage: { args: typebox_exports.Tuple([Id2, RecallRefSchema]), result: RecallResultSchema },
    getLoadedResources: { args: typebox_exports.Tuple([Id2]), result: ObjectResult2() },
    getSessionMessages: { args: typebox_exports.Tuple([Id2]), result: ArrayResult2() },
    peekSubagentMessages: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]),
      result: ArrayResult2()
    },
    steerSubagent: {
      args: typebox_exports.Union([
        typebox_exports.Tuple([Id2, typebox_exports.String()]),
        typebox_exports.Tuple([Id2, typebox_exports.String(), typebox_exports.Union([typebox_exports.Literal("steer"), typebox_exports.Literal("followUp")])])
      ]),
      result: typebox_exports.Void()
    },
    replySubagentSupervisor: { args: typebox_exports.Tuple([Id2, Id2, typebox_exports.String()]), result: typebox_exports.Void() },
    getTodos: { args: typebox_exports.Tuple([Id2]), result: ArrayResult2() },
    listModels: { args: typebox_exports.Tuple([]), result: ArrayResult2() },
    listProjectFiles: {
      args: typebox_exports.Union([typebox_exports.Tuple([]), typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })])]),
      result: typebox_exports.Array(typebox_exports.String())
    },
    ensureProjectTrust: { args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]), result: typebox_exports.Boolean() }
  }
});

// packages/shared/src/host-api/settings.ts
var StringId = typebox_exports.String({ minLength: 1 });
var ProviderOptions = typebox_exports.Object(
  { forceNetwork: typebox_exports.Optional(typebox_exports.Boolean()) },
  { additionalProperties: false }
);
var ProviderModel = typebox_exports.Object(
  {
    id: StringId,
    name: StringId,
    reasoning: typebox_exports.Optional(typebox_exports.Boolean()),
    contextWindow: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
    maxTokens: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
    imageInput: typebox_exports.Optional(typebox_exports.Boolean())
  },
  { additionalProperties: false }
);
var ProviderInfoSchema = typebox_exports.Object(
  {
    id: StringId,
    name: typebox_exports.String(),
    custom: typebox_exports.Boolean(),
    overridesBuiltin: typebox_exports.Optional(typebox_exports.Boolean()),
    configured: typebox_exports.Boolean(),
    authSource: typebox_exports.Optional(typebox_exports.String()),
    authLabel: typebox_exports.Optional(typebox_exports.String()),
    oauth: typebox_exports.Optional(
      typebox_exports.Object(
        { loginLabel: typebox_exports.Optional(typebox_exports.String()), isSubscription: typebox_exports.Optional(typebox_exports.Boolean()) },
        { additionalProperties: false }
      )
    ),
    apiKeyLogin: typebox_exports.Optional(typebox_exports.Boolean()),
    baseUrl: typebox_exports.Optional(typebox_exports.String()),
    api: typebox_exports.Optional(typebox_exports.String()),
    customModels: typebox_exports.Optional(
      typebox_exports.Array(
        typebox_exports.Object(
          {
            id: StringId,
            name: typebox_exports.Optional(typebox_exports.String()),
            reasoning: typebox_exports.Optional(typebox_exports.Boolean()),
            contextWindow: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
            maxTokens: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
            imageInput: typebox_exports.Optional(typebox_exports.Boolean())
          },
          { additionalProperties: false }
        )
      )
    ),
    models: typebox_exports.Array(ProviderModel)
  },
  { additionalProperties: false }
);
var ModelPrefsSchema = typebox_exports.Object(
  {
    hiddenModels: typebox_exports.Record(typebox_exports.String(), typebox_exports.Array(typebox_exports.String())),
    subagentModels: typebox_exports.Record(typebox_exports.String(), typebox_exports.String()),
    subagentThinking: typebox_exports.Record(
      typebox_exports.String(),
      typebox_exports.Union([
        typebox_exports.Literal("off"),
        typebox_exports.Literal("minimal"),
        typebox_exports.Literal("low"),
        typebox_exports.Literal("medium"),
        typebox_exports.Literal("high"),
        typebox_exports.Literal("xhigh"),
        typebox_exports.Literal("max")
      ])
    ),
    backgroundReviewerModel: typebox_exports.Boolean()
  },
  { additionalProperties: false }
);
var CustomModel = typebox_exports.Object(
  {
    id: StringId,
    name: typebox_exports.Optional(typebox_exports.String()),
    reasoning: typebox_exports.Optional(typebox_exports.Boolean()),
    contextWindow: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
    maxTokens: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
    imageInput: typebox_exports.Optional(typebox_exports.Boolean())
  },
  { additionalProperties: false }
);
var CustomProvider = typebox_exports.Object(
  {
    id: StringId,
    name: typebox_exports.Optional(typebox_exports.String()),
    baseUrl: typebox_exports.String({ minLength: 1 }),
    api: typebox_exports.String({ minLength: 1 }),
    models: typebox_exports.Array(CustomModel),
    apiKey: typebox_exports.Optional(typebox_exports.String())
  },
  { additionalProperties: false }
);
var SubagentInfoSchema = typebox_exports.Object(
  {
    name: StringId,
    description: typebox_exports.String(),
    source: typebox_exports.Union([typebox_exports.Literal("builtin"), typebox_exports.Literal("user")])
  },
  { additionalProperties: false }
);
var LoginResultSchema = typebox_exports.Object(
  { ok: typebox_exports.Boolean(), cancelled: typebox_exports.Optional(typebox_exports.Boolean()), error: typebox_exports.Optional(typebox_exports.String()) },
  { additionalProperties: false }
);
var ProviderTestResultSchema = typebox_exports.Object(
  { ok: typebox_exports.Boolean(), error: typebox_exports.Optional(typebox_exports.String()), modelId: typebox_exports.Optional(typebox_exports.String()) },
  { additionalProperties: false }
);
var SettingsContract = defineDomain("settings", {
  methods: {
    listProviders: {
      args: typebox_exports.Union([typebox_exports.Tuple([]), typebox_exports.Tuple([ProviderOptions])]),
      result: typebox_exports.Array(ProviderInfoSchema)
    },
    saveApiKey: { args: typebox_exports.Tuple([StringId, typebox_exports.String()]), result: typebox_exports.Void() },
    removeCredential: { args: typebox_exports.Tuple([StringId]), result: typebox_exports.Void() },
    addCustomProvider: { args: typebox_exports.Tuple([CustomProvider]), result: typebox_exports.Void() },
    updateCustomProvider: { args: typebox_exports.Tuple([CustomProvider]), result: typebox_exports.Void() },
    removeCustomProvider: { args: typebox_exports.Tuple([StringId]), result: typebox_exports.Void() },
    setProviderBaseUrl: {
      args: typebox_exports.Union([
        typebox_exports.Tuple([StringId, typebox_exports.String()]),
        typebox_exports.Tuple([StringId, typebox_exports.String(), typebox_exports.String()])
      ]),
      result: typebox_exports.Void()
    },
    testProvider: {
      args: typebox_exports.Union([typebox_exports.Tuple([StringId]), typebox_exports.Tuple([StringId, StringId])]),
      result: typebox_exports.Unsafe(ProviderTestResultSchema)
    },
    getModelPrefs: { args: typebox_exports.Tuple([]), result: typebox_exports.Unsafe(ModelPrefsSchema) },
    setModelHidden: {
      args: typebox_exports.Tuple([StringId, StringId, typebox_exports.Boolean()]),
      result: typebox_exports.Unsafe(ModelPrefsSchema)
    },
    setModelsHidden: {
      args: typebox_exports.Tuple([StringId, typebox_exports.Array(StringId), typebox_exports.Boolean()]),
      result: typebox_exports.Unsafe(ModelPrefsSchema)
    },
    setSubagentModel: {
      args: typebox_exports.Tuple([StringId, typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()])]),
      result: typebox_exports.Unsafe(ModelPrefsSchema)
    },
    setSubagentThinking: {
      args: typebox_exports.Tuple([StringId, typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()])]),
      result: typebox_exports.Unsafe(ModelPrefsSchema)
    },
    setBackgroundReviewerModel: {
      args: typebox_exports.Tuple([typebox_exports.Boolean()]),
      result: typebox_exports.Unsafe(ModelPrefsSchema)
    },
    listSubagents: { args: typebox_exports.Tuple([]), result: typebox_exports.Array(SubagentInfoSchema) },
    startProviderLogin: {
      args: typebox_exports.Tuple([StringId, StringId]),
      result: typebox_exports.Unsafe(LoginResultSchema)
    },
    cancelProviderLogin: { args: typebox_exports.Tuple([StringId]), result: typebox_exports.Void() },
    respondProviderLogin: { args: typebox_exports.Tuple([StringId, StringId, typebox_exports.String()]), result: typebox_exports.Void() }
  }
});

// packages/shared/src/host-api/subagents.ts
var SubagentPanelSourceSchema = typebox_exports.Union([
  typebox_exports.Literal("builtin"),
  typebox_exports.Literal("user"),
  typebox_exports.Literal("project")
]);
var SubagentPanelRunStatusSchema = typebox_exports.Union([
  typebox_exports.Literal("queued"),
  typebox_exports.Literal("running"),
  typebox_exports.Literal("needs_reply"),
  typebox_exports.Literal("waiting_approval"),
  typebox_exports.Literal("done"),
  typebox_exports.Literal("error"),
  typebox_exports.Literal("aborted")
]);
var SubagentPanelContextStateSchema = typebox_exports.Union([
  typebox_exports.Literal("none"),
  typebox_exports.Literal("pending"),
  typebox_exports.Literal("delivered")
]);
var SupervisorRequestSchema = typebox_exports.Object(
  {
    id: typebox_exports.String({ minLength: 1 }),
    reason: typebox_exports.Union([
      typebox_exports.Literal("need_decision"),
      typebox_exports.Literal("interview_request"),
      typebox_exports.Literal("progress_update")
    ]),
    message: typebox_exports.String(),
    expectsReply: typebox_exports.Boolean()
  },
  { additionalProperties: false }
);
var SubagentPanelAgentSchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1 }),
    description: typebox_exports.String(),
    source: SubagentPanelSourceSchema,
    tools: typebox_exports.Array(typebox_exports.String()),
    model: typebox_exports.Optional(typebox_exports.String()),
    mcpAccess: typebox_exports.Union([typebox_exports.Literal("none"), typebox_exports.Literal("read-local")]),
    trusted: typebox_exports.Boolean(),
    path: typebox_exports.Optional(typebox_exports.String())
  },
  { additionalProperties: false }
);
var SubagentPanelSnapshotSchema = typebox_exports.Object(
  {
    sessionId: typebox_exports.String({ minLength: 1 }),
    cwd: typebox_exports.String({ minLength: 1 }),
    agents: typebox_exports.Array(SubagentPanelAgentSchema),
    maxConcurrent: typebox_exports.Integer({ minimum: 1 }),
    projectTrusted: typebox_exports.Boolean(),
    userAgentsDir: typebox_exports.String({ minLength: 1 }),
    projectAgentsDir: typebox_exports.String({ minLength: 1 }),
    readOnly: typebox_exports.Boolean()
  },
  { additionalProperties: false }
);
var SubagentDispatchTaskSchema = typebox_exports.Object(
  {
    agent: typebox_exports.String({ minLength: 1 }),
    task: typebox_exports.String({ minLength: 1 }),
    requiredTools: typebox_exports.Optional(typebox_exports.Array(typebox_exports.String({ minLength: 1 })))
  },
  { additionalProperties: false }
);
var SubagentDispatchInputSchema = typebox_exports.Object(
  {
    tasks: typebox_exports.Array(SubagentDispatchTaskSchema, { minItems: 1, maxItems: 8 }),
    cwd: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })),
    followUp: typebox_exports.Optional(typebox_exports.Boolean()),
    trustProjectAgents: typebox_exports.Optional(typebox_exports.Boolean())
  },
  { additionalProperties: false }
);
var SubagentPanelRunSchema = typebox_exports.Object(
  {
    runId: typebox_exports.String({ minLength: 1 }),
    dispatchId: typebox_exports.String({ minLength: 1 }),
    parentSessionId: typebox_exports.String({ minLength: 1 }),
    agent: typebox_exports.String({ minLength: 1 }),
    source: SubagentPanelSourceSchema,
    task: typebox_exports.String({ minLength: 1 }),
    cwd: typebox_exports.String({ minLength: 1 }),
    requiredTools: typebox_exports.Array(typebox_exports.String({ minLength: 1 })),
    followUp: typebox_exports.Boolean(),
    status: SubagentPanelRunStatusSchema,
    contextState: SubagentPanelContextStateSchema,
    queuePosition: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1 })),
    createdAt: typebox_exports.Number(),
    startedAt: typebox_exports.Optional(typebox_exports.Number()),
    endedAt: typebox_exports.Optional(typebox_exports.Number()),
    childSessionId: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })),
    sessionFile: typebox_exports.Optional(typebox_exports.String({ minLength: 1 })),
    model: typebox_exports.Optional(typebox_exports.String()),
    tokens: typebox_exports.Optional(typebox_exports.Number({ minimum: 0 })),
    exitCode: typebox_exports.Optional(typebox_exports.Integer()),
    error: typebox_exports.Optional(typebox_exports.String()),
    content: typebox_exports.Optional(typebox_exports.String()),
    statusText: typebox_exports.Optional(typebox_exports.String()),
    statusPhase: typebox_exports.Optional(typebox_exports.String()),
    currentAction: typebox_exports.Optional(typebox_exports.String()),
    currentTool: typebox_exports.Optional(typebox_exports.String()),
    lastSteerAt: typebox_exports.Optional(typebox_exports.Number()),
    supervisorRequest: typebox_exports.Optional(typebox_exports.Union([SupervisorRequestSchema, typebox_exports.Null()])),
    pendingApprovalIds: typebox_exports.Array(typebox_exports.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);
var SubagentDispatchReceiptSchema = typebox_exports.Object(
  {
    dispatchId: typebox_exports.String({ minLength: 1 }),
    runs: typebox_exports.Array(SubagentPanelRunSchema)
  },
  { additionalProperties: false }
);
var SubagentsContract = defineDomain("subagents", {
  methods: {
    list: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]),
      result: SubagentPanelSnapshotSchema
    },
    dispatch: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 }), SubagentDispatchInputSchema]),
      result: SubagentDispatchReceiptSchema
    },
    abort: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]),
      result: typebox_exports.Boolean()
    },
    runs: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]),
      result: typebox_exports.Array(SubagentPanelRunSchema)
    }
  }
});

// packages/shared/src/host-api/ui-plugins.ts
var UiPluginAnchorSchema = typebox_exports.Union([
  typebox_exports.Literal("top-left"),
  typebox_exports.Literal("top-center"),
  typebox_exports.Literal("top-right"),
  typebox_exports.Literal("center-left"),
  typebox_exports.Literal("center"),
  typebox_exports.Literal("center-right"),
  typebox_exports.Literal("bottom-left"),
  typebox_exports.Literal("bottom-center"),
  typebox_exports.Literal("bottom-right")
]);
var UiPluginContributionSchema = typebox_exports.Object(
  {
    id: typebox_exports.String({ minLength: 1 }),
    region: typebox_exports.String({ minLength: 1 }),
    export: typebox_exports.String({ minLength: 1 }),
    anchor: typebox_exports.Optional(UiPluginAnchorSchema),
    title: typebox_exports.Optional(typebox_exports.String())
  },
  { additionalProperties: false }
);
var UiPluginManifestSchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1 }),
    droneUi: typebox_exports.Integer({ minimum: 1 }),
    main: typebox_exports.String({ minLength: 1 }),
    slots: typebox_exports.Optional(typebox_exports.Record(typebox_exports.String(), typebox_exports.String())),
    contributions: typebox_exports.Optional(typebox_exports.Array(UiPluginContributionSchema)),
    headless: typebox_exports.Optional(typebox_exports.Boolean()),
    version: typebox_exports.Optional(typebox_exports.String()),
    displayName: typebox_exports.Optional(typebox_exports.String()),
    description: typebox_exports.Optional(typebox_exports.String())
  },
  { additionalProperties: false }
);
var UiPluginInfoSchema = typebox_exports.Object(
  {
    name: typebox_exports.String({ minLength: 1 }),
    displayName: typebox_exports.Optional(typebox_exports.String()),
    description: typebox_exports.Optional(typebox_exports.String()),
    version: typebox_exports.Optional(typebox_exports.String()),
    droneUi: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1 })),
    slots: typebox_exports.Record(typebox_exports.String(), typebox_exports.String()),
    contributions: typebox_exports.Array(UiPluginContributionSchema),
    headless: typebox_exports.Optional(typebox_exports.Boolean()),
    enabled: typebox_exports.Boolean(),
    trusted: typebox_exports.Boolean(),
    invalidReason: typebox_exports.Optional(typebox_exports.String()),
    buildError: typebox_exports.Optional(typebox_exports.String()),
    built: typebox_exports.Boolean(),
    builtin: typebox_exports.Optional(typebox_exports.Boolean())
  },
  { additionalProperties: false }
);
var UiPluginsConfigSchema = typebox_exports.Object(
  {
    enabled: typebox_exports.Boolean(),
    plugins: typebox_exports.Record(
      typebox_exports.String(),
      typebox_exports.Object(
        {
          enabled: typebox_exports.Boolean(),
          trusted: typebox_exports.Boolean()
        },
        { additionalProperties: false }
      )
    ),
    assignments: typebox_exports.Record(typebox_exports.String(), typebox_exports.String())
  },
  { additionalProperties: false }
);
var UiPluginsEventSchema = typebox_exports.Union([
  typebox_exports.Object(
    { kind: typebox_exports.Literal("changed"), name: typebox_exports.String({ minLength: 1 }) },
    { additionalProperties: false }
  ),
  typebox_exports.Object({ kind: typebox_exports.Literal("config") }, { additionalProperties: false })
]);
var UiPluginsContract = defineDomain("uiPlugins", {
  methods: {
    getConfig: {
      args: typebox_exports.Tuple([]),
      result: typebox_exports.Unsafe(UiPluginsConfigSchema)
    },
    setEnabled: {
      args: typebox_exports.Tuple([typebox_exports.Boolean()]),
      result: typebox_exports.Void()
    },
    list: {
      args: typebox_exports.Tuple([]),
      result: typebox_exports.Array(typebox_exports.Unsafe(UiPluginInfoSchema))
    },
    readCode: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]),
      result: typebox_exports.Union([
        typebox_exports.Object(
          {
            manifest: typebox_exports.Unsafe(UiPluginManifestSchema),
            code: typebox_exports.String()
          },
          { additionalProperties: false }
        ),
        typebox_exports.Object({ error: typebox_exports.String() }, { additionalProperties: false })
      ])
    },
    setPluginEnabled: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 }), typebox_exports.Boolean()]),
      result: typebox_exports.Void()
    },
    assignSlot: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 }), typebox_exports.Union([typebox_exports.String(), typebox_exports.Null()])]),
      result: typebox_exports.Void()
    },
    rebuild: {
      args: typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })]),
      result: typebox_exports.Union([
        typebox_exports.Object({ ok: typebox_exports.Literal(true) }, { additionalProperties: false }),
        typebox_exports.Object({ ok: typebox_exports.Literal(false), error: typebox_exports.String() }, { additionalProperties: false })
      ])
    },
    openDir: {
      // TypeBox optional tuple items still produce minItems=1; model the
      // no-argument and named-plugin forms explicitly.
      args: typebox_exports.Union([typebox_exports.Tuple([]), typebox_exports.Tuple([typebox_exports.String({ minLength: 1 })])]),
      result: typebox_exports.Void()
    }
  },
  events: {
    event: typebox_exports.Unsafe(UiPluginsEventSchema)
  }
});

// packages/shared/src/knowledge-specialists.ts
var KNOWLEDGE_SPECIALISTS = [
  {
    role: "navigator",
    name: "knowledge-navigator",
    label: "\u77E5\u8BC6\u5BFC\u822A\u5458",
    description: "\u6309\u5BFC\u822A\u68C0\u7D22\u5171\u4EAB\u77E5\u8BC6\u4E0E\u5F53\u524D\u9879\u76EE\uFF0C\u53EA\u8FD4\u56DE\u5C11\u91CF\u76F8\u5173\u6765\u6E90\u3002",
    permissions: ["knowledge_read", "knowledge_search", "knowledge_submit"],
    maxTurns: 6,
    maxTokens: 1800
  },
  {
    role: "evidence",
    name: "knowledge-evidence-curator",
    label: "\u8BC1\u636E\u6574\u7406\u5458",
    description: "\u6838\u5BF9\u6307\u5B9A\u6765\u6E90\u7684\u9002\u7528\u8303\u56F4\u3001\u51B2\u7A81\u4E0E\u7F3A\u53E3\uFF0C\u4E0D\u81EA\u52A8\u8BA4\u8BC1\u7ED3\u8BBA\u3002",
    permissions: ["knowledge_read", "knowledge_submit"],
    maxTurns: 4,
    maxTokens: 2400
  },
  {
    role: "wiki",
    name: "knowledge-wiki-editor",
    label: "Wiki \u4FEE\u8BA2\u5458",
    description: "\u6839\u636E\u5DF2\u8BFB\u8BC1\u636E\u751F\u6210\u5F85\u5BA1\u6838\u4FEE\u8BA2\u6B63\u6587\uFF0C\u65E0\u6B63\u5F0F Wiki \u5199\u5165\u4E0E\u6279\u51C6\u6743\u9650\u3002",
    permissions: ["knowledge_read", "knowledge_submit"],
    maxTurns: 3,
    maxTokens: 6500
  },
  {
    role: "explainer",
    name: "knowledge-explainer",
    label: "Show Me \u8BB2\u89E3\u5458",
    description: "\u6309\u5B9E\u9645 Show Me skill \u751F\u6210\u72EC\u7ACB\u8BB2\u89E3\u4EA7\u7269\uFF0C\u7531\u5BBF\u4E3B\u4FDD\u5B58\uFF1B\u4E0D\u6267\u884C\u8F6F\u4EF6\u6216\u6D4B\u8BD5\u3002",
    permissions: ["knowledge_read", "knowledge_submit"],
    maxTurns: 3,
    maxTokens: 12e3
  }
];
var KNOWLEDGE_REVIEWER = {
  role: "reviewer",
  name: "knowledge-wiki-reviewer",
  label: "Wiki \u6A21\u578B\u5BA1\u6838\u5458",
  description: "\u72EC\u7ACB\u6838\u5BF9\u9009\u4E2D\u7684\u5019\u9009\u548C\u6765\u6E90\uFF0C\u4EC5\u8FD4\u56DE\u5BA1\u6838\u610F\u89C1\uFF1B\u81EA\u52A8\u5E94\u7528\u987B\u7531\u7528\u6237\u5355\u72EC\u6388\u6743\u3002",
  permissions: ["knowledge_submit"],
  maxTurns: 1,
  maxTokens: 2800
};
var PROTECTED_KNOWLEDGE_AGENTS = [...KNOWLEDGE_SPECIALISTS, KNOWLEDGE_REVIEWER];

// packages/shared/src/process-lanes/demo.ts
var route = (utterance, primary, stage, intake, landing, keptCheckpoint = false, host = null) => ({
  utterance,
  intake,
  capabilities: primary === "pydeseq2" ? ["research"] : ["knowledge", "research"],
  topics: [],
  direction: stage === "de" ? "analysis" : "evidence",
  stage,
  contract: null,
  primary,
  reason: null,
  unavailableStage: null,
  comparison: false,
  academic: false,
  keptCheckpoint,
  deferPhrase: intake === "continuation",
  visiblePrimary: Boolean(primary),
  landing,
  host
});
var task = (state, reason, planApproved = false) => ({
  version: 2,
  revision: 1,
  activeTaskId: "demo-task",
  selectionRequired: false,
  limits: { stageCalls: 48, totalCalls: 192 },
  tasks: [
    {
      id: "demo-task",
      goal: "demo",
      state,
      updatedAt: "2026-10-04T00:00:00Z",
      reason,
      stage: 1,
      planApproved,
      authorizationRequired: !planApproved,
      budget: { calls: 2, stageCalls: 1 },
      waitMs: 0,
      capabilities: ["research"],
      milestones: [],
      actions: [],
      operations: []
    }
  ]
});
var PROCESS_DEMO_STEPS = [
  [
    { type: "user-input", id: "u1", seq: 0, text: "\u68C0\u7D22\u8BBA\u6587\uFF1A\u5C0F\u83DC\u86FE DHX16 \u5728\u6027\u522B\u51B3\u5B9A\u4E2D\u7684\u8BC1\u636E" },
    {
      type: "turn-route",
      id: "r1",
      seq: 1,
      route: route(
        "\u68C0\u7D22\u8BBA\u6587\uFF1A\u5C0F\u83DC\u86FE DHX16 \u5728\u6027\u522B\u51B3\u5B9A\u4E2D\u7684\u8BC1\u636E",
        "nature-academic-search",
        "search",
        "new-topic",
        "workflow"
      )
    }
  ],
  [
    { type: "user-input", id: "u2", seq: 2, text: "\u7EE7\u7EED\u3002\u9605\u8BFB\u5F52\u6863\u540E\u6765\u6E90\uFF0C\u7ED1\u5B9A\u4E3B\u5F20\u5E76\u5199\u5165\u77E5\u8BC6\u5E93" },
    {
      type: "turn-route",
      id: "r2",
      seq: 3,
      route: route(
        "\u7EE7\u7EED\u3002\u9605\u8BFB\u5F52\u6863\u540E\u6765\u6E90\uFF0C\u7ED1\u5B9A\u4E3B\u5F20\u5E76\u5199\u5165\u77E5\u8BC6\u5E93",
        "research-vault",
        "vault",
        "new-topic",
        "workflow"
      )
    }
  ],
  [
    { type: "user-input", id: "u3", seq: 4, text: "\u5BF9\u5DF2\u6709\u8BA1\u6570\u505A DHX16 \u7684\u5DEE\u5F02\u8868\u8FBE" },
    {
      type: "turn-route",
      id: "r3",
      seq: 5,
      route: route("\u5BF9\u5DF2\u6709\u8BA1\u6570\u505A DHX16 \u7684\u5DEE\u5F02\u8868\u8FBE", "pydeseq2", "de", "new-topic", "workflow")
    }
  ],
  [{ type: "tool-receipt", id: "t4", seq: 6, name: "read", state: "done" }],
  [
    {
      type: "tool-receipt",
      id: "t5",
      seq: 7,
      name: "write",
      state: "error",
      blockedReason: "task-authorization-required"
    }
  ],
  [{ type: "task-view", id: "v6", seq: 8, view: task("running", null, true), demo: true }],
  [{ type: "task-view", id: "v7", seq: 9, view: task("blocked", "reconcile-before-retry", true) }],
  [
    { type: "user-input", id: "u8", seq: 10, text: "\u8FDB\u5EA6\u5982\u4F55" },
    {
      type: "turn-route",
      id: "r8",
      seq: 11,
      route: route("\u8FDB\u5EA6\u5982\u4F55", "pydeseq2", "de", "status", "host-gate", true, {
        reason: "reconcile-before-retry",
        state: "blocked",
        stageCalls: 1,
        calls: 2,
        progressCount: 1,
        stageStartProgress: 0,
        stageLimited: false,
        hasProgress: true,
        pendingReview: false,
        reviewLinked: false,
        deferredReviews: 0,
        releasedStage: false
      })
    }
  ]
];

// packages/shared/src/resource-preview-format.ts
var TEXT_PREVIEW_BYTES = 128 * 1024;

// node_modules/typebox/build/schema/types/_refine.mjs
function IsRefine2(value) {
  return guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => guard_exports.IsObject(value2) && guard_exports.HasPropertyKey(value2, "check") && guard_exports.HasPropertyKey(value2, "error") && guard_exports.IsFunction(value2.check) && guard_exports.IsFunction(value2.error));
}

// node_modules/typebox/build/schema/types/schema.mjs
function IsSchemaObject(value) {
  return guard_exports.IsObject(value) && !guard_exports.IsArray(value);
}
function IsSchemaBoolean(value) {
  return guard_exports.IsBoolean(value);
}
function IsSchema2(value) {
  return IsSchemaObject(value) || IsSchemaBoolean(value);
}

// node_modules/typebox/build/schema/types/additionalItems.mjs
function IsAdditionalItems(schema) {
  return guard_exports.HasPropertyKey(schema, "additionalItems") && IsSchema2(schema.additionalItems);
}

// node_modules/typebox/build/schema/types/additionalProperties.mjs
function IsAdditionalProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "additionalProperties") && IsSchema2(schema.additionalProperties);
}

// node_modules/typebox/build/schema/types/allOf.mjs
function IsAllOf(schema) {
  return guard_exports.HasPropertyKey(schema, "allOf") && guard_exports.IsArray(schema.allOf) && schema.allOf.every((value) => IsSchema2(value));
}

// node_modules/typebox/build/schema/types/anchor.mjs
function IsAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$anchor") && guard_exports.IsString(schema.$anchor);
}

// node_modules/typebox/build/schema/types/anyOf.mjs
function IsAnyOf(schema) {
  return guard_exports.HasPropertyKey(schema, "anyOf") && guard_exports.IsArray(schema.anyOf) && schema.anyOf.every((value) => IsSchema2(value));
}

// node_modules/typebox/build/schema/types/const.mjs
function IsConst(value) {
  return guard_exports.HasPropertyKey(value, "const");
}

// node_modules/typebox/build/schema/types/contains.mjs
function IsContains(schema) {
  return guard_exports.HasPropertyKey(schema, "contains") && IsSchema2(schema.contains);
}

// node_modules/typebox/build/schema/types/default.mjs
function IsDefault(schema) {
  return guard_exports.HasPropertyKey(schema, "default");
}

// node_modules/typebox/build/schema/types/dependencies.mjs
function IsDependencies(schema) {
  return guard_exports.HasPropertyKey(schema, "dependencies") && guard_exports.IsObject(schema.dependencies) && Object.values(schema.dependencies).every((value) => IsSchema2(value) || guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
}

// node_modules/typebox/build/schema/types/dependentRequired.mjs
function IsDependentRequired(schema) {
  return guard_exports.HasPropertyKey(schema, "dependentRequired") && guard_exports.IsObject(schema.dependentRequired) && Object.values(schema.dependentRequired).every((value) => guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
}

// node_modules/typebox/build/schema/types/dependentSchemas.mjs
function IsDependentSchemas(schema) {
  return guard_exports.HasPropertyKey(schema, "dependentSchemas") && guard_exports.IsObject(schema.dependentSchemas) && Object.values(schema.dependentSchemas).every((value) => IsSchema2(value));
}

// node_modules/typebox/build/schema/types/dynamicAnchor.mjs
function IsDynamicAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$dynamicAnchor") && guard_exports.IsString(schema.$dynamicAnchor);
}

// node_modules/typebox/build/schema/types/dynamicRef.mjs
function IsDynamicRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$dynamicRef") && guard_exports.IsString(schema.$dynamicRef);
}

// node_modules/typebox/build/schema/types/else.mjs
function IsElse(schema) {
  return guard_exports.HasPropertyKey(schema, "else") && IsSchema2(schema.else);
}

// node_modules/typebox/build/schema/types/enum.mjs
function IsEnum2(schema) {
  return guard_exports.HasPropertyKey(schema, "enum") && guard_exports.IsArray(schema.enum);
}

// node_modules/typebox/build/schema/types/exclusiveMaximum.mjs
function IsExclusiveMaximum(schema) {
  return guard_exports.HasPropertyKey(schema, "exclusiveMaximum") && (guard_exports.IsNumber(schema.exclusiveMaximum) || guard_exports.IsBigInt(schema.exclusiveMaximum));
}

// node_modules/typebox/build/schema/types/exclusiveMinimum.mjs
function IsExclusiveMinimum(schema) {
  return guard_exports.HasPropertyKey(schema, "exclusiveMinimum") && (guard_exports.IsNumber(schema.exclusiveMinimum) || guard_exports.IsBigInt(schema.exclusiveMinimum));
}

// node_modules/typebox/build/schema/types/format.mjs
function IsFormat(schema) {
  return guard_exports.HasPropertyKey(schema, "format") && guard_exports.IsString(schema.format);
}

// node_modules/typebox/build/schema/types/id.mjs
function IsId(schema) {
  return guard_exports.HasPropertyKey(schema, "$id") && guard_exports.IsString(schema.$id);
}

// node_modules/typebox/build/schema/types/if.mjs
function IsIf(schema) {
  return guard_exports.HasPropertyKey(schema, "if") && IsSchema2(schema.if);
}

// node_modules/typebox/build/schema/types/items.mjs
function IsItems(schema) {
  return guard_exports.HasPropertyKey(schema, "items") && (IsSchema2(schema.items) || guard_exports.IsArray(schema.items) && schema.items.every((value) => {
    return IsSchema2(value);
  }));
}
function IsItemsSized(schema) {
  return IsItems(schema) && guard_exports.IsArray(schema.items);
}

// node_modules/typebox/build/schema/types/maximum.mjs
function IsMaximum(schema) {
  return guard_exports.HasPropertyKey(schema, "maximum") && (guard_exports.IsNumber(schema.maximum) || guard_exports.IsBigInt(schema.maximum));
}

// node_modules/typebox/build/schema/types/maxContains.mjs
function IsMaxContains(schema) {
  return guard_exports.HasPropertyKey(schema, "maxContains") && guard_exports.IsNumber(schema.maxContains);
}

// node_modules/typebox/build/schema/types/maxItems.mjs
function IsMaxItems(schema) {
  return guard_exports.HasPropertyKey(schema, "maxItems") && guard_exports.IsNumber(schema.maxItems);
}

// node_modules/typebox/build/schema/types/maxLength.mjs
function IsMaxLength3(schema) {
  return guard_exports.HasPropertyKey(schema, "maxLength") && guard_exports.IsNumber(schema.maxLength);
}

// node_modules/typebox/build/schema/types/maxProperties.mjs
function IsMaxProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "maxProperties") && guard_exports.IsNumber(schema.maxProperties);
}

// node_modules/typebox/build/schema/types/minimum.mjs
function IsMinimum(schema) {
  return guard_exports.HasPropertyKey(schema, "minimum") && (guard_exports.IsNumber(schema.minimum) || guard_exports.IsBigInt(schema.minimum));
}

// node_modules/typebox/build/schema/types/minContains.mjs
function IsMinContains(schema) {
  return guard_exports.HasPropertyKey(schema, "minContains") && guard_exports.IsNumber(schema.minContains);
}

// node_modules/typebox/build/schema/types/minItems.mjs
function IsMinItems(schema) {
  return guard_exports.HasPropertyKey(schema, "minItems") && guard_exports.IsNumber(schema.minItems);
}

// node_modules/typebox/build/schema/types/minLength.mjs
function IsMinLength3(schema) {
  return guard_exports.HasPropertyKey(schema, "minLength") && guard_exports.IsNumber(schema.minLength);
}

// node_modules/typebox/build/schema/types/minProperties.mjs
function IsMinProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "minProperties") && guard_exports.IsNumber(schema.minProperties);
}

// node_modules/typebox/build/schema/types/multipleOf.mjs
function IsMultipleOf2(schema) {
  return guard_exports.HasPropertyKey(schema, "multipleOf") && (guard_exports.IsNumber(schema.multipleOf) || guard_exports.IsBigInt(schema.multipleOf));
}

// node_modules/typebox/build/schema/types/not.mjs
function IsNot(schema) {
  return guard_exports.HasPropertyKey(schema, "not") && IsSchema2(schema.not);
}

// node_modules/typebox/build/schema/types/oneOf.mjs
function IsOneOf(schema) {
  return guard_exports.HasPropertyKey(schema, "oneOf") && guard_exports.IsArray(schema.oneOf) && schema.oneOf.every((value) => IsSchema2(value));
}

// node_modules/typebox/build/schema/types/pattern.mjs
function IsPattern(schema) {
  return guard_exports.HasPropertyKey(schema, "pattern") && (guard_exports.IsString(schema.pattern) || schema.pattern instanceof RegExp);
}

// node_modules/typebox/build/schema/types/patternProperties.mjs
function IsPatternProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "patternProperties") && guard_exports.IsObject(schema.patternProperties) && Object.values(schema.patternProperties).every((value) => IsSchema2(value));
}

// node_modules/typebox/build/schema/types/prefixItems.mjs
function IsPrefixItems(schema) {
  return guard_exports.HasPropertyKey(schema, "prefixItems") && guard_exports.IsArray(schema.prefixItems) && schema.prefixItems.every((schema2) => IsSchema2(schema2));
}

// node_modules/typebox/build/schema/types/properties.mjs
function IsProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "properties") && guard_exports.IsObject(schema.properties) && Object.values(schema.properties).every((value) => IsSchema2(value));
}

// node_modules/typebox/build/schema/types/propertyNames.mjs
function IsPropertyNames(schema) {
  return guard_exports.HasPropertyKey(schema, "propertyNames") && (guard_exports.IsObject(schema.propertyNames) || IsSchema2(schema.propertyNames));
}

// node_modules/typebox/build/schema/types/recursiveAnchor.mjs
function IsRecursiveAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$recursiveAnchor") && guard_exports.IsBoolean(schema.$recursiveAnchor);
}
function IsRecursiveAnchorTrue(schema) {
  return IsRecursiveAnchor(schema) && guard_exports.IsEqual(schema.$recursiveAnchor, true);
}

// node_modules/typebox/build/schema/types/recursiveRef.mjs
function IsRecursiveRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$recursiveRef") && guard_exports.IsString(schema.$recursiveRef);
}

// node_modules/typebox/build/schema/types/ref.mjs
function IsRef2(schema) {
  return guard_exports.HasPropertyKey(schema, "$ref") && guard_exports.IsString(schema.$ref);
}

// node_modules/typebox/build/schema/types/required.mjs
function IsRequired(schema) {
  return guard_exports.HasPropertyKey(schema, "required") && guard_exports.IsArray(schema.required) && schema.required.every((value) => guard_exports.IsString(value));
}

// node_modules/typebox/build/schema/types/then.mjs
function IsThen(schema) {
  return guard_exports.HasPropertyKey(schema, "then") && IsSchema2(schema.then);
}

// node_modules/typebox/build/schema/types/type.mjs
function IsType(schema) {
  return guard_exports.HasPropertyKey(schema, "type") && (guard_exports.IsString(schema.type) || guard_exports.IsArray(schema.type) && schema.type.every((value) => guard_exports.IsString(value)));
}

// node_modules/typebox/build/schema/types/uniqueItems.mjs
function IsUniqueItems(schema) {
  return guard_exports.HasPropertyKey(schema, "uniqueItems") && guard_exports.IsBoolean(schema.uniqueItems);
}

// node_modules/typebox/build/schema/types/unevaluatedItems.mjs
function IsUnevaluatedItems(schema) {
  return guard_exports.HasPropertyKey(schema, "unevaluatedItems") && IsSchema2(schema.unevaluatedItems);
}

// node_modules/typebox/build/schema/types/unevaluatedProperties.mjs
function IsUnevaluatedProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "unevaluatedProperties") && IsSchema2(schema.unevaluatedProperties);
}

// node_modules/typebox/build/schema/engine/_context.mjs
var CheckContext = class {
  constructor() {
    const indices = /* @__PURE__ */ new Set();
    const keys = /* @__PURE__ */ new Set();
    this.stack = [{ indices, keys }];
  }
  // ----------------------------------------------------------------
  // Stack
  // ----------------------------------------------------------------
  Push() {
    const indices = /* @__PURE__ */ new Set();
    const keys = /* @__PURE__ */ new Set();
    this.stack.push({ indices, keys });
    return true;
  }
  Pop() {
    this.stack.pop();
    return true;
  }
  // ----------------------------------------------------------------
  // Top
  // ----------------------------------------------------------------
  AddIndex(index) {
    this.GetIndices().add(index);
    return true;
  }
  AddKey(key) {
    this.GetKeys().add(key);
    return true;
  }
  GetIndices() {
    const top = this.stack[this.stack.length - 1];
    return top.indices;
  }
  GetKeys() {
    const top = this.stack[this.stack.length - 1];
    return top.keys;
  }
  Merge(results) {
    for (const context of results) {
      context.GetIndices().forEach((value) => this.GetIndices().add(value));
      context.GetKeys().forEach((value) => this.GetKeys().add(value));
    }
    return true;
  }
};
var ErrorContext = class extends CheckContext {
  constructor(callback) {
    super();
    this.callback = callback;
  }
  AddError(error) {
    this.callback(error);
    return false;
  }
};
var AccumulatedErrorContext = class extends ErrorContext {
  constructor() {
    super((error) => this.errors.push(error));
    this.errors = [];
  }
  AddError(error) {
    this.errors.push(error);
    return false;
  }
  GetErrors() {
    return this.errors;
  }
};

// node_modules/typebox/build/schema/engine/_refine.mjs
function CheckRefine(_stack, _context, schema, value) {
  return guard_exports.Every(schema["~refine"], 0, (refinement, _) => refinement.check(value));
}
function ErrorRefine(_stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(schema["~refine"], 0, (refinement, index) => {
    return refinement.check(value) || context.AddError({
      keyword: "~refine",
      schemaPath,
      instancePath,
      params: { index, message: refinement.error(value) }
    });
  });
}

// node_modules/typebox/build/schema/engine/additionalItems.mjs
function IsValid(schema) {
  return IsItems(schema) && guard_exports.IsArray(schema.items);
}
function CheckAdditionalItems(stack, context, schema, value) {
  if (!IsValid(schema))
    return true;
  const isAdditionalItems = value.every((item, index) => {
    return guard_exports.IsLessThan(index, schema.items.length) || CheckSchemaPushStack(stack, context, schema.additionalItems, item) && context.AddIndex(index);
  });
  return isAdditionalItems;
}
function ErrorAdditionalItems(stack, context, schemaPath, instancePath, schema, value) {
  if (!IsValid(schema))
    return true;
  const isAdditionalItems = value.every((item, index) => {
    const nextSchemaPath = `${schemaPath}/additionalItems`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessThan(index, schema.items.length) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema.additionalItems, item) && context.AddIndex(index);
  });
  return isAdditionalItems;
}

// node_modules/typebox/build/schema/engine/additionalProperties.mjs
function GetPropertyKeyAsPattern(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escaped}$`;
}
function GetPropertiesPattern(schema) {
  const patterns = [];
  if (IsPatternProperties(schema))
    patterns.push(...guard_exports.Keys(schema.patternProperties));
  if (IsProperties(schema))
    patterns.push(...guard_exports.Keys(schema.properties).map(GetPropertyKeyAsPattern));
  return guard_exports.IsEqual(patterns.length, 0) ? "(?!)" : `(${patterns.join("|")})`;
}
function CheckAdditionalProperties(stack, context, schema, value) {
  const regexp = new RegExp(GetPropertiesPattern(schema));
  const isAdditionalProperties = guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => {
    return regexp.test(key) || CheckSchemaPushStack(stack, context, schema.additionalProperties, value[key]) && context.AddKey(key);
  });
  return isAdditionalProperties;
}
function ErrorAdditionalProperties(stack, context, schemaPath, instancePath, schema, value) {
  const regexp = new RegExp(GetPropertiesPattern(schema));
  const additionalProperties = [];
  const isAdditionalProperties = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
    const nextSchemaPath = `${schemaPath}/additionalProperties`;
    const nextInstancePath = `${instancePath}/${key}`;
    const nextContext = new AccumulatedErrorContext();
    const isAdditionalProperty = regexp.test(key) || ErrorSchemaPushStack(stack, nextContext, nextSchemaPath, nextInstancePath, schema.additionalProperties, value[key]) && context.AddKey(key);
    if (!isAdditionalProperty)
      additionalProperties.push(key);
    return isAdditionalProperty;
  });
  return isAdditionalProperties || context.AddError({
    keyword: "additionalProperties",
    schemaPath,
    instancePath,
    params: { additionalProperties }
  });
}

// node_modules/typebox/build/schema/engine/allOf.mjs
function CheckAllOf(stack, context, schema, value) {
  const results = schema.allOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsEqual(results.length, schema.allOf.length) && context.Merge(results);
}
function ErrorAllOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const results = schema.allOf.reduce((result, schema2, index) => {
    const nextSchemaPath = `${schemaPath}/allOf/${index}`;
    const nextContext = new AccumulatedErrorContext();
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isAllOf = guard_exports.IsEqual(results.length, schema.allOf.length) && context.Merge(results);
  if (!isAllOf)
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isAllOf;
}

// node_modules/typebox/build/schema/engine/anyOf.mjs
function CheckAnyOf(stack, context, schema, value) {
  const results = schema.anyOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsGreaterThan(results.length, 0) && context.Merge(results);
}
function ErrorAnyOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const results = schema.anyOf.reduce((result, schema2, index) => {
    const nextContext = new AccumulatedErrorContext();
    const nextSchemaPath = `${schemaPath}/anyOf/${index}`;
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isAnyOf = guard_exports.IsGreaterThan(results.length, 0) && context.Merge(results);
  if (!isAnyOf)
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isAnyOf || context.AddError({
    keyword: "anyOf",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/typebox/build/schema/engine/boolean.mjs
function CheckSchemaBoolean(_stack, _context, schema, _value) {
  return schema;
}
function ErrorSchemaBoolean(stack, context, schemaPath, instancePath, schema, value) {
  return CheckSchemaBoolean(stack, context, schema, value) || context.AddError({
    keyword: "boolean",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/typebox/build/schema/engine/const.mjs
function CheckConst(_stack, _context, schema, value) {
  return guard_exports.IsValueLike(schema.const) ? guard_exports.IsEqual(value, schema.const) : guard_exports.IsDeepEqual(value, schema.const);
}
function ErrorConst(stack, context, schemaPath, instancePath, schema, value) {
  return CheckConst(stack, context, schema, value) || context.AddError({
    keyword: "const",
    schemaPath,
    instancePath,
    params: { allowedValue: schema.const }
  });
}

// node_modules/typebox/build/schema/engine/contains.mjs
function IsValid2(schema) {
  return !(IsMinContains(schema) && guard_exports.IsEqual(schema.minContains, 0));
}
function CheckContains(stack, context, schema, value) {
  if (!IsValid2(schema))
    return true;
  return !guard_exports.IsEqual(value.length, 0) && value.some((item) => CheckSchema(stack, context, schema.contains, item));
}
function ErrorContains(stack, context, schemaPath, instancePath, schema, value) {
  return CheckContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains: 1 }
  });
}

// node_modules/typebox/build/schema/engine/dependencies.mjs
function CheckDependencies(stack, context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
    return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((key2) => guard_exports.HasPropertyKey(value, key2)) : CheckSchema(stack, context, schema2, value));
  });
  return isLength || isEvery;
}
function ErrorDependencies(stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/dependencies/${key}`;
    return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((dependency) => guard_exports.HasPropertyKey(value, dependency) || context.AddError({
      keyword: "dependencies",
      schemaPath,
      instancePath,
      params: { property: key, dependencies: schema2 }
    })) : ErrorSchema(stack, context, nextSchemaPath, instancePath, schema2, value));
  });
  return isLength || isEvery;
}

// node_modules/typebox/build/schema/engine/dependentRequired.mjs
function CheckDependentRequired(_stack, _context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
    return !guard_exports.HasPropertyKey(value, key) || keys.every((key2) => guard_exports.HasPropertyKey(value, key2));
  });
  return isLength || isEvery;
}
function ErrorDependentRequired(_stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEveryEntry = guard_exports.EveryAll(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
    return !guard_exports.HasPropertyKey(value, key) || guard_exports.EveryAll(keys, 0, (dependency) => guard_exports.HasPropertyKey(value, dependency) || context.AddError({
      keyword: "dependentRequired",
      schemaPath,
      instancePath,
      params: { property: key, dependencies: keys }
    }));
  });
  return isLength || isEveryEntry;
}

// node_modules/typebox/build/schema/engine/dependentSchemas.mjs
function CheckDependentSchemas(stack, context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
    return !guard_exports.HasPropertyKey(value, key) || CheckSchema(stack, context, schema2, value);
  });
  return isLength || isEvery;
}
function ErrorDependentSchemas(stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/dependentSchemas/${key}`;
    return !guard_exports.HasPropertyKey(value, key) || ErrorSchema(stack, context, nextSchemaPath, instancePath, schema2, value);
  });
  return isLength || isEvery;
}

// node_modules/typebox/build/schema/engine/dynamicRef.mjs
function CheckDynamicRef(stack, context, schema, value) {
  const target = stack.DynamicRef(schema) ?? false;
  return IsSchema2(target) && CheckSchema(stack, context, target, value);
}
function ErrorDynamicRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.DynamicRef(schema) ?? false;
  return IsSchema2(target) && ErrorSchema(stack, context, "#", instancePath, target, value);
}

// node_modules/typebox/build/schema/engine/enum.mjs
function CheckEnum(_stack, _context, schema, value) {
  return schema.enum.some((option) => guard_exports.IsValueLike(option) ? guard_exports.IsEqual(value, option) : guard_exports.IsDeepEqual(value, option));
}
function ErrorEnum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckEnum(stack, context, schema, value) || context.AddError({
    keyword: "enum",
    schemaPath,
    instancePath,
    params: { allowedValues: schema.enum }
  });
}

// node_modules/typebox/build/schema/engine/exclusiveMaximum.mjs
function CheckExclusiveMaximum(_stack, _context, schema, value) {
  return guard_exports.IsLessThan(value, schema.exclusiveMaximum);
}
function ErrorExclusiveMaximum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckExclusiveMaximum(stack, context, schema, value) || context.AddError({
    keyword: "exclusiveMaximum",
    schemaPath,
    instancePath,
    params: { comparison: "<", limit: schema.exclusiveMaximum }
  });
}

// node_modules/typebox/build/schema/engine/exclusiveMinimum.mjs
function CheckExclusiveMinimum(_stack, _context, schema, value) {
  return guard_exports.IsGreaterThan(value, schema.exclusiveMinimum);
}
function ErrorExclusiveMinimum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckExclusiveMinimum(stack, context, schema, value) || context.AddError({
    keyword: "exclusiveMinimum",
    schemaPath,
    instancePath,
    params: { comparison: ">", limit: schema.exclusiveMinimum }
  });
}

// node_modules/typebox/build/format/format.mjs
var format_exports = {};
__export(format_exports, {
  Clear: () => Clear,
  Entries: () => Entries2,
  Get: () => Get3,
  Has: () => Has,
  IsDate: () => IsDate2,
  IsDateTime: () => IsDateTime,
  IsDuration: () => IsDuration,
  IsEmail: () => IsEmail,
  IsHostname: () => IsHostname,
  IsIPv4: () => IsIPv4,
  IsIPv6: () => IsIPv6,
  IsIdnEmail: () => IsIdnEmail,
  IsIdnHostname: () => IsIdnHostname,
  IsIri: () => IsIri,
  IsIriReference: () => IsIriReference,
  IsJsonPointer: () => IsJsonPointer,
  IsJsonPointerUriFragment: () => IsJsonPointerUriFragment,
  IsRegex: () => IsRegex,
  IsRelativeJsonPointer: () => IsRelativeJsonPointer,
  IsTime: () => IsTime,
  IsUri: () => IsUri,
  IsUriReference: () => IsUriReference,
  IsUriTemplate: () => IsUriTemplate,
  IsUrl: () => IsUrl,
  IsUuid: () => IsUuid,
  Reset: () => Reset2,
  Set: () => Set3,
  Test: () => Test
});

// node_modules/typebox/build/format/date.mjs
var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
function IsLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function IsDate2(value) {
  const matches = DATE.exec(value);
  if (!matches)
    return false;
  const year = +matches[1];
  const month = +matches[2];
  const day = +matches[3];
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && IsLeapYear(year) ? 29 : DAYS[month]);
}

// node_modules/typebox/build/format/time.mjs
var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(?:Z|([+-])(\d\d):(\d\d))?$/i;
function IsTime(value, strictTimeZone = true) {
  const matches = TIME.exec(value);
  if (!matches)
    return false;
  const hr = +matches[1];
  const min = +matches[2];
  const sec = +matches[3];
  const tzSign = matches[4] === "-" ? -1 : 1;
  const tzH = +(matches[5] || 0);
  const tzM = +(matches[6] || 0);
  if (tzH > 23 || tzM > 59)
    return false;
  if (strictTimeZone && !matches[4] && value.toLowerCase().indexOf("z") === -1) {
    return false;
  }
  if (hr <= 23 && min <= 59 && sec < 60)
    return true;
  const utcMin = min - tzM * tzSign;
  const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}

// node_modules/typebox/build/format/date_time.mjs
function IsDateTime(value, strictTimeZone = true) {
  const dateTime = value.split(/T/i);
  return dateTime.length === 2 && IsDate2(dateTime[0]) && IsTime(dateTime[1], strictTimeZone);
}

// node_modules/typebox/build/format/duration.mjs
var Duration = /^P((\d+Y(\d+M(\d+D)?)?|\d+M(\d+D)?|\d+D)(T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S))?|T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S)|\d+W)$/;
function IsDuration(value) {
  return Duration.test(value);
}

// node_modules/typebox/build/format/email.mjs
var Email = /^(?!.*\.\.)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
function IsEmail(value) {
  return Email.test(value);
}

// node_modules/typebox/build/format/_puny.mjs
var PUNYCODE_BASE = 36;
var PUNYCODE_TMIN = 1;
var PUNYCODE_TMAX = 26;
var PUNYCODE_SKEW = 38;
var PUNYCODE_DAMP = 700;
var PUNYCODE_INITIAL_BIAS = 72;
var PUNYCODE_INITIAL_N = 128;
function Adapt(delta, numPoints, firstTime) {
  delta = firstTime ? Math.floor(delta / PUNYCODE_DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > (PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX >> 1) {
    delta = Math.floor(delta / (PUNYCODE_BASE - PUNYCODE_TMIN));
    k += PUNYCODE_BASE;
  }
  return k + Math.floor((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * delta / (delta + PUNYCODE_SKEW));
}
function Decode2(value) {
  const output = [];
  let n = PUNYCODE_INITIAL_N;
  let i = 0;
  let bias = PUNYCODE_INITIAL_BIAS;
  const delimIdx = value.lastIndexOf("-");
  if (delimIdx > 0) {
    for (let j = 0; j < delimIdx; j++) {
      const cp = value.charCodeAt(j);
      if (cp >= 128)
        throw new Error("Invalid punycode: non-basic before delimiter");
      output.push(cp);
    }
  }
  let inIdx = delimIdx < 0 ? 0 : delimIdx + 1;
  while (inIdx < value.length) {
    const oldi = i;
    let w = 1;
    let k = PUNYCODE_BASE;
    while (true) {
      if (inIdx >= value.length)
        throw new Error("Invalid punycode: unexpected end of input");
      const ch = value.charCodeAt(inIdx++);
      let digit;
      if (ch >= 97 && ch <= 122)
        digit = ch - 97;
      else if (ch >= 48 && ch <= 57)
        digit = ch - 48 + 26;
      else if (ch >= 65 && ch <= 90)
        Unreachable();
      else
        throw new Error("Invalid punycode: bad digit character");
      i += digit * w;
      const t = k <= bias ? PUNYCODE_TMIN : k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias;
      if (digit < t)
        break;
      w *= PUNYCODE_BASE - t;
      k += PUNYCODE_BASE;
    }
    const outLen = output.length + 1;
    bias = Adapt(i - oldi, outLen, oldi === 0);
    n += Math.floor(i / outLen);
    i %= outLen;
    output.splice(i, 0, n);
    i++;
  }
  return globalThis.String.fromCodePoint(...output);
}

// node_modules/typebox/build/format/_idna.mjs
function IsNonspacingMark(cp) {
  return /\p{Mn}/u.test(String.fromCodePoint(cp));
}
function IsSpacingCombiningMark(cp) {
  return /\p{Mc}/u.test(String.fromCodePoint(cp));
}
function IsEnclosingMark(cp) {
  return /\p{Me}/u.test(String.fromCodePoint(cp));
}
function IsCombiningMark2(cp) {
  return IsNonspacingMark(cp) || IsSpacingCombiningMark(cp) || IsEnclosingMark(cp);
}
var RFC5892_DISALLOWED = /* @__PURE__ */ new Set([
  1600,
  // ARABIC TATWEEL
  2042,
  // NKO LAJANYALAN
  12334,
  // HANGUL SINGLE DOT TONE MARK
  12335,
  // HANGUL DOUBLE DOT TONE MARK
  12337,
  // VERTICAL KANA REPEAT MARK
  12338,
  // VERTICAL KANA REPEAT WITH VOICED ITERATION MARK
  12339,
  // VERTICAL KANA REPEAT MARK UPPER HALF
  12340,
  // VERTICAL KANA REPEAT WITH VOICED ITERATION MARK UPPER HALF
  12341,
  // VERTICAL KANA REPEAT MARK LOWER HALF
  12347
  // VERTICAL IDEOGRAPHIC ITERATION MARK
]);
var VIRAMA_CPS = /* @__PURE__ */ new Set([
  2381,
  2509,
  2637,
  2765,
  2893,
  3021,
  3149,
  3277,
  3387,
  3388,
  3405,
  3530,
  6980,
  7082,
  7083,
  43456,
  69702,
  69759,
  69817,
  69939,
  69940,
  70080,
  70197,
  70477,
  70722,
  70850,
  71103,
  71231,
  71350,
  72767,
  73028,
  73029
]);
function IsGreek(cp) {
  return /\p{Script=Greek}/u.test(String.fromCodePoint(cp));
}
function IsHebrew(cp) {
  return /\p{Script=Hebrew}/u.test(String.fromCodePoint(cp));
}
function IsHiragana(cp) {
  return /\p{Script=Hiragana}/u.test(String.fromCodePoint(cp));
}
function IsKatakana(cp) {
  return /\p{Script=Katakana}/u.test(String.fromCodePoint(cp));
}
function IsHan(cp) {
  return /\p{Script=Han}/u.test(String.fromCodePoint(cp));
}
function IsArabicIndicDigit(cp) {
  return cp >= 1632 && cp <= 1641;
}
function IsExtendedArabicIndicDigit(cp) {
  return cp >= 1776 && cp <= 1785;
}
function IsVirama(cp) {
  return VIRAMA_CPS.has(cp);
}
function IsUnicodeLabel(value) {
  if (value.length === 0)
    return Unreachable();
  const cps = [...value].map((c) => c.codePointAt(0));
  const len = cps.length;
  if (cps[0] === 45 || cps[len - 1] === 45)
    return false;
  if (len >= 4 && cps[2] === 45 && cps[3] === 45)
    return false;
  if (IsCombiningMark2(cps[0]))
    return false;
  let hasJapanese = false;
  let hasArabicIndic = false;
  let hasExtendedArabicIndic = false;
  for (let i = 0; i < len; i++) {
    const cp = cps[i];
    if (RFC5892_DISALLOWED.has(cp))
      return false;
    if (IsHiragana(cp) || IsKatakana(cp) || IsHan(cp))
      hasJapanese = true;
    if (IsArabicIndicDigit(cp))
      hasArabicIndic = true;
    if (IsExtendedArabicIndicDigit(cp))
      hasExtendedArabicIndic = true;
    const prev = cps[i - 1], next = cps[i + 1];
    switch (cp) {
      case 183:
        if (prev !== 108 || next !== 108)
          return false;
        break;
      // MIDDLE DOT (Catalan)
      case 885:
        if (next === void 0 || !IsGreek(next))
          return false;
        break;
      // Greek KERAIA
      case 1523:
      case 1524:
        if (prev === void 0 || !IsHebrew(prev))
          return false;
        break;
      // Hebrew GERESH
      case 8204:
        if (prev === void 0 || prev < 128 && !IsVirama(prev))
          return false;
        break;
      case 8205:
        if (prev === void 0 || !IsVirama(prev))
          return false;
        break;
      case 12539:
        break;
    }
  }
  if (value.includes("\u30FB") && !hasJapanese)
    return false;
  if (hasArabicIndic && hasExtendedArabicIndic)
    return false;
  return true;
}
function IsAsciiLabel(value) {
  if (value.charCodeAt(0) === 45 || value.charCodeAt(value.length - 1) === 45)
    return false;
  if (value.length >= 4 && value.charCodeAt(2) === 45 && value.charCodeAt(3) === 45)
    return false;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (!(ch >= 97 && ch <= 122 || // a-z
    ch >= 65 && ch <= 90 || // A-Z
    ch >= 48 && ch <= 57 || // 0-9
    ch === 45))
      return false;
  }
  return true;
}
function IsPuny(value) {
  return value.toLowerCase().startsWith("xn--");
}
function IsPunyLabel(value) {
  try {
    const payload = value.slice(4).toLowerCase();
    const lastHyphen = payload.lastIndexOf("-");
    if (lastHyphen === 0) {
      return false;
    }
    const decoded = Decode2(payload);
    if (!decoded)
      return false;
    return IsUnicodeLabel(decoded);
  } catch {
    return false;
  }
}
function IsIdnLabel(value) {
  if (value.length === 0 || value.length > 63)
    return false;
  return IsPuny(value) ? IsPunyLabel(value) : IsUnicodeLabel(value);
}
function IsLabel(value) {
  if (value.length === 0 || value.length > 63)
    return false;
  return IsPuny(value) ? IsPunyLabel(value) : IsAsciiLabel(value);
}

// node_modules/typebox/build/format/hostname.mjs
function IsHostname(value) {
  if (value.length === 0 || value.length > 253)
    return false;
  if (value.charCodeAt(value.length - 1) === 46)
    return false;
  for (const label of value.split(".")) {
    if (!IsLabel(label))
      return false;
  }
  return true;
}

// node_modules/typebox/build/format/idn_email.mjs
var IdnEmail = /^(?!.*\.\.)[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)*$/iu;
function IsIdnEmail(value) {
  return IdnEmail.test(value);
}

// node_modules/typebox/build/format/idn_hostname.mjs
function IsIdnHostname(value) {
  if (value.length === 0 || value.includes(" "))
    return false;
  const canonical = value.normalize("NFC").replace(/[\u002E\u3002\uFF0E\uFF61]/g, ".");
  if (canonical.length > 253)
    return false;
  for (const label of canonical.split(".")) {
    if (!IsIdnLabel(label))
      return false;
  }
  return true;
}

// node_modules/typebox/build/format/ipv4.mjs
function IsIPv4Internal(value, start, end) {
  let dots = 0;
  let num = 0;
  let digits = 0;
  let leading = 0;
  for (let i = start; i < end; i++) {
    const ch = value.charCodeAt(i);
    if (ch === 46) {
      if (digits === 0 || num > 255 || leading === 48 && digits > 1)
        return false;
      dots++;
      num = 0;
      digits = 0;
      leading = 0;
    } else if (ch >= 48 && ch <= 57) {
      if (digits === 0)
        leading = ch;
      num = num * 10 + (ch - 48);
      digits++;
    } else {
      return false;
    }
  }
  return dots === 3 && digits > 0 && num <= 255 && !(leading === 48 && digits > 1);
}
function IsIPv4(value) {
  return IsIPv4Internal(value, 0, value.length);
}

// node_modules/typebox/build/format/ipv6.mjs
function InRange(ch) {
  return ch >= 48 && ch <= 57 || // 0-9
  ch >= 65 && ch <= 70 || // A-F
  ch >= 97 && ch <= 102;
}
function IsIPv6(value) {
  const length = value.length;
  if (length === 0)
    return false;
  let groups2 = 0;
  let compressed = false;
  let i = 0;
  if (value.charCodeAt(0) === 58 && value.charCodeAt(1) === 58) {
    if (length === 2)
      return true;
    compressed = true;
    i = 2;
  }
  while (i < length) {
    let digits = 0;
    const start = i;
    while (i < length && InRange(value.charCodeAt(i))) {
      i++;
      digits++;
    }
    if (digits === 0)
      return false;
    const next = value.charCodeAt(i);
    if (next === 46) {
      if (!IsIPv4Internal(value, start, length))
        return false;
      groups2 += 2;
      i = length;
      break;
    }
    if (digits > 4)
      return false;
    groups2++;
    if (i === length)
      break;
    if (next !== 58)
      return false;
    i++;
    if (value.charCodeAt(i) === 58) {
      if (compressed)
        return false;
      if (value.charCodeAt(i + 1) === 58)
        return false;
      compressed = true;
      i++;
      if (i === length)
        break;
    }
  }
  return compressed ? groups2 <= 7 : groups2 === 8;
}

// node_modules/typebox/build/format/iri_reference.mjs
function TryUrl(value) {
  try {
    new URL(value, "http://example.com");
    return true;
  } catch {
    return false;
  }
}
function IsIriReference(value) {
  if (value.includes(" ")) {
    return false;
  }
  if (value.includes("\\")) {
    return false;
  }
  if (/[\x00-\x1F\x7F]/.test(value)) {
    return false;
  }
  if (/%(?![0-9a-fA-F]{2})/.test(value)) {
    return false;
  }
  if (value === "") {
    return true;
  }
  const colonIndex = value.indexOf(":");
  const hasValidSchemePrefix = colonIndex > 0 && // Colon must not be at the very beginning (e.g., ":foo")
  /^[a-zA-Z][a-zA-Z0-9+\-.]*$/.test(value.substring(0, colonIndex));
  if (hasValidSchemePrefix) {
    return TryUrl(value);
  } else {
    const looksLikeMalformedSchemeAndAuthority = value.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*)(\/\/)/);
    if (looksLikeMalformedSchemeAndAuthority && colonIndex === -1) {
      return false;
    }
    return TryUrl(value);
  }
}

// node_modules/typebox/build/format/iri.mjs
function IsIri(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// node_modules/typebox/build/format/json_pointer_uri_fragment.mjs
var JsonPointerUriFragment = /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
function IsJsonPointerUriFragment(value) {
  return JsonPointerUriFragment.test(value);
}

// node_modules/typebox/build/format/json_pointer.mjs
var JsonPointer = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
function IsJsonPointer(value) {
  return JsonPointer.test(value);
}

// node_modules/typebox/build/format/regex.mjs
function IsRegex(value) {
  if (value.length === 0) {
    return false;
  }
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

// node_modules/typebox/build/format/relative_json_pointer.mjs
var RelativeJsonPointer = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/;
function IsRelativeJsonPointer(value) {
  return RelativeJsonPointer.test(value);
}

// node_modules/typebox/build/format/uri_reference.mjs
var UriReference = /^(?!.*[^\x00-\x7F])(?!.*\\)(?:(?:[a-z][a-z0-9+\-.]*:)?(?:\/\/[^\s[\]{}<>^`|]*)?|[^\s[\]{}<>^`|]*)(?:\?[^\s[\]{}<>^`|]*)?(?:#[^\s[\]{}<>^`|]*)?$/i;
function IsUriReference(value) {
  return UriReference.test(value);
}

// node_modules/typebox/build/format/uri_template.mjs
var UriTemplate = /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i;
function IsUriTemplate(value) {
  return UriTemplate.test(value);
}

// node_modules/typebox/build/format/uri.mjs
function IsAlpha(ch) {
  return ch >= 97 && ch <= 122 || ch >= 65 && ch <= 90;
}
function IsAlphaNumeric(ch) {
  return IsAlpha(ch) || ch >= 48 && ch <= 57;
}
function IsHex(ch) {
  return ch >= 48 && ch <= 57 || // 0-9
  ch >= 65 && ch <= 70 || // A-F
  ch >= 97 && ch <= 102;
}
function IsSchemeChar(ch) {
  return IsAlphaNumeric(ch) || ch === 43 || ch === 45 || ch === 46;
}
function IsUnreserved(ch) {
  return IsAlphaNumeric(ch) || ch === 45 || ch === 46 || // '-', '.'
  ch === 95 || ch === 126;
}
function IsSubDelim(ch) {
  return ch === 33 || ch === 36 || ch === 38 || ch === 39 || ch === 40 || ch === 41 || ch === 42 || ch === 43 || ch === 44 || ch === 59 || ch === 61;
}
function IsPchar(ch) {
  return IsUnreserved(ch) || IsSubDelim(ch) || ch === 58 || ch === 64;
}
function IsUri(value) {
  const length = value.length;
  if (length === 0)
    return false;
  if (!IsAlpha(value.charCodeAt(0)))
    return false;
  let i = 1;
  while (i < length) {
    const ch = value.charCodeAt(i);
    if (ch === 58)
      break;
    if (!IsSchemeChar(ch))
      return false;
    i++;
  }
  if (value.charCodeAt(i) !== 58)
    return false;
  i++;
  if (value.charCodeAt(i) === 47 && value.charCodeAt(i + 1) === 47) {
    i += 2;
    const authorityStart = i;
    let atPos = -1;
    for (let j = i; j < length; j++) {
      const ch = value.charCodeAt(j);
      if (ch === 64) {
        atPos = j;
        break;
      }
      if (ch === 47 || ch === 63 || ch === 35)
        break;
    }
    if (atPos !== -1) {
      for (let j = authorityStart; j < atPos; j++) {
        const ch = value.charCodeAt(j);
        if (ch === 91 || ch === 93)
          return false;
        if (ch === 37) {
          if (j + 2 >= atPos || !IsHex(value.charCodeAt(j + 1)) || !IsHex(value.charCodeAt(j + 2)))
            return false;
          j += 2;
        } else if (!IsUnreserved(ch) && !IsSubDelim(ch) && ch !== 58)
          return false;
      }
      i = atPos + 1;
    }
    if (value.charCodeAt(i) === 91) {
      i++;
      while (i < length && value.charCodeAt(i) !== 93)
        i++;
      if (value.charCodeAt(i) !== 93)
        return false;
      i++;
    } else {
      while (i < length) {
        const ch = value.charCodeAt(i);
        if (ch === 47 || ch === 63 || ch === 35 || ch === 58)
          break;
        if (ch < 128 && !IsUnreserved(ch) && !IsSubDelim(ch))
          return false;
        i++;
      }
    }
    if (value.charCodeAt(i) === 58) {
      i++;
      while (i < length) {
        const ch = value.charCodeAt(i);
        if (ch === 47 || ch === 63 || ch === 35)
          break;
        if (ch < 48 || ch > 57)
          return false;
        i++;
      }
    }
  }
  while (i < length) {
    const ch = value.charCodeAt(i);
    if (ch === 37) {
      if (i + 2 >= length || !IsHex(value.charCodeAt(i + 1)) || !IsHex(value.charCodeAt(i + 2)))
        return false;
      i += 2;
    } else if (ch > 127) {
      return false;
    } else if (!(IsPchar(ch) || ch === 47 || ch === 63 || ch === 35)) {
      return false;
    }
    i++;
  }
  return true;
}

// node_modules/typebox/build/format/url.mjs
var Url = /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu;
function IsUrl(value) {
  return Url.test(value);
}

// node_modules/typebox/build/format/uuid.mjs
var Uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function IsUuid(value) {
  return Uuid.test(value);
}

// node_modules/typebox/build/format/_registry.mjs
var formats = /* @__PURE__ */ new Map();
function Clear() {
  formats.clear();
}
function Entries2() {
  return [...formats.entries()];
}
function Set3(format, check) {
  formats.set(format, check);
}
function Has(format) {
  return formats.has(format);
}
function Get3(format) {
  return formats.get(format);
}
function Test(format, value) {
  return formats.get(format)?.(value) ?? true;
}
function Reset2() {
  Clear();
  formats.set("date-time", IsDateTime);
  formats.set("date", IsDate2);
  formats.set("duration", IsDuration);
  formats.set("email", IsEmail);
  formats.set("hostname", IsHostname);
  formats.set("idn-email", IsIdnEmail);
  formats.set("idn-hostname", IsIdnHostname);
  formats.set("ipv4", IsIPv4);
  formats.set("ipv6", IsIPv6);
  formats.set("iri-reference", IsIriReference);
  formats.set("iri", IsIri);
  formats.set("json-pointer-uri-fragment", IsJsonPointerUriFragment);
  formats.set("json-pointer", IsJsonPointer);
  formats.set("regex", IsRegex);
  formats.set("relative-json-pointer", IsRelativeJsonPointer);
  formats.set("time", IsTime);
  formats.set("uri-reference", IsUriReference);
  formats.set("uri-template", IsUriTemplate);
  formats.set("uri", IsUri);
  formats.set("url", IsUrl);
  formats.set("uuid", IsUuid);
}
Reset2();

// node_modules/typebox/build/schema/engine/format.mjs
function CheckFormat(_stack, _context, schema, value) {
  return format_exports.Test(schema.format, value);
}
function ErrorFormat(stack, context, schemaPath, instancePath, schema, value) {
  return CheckFormat(stack, context, schema, value) || context.AddError({
    keyword: "format",
    schemaPath,
    instancePath,
    params: { format: schema.format }
  });
}

// node_modules/typebox/build/schema/engine/if.mjs
function CheckIf(stack, context, schema, value) {
  const thenSchema = IsThen(schema) ? schema.then : true;
  const elseSchema = IsElse(schema) ? schema.else : true;
  return CheckSchema(stack, context, schema.if, value) ? CheckSchema(stack, context, thenSchema, value) : CheckSchema(stack, context, elseSchema, value);
}
function ErrorIf(stack, context, schemaPath, instancePath, schema, value) {
  const thenSchema = IsThen(schema) ? schema.then : true;
  const elseSchema = IsElse(schema) ? schema.else : true;
  const trueContext = new AccumulatedErrorContext();
  const isIf = ErrorSchema(stack, trueContext, `${schemaPath}/if`, instancePath, schema.if, value) ? ErrorSchema(stack, trueContext, `${schemaPath}/then`, instancePath, thenSchema, value) || context.AddError({
    keyword: "if",
    schemaPath,
    instancePath,
    params: { failingKeyword: "then" }
  }) : ErrorSchema(stack, context, `${schemaPath}/else`, instancePath, elseSchema, value) || context.AddError({
    keyword: "if",
    schemaPath,
    instancePath,
    params: { failingKeyword: "else" }
  });
  if (isIf)
    context.Merge([trueContext]);
  return isIf;
}

// node_modules/typebox/build/schema/engine/items.mjs
function CheckItemsSized(stack, context, schema, value) {
  return guard_exports.Every(schema.items, 0, (schema2, index) => {
    return guard_exports.IsLessEqualThan(value.length, index) || CheckSchemaPushStack(stack, context, schema2, value[index]) && context.AddIndex(index);
  });
}
function ErrorItemsSized(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(schema.items, 0, (schema2, index) => {
    const nextSchemaPath = `${schemaPath}/items/${index}`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessEqualThan(value.length, index) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[index]) && context.AddIndex(index);
  });
}
function CheckItemsUnsized(stack, context, schema, value) {
  const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
  return guard_exports.Every(value, offset, (element, index) => {
    return CheckSchemaPushStack(stack, context, schema.items, element) && context.AddIndex(index);
  });
}
function ErrorItemsUnsized(stack, context, schemaPath, instancePath, schema, value) {
  const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
  return guard_exports.EveryAll(value, offset, (element, index) => {
    const nextSchemaPath = `${schemaPath}/items`;
    const nextInstancePath = `${instancePath}/${index}`;
    return ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema.items, element) && context.AddIndex(index);
  });
}
function CheckItems(stack, context, schema, value) {
  return IsItemsSized(schema) ? CheckItemsSized(stack, context, schema, value) : CheckItemsUnsized(stack, context, schema, value);
}
function ErrorItems(stack, context, schemaPath, instancePath, schema, value) {
  return IsItemsSized(schema) ? ErrorItemsSized(stack, context, schemaPath, instancePath, schema, value) : ErrorItemsUnsized(stack, context, schemaPath, instancePath, schema, value);
}

// node_modules/typebox/build/schema/engine/maxContains.mjs
function IsValid3(schema) {
  return IsContains(schema);
}
function CheckMaxContains(stack, context, schema, value) {
  if (!IsValid3(schema))
    return true;
  const count = value.reduce((result, item) => CheckSchema(stack, context, schema.contains, item) ? ++result : result, 0);
  return guard_exports.IsLessEqualThan(count, schema.maxContains);
}
function ErrorMaxContains(stack, context, schemaPath, instancePath, schema, value) {
  const minContains = IsMinContains(schema) ? schema.minContains : 1;
  return CheckMaxContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains, maxContains: schema.maxContains }
  });
}

// node_modules/typebox/build/schema/engine/maximum.mjs
function CheckMaximum(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(value, schema.maximum);
}
function ErrorMaximum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaximum(stack, context, schema, value) || context.AddError({
    keyword: "maximum",
    schemaPath,
    instancePath,
    params: { comparison: "<=", limit: schema.maximum }
  });
}

// node_modules/typebox/build/schema/engine/maxItems.mjs
function CheckMaxItems(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(value.length, schema.maxItems);
}
function ErrorMaxItems(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxItems(stack, context, schema, value) || context.AddError({
    keyword: "maxItems",
    schemaPath,
    instancePath,
    params: { limit: schema.maxItems }
  });
}

// node_modules/typebox/build/schema/engine/maxLength.mjs
function CheckMaxLength(_stack, _context, schema, value) {
  return guard_exports.IsMaxLength(value, schema.maxLength);
}
function ErrorMaxLength(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxLength(stack, context, schema, value) || context.AddError({
    keyword: "maxLength",
    schemaPath,
    instancePath,
    params: { limit: schema.maxLength }
  });
}

// node_modules/typebox/build/schema/engine/maxProperties.mjs
function CheckMaxProperties(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(guard_exports.Keys(value).length, schema.maxProperties);
}
function ErrorMaxProperties(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxProperties(stack, context, schema, value) || context.AddError({
    keyword: "maxProperties",
    schemaPath,
    instancePath,
    params: { limit: schema.maxProperties }
  });
}

// node_modules/typebox/build/schema/engine/minContains.mjs
function IsValid4(schema) {
  return IsContains(schema);
}
function CheckMinContains(stack, context, schema, value) {
  if (!IsValid4(schema))
    return true;
  const count = value.reduce((result, item) => CheckSchema(stack, context, schema.contains, item) ? ++result : result, 0);
  return guard_exports.IsGreaterEqualThan(count, schema.minContains);
}
function ErrorMinContains(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains: schema.minContains }
  });
}

// node_modules/typebox/build/schema/engine/minimum.mjs
function CheckMinimum(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(value, schema.minimum);
}
function ErrorMinimum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinimum(stack, context, schema, value) || context.AddError({
    keyword: "minimum",
    schemaPath,
    instancePath,
    params: { comparison: ">=", limit: schema.minimum }
  });
}

// node_modules/typebox/build/schema/engine/minItems.mjs
function CheckMinItems(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(value.length, schema.minItems);
}
function ErrorMinItems(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinItems(stack, context, schema, value) || context.AddError({
    keyword: "minItems",
    schemaPath,
    instancePath,
    params: { limit: schema.minItems }
  });
}

// node_modules/typebox/build/schema/engine/minLength.mjs
function CheckMinLength(_stack, _context, schema, value) {
  return guard_exports.IsMinLength(value, schema.minLength);
}
function ErrorMinLength(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinLength(stack, context, schema, value) || context.AddError({
    keyword: "minLength",
    schemaPath,
    instancePath,
    params: { limit: schema.minLength }
  });
}

// node_modules/typebox/build/schema/engine/minProperties.mjs
function CheckMinProperties(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(guard_exports.Keys(value).length, schema.minProperties);
}
function ErrorMinProperties(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinProperties(stack, context, schema, value) || context.AddError({
    keyword: "minProperties",
    schemaPath,
    instancePath,
    params: { limit: schema.minProperties }
  });
}

// node_modules/typebox/build/schema/engine/multipleOf.mjs
function CheckMultipleOf(_stack, _context, schema, value) {
  return guard_exports.IsMultipleOf(value, schema.multipleOf);
}
function ErrorMultipleOf(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMultipleOf(stack, context, schema, value) || context.AddError({
    keyword: "multipleOf",
    schemaPath,
    instancePath,
    params: { multipleOf: schema.multipleOf }
  });
}

// node_modules/typebox/build/schema/engine/not.mjs
function CheckNot(stack, context, schema, value) {
  const nextContext = new CheckContext();
  const isSchema = !CheckSchema(stack, nextContext, schema.not, value);
  const isNot = isSchema && context.Merge([nextContext]);
  return isNot;
}
function ErrorNot(stack, context, schemaPath, instancePath, schema, value) {
  return CheckNot(stack, context, schema, value) || context.AddError({
    keyword: "not",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/typebox/build/schema/engine/oneOf.mjs
function CheckOneOf(stack, context, schema, value) {
  const passedContexts = schema.oneOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsEqual(passedContexts.length, 1) && context.Merge(passedContexts);
}
function ErrorOneOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const passingSchemas = [];
  const passedContexts = schema.oneOf.reduce((result, schema2, index) => {
    const nextContext = new AccumulatedErrorContext();
    const nextSchemaPath = `${schemaPath}/oneOf/${index}`;
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (isSchema)
      passingSchemas.push(index);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isOneOf = guard_exports.IsEqual(passedContexts.length, 1) && context.Merge(passedContexts);
  if (!isOneOf && guard_exports.IsEqual(passingSchemas.length, 0))
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isOneOf || context.AddError({
    keyword: "oneOf",
    schemaPath,
    instancePath,
    params: { passingSchemas }
  });
}

// node_modules/typebox/build/schema/engine/pattern.mjs
function CheckPattern(_stack, _context, schema, value) {
  const regexp = guard_exports.IsString(schema.pattern) ? new RegExp(schema.pattern, "u") : schema.pattern;
  return regexp.test(value);
}
function ErrorPattern(stack, context, schemaPath, instancePath, schema, value) {
  return CheckPattern(stack, context, schema, value) || context.AddError({
    keyword: "pattern",
    schemaPath,
    instancePath,
    params: { pattern: schema.pattern }
  });
}

// node_modules/typebox/build/schema/engine/patternProperties.mjs
function CheckPatternProperties(stack, context, schema, value) {
  return guard_exports.Every(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
    const regexp = new RegExp(pattern, "u");
    return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
      return !regexp.test(key) || CheckSchemaPushStack(stack, context, schema2, prop) && context.AddKey(key);
    });
  });
}
function ErrorPatternProperties(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
    const nextSchemaPath = `${schemaPath}/patternProperties/${pattern}`;
    const regexp = new RegExp(pattern, "u");
    return guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, value2]) => {
      const nextInstancePath = `${instancePath}/${key}`;
      const notKey = !regexp.test(key);
      return notKey || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value2) && context.AddKey(key);
    });
  });
}

// node_modules/typebox/build/schema/engine/prefixItems.mjs
function CheckPrefixItems(stack, context, schema, value) {
  return guard_exports.IsEqual(value.length, 0) || guard_exports.Every(schema.prefixItems, 0, (schema2, index) => {
    return guard_exports.IsLessEqualThan(value.length, index) || CheckSchemaPushStack(stack, context, schema2, value[index]) && context.AddIndex(index);
  });
}
function ErrorPrefixItems(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.IsEqual(value.length, 0) || guard_exports.EveryAll(schema.prefixItems, 0, (schema2, index) => {
    const nextSchemaPath = `${schemaPath}/prefixItems/${index}`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessEqualThan(value.length, index) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[index]) && context.AddIndex(index);
  });
}

// node_modules/typebox/build/schema/engine/_exact_optional.mjs
function IsExactOptional(required, key) {
  return required.includes(key) || settings_exports.Get().exactOptionalPropertyTypes;
}
function InexactOptionalCheck(value, key) {
  return guard_exports.IsUndefined(value[key]);
}

// node_modules/typebox/build/schema/engine/properties.mjs
function CheckProperties(stack, context, schema, value) {
  const required = IsRequired(schema) ? schema.required : [];
  const isProperties = guard_exports.Every(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
    const isProperty = !guard_exports.HasPropertyKey(value, key) || CheckSchemaPushStack(stack, context, schema2, value[key]) && context.AddKey(key);
    return IsExactOptional(required, key) ? isProperty : InexactOptionalCheck(value, key) || isProperty;
  });
  return isProperties;
}
function ErrorProperties(stack, context, schemaPath, instancePath, schema, value) {
  const required = IsRequired(schema) ? schema.required : [];
  const isProperties = guard_exports.EveryAll(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/properties/${key}`;
    const nextInstancePath = `${instancePath}/${key}`;
    const isProperty = () => !guard_exports.HasPropertyKey(value, key) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[key]) && context.AddKey(key);
    return IsExactOptional(required, key) ? isProperty() : InexactOptionalCheck(value, key) || isProperty();
  });
  return isProperties;
}

// node_modules/typebox/build/schema/engine/propertyNames.mjs
function CheckPropertyNames(stack, context, schema, value) {
  return guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => CheckSchema(stack, context, schema.propertyNames, key));
}
function ErrorPropertyNames(stack, context, schemaPath, instancePath, schema, value) {
  const propertyNames = [];
  const isPropertyNames = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
    const nextInstancePath = `${instancePath}/${key}`;
    const nextSchemaPath = `${schemaPath}/propertyNames`;
    const nextContext = new AccumulatedErrorContext();
    const isPropertyName = ErrorSchema(stack, nextContext, nextSchemaPath, nextInstancePath, schema.propertyNames, key);
    if (!isPropertyName)
      propertyNames.push(key);
    return isPropertyName;
  });
  return isPropertyNames || context.AddError({
    keyword: "propertyNames",
    schemaPath,
    instancePath,
    params: { propertyNames }
  });
}

// node_modules/typebox/build/schema/engine/recursiveRef.mjs
function CheckRecursiveRef(stack, context, schema, value) {
  const target = stack.RecursiveRef(schema) ?? false;
  return IsSchema2(target) && CheckSchema(stack, context, target, value);
}
function ErrorRecursiveRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.RecursiveRef(schema) ?? false;
  return IsSchema2(target) && ErrorSchema(stack, context, "#", instancePath, target, value);
}

// node_modules/typebox/build/schema/engine/ref.mjs
function CheckRef(stack, context, schema, value) {
  const target = stack.Ref(schema) ?? false;
  const nextContext = new CheckContext();
  const result = IsSchema2(target) && CheckSchema(stack, nextContext, target, value);
  if (result)
    context.Merge([nextContext]);
  return result;
}
function ErrorRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.Ref(schema) ?? false;
  const nextContext = new AccumulatedErrorContext();
  const result = IsSchema2(target) && ErrorSchema(stack, nextContext, "#", instancePath, target, value);
  if (result)
    context.Merge([nextContext]);
  if (!result)
    nextContext.GetErrors().forEach((error) => context.AddError(error));
  return result;
}

// node_modules/typebox/build/schema/engine/required.mjs
function CheckRequired(_stack, _context, schema, value) {
  return guard_exports.Every(schema.required, 0, (key) => guard_exports.HasPropertyKey(value, key));
}
function ErrorRequired(_stack, context, schemaPath, instancePath, schema, value) {
  const requiredProperties = [];
  const isRequired = guard_exports.EveryAll(schema.required, 0, (key) => {
    const hasKey = guard_exports.HasPropertyKey(value, key);
    if (!hasKey)
      requiredProperties.push(key);
    return hasKey;
  });
  return isRequired || context.AddError({
    keyword: "required",
    schemaPath,
    instancePath,
    params: { requiredProperties }
  });
}

// node_modules/typebox/build/schema/engine/type.mjs
function CheckTypeName(_stack, _context, type, _schema, value) {
  return (
    // jsonschema
    guard_exports.IsEqual(type, "object") ? guard_exports.IsObjectNotArray(value) : guard_exports.IsEqual(type, "array") ? guard_exports.IsArray(value) : guard_exports.IsEqual(type, "boolean") ? guard_exports.IsBoolean(value) : guard_exports.IsEqual(type, "integer") ? guard_exports.IsInteger(value) : guard_exports.IsEqual(type, "number") ? guard_exports.IsNumber(value) : guard_exports.IsEqual(type, "null") ? guard_exports.IsNull(value) : guard_exports.IsEqual(type, "string") ? guard_exports.IsString(value) : (
      // xschema
      guard_exports.IsEqual(type, "bigint") ? guard_exports.IsBigInt(value) : guard_exports.IsEqual(type, "constructor") ? guard_exports.IsConstructor(value) : guard_exports.IsEqual(type, "function") ? guard_exports.IsFunction(value) : guard_exports.IsEqual(type, "symbol") ? guard_exports.IsSymbol(value) : guard_exports.IsEqual(type, "undefined") ? guard_exports.IsUndefined(value) : guard_exports.IsEqual(type, "void") ? guard_exports.IsUndefined(value) : true
    )
  );
}
function CheckTypeNames(stack, context, types, schema, value) {
  return types.some((type) => CheckTypeName(stack, context, type, schema, value));
}
function CheckType(stack, context, schema, value) {
  return guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context, schema.type, schema, value) : CheckTypeName(stack, context, schema.type, schema, value);
}
function ErrorType(stack, context, schemaPath, instancePath, schema, value) {
  const isType = guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context, schema.type, schema, value) : CheckTypeName(stack, context, schema.type, schema, value);
  return isType || context.AddError({
    keyword: "type",
    schemaPath,
    instancePath,
    params: { type: schema.type }
  });
}

// node_modules/typebox/build/schema/engine/unevaluatedItems.mjs
function CheckUnevaluatedItems(stack, context, schema, value) {
  const indices = context.GetIndices();
  return guard_exports.Every(value, 0, (item, index) => {
    return (indices.has(index) || CheckSchema(stack, context, schema.unevaluatedItems, item)) && context.AddIndex(index);
  });
}
function ErrorUnevaluatedItems(stack, context, schemaPath, instancePath, schema, value) {
  const indices = context.GetIndices();
  const unevaluatedItems = [];
  const isUnevaluatedItems = guard_exports.EveryAll(value, 0, (item, index) => {
    const nextContext = new AccumulatedErrorContext();
    const isEvaluatedItem = (indices.has(index) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedItems, item)) && context.AddIndex(index);
    if (!isEvaluatedItem)
      unevaluatedItems.push(index);
    return isEvaluatedItem;
  });
  return isUnevaluatedItems || context.AddError({
    keyword: "unevaluatedItems",
    schemaPath,
    instancePath,
    params: { unevaluatedItems }
  });
}

// node_modules/typebox/build/schema/engine/unevaluatedProperties.mjs
function CheckUnevaluatedProperties(stack, context, schema, value) {
  const keys = context.GetKeys();
  return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
    return keys.has(key) || CheckSchema(stack, context, schema.unevaluatedProperties, prop) && context.AddKey(key);
  });
}
function ErrorUnevaluatedProperties(stack, context, schemaPath, instancePath, schema, value) {
  const keys = context.GetKeys();
  const unevaluatedProperties = [];
  const isUnevaluatedProperties = guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, prop]) => {
    const nextContext = new AccumulatedErrorContext();
    const isEvaluatedProperty = keys.has(key) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedProperties, prop) && context.AddKey(key);
    if (!isEvaluatedProperty)
      unevaluatedProperties.push(key);
    return isEvaluatedProperty;
  });
  return isUnevaluatedProperties || context.AddError({
    keyword: "unevaluatedProperties",
    schemaPath,
    instancePath,
    params: { unevaluatedProperties }
  });
}

// node_modules/typebox/build/schema/engine/uniqueItems.mjs
function IsValid5(schema) {
  return !guard_exports.IsEqual(schema.uniqueItems, false);
}
function CheckUniqueItems(_stack, _context, schema, value) {
  if (!IsValid5(schema))
    return true;
  const set = new Set(value.map(hash_exports.Hash)).size;
  const isLength = value.length;
  return guard_exports.IsEqual(set, isLength);
}
function ErrorUniqueItems(_stack, context, schemaPath, instancePath, schema, value) {
  if (!IsValid5(schema))
    return true;
  const set = /* @__PURE__ */ new Set();
  const duplicateItems = value.reduce((result, value2, index) => {
    const hash = hash_exports.Hash(value2);
    if (set.has(hash))
      return [...result, index];
    set.add(hash);
    return result;
  }, []);
  const isUniqueItems = guard_exports.IsEqual(duplicateItems.length, 0);
  return isUniqueItems || context.AddError({
    keyword: "uniqueItems",
    schemaPath,
    instancePath,
    params: { duplicateItems }
  });
}

// node_modules/typebox/build/schema/engine/schema.mjs
function CheckSchemaPushStack(stack, context, schema, value) {
  return context.Push() && CheckSchema(stack, context, schema, value) && context.Pop();
}
function CheckSchema(stack, context, schema, value) {
  stack.Push(schema);
  const result = IsSchemaBoolean(schema) ? CheckSchemaBoolean(stack, context, schema, value) : (!IsType(schema) || CheckType(stack, context, schema, value)) && (!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || (!IsRequired(schema) || CheckRequired(stack, context, schema, value)) && (!IsAdditionalProperties(schema) || CheckAdditionalProperties(stack, context, schema, value)) && (!IsDependencies(schema) || CheckDependencies(stack, context, schema, value)) && (!IsDependentRequired(schema) || CheckDependentRequired(stack, context, schema, value)) && (!IsDependentSchemas(schema) || CheckDependentSchemas(stack, context, schema, value)) && (!IsPatternProperties(schema) || CheckPatternProperties(stack, context, schema, value)) && (!IsProperties(schema) || CheckProperties(stack, context, schema, value)) && (!IsPropertyNames(schema) || CheckPropertyNames(stack, context, schema, value)) && (!IsMinProperties(schema) || CheckMinProperties(stack, context, schema, value)) && (!IsMaxProperties(schema) || CheckMaxProperties(stack, context, schema, value))) && (!guard_exports.IsArray(value) || (!IsAdditionalItems(schema) || CheckAdditionalItems(stack, context, schema, value)) && (!IsContains(schema) || CheckContains(stack, context, schema, value)) && (!IsItems(schema) || CheckItems(stack, context, schema, value)) && (!IsMaxContains(schema) || CheckMaxContains(stack, context, schema, value)) && (!IsMaxItems(schema) || CheckMaxItems(stack, context, schema, value)) && (!IsMinContains(schema) || CheckMinContains(stack, context, schema, value)) && (!IsMinItems(schema) || CheckMinItems(stack, context, schema, value)) && (!IsPrefixItems(schema) || CheckPrefixItems(stack, context, schema, value)) && (!IsUniqueItems(schema) || CheckUniqueItems(stack, context, schema, value))) && (!guard_exports.IsString(value) || (!IsMaxLength3(schema) || CheckMaxLength(stack, context, schema, value)) && (!IsMinLength3(schema) || CheckMinLength(stack, context, schema, value)) && (!IsFormat(schema) || CheckFormat(stack, context, schema, value)) && (!IsPattern(schema) || CheckPattern(stack, context, schema, value))) && (!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || (!IsExclusiveMaximum(schema) || CheckExclusiveMaximum(stack, context, schema, value)) && (!IsExclusiveMinimum(schema) || CheckExclusiveMinimum(stack, context, schema, value)) && (!IsMaximum(schema) || CheckMaximum(stack, context, schema, value)) && (!IsMinimum(schema) || CheckMinimum(stack, context, schema, value)) && (!IsMultipleOf2(schema) || CheckMultipleOf(stack, context, schema, value))) && (!IsRef2(schema) || CheckRef(stack, context, schema, value)) && (!IsRecursiveRef(schema) || CheckRecursiveRef(stack, context, schema, value)) && (!IsDynamicRef(schema) || CheckDynamicRef(stack, context, schema, value)) && (!IsConst(schema) || CheckConst(stack, context, schema, value)) && (!IsEnum2(schema) || CheckEnum(stack, context, schema, value)) && (!IsIf(schema) || CheckIf(stack, context, schema, value)) && (!IsNot(schema) || CheckNot(stack, context, schema, value)) && (!IsAllOf(schema) || CheckAllOf(stack, context, schema, value)) && (!IsAnyOf(schema) || CheckAnyOf(stack, context, schema, value)) && (!IsOneOf(schema) || CheckOneOf(stack, context, schema, value)) && (!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || CheckUnevaluatedItems(stack, context, schema, value))) && (!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || CheckUnevaluatedProperties(stack, context, schema, value))) && (!IsRefine2(schema) || CheckRefine(stack, context, schema, value));
  stack.Pop(schema);
  return result;
}
function ErrorSchemaPushStack(stack, context, schemaPath, instancePath, schema, value) {
  return context.Push() && ErrorSchema(stack, context, schemaPath, instancePath, schema, value) && context.Pop();
}
function ErrorSchema(stack, context, schemaPath, instancePath, schema, value) {
  stack.Push(schema);
  const result = IsSchemaBoolean(schema) ? ErrorSchemaBoolean(stack, context, schemaPath, instancePath, schema, value) : !!(+(!IsType(schema) || ErrorType(stack, context, schemaPath, instancePath, schema, value)) & +(!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || !!(+(!IsRequired(schema) || ErrorRequired(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAdditionalProperties(schema) || ErrorAdditionalProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependencies(schema) || ErrorDependencies(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependentRequired(schema) || ErrorDependentRequired(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependentSchemas(schema) || ErrorDependentSchemas(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPatternProperties(schema) || ErrorPatternProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsProperties(schema) || ErrorProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPropertyNames(schema) || ErrorPropertyNames(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinProperties(schema) || ErrorMinProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxProperties(schema) || ErrorMaxProperties(stack, context, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsArray(value) || !!(+(!IsAdditionalItems(schema) || ErrorAdditionalItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsContains(schema) || ErrorContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsItems(schema) || ErrorItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxContains(schema) || ErrorMaxContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxItems(schema) || ErrorMaxItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinContains(schema) || ErrorMinContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinItems(schema) || ErrorMinItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPrefixItems(schema) || ErrorPrefixItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsUniqueItems(schema) || ErrorUniqueItems(stack, context, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsString(value) || !!(+(!IsMaxLength3(schema) || ErrorMaxLength(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinLength3(schema) || ErrorMinLength(stack, context, schemaPath, instancePath, schema, value)) & +(!IsFormat(schema) || ErrorFormat(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPattern(schema) || ErrorPattern(stack, context, schemaPath, instancePath, schema, value)))) & +(!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || !!(+(!IsExclusiveMaximum(schema) || ErrorExclusiveMaximum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsExclusiveMinimum(schema) || ErrorExclusiveMinimum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaximum(schema) || ErrorMaximum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinimum(schema) || ErrorMinimum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMultipleOf2(schema) || ErrorMultipleOf(stack, context, schemaPath, instancePath, schema, value)))) & +(!IsRef2(schema) || ErrorRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsRecursiveRef(schema) || ErrorRecursiveRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDynamicRef(schema) || ErrorDynamicRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsConst(schema) || ErrorConst(stack, context, schemaPath, instancePath, schema, value)) & +(!IsEnum2(schema) || ErrorEnum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsIf(schema) || ErrorIf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsNot(schema) || ErrorNot(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAllOf(schema) || ErrorAllOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAnyOf(schema) || ErrorAnyOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsOneOf(schema) || ErrorOneOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || ErrorUnevaluatedItems(stack, context, schemaPath, instancePath, schema, value))) & +(!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || ErrorUnevaluatedProperties(stack, context, schemaPath, instancePath, schema, value)))) && (!IsRefine2(schema) || ErrorRefine(stack, context, schemaPath, instancePath, schema, value));
  stack.Pop(schema);
  return result;
}

// node_modules/typebox/build/schema/resolve/resolve.mjs
var resolve_exports = {};
__export(resolve_exports, {
  DynamicRef: () => DynamicRef,
  Ref: () => Ref2
});

// node_modules/typebox/build/schema/pointer/pointer.mjs
var pointer_exports = {};
__export(pointer_exports, {
  Delete: () => Delete,
  Get: () => Get4,
  Has: () => Has2,
  Indices: () => Indices,
  Set: () => Set4
});
function AssertNotRoot(indices) {
  if (indices.length === 0)
    throw Error("Cannot set root");
}
function AssertCanSet(value) {
  if (!guard_exports.IsObject(value))
    throw Error("Cannot set value");
}
function AssertIndex(index) {
  if (guard_exports.IsUnsafePropertyKey(index))
    throw Error("Pointer contains unsafe property key");
}
function AssertIndices(indices) {
  for (const index of indices)
    AssertIndex(index);
}
function IsNumericIndex(index) {
  return /^(0|[1-9]\d*)$/.test(index);
}
function TakeIndexRight(indices) {
  return [
    indices.slice(0, indices.length - 1),
    indices.slice(indices.length - 1)[0]
  ];
}
function HasIndex(index, value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, index);
}
function GetIndex(index, value) {
  return guard_exports.IsObject(value) && !guard_exports.IsUnsafePropertyKey(index) ? value[index] : void 0;
}
function GetIndices(indices, value) {
  return indices.reduce((value2, index) => GetIndex(index, value2), value);
}
function Indices(pointer) {
  if (guard_exports.IsEqual(pointer.length, 0))
    return [];
  const indices = pointer.split("/").map((index) => index.replace(/~1/g, "/").replace(/~0/g, "~"));
  return indices.length > 0 && indices[0] === "" ? indices.slice(1) : indices;
}
function Has2(value, pointer) {
  let current = value;
  return Indices(pointer).every((index) => {
    if (!HasIndex(index, current))
      return false;
    current = current[index];
    return true;
  });
}
function Get4(value, pointer) {
  const indices = Indices(pointer);
  return GetIndices(indices, value);
}
function Set4(value, pointer, next) {
  const indices = Indices(pointer);
  AssertNotRoot(indices);
  AssertIndices(indices);
  const [head, index] = TakeIndexRight(indices);
  const parent = GetIndices(head, value);
  AssertCanSet(parent);
  parent[index] = next;
  return value;
}
function Delete(value, pointer) {
  const indices = Indices(pointer);
  AssertNotRoot(indices);
  AssertIndices(indices);
  const [head, index] = TakeIndexRight(indices);
  const parent = GetIndices(head, value);
  AssertCanSet(parent);
  if (guard_exports.IsArray(parent) && IsNumericIndex(index)) {
    parent.splice(+index, 1);
  } else {
    delete parent[index];
  }
  return value;
}

// node_modules/typebox/build/schema/resolve/ref.mjs
function MatchId(schema, base, ref) {
  if (schema.$id === ref.hash)
    return schema;
  const absoluteId = new URL(schema.$id, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  if (guard_exports.IsEqual(absoluteId.pathname, absoluteRef.pathname)) {
    return ref.hash.startsWith("#") ? MatchHash(schema, base, ref) : schema;
  }
  return void 0;
}
function MatchAnchor(schema, base, ref) {
  const absoluteAnchor = new URL(`#${schema.$anchor}`, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  return guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href) ? schema : void 0;
}
function MatchDynamicAnchor(schema, base, ref) {
  const absoluteAnchor = new URL(`#${schema.$dynamicAnchor}`, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  return guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href) ? schema : void 0;
}
function MatchHash(schema, _base, ref) {
  if (ref.href.endsWith("#"))
    return schema;
  if (!ref.hash.startsWith("#"))
    return void 0;
  const fragment = decodeURIComponent(ref.hash.slice(1));
  if (!fragment.startsWith("/"))
    return void 0;
  return pointer_exports.Get(schema, fragment);
}
function Match4(schema, base, ref) {
  if (IsId(schema)) {
    const result = MatchId(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (IsAnchor(schema)) {
    const result = MatchAnchor(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (IsDynamicAnchor(schema)) {
    const result = MatchDynamicAnchor(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  return MatchHash(schema, base, ref);
}
function FromArray6(schema, base, ref) {
  return schema.reduce((result, item) => {
    const match = FromValue3(item, base, ref);
    return !guard_exports.IsUndefined(match) ? match : result;
  }, void 0);
}
function FromObject10(schema, base, ref) {
  return guard_exports.Keys(schema).reduce((result, key) => {
    const match = FromValue3(schema[key], base, ref);
    return !guard_exports.IsUndefined(match) ? match : result;
  }, void 0);
}
function FromValue3(schema, base, ref) {
  const nextBase = IsSchemaObject(schema) && IsId(schema) ? new URL(schema.$id, base.href) : base;
  if (IsSchemaObject(schema)) {
    const result = Match4(schema, nextBase, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (guard_exports.IsArray(schema))
    return FromArray6(schema, nextBase, ref);
  if (guard_exports.IsObject(schema))
    return FromObject10(schema, nextBase, ref);
  return void 0;
}
function Ref2(schema, ref) {
  const defaultBase = new URL("http://unknown/");
  const initialBase = IsId(schema) ? new URL(schema.$id, defaultBase.href) : defaultBase;
  const initialRef = new URL(ref, initialBase.href);
  return FromValue3(schema, initialBase, initialRef);
}
function DynamicRef(root, base, dynamicRef, dynamicAnchors) {
  const fragmentTarget = dynamicRef.$dynamicRef.startsWith("#") ? Ref2(base, dynamicRef.$dynamicRef) : Ref2(root, dynamicRef.$dynamicRef);
  if (guard_exports.IsUndefined(fragmentTarget))
    return void 0;
  if (!IsSchemaObject(fragmentTarget) || !IsDynamicAnchor(fragmentTarget))
    return fragmentTarget;
  const fragment = new URL(dynamicRef.$dynamicRef, "http://unknown/").hash;
  if (fragment.startsWith("#/"))
    return fragmentTarget;
  const anchorTarget = dynamicAnchors.find((anchor) => anchor.$dynamicAnchor === fragmentTarget.$dynamicAnchor);
  return anchorTarget ?? fragmentTarget;
}

// node_modules/typebox/build/schema/engine/_stack.mjs
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _Stack_instances;
var _Stack_PushResourceAnchors;
var _Stack_PopResourceAnchors;
var _Stack_FromContext;
var _Stack_FromRef;
var Stack = class {
  constructor(context, schema) {
    _Stack_instances.add(this);
    this.context = context;
    this.schema = schema;
    this.ids = [];
    this.anchors = [];
    this.recursiveAnchors = [];
    this.dynamicAnchors = [];
  }
  // ----------------------------------------------------------------
  // Base
  // ----------------------------------------------------------------
  BaseURL() {
    return this.ids.reduce((result, schema) => new URL(schema.$id, result), new URL("http://unknown"));
  }
  Base() {
    return this.ids[this.ids.length - 1] ?? this.schema;
  }
  // ----------------------------------------------------------------
  // Stack
  // ----------------------------------------------------------------
  Push(schema) {
    if (!IsSchemaObject(schema))
      return;
    if (IsId(schema)) {
      this.ids.push(schema);
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PushResourceAnchors).call(this, schema);
    }
    if (IsAnchor(schema))
      this.anchors.push(schema);
    if (IsRecursiveAnchorTrue(schema))
      this.recursiveAnchors.push(schema);
    if (IsDynamicAnchor(schema))
      this.dynamicAnchors.push(schema);
  }
  Pop(schema) {
    if (!IsSchemaObject(schema))
      return;
    if (IsId(schema)) {
      this.ids.pop();
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PopResourceAnchors).call(this, schema);
    }
    if (IsAnchor(schema))
      this.anchors.pop();
    if (IsRecursiveAnchorTrue(schema))
      this.recursiveAnchors.pop();
    if (IsDynamicAnchor(schema))
      this.dynamicAnchors.pop();
  }
  Ref(ref) {
    return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_FromContext).call(this, ref) ?? __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_FromRef).call(this, ref);
  }
  // ----------------------------------------------------------------
  // RecursiveRef
  // ----------------------------------------------------------------
  RecursiveRef(recursiveRef) {
    return IsRecursiveAnchorTrue(this.Base()) ? resolve_exports.Ref(this.recursiveAnchors[0], recursiveRef.$recursiveRef) : resolve_exports.Ref(this.Base(), recursiveRef.$recursiveRef);
  }
  // ----------------------------------------------------------------
  // DynamicRef
  // ----------------------------------------------------------------
  DynamicRef(dynamicRef) {
    const root = this.schema;
    return resolve_exports.DynamicRef(root, this.Base(), dynamicRef, this.dynamicAnchors);
  }
};
_Stack_instances = /* @__PURE__ */ new WeakSet(), _Stack_PushResourceAnchors = function _Stack_PushResourceAnchors2(schema, isRoot = true) {
  if (!IsSchemaObject(schema))
    return;
  const current = schema;
  if (!isRoot && IsId(current))
    return;
  if (!isRoot && IsDynamicAnchor(current))
    this.dynamicAnchors.push(current);
  for (const key of guard_exports.Keys(current))
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PushResourceAnchors2).call(this, current[key], false);
}, _Stack_PopResourceAnchors = function _Stack_PopResourceAnchors2(schema, isRoot = true) {
  if (!IsSchemaObject(schema))
    return;
  const current = schema;
  if (!isRoot && IsId(current))
    return;
  if (!isRoot && IsDynamicAnchor(current))
    this.dynamicAnchors.pop();
  for (const key of guard_exports.Keys(current))
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PopResourceAnchors2).call(this, current[key], false);
}, _Stack_FromContext = function _Stack_FromContext2(ref) {
  return guard_exports.HasPropertyKey(this.context, ref.$ref) ? this.context[ref.$ref] : void 0;
}, _Stack_FromRef = function _Stack_FromRef2(ref) {
  const root = this.schema;
  return !ref.$ref.startsWith("#") ? resolve_exports.Ref(root, ref.$ref) : resolve_exports.Ref(this.Base(), ref.$ref);
};

// node_modules/typebox/build/schema/errors.mjs
function Errors(...args) {
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
