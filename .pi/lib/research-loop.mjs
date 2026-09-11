import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadWorkspaceConfig } from "../extensions/workspace-config.mjs";
import { sourceStatus } from "./source-archive.mjs";

export const RESEARCH_STAGES = Object.freeze([
  "created", "local_query_recorded", "external_search_recorded", "sources_inspected",
  "sources_archived", "claims_bound", "answerable",
]);

function safeSlug(value, label) {
  const text = String(value ?? "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)) throw new Error(`${label} must be lowercase kebab-case`);
  return text;
}

function within(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep));
}

async function readJson(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid JSON object: ${path}`);
  return value;
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
    source_refs: Array.isArray(gate.source_refs) ? gate.source_refs : [],
    archive_count: Number(gate.archive_count) || 0,
  };
}

function advance(gate, stage, details = {}) {
  const current = RESEARCH_STAGES.indexOf(gate.stage);
  const target = RESEARCH_STAGES.indexOf(stage);
  if (target < 0) throw new Error(`Unknown research stage: ${stage}`);
  if (target < current) return { ...gate, events: [...gate.events, { type: stage, at: new Date().toISOString(), repeated: true, ...details }] };
  return { ...gate, stage, events: [...gate.events, { type: stage, at: new Date().toISOString(), ...details }] };
}

async function resolveRun(cwd, runDir) {
  const config = await loadWorkspaceConfig(cwd);
  if (!runDir) throw new Error("run_dir is required for this action");
  const path = resolve(cwd, runDir);
  if (!within(config.resultsRoot, path)) throw new Error("run_dir must stay inside the configured results root");
  const rel = relative(config.resultsRoot, path).split(sep);
  if (rel.length !== 2 || !rel[1].startsWith("run-")) throw new Error("run_dir must be directly inside a result slug");
  await access(join(path, "metadata.json"));
  return { config, path, metadataPath: join(path, "metadata.json") };
}

export async function startResearchRun({ cwd = process.cwd(), project, resultSlug, query } = {}) {
  const config = await loadWorkspaceConfig(cwd);
  project = safeSlug(project || "research-workbench", "project");
  resultSlug = safeSlug(resultSlug || "research-question", "result_slug");
  if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const runId = `run-${stamp}-${randomUUID().slice(0, 8)}`;
  const runDir = join(config.resultsRoot, resultSlug, runId);
  const now = new Date().toISOString();
  const metadata = {
    run_id: runId, project, result_slug: resultSlug, query: query.trim(), status: "running", started_at: now,
    evidence_gate: { stage: "created", status: "ok", answerable: false, events: [{ type: "created", at: now }], claim_refs: [], source_refs: [], archive_count: 0 },
  };
  await mkdir(runDir, { recursive: true });
  await atomicJson(join(runDir, "metadata.json"), metadata);
  return { run_dir: runDir, metadata };
}

export async function updateResearchLoop({ cwd = process.cwd(), runDir, action, query, sourceRefs = [], claimRefs = [], outcome, notes } = {}) {
  const { path, metadataPath } = await resolveRun(cwd, runDir);
  const metadata = await readJson(metadataPath);
  let gate = gateOf(metadata);
  const detail = { ...(query ? { query: String(query).trim() } : {}), ...(outcome ? { outcome } : {}), ...(notes ? { notes } : {}) };
  const requireStage = (stage) => {
    if (RESEARCH_STAGES.indexOf(gate.stage) < RESEARCH_STAGES.indexOf(stage)) throw new Error(`research loop must reach ${stage} before ${action}`);
  };
  if (action === "status") return { run_dir: path, metadata, evidence_gate: gate };
  if (action === "record_local") {
    if (!query?.trim()) throw new Error("query is required");
    gate = advance(gate, "local_query_recorded", detail);
  } else if (action === "record_external") {
    requireStage("local_query_recorded");
    if (!query?.trim() && !notes?.trim()) throw new Error("record the external query or why external search was skipped");
    gate = advance(gate, "external_search_recorded", detail);
  } else if (action === "inspect_sources") {
    requireStage("external_search_recorded");
    if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) throw new Error("source_refs must list inspected original sources");
    gate = advance({ ...gate, source_refs: [...new Set([...gate.source_refs, ...sourceRefs.map(String)])] }, "sources_inspected", { ...detail, source_refs: sourceRefs });
  } else if (action === "verify_archive") {
    requireStage("sources_inspected");
    const archive = await sourceStatus({ cwd, run_dir: path });
    const downloaded = (archive.manifest?.items || []).filter(item => item.status === "downloaded");
    if (downloaded.length === 0) throw new Error("no verified archived source is present for this run");
    gate = advance({ ...gate, archive_count: downloaded.length }, "sources_archived", { archived: downloaded.map(item => ({ id: item.id, sha256: item.sha256, path: item.path })) });
  } else if (action === "bind_claims") {
    requireStage("sources_archived");
    if (!Array.isArray(claimRefs) || claimRefs.length === 0) throw new Error("claim_refs must contain at least one traceable claim binding");
    gate = advance({ ...gate, claim_refs: [...new Set(claimRefs.map(String))] }, "claims_bound", { claim_refs: claimRefs });
  } else if (action === "finalize") {
    requireStage("claims_bound");
    if (gate.archive_count < 1 || gate.claim_refs.length < 1) throw new Error("archive verification and claim binding are required before answerable");
    gate = advance({ ...gate, status: "ok", answerable: true }, "answerable", detail);
  } else {
    throw new Error(`unknown research_loop action: ${action}`);
  }
  metadata.evidence_gate = gate;
  metadata.updated_at = new Date().toISOString();
  await atomicJson(metadataPath, metadata);
  return { run_dir: path, evidence_gate: gate };
}
