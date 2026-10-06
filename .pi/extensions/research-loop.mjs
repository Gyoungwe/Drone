// @ts-nocheck
// packages/research/src/literature-receipt.ts
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
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
    const text2 = await readFile(file, "utf8");
    const linked = text2.includes(`zotero:${zoteroKey}`) || new RegExp(`zotero://select/library/items/${zoteroKey}(?=[)\\s<>]|$)`).test(text2) || new RegExp(`^zotero_key: *["']?${zoteroKey}["']? *$`, "m").test(text2);
    const dois = text2.match(/10\.\d{4,9}\/[^\s<>"'\])]+/gi) || [];
    receipt.obsidian = {
      status: linked && dois.some((item) => normalizeDoi(item.replace(/[.,;]+$/, "")) === normalizedDoi) ? "verified" : "identity-mismatch",
      path: notePath,
      vault: root,
      hash: createHash("sha256").update(text2).digest("hex")
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
import { realpath as realpath2 } from "node:fs/promises";

// packages/research/src/receipt-journal-policy.ts
import { resolve as resolve2 } from "node:path";
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

// packages/research/src/research-loop.ts
import { createHash as createHash2, randomUUID } from "node:crypto";
import { access, mkdir, readFile as readFile2, realpath as realpath3, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute as isAbsolute2, join, relative as relative2, resolve as resolve3, sep as sep2 } from "node:path";

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
    const config = await loadWorkspaceConfig2(cwd);
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
    const rel = relative2(resolve3(root), resolve3(target));
    return rel === "" || !isAbsolute2(rel) && rel !== ".." && !rel.startsWith(`..${sep2}`);
  }
  function fileHash(bytes) {
    return createHash2("sha256").update(bytes).digest("hex");
  }
  async function archivedSourceRecords(cwd, runDir) {
    const archive = await sourceStatus2({ cwd, run_dir: resolve3(cwd, runDir) });
    const records = [];
    for (const item of archive.manifest?.items || []) {
      if (item.status !== "downloaded" || !item.path || !item.sha256) continue;
      const absolute = resolve3(cwd, item.path);
      if (!within2(join(resolve3(cwd, runDir), "sources"), absolute)) continue;
      try {
        if (!within2(await realpath3(join(resolve3(cwd, runDir), "sources")), await realpath3(absolute)))
          continue;
        if (fileHash(await readFile2(absolute)) !== item.sha256) continue;
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
    const sourcesRoot = join(resolve3(cwd, runDir), "sources");
    if (!within2(sourcesRoot, absolute)) return false;
    if (!within2(await realpath3(sourcesRoot), await realpath3(absolute))) return false;
    if (details.truncation?.firstLineExceedsLimit) return false;
    const returned = details.truncation?.content ?? content?.find((part) => part.type === "text")?.text;
    if (typeof returned !== "string" || !returned.trim()) return false;
    const bytes = await readFile2(absolute);
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
      relative2(resolve3(cwd, runDir), absolute)
    ]);
    for (const alias of aliases) ledger(cwd, runDir).reads.set(alias, read);
    return true;
  }
  async function readJson(path) {
    const value = JSON.parse(await readFile2(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`Invalid JSON object: ${path}`);
    return value;
  }
  async function atomicJson(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}
`, "utf8");
    await rename(temp, path);
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
    const config = await loadWorkspaceConfig2(cwd);
    if (!runDir) throw new Error("run_dir is required for this action");
    const path = resolve3(cwd, runDir);
    if (!within2(config.resultsRoot, path))
      throw new Error("run_dir must stay inside the configured results root");
    const rel = relative2(config.resultsRoot, path).split(sep2);
    if (rel.length !== 2 || !rel[1]?.startsWith("run-"))
      throw new Error("run_dir must be directly inside a result slug");
    await access(join(path, "metadata.json"));
    return { config, path, metadataPath: join(path, "metadata.json") };
  }
  async function startResearchRun({ cwd = process.cwd(), project, resultSlug, query } = {}) {
    const config = await loadWorkspaceConfig2(cwd);
    project = safeSlug(project || "research-workbench", "project");
    resultSlug = safeSlug(resultSlug || "research-question", "result_slug");
    if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const runId = `run-${stamp}-${randomUUID().slice(0, 8)}`;
    const runDir = join(config.resultsRoot, resultSlug, runId);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const metadata = {
      run_id: runId,
      project,
      result_slug: resultSlug,
      topic_id: topicIdFromResultSlug(resultSlug),
      query: query.trim(),
      status: "running",
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
    await mkdir(runDir, { recursive: true });
    await atomicJson(join(runDir, "metadata.json"), metadata);
    return { run_dir: runDir, metadata };
  }
  async function updateResearchLoop({
    cwd = process.cwd(),
    runDir,
    action,
    query,
    sourceRefs = [],
    claimRefs = [],
    claimBindings = [],
    outcome,
    notes
  } = {}) {
    const { path, metadataPath } = await resolveRun(cwd, runDir);
    const metadata = await readJson(metadataPath);
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
    if (action === "status") return { run_dir: path, metadata, evidence_gate: gate };
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
      const archive = await sourceStatus2({ cwd, run_dir: path });
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
        const available = await updateResearchLoop({ cwd, runDir, action: "verify_archive" });
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
      } else if (gate.claim_bindings.length && claimRefs.length) {
        throw new Error("Structured claim_bindings are required; legacy claim_refs cannot establish support");
      }
      if (!gate.claim_bindings.length)
        throw new Error(
          "Structured claim_bindings with observed source excerpts are required before answerable"
        );
      if (!Array.isArray(claimRefs) || claimRefs.length === 0)
        throw new Error("claim_refs must contain at least one traceable claim binding");
      gate = advance({ ...gate, claim_refs: [...new Set(claimRefs.map(String))] }, "claims_bound", {
        claim_refs: claimRefs
      });
    } else if (action === "finalize") {
      requireStage("claims_bound");
      await validateReuse(cwd, runDir, gate);
      if (gate.archive_count + gate.reuse_count < 1 || gate.claim_refs.length < 1 || !gate.claim_bindings.length || gate.claim_bindings.some(
        (binding) => !Array.isArray(binding.sources) || binding.sources.length < 1
      ))
        throw new Error("archive verification and claim binding are required before answerable");
      gate.claim_bindings = validateClaimBindings(
        gate.claim_bindings,
        [...await reusableSources(cwd, runDir), ...await archivedSourceRecords(cwd, runDir)],
        ledger(cwd, runDir).reads
      );
      gate = advance({ ...gate, status: "ok", answerable: true }, "answerable", detail);
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
    await atomicJson(metadataPath, metadata);
    return { run_dir: path, evidence_gate: gate };
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
    if (!claimBindings.length && !claimRefs.length && !gate.claim_refs.length)
      throw new Error(
        "Provide explicit claim_refs; downloading or identity verification alone does not bind scientific claims"
      );
    const refs = (Array.isArray(claimRefs) && claimRefs.length ? claimRefs : null) || gate.claim_refs;
    if (!refs.length && !claimBindings.length)
      throw new Error("claim_refs must contain at least one traceable claim binding");
    if (claimBindings.length || RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf("claims_bound"))
      status = await updateResearchLoop({
        cwd,
        runDir,
        action: "bind_claims",
        claimRefs: refs,
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
          const config = await loadWorkspaceConfig2(cwd);
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
      if (toolName === "research_deposit_knowledge" && details.type === "claim" && details.note)
        return await updateResearchLoop({
          cwd,
          runDir,
          action: "bind_claims",
          claimRefs: [details.note]
        });
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
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";
import { lstat, readFile as readFile3, realpath as realpath4, rename as rename2, stat as stat2, writeFile as writeFile2 } from "node:fs/promises";
import { isAbsolute as isAbsolute3, join as join2, relative as relative3, resolve as resolve4, sep as sep3 } from "node:path";
var queues = /* @__PURE__ */ new Map();
var digest = (value) => createHash3("sha256").update(value).digest("hex");
var defaultWorkspaceConfig = async (cwd) => ({
  resultsRoot: resolve4(cwd, "results")
});
function within(root, path) {
  const rel = relative3(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep3}`) && !isAbsolute3(rel);
}
async function runPath(cwd, runDir, loadConfig) {
  const config = await loadConfig(cwd);
  const root = await realpath4(config.resultsRoot);
  const run = await realpath4(resolve4(cwd, runDir || ""));
  const parts = relative3(root, run).split(sep3);
  if (!within(root, run) || parts.length !== 2 || !parts[1]?.startsWith("run-")) {
    throw new Error("Expected existing run inside results root");
  }
  await readFile3(join2(run, "metadata.json"), "utf8");
  return run;
}
async function readObservations(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) {
      throw new Error("Invalid observation file");
    }
    const data = JSON.parse(await readFile3(path, "utf8"));
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
  const temp = `${path}.${randomUUID2()}.tmp`;
  await writeFile2(temp, JSON.stringify(value, null, 2));
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
  loadWorkspaceConfig: loadWorkspaceConfig2 = defaultWorkspaceConfig
}) {
  if (!["bash", "powershell"].includes(toolName) || !toolCallId) return null;
  const run = await runPath(cwd, runDir, loadWorkspaceConfig2);
  const file = join2(run, "execution-observations.json");
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
import { access as access2, mkdir as mkdir2, readFile as readFile4, realpath as realpath5, rename as rename3, writeFile as writeFile3 } from "node:fs/promises";
import { basename as basename2, dirname as dirname2, extname, join as join3, relative as relative5, resolve as resolve6, sep as sep5 } from "node:path";

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
import { basename, isAbsolute as isAbsolute4, relative as relative4, resolve as resolve5, sep as sep4 } from "node:path";
var SOURCE_CATEGORIES = ["papers", "supplementary", "software", "manuals"];
var DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
function isWithin(root, child) {
  const rel = relative4(resolve5(root), resolve5(child));
  return rel === "" || !isAbsolute4(rel) && !rel.startsWith(`..${sep4}`) && rel !== ".." && !rel.includes(`..${sep4}`);
}
function validateRunDir(resultsRoot, candidate) {
  const runDir = resolve5(candidate);
  const rel = relative4(resolve5(resultsRoot), runDir);
  const parts = rel.split(sep4);
  if (!rel || !isWithin(resultsRoot, runDir) || parts.length !== 2 || !parts[1]?.startsWith("run-"))
    throw new Error("run_dir must point to a run directory directly inside the configured results root");
  return runDir;
}

// packages/research/src/source-archive.ts
async function readManifest(file, runDir) {
  try {
    const parsed = JSON.parse(await readFile4(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items))
      throw new Error("invalid manifest");
    return parsed;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 1, run_dir: runDir, updated_at: null, items: [] };
  }
}
async function sourceStatus(options = {}, ports) {
  if (!ports) throw new Error("Source archive host ports are required");
  const { cwd = process.cwd(), run_dir } = options;
  const config = await ports.workspace(cwd);
  const runDir = run_dir ? validateRunDir(config.resultsRoot, resolve6(cwd, run_dir)) : null;
  if (!runDir) return { results_root: config.resultsRoot, categories: SOURCE_CATEGORIES, run_dir: null };
  const manifestPath = join3(runDir, "sources", "download-manifest.json");
  const failuresPath = join3(runDir, "sources", "download-failures.md");
  const manifest = await readManifest(manifestPath, runDir);
  let failures = "";
  try {
    failures = await readFile4(failuresPath, "utf8");
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
    failure_count: manifest.failures?.length ?? Math.max(0, (failures.match(/^## /gm) || []).length)
  };
}

// packages/tasks/src/runtime-compiled/process-events.mjs
function emitProcessEvent(event, ...args) {
  process.emit(event, ...args);
}

// packages/tasks/src/runtime-compiled/runtime-bridge.mjs
import { AsyncLocalStorage } from "node:async_hooks";
var contexts = new AsyncLocalStorage();
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
    const gate = new Promise((resolve9) => {
      unlock = resolve9;
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
  async run(key, task) {
    const release = await this.acquire(key);
    try {
      return await task();
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
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
var VERSION = 1;
var RUNTIME_EVENT = "drone:runtime/v1";
var RUNTIME_REQUEST_EVENT = "drone:runtime/request/v1";
var contexts2 = new AsyncLocalStorage2();
var hostRuntimes2 = /* @__PURE__ */ new WeakMap();
var hostCleanups = /* @__PURE__ */ new WeakMap();
var processRuntime;
var KeyedScheduler2 = class {
  tails = /* @__PURE__ */ new Map();
  disposed = false;
  async run(key, task) {
    if (this.disposed) throw new Error("Extension runtime scheduler has been disposed");
    const previous = this.tails.get(key) ?? Promise.resolve();
    let unlock;
    const gate = new Promise((resolve9) => {
      unlock = resolve9;
    });
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);
    await previous;
    try {
      return await task();
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
function runExtensionExclusive(pi, key, task) {
  return Promise.resolve(
    withExtensionRuntime(pi, () => {
      const runtime = contexts2.getStore() ?? standaloneRuntime2();
      return runtime.scheduler.run(key, task);
    })
  );
}
function standaloneRuntime2() {
  if (!processRuntime) processRuntime = createStandaloneRuntime2();
  return processRuntime;
}

// packages/extensions/src/workspace-config.ts
import { access as access3, mkdir as mkdir4, readFile as readFile6, realpath as realpath7, rename as rename5, writeFile as writeFile5 } from "node:fs/promises";
import { dirname as dirname3, isAbsolute as isAbsolute6, join as join5, relative as relative6, resolve as resolve8, sep as sep6 } from "node:path";

// packages/knowledge/src/config.ts
import { AsyncLocalStorage as AsyncLocalStorage3 } from "node:async_hooks";
import { createHash as createHash4, randomUUID as randomUUID3 } from "node:crypto";
import { mkdir as mkdir3, readFile as readFile5, realpath as realpath6, rename as rename4, writeFile as writeFile4 } from "node:fs/promises";
import { basename as basename3, isAbsolute as isAbsolute5, join as join4, resolve as resolve7 } from "node:path";
function createKnowledgeConfigState() {
  return { local: new AsyncLocalStorage3(), queues: /* @__PURE__ */ new Map() };
}
function errorCode(error) {
  return error && typeof error === "object" && "code" in error ? error.code : void 0;
}
function knowledgeDirectory() {
  const value = process.env.DRONE_KNOWLEDGE_DIR;
  if (!value) return null;
  if (!isAbsolute5(value)) throw new Error("DRONE_KNOWLEDGE_DIR must be absolute");
  return resolve7(value);
}
function projectIdentity(cwd, configured) {
  if (typeof configured === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(configured)) return configured;
  const path = resolve7(cwd);
  const stem = basename3(path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  return `${stem}-${createHash4("sha256").update(path).digest("hex").slice(0, 10)}`;
}
function validateBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !isAbsolute5(String(value.vault || "")) || !/^[a-f0-9]{24}$/.test(String(value.vaultId || "")) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !["project", "literature", "hybrid"].includes(String(value.profile)) || !["run-only", "verified", "rich"].includes(String(value.depositMode)) || !["none", "read-local"].includes(String(value.subagentPolicy)) || typeof value.updatedAt !== "string")
    throw new Error("Invalid application knowledge binding; no project fallback was used");
}
async function readKnowledgeBindingWithState(state, { fresh = false } = {}) {
  if (!fresh && state.local.getStore()) return state.local.getStore() ?? null;
  const directory = knowledgeDirectory();
  if (!directory) return null;
  let value;
  try {
    value = JSON.parse((await readFile5(join4(directory, "binding.json"), "utf8")).replace(/^\uFEFF/, ""));
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
    libraryTypes: ["Papers", "Methods", "Software", "Ideas", "Explainers"]
  },
  literature: {
    id: "literature",
    projectTypes: ["Questions", "Papers", "Evidence", "Claims", "Runs", "Wiki"],
    libraryTypes: ["Papers", "Methods", "Concepts", "Software", "Entities", "Ideas", "Explainers"]
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
    libraryTypes: ["Papers", "Methods", "Concepts", "Software", "Entities", "Ideas", "Explainers"]
  }
};
var DEFAULT_VAULT_PROFILE = "hybrid";
var SUBAGENT_MCP_POLICIES = ["none", "read-local"];
function getVaultProfile(id = DEFAULT_VAULT_PROFILE) {
  if (typeof id !== "string" || !(id in VAULT_PROFILES)) throw new Error(`Unknown knowledge profile: ${id}`);
  return VAULT_PROFILES[id];
}

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
  maxConcurrentSubagents: 3,
  timezone: "Asia/Shanghai",
  knowledgeProfile: DEFAULT_VAULT_PROFILE,
  knowledgeDepositMode: "verified",
  subagentMcpPolicy: "read-local"
});
var CONFIG_NAME = ".pi/research-workspace.json";
function configPath(cwd) {
  return join5(cwd, CONFIG_NAME);
}
function resolveConfiguredPath(cwd, value) {
  if (value == null || value === "") return null;
  return resolve8(cwd, value);
}
function validatePatch(config) {
  const max = Number(config.maxConcurrentSubagents);
  if (!Number.isInteger(max) || max < 1 || max > 3) {
    throw new Error("maxConcurrentSubagents must be an integer between 1 and 3");
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
    const desktop = JSON.parse(await readFile6(process.env.PI_RESEARCH_DESKTOP_CONFIG, "utf8"));
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      resultsRoot: desktop.resultsRoot,
      obsidianVault: desktop.vaultStatus === "bound" ? desktop.obsidianVault : null,
      vaultWritePolicy: desktop.vaultWritePolicy,
      mcpStatus: desktop.mcpStatus
    };
  }
  const projectRoot = resolve8(cwd);
  let raw = {};
  try {
    raw = JSON.parse(await readFile6(configPath(projectRoot), "utf8"));
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
    sourceStatus: async ({ cwd, run_dir }) => {
      return sourceStatus(
        { cwd, run_dir },
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
        project: { type: "string" },
        result_slug: { type: "string" },
        query: { type: "string" },
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
        const result = await journal.execute(
          runDir,
          async () => params.action === "start" ? loop.startResearchRun({
            cwd: ctx.cwd,
            project: params.project,
            resultSlug: params.result_slug,
            query: params.query
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
          receipt_journal: result?.receipt_journal
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
