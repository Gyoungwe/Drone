// packages/research/src/research-loop.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { access, mkdir, readFile as readFile2, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute as isAbsolute2, join as join3, relative, resolve as resolve3, sep } from "node:path";

// packages/knowledge/src/project-identity.ts
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";

// packages/knowledge/src/config.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { basename, isAbsolute, join, resolve } from "node:path";
function createKnowledgeConfigState() {
  return { local: new AsyncLocalStorage(), queues: /* @__PURE__ */ new Map() };
}
function projectIdentity(cwd, configured) {
  if (typeof configured === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(configured)) return configured;
  const path = resolve(cwd);
  const stem = basename(path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  return `${stem}-${createHash("sha256").update(path).digest("hex").slice(0, 10)}`;
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
    const parsed = JSON.parse(await readFile(join2(cwd, ".pi", "research-workspace.json"), "utf8"));
    if (parsed && typeof parsed === "object" && "knowledgeProjectId" in parsed)
      return parsed.knowledgeProjectId;
  } catch {
  }
  return void 0;
}
async function resolveWorkspaceProject(input) {
  return resolveProjectIdentity({ ...input, configured: await readConfiguredProject(input.cwd) });
}

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
  const loadWorkspaceConfig = ports.workspace;
  const verifyLiteratureReceipt = ports.verifyLiteratureReceipt;
  const sourceStatus = ports.sourceStatus;
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
    const root = await realpath(config.obsidianVault);
    const state = ledger(cwd, runDir), result = [];
    for (const [path, proof] of state.verified) {
      const read = state.reads.get(path);
      if (!read || read.hash !== proof.obsidian?.hash || read.vault !== root || read.revision !== (config.knowledgeBindingRevision || 0) || proof.obsidian?.vault !== root)
        continue;
      const current = await verifyLiteratureReceipt({
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
  function within(root, target) {
    const rel = relative(resolve3(root), resolve3(target));
    return rel === "" || !isAbsolute2(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
  }
  function fileHash(bytes) {
    return createHash2("sha256").update(bytes).digest("hex");
  }
  async function archivedSourceRecords(cwd, runDir) {
    const archive = await sourceStatus({ cwd, run_dir: resolve3(cwd, runDir) });
    const records = [];
    for (const item of archive.manifest?.items || []) {
      if (item.status !== "downloaded" || !item.path || !item.sha256) continue;
      const absolute = resolve3(cwd, item.path);
      if (!within(join3(resolve3(cwd, runDir), "sources"), absolute)) continue;
      try {
        if (!within(await realpath(join3(resolve3(cwd, runDir), "sources")), await realpath(absolute)))
          continue;
        if (fileHash(await readFile2(absolute)) !== item.sha256) continue;
      } catch {
        continue;
      }
      const aliases = /* @__PURE__ */ new Set([
        String(item.path),
        absolute,
        relative(cwd, absolute),
        relative(resolve3(cwd, runDir), absolute)
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
    const sourcesRoot = join3(resolve3(cwd, runDir), "sources");
    if (!within(sourcesRoot, absolute)) return false;
    if (!within(await realpath(sourcesRoot), await realpath(absolute))) return false;
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
      relative(cwd, absolute),
      relative(resolve3(cwd, runDir), absolute)
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
    const temp = `${path}.${randomUUID2()}.tmp`;
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
    const config = await loadWorkspaceConfig(cwd);
    if (!runDir) throw new Error("run_dir is required for this action");
    const path = resolve3(cwd, runDir);
    if (!within(config.resultsRoot, path))
      throw new Error("run_dir must stay inside the configured results root");
    const rel = relative(config.resultsRoot, path).split(sep);
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
    const config = await loadWorkspaceConfig(cwd);
    project = safeSlug(project || (await resolveWorkspaceProject({ cwd })).project, "project");
    resultSlug = safeSlug(resultSlug || "research-question", "result_slug");
    if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const runId = `run-${stamp}-${randomUUID2().slice(0, 8)}`;
    const runDir = join3(config.resultsRoot, resultSlug, runId);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const metadata = {
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
    await mkdir(runDir, { recursive: true });
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
      const archive = await sourceStatus({ cwd, run_dir: path, verify: true });
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
        if (!provenance || provenance.version !== 1)
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
              vault: readBinding ? readBinding.vault : await realpath(config.obsidianVault),
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
export {
  RESEARCH_STAGES,
  createResearchLoop
};
