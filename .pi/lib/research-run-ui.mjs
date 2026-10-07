// packages/research/src/research-run-ui.ts
import { readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  sources_reused: "\u590D\u7528\u5DF2\u9A8C\u8BC1\u6765\u6E90",
  claims_bound: "\u7ED1\u5B9A\u4E3B\u5F20",
  answerable: "\u53EF\u56DE\u7B54"
};
function text(value, max = 480) {
  return String(value ?? "").normalize("NFKC").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function within(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}
function safeRunDir(resultsRoot, candidate) {
  const runDir = resolve(resultsRoot, candidate);
  const parts = relative(resolve(resultsRoot), runDir).split(sep);
  if (!within(resultsRoot, runDir) || parts.length !== 2 || !parts[1]?.startsWith("run-"))
    throw new Error("research run is outside the configured results root");
  return runDir;
}
async function readJson(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function gateOf(metadata) {
  const gate = metadata?.evidence_gate && typeof metadata.evidence_gate === "object" ? metadata.evidence_gate : {};
  const stage = STAGES.includes(gate.stage) ? gate.stage : "created";
  return {
    stage,
    status: gate.status === "failed" ? "failed" : "ok",
    answerable: gate.answerable === true,
    events: Array.isArray(gate.events) ? gate.events : [],
    claimBindings: Array.isArray(gate.claim_bindings) ? gate.claim_bindings : [],
    claimRefs: Array.isArray(gate.claim_refs) ? gate.claim_refs : [],
    sourceRefs: Array.isArray(gate.source_refs) ? gate.source_refs : [],
    archiveCount: Number(gate.archive_count) || 0,
    reuseCount: Number(gate.reuse_count) || 0,
    reusedSources: Array.isArray(gate.reused_sources) ? gate.reused_sources : [],
    warnings: Array.isArray(gate.warnings) ? gate.warnings.map((item) => text(item, 240)) : []
  };
}
function route(metadata) {
  const gate = gateOf(metadata);
  const current = STAGES.indexOf(gate.stage);
  const events = /* @__PURE__ */ new Map();
  for (const event of gate.events) {
    const key = text(event?.type, 80);
    if (key) events.set(key, event);
  }
  return STAGES.map((key, index) => ({
    key,
    label: LABELS[key] || key,
    state: gate.status === "failed" && index === current ? "blocked" : index < current || index === current && gate.answerable ? "complete" : index === current ? "active" : "pending",
    at: typeof events.get(key)?.at === "string" ? events.get(key).at : null,
    detail: text(events.get(key)?.notes || events.get(key)?.outcome, 240) || null
  }));
}
async function sourceManifest(runDir, gate) {
  const manifest = await readJson(join(runDir, "sources", "download-manifest.json"));
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  const byPath = /* @__PURE__ */ new Map();
  for (const item of items) {
    const path = text(item?.path || item?.file, 480).replaceAll("\\", "/");
    if (!path) continue;
    byPath.set(path, {
      path,
      status: text(item?.status, 80) || "unknown",
      hash: /^[a-f0-9]{64}$/i.test(String(item?.sha256 || "")) ? String(item.sha256).toLowerCase() : null,
      verified: item?.status === "downloaded" && Boolean(item?.sha256)
    });
  }
  for (const path of gate.sourceRefs) {
    const key = text(path, 480).replaceAll("\\", "/");
    if (key && !byPath.has(key)) byPath.set(key, { path: key, status: "inspected", hash: null, verified: false });
  }
  for (const source of gate.reusedSources || []) {
    const key = text(source?.path, 480).replaceAll("\\", "/");
    if (key) byPath.set(key, { path: key, status: "reused", hash: text(source?.hash, 64) || null, verified: true });
  }
  return [...byPath.values()].slice(0, 64);
}
function claims(gate) {
  return gate.claimBindings.slice(0, 64).map((binding) => ({
    claim: text(binding?.claim, 480),
    support: Array.isArray(binding?.sources) ? binding.sources.map((item) => text(item?.path, 480)).filter(Boolean) : [],
    status: binding?.status === "verified" ? "verified" : "bound"
  })).filter((item) => item.claim);
}
function listItem(metadata, runDir, resultsRoot) {
  const gate = gateOf(metadata);
  return {
    runId: text(metadata.run_id || basename(runDir), 180),
    resultSlug: text(metadata.result_slug || relative(resultsRoot, runDir).split(sep)[0], 180),
    project: text(metadata.project, 180),
    topicId: text(metadata.topic_id, 180) || null,
    query: text(metadata.query, 1e3),
    status: text(metadata.status, 80) || "unknown",
    stage: gate.stage,
    answerable: gate.answerable,
    scientificallyVerified: false,
    startedAt: text(metadata.started_at, 80) || null,
    updatedAt: text(metadata.updated_at || metadata.started_at, 80) || null,
    runDir: relative(resultsRoot, runDir).replaceAll(sep, "/")
  };
}
async function discover(resultsRoot, project) {
  const output = [];
  let slugs = [];
  try {
    slugs = await readdir(resultsRoot, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const slug of slugs) {
    if (!slug.isDirectory() || slug.name.startsWith(".")) continue;
    let runs = [];
    try {
      runs = await readdir(join(resultsRoot, slug.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of runs) {
      if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
      const runDir = join(resultsRoot, slug.name, entry.name);
      const metadata = await readJson(join(runDir, "metadata.json"));
      if (!metadata || project && text(metadata.project, 180) !== text(project, 180)) continue;
      output.push({ metadata, runDir });
    }
  }
  return output.sort((a, b) => String(b.metadata.updated_at || b.metadata.started_at).localeCompare(String(a.metadata.updated_at || a.metadata.started_at)));
}
async function listResearchRuns(input) {
  const limit = Math.max(1, Math.min(50, Number(input.limit) || 10));
  const found = await discover(resolve(input.resultsRoot), input.project);
  return { items: found.slice(0, limit).map(({ metadata, runDir }) => listItem(metadata, runDir, input.resultsRoot)), total: found.length };
}
async function getResearchRun(input) {
  const resultsRoot = resolve(input.resultsRoot);
  let runDir = input.runDir ? safeRunDir(resultsRoot, input.runDir) : null;
  if (!runDir && input.runId) {
    const found = await discover(resultsRoot);
    runDir = found.find(({ metadata: metadata2, runDir: candidate }) => text(metadata2.run_id, 180) === text(input.runId, 180))?.runDir || null;
  }
  if (!runDir) throw new Error("research run not found");
  const metadata = await readJson(join(runDir, "metadata.json"));
  if (!metadata) throw new Error("research run metadata is invalid");
  const gate = gateOf(metadata);
  const item = listItem(metadata, runDir, resultsRoot);
  return {
    ...item,
    route: route(metadata),
    sources: await sourceManifest(runDir, gate),
    claims: claims(gate),
    warnings: gate.warnings,
    coverage: metadata.retrieval_coverage || metadata.metrics?.index?.semantic || null,
    archive: {
      count: gate.archiveCount,
      reused: gate.reuseCount,
      verified: gate.archiveCount > 0 || gate.reuseCount > 0
    }
  };
}
export {
  getResearchRun,
  listResearchRuns
};
