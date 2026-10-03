// packages/research/src/research-loop.ts
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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
  const runKey = (cwd, runDir) => resolve(cwd, runDir);
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
      await reusableSources(cwd, runDir),
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
    const rel = relative(resolve(root), resolve(target));
    return rel === "" || !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
  }
  async function readJson(path) {
    const value = JSON.parse(await readFile(path, "utf8"));
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
    const path = resolve(cwd, runDir);
    if (!within(config.resultsRoot, path))
      throw new Error("run_dir must stay inside the configured results root");
    const rel = relative(config.resultsRoot, path).split(sep);
    if (rel.length !== 2 || !rel[1]?.startsWith("run-"))
      throw new Error("run_dir must be directly inside a result slug");
    await access(join(path, "metadata.json"));
    return { config, path, metadataPath: join(path, "metadata.json") };
  }
  async function startResearchRun({ cwd = process.cwd(), project, resultSlug, query, requiresProvenance = false } = {}) {
    const config = await loadWorkspaceConfig(cwd);
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
      revision: 0,
      requires_provenance: requiresProvenance === true,
      provenance: { status: requiresProvenance === true ? "pending" : "not-required" },
      started_at: now,
      evidence_gate: {
        stage: "created",
        status: "ok",
        answerable: false,
        events: [{ type: "created", at: now }],
        claim_refs: [],
        source_refs: [],
        archive_count: 0
      }
    };
    await mkdir(runDir, { recursive: true });
    await atomicJson(join(runDir, "metadata.json"), metadata);
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
          await reusableSources(cwd, runDir),
          ledger(cwd, runDir).reads
        );
        gate = { ...gate, claim_bindings: checked, warnings: [] };
        claimRefs = claimBindingRefs(checked);
      } else if (gate.claim_bindings.length) {
        const checked = await validateStoredClaimBindings(cwd, runDir, gate);
        gate = { ...gate, claim_bindings: checked, claim_refs: claimBindingRefs(checked), warnings: [] };
        claimRefs = claimBindingRefs(checked);
      } else if (claimRefs.length) {
        throw new Error("Structured claim_bindings are required; legacy claim_refs cannot make a run answerable");
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
        const provenance = await readJson(join(path, "reproducibility-manifest.json"));
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
    metadata.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    metadata.revision = revision + 1;
    await atomicJson(metadataPath, metadata);
    return { run_dir: path, evidence_gate: gate, revision: metadata.revision };
  }
  async function updateResearchLoop(input = {}) {
    const cwd = input.cwd || process.cwd();
    const key = runKey(cwd, input.runDir);
    const work = () => updateResearchLoopUnlocked(input);
    return ports.exclusive ? ports.exclusive(key, work) : work();
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
    if (gate.stage !== "answerable") status = await updateResearchLoop({ cwd, runDir, action: "finalize" });
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
