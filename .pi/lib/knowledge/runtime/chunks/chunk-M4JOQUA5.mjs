// @ts-nocheck
import {
  contractContentHash,
  createKnowledgeSnapshot
} from "./chunk-FDMELZ7E.mjs";
import {
  projectIdentity
} from "./chunk-CXEKIGAQ.mjs";

// packages/knowledge/src/reuse.ts
import { isAbsolute, resolve } from "node:path";
function resolveKnowledgeContext(input) {
  if (typeof input.workspaceRoot !== "string" || !isAbsolute(input.workspaceRoot))
    throw new Error("Knowledge workspaceRoot must be absolute");
  const workspaceRoot = resolve(input.workspaceRoot);
  const workspaceId = cleanId(input.workspaceId) ?? projectIdentity(workspaceRoot);
  const projectId = cleanId(input.projectId) ?? workspaceId;
  return { projectId, workspaceId, workspaceRoot };
}
function cleanId(value) {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").trim();
  if (!text || text.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text)) return null;
  return text;
}
var HASH = /^[a-f0-9]{64}$/;
var ISO_DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
function asTime(value, label) {
  if (!ISO_DATE.test(value)) throw new Error(`${label} must be an ISO UTC timestamp`);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} is invalid`);
  return time;
}
function nowIso(value) {
  const now = value ?? (/* @__PURE__ */ new Date()).toISOString();
  asTime(now, "now");
  return now;
}
function validParentRef(value) {
  if (typeof value === "string") return value.trim().length > 0 && value.length <= 512;
  return !!value && typeof value.id === "string" && value.id.length > 0 && typeof value.kind === "string";
}
function validateKnowledgeSourceReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") throw new Error("Invalid knowledge source receipt");
  if (!receipt.sourceRef || receipt.sourceRef.length > 4096) throw new Error("Invalid sourceRef");
  if (!receipt.receiptRef || receipt.receiptRef.length > 512) throw new Error("Invalid receiptRef");
  if (!HASH.test(receipt.contentHash)) throw new Error("Source receipt contentHash must be SHA-256");
  asTime(receipt.readAt, "readAt");
  if (receipt.version !== void 0 && (!receipt.version || receipt.version.length > 512))
    throw new Error("Invalid source receipt version");
  if (receipt.summary !== void 0 && receipt.summary.length > 4e3) throw new Error("Source summary is too long");
  if (receipt.evidenceGrade && !["navigation", "contextual", "primary", "validated", "reproduced"].includes(receipt.evidenceGrade))
    throw new Error("Invalid source receipt evidence grade");
  if (receipt.evidenceLevel && !["navigation", "contextual", "primary", "validated", "reproduced"].includes(receipt.evidenceLevel))
    throw new Error("Invalid source receipt evidence level");
  for (const ref of [...receipt.analysisRefs ?? [], ...receipt.checkpointRefs ?? []])
    if (!validParentRef(ref)) throw new Error("Invalid source receipt parent reference");
  if (receipt.freshness?.expiresAt) asTime(receipt.freshness.expiresAt, "freshness.expiresAt");
  return receipt;
}
function checkKnowledgeReceiptFreshness(receipt, options = {}) {
  try {
    validateKnowledgeSourceReceipt(receipt);
    const checkedAt = nowIso(options.now);
    const checked = Date.parse(checkedAt);
    const readAt = Date.parse(receipt.readAt);
    if (readAt > checked) return { status: "invalid", checkedAt, reason: "readAt is in the future" };
    if (receipt.freshness?.expiresAt && Date.parse(receipt.freshness.expiresAt) <= checked)
      return { status: "stale", checkedAt, reason: "receipt expiry has passed" };
    if (options.maxAgeMs !== void 0) {
      if (!Number.isFinite(options.maxAgeMs) || options.maxAgeMs < 0) throw new Error("maxAgeMs must be non-negative");
      if (checked - readAt > options.maxAgeMs)
        return { status: "stale", checkedAt, reason: "receipt exceeds the freshness window" };
    }
    if (!options.current) {
      return options.requireCurrent ? { status: "unknown", checkedAt, reason: "current source identity was not observed" } : { status: "fresh", checkedAt };
    }
    if (!HASH.test(options.current.contentHash))
      return { status: "invalid", checkedAt, reason: "current source hash is invalid" };
    if (options.current.contentHash !== receipt.contentHash)
      return { status: "stale", checkedAt, reason: "source content hash changed" };
    if (receipt.version !== void 0 && options.current.version !== receipt.version)
      return { status: "stale", checkedAt, reason: "source version changed" };
    return { status: "fresh", checkedAt };
  } catch (error) {
    return { status: "invalid", checkedAt: options.now ?? (/* @__PURE__ */ new Date()).toISOString(), reason: String(error) };
  }
}
var GRADE_RANK = {
  navigation: 0,
  contextual: 1,
  primary: 2,
  validated: 3,
  reproduced: 4
};
var LEVEL_RANK = {
  "navigation-only": 0,
  "evidence-eligible": 2,
  "validated-capability": 3,
  "reproduced-capability": 4
};
function knowledgeEvidenceGradeRank(grade) {
  return GRADE_RANK[grade];
}
function knowledgeReuseLevelRank(level) {
  return LEVEL_RANK[level];
}
function levelForGrade(grade) {
  if (grade === "reproduced") return "reproduced-capability";
  if (grade === "validated") return "validated-capability";
  if (grade === "primary") return "evidence-eligible";
  return "navigation-only";
}
function maxGrade(sources) {
  return sources.reduce(
    (best, source) => knowledgeEvidenceGradeRank(source.evidenceGrade ?? source.evidenceLevel ?? "navigation") > knowledgeEvidenceGradeRank(best) ? source.evidenceGrade ?? source.evidenceLevel ?? "navigation" : best,
    "navigation"
  );
}
function uniqueRefs(refs) {
  const seen = /* @__PURE__ */ new Set();
  return refs.filter((ref) => {
    const key = typeof ref === "string" ? ref : `${ref.kind}:${ref.id}:${ref.revision ?? ""}:${ref.contentHash ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function ingestKnowledgeSnapshot(input) {
  if (!input.context?.projectId || !input.context.workspaceId) throw new Error("Knowledge context is required");
  if (!Array.isArray(input.sources) || input.sources.length === 0 || input.sources.length > 128)
    throw new Error("Knowledge snapshot requires 1-128 source receipts");
  const createdAt = nowIso(input.createdAt);
  const ingestedAt = nowIso(input.ingestedAt ?? createdAt);
  const sources = input.sources.map((source) => {
    const sourceGrade = source.evidenceGrade ?? source.evidenceLevel;
    const normalized = {
      ...source,
      ...sourceGrade ? { evidenceGrade: sourceGrade, evidenceLevel: sourceGrade } : {},
      analysisRefs: uniqueRefs(source.analysisRefs ?? []),
      checkpointRefs: uniqueRefs(source.checkpointRefs ?? [])
    };
    return validateKnowledgeSourceReceipt(normalized);
  });
  const grade = input.evidenceGrade ?? input.evidenceLevel ?? maxGrade(sources);
  if (sources.some((source) => knowledgeEvidenceGradeRank(source.evidenceGrade ?? source.evidenceLevel ?? "navigation") > knowledgeEvidenceGradeRank(grade)))
    throw new Error("Snapshot evidence grade cannot understate a source grade");
  const inferredLevel = levelForGrade(grade);
  const reuseLevel = input.reuseLevel ?? inferredLevel;
  if (knowledgeReuseLevelRank(reuseLevel) > knowledgeReuseLevelRank(inferredLevel))
    throw new Error("Snapshot reuse level exceeds its evidence grade");
  const analysisRefs = uniqueRefs([
    ...input.analysisRefs ?? [],
    ...sources.flatMap((source) => source.analysisRefs ?? [])
  ]);
  const evidenceCheckpointRefs = uniqueRefs([
    ...input.evidenceCheckpointRefs ?? [],
    ...sources.flatMap((source) => source.checkpointRefs ?? [])
  ]);
  const parentRefs = uniqueRefs([
    ...input.parentRefs ?? [],
    ...input.caseRef ? [input.caseRef] : [],
    ...analysisRefs,
    ...evidenceCheckpointRefs
  ]);
  const identity = {
    projectId: input.context.projectId,
    workspaceId: input.context.workspaceId,
    sources,
    createdAt
  };
  const id = input.id ?? `knowledge-${contractContentHash(identity).slice(0, 24)}`;
  if (!cleanId(id)) throw new Error("Knowledge snapshot id contains unsafe characters");
  return createKnowledgeSnapshot({
    id,
    ...input.caseRef ? { caseRef: input.caseRef } : {},
    projectId: input.context.projectId,
    workspaceId: input.context.workspaceId,
    ...input.assay ? { assay: input.assay } : {},
    environmentFingerprint: input.environmentFingerprint,
    sources,
    reuseLevel,
    evidenceGrade: grade,
    evidenceLevel: grade,
    freshness: { checkedAt: ingestedAt },
    methodVersion: input.methodVersion,
    referenceVersion: input.referenceVersion,
    inputManifestHash: input.inputManifestHash,
    analysisRefs,
    evidenceCheckpointRefs,
    createdAt,
    ingestedAt,
    parentRefs
  });
}
function sameRef(a, b) {
  return typeof a === "string" && typeof b === "string" ? a === b : typeof a !== "string" && typeof b !== "string" && a.kind === b.kind && a.id === b.id;
}
function checkKnowledgeSnapshotReuse(snapshot, request) {
  const reasons = [];
  const freshness = snapshot.sources.map(
    (source) => checkKnowledgeReceiptFreshness(source, {
      now: request.now,
      maxAgeMs: request.maxAgeMs,
      requireCurrent: request.requireCurrent,
      current: request.sourceStates?.[source.sourceRef]
    })
  );
  if (snapshot.projectId !== request.context.projectId || snapshot.workspaceId !== request.context.workspaceId)
    reasons.push("snapshot belongs to another project or workspace");
  if (request.requiredLevel && knowledgeReuseLevelRank(snapshot.reuseLevel) < knowledgeReuseLevelRank(request.requiredLevel))
    reasons.push("snapshot evidence level is insufficient");
  if (request.assay && snapshot.assay !== request.assay) reasons.push("assay does not match");
  if (request.methodVersion && snapshot.methodVersion !== request.methodVersion) reasons.push("method version does not match");
  if (request.referenceVersion && snapshot.referenceVersion !== request.referenceVersion)
    reasons.push("reference version does not match");
  if (request.inputManifestHash && snapshot.inputManifestHash !== request.inputManifestHash)
    reasons.push("input manifest does not match");
  if (request.analysisRef && !(snapshot.analysisRefs ?? []).some((ref) => sameRef(ref, request.analysisRef)))
    reasons.push("analysis reference is not linked");
  if (request.evidenceCheckpointRef && !(snapshot.evidenceCheckpointRefs ?? []).some((ref) => sameRef(ref, request.evidenceCheckpointRef)))
    reasons.push("evidence checkpoint reference is not linked");
  if (freshness.some((item) => item.status === "stale" || item.status === "invalid")) reasons.push("one or more source receipts are stale");
  if (freshness.some((item) => item.status === "unknown")) reasons.push("source freshness is unknown");
  let status = "reusable";
  if (reasons.length) {
    if (freshness.some((item) => item.status === "stale" || item.status === "invalid")) status = "stale";
    else if (snapshot.projectId !== request.context.projectId || snapshot.workspaceId !== request.context.workspaceId) status = "context-mismatch";
    else if (request.requiredLevel && knowledgeReuseLevelRank(snapshot.reuseLevel) < knowledgeReuseLevelRank(request.requiredLevel)) status = "insufficient-evidence";
    else if (request.methodVersion && snapshot.methodVersion !== request.methodVersion) status = "method-mismatch";
    else if (request.referenceVersion && snapshot.referenceVersion !== request.referenceVersion) status = "reference-mismatch";
    else if (request.inputManifestHash && snapshot.inputManifestHash !== request.inputManifestHash) status = "input-mismatch";
    else if (request.analysisRef || request.evidenceCheckpointRef) status = "unlinked";
    else status = "stale";
  }
  return { snapshotId: snapshot.id, reusable: reasons.length === 0, status, reasons, freshness };
}
var KnowledgeReuseIndex = class {
  constructor(store, snapshots = []) {
    this.store = store;
    for (const snapshot of snapshots) this.entries.set(snapshot.id, { snapshot, reuseCount: 0 });
  }
  entries = /* @__PURE__ */ new Map();
  writeQueue = Promise.resolve();
  async load() {
    if (!this.store) return;
    const snapshots = await this.store.read();
    for (const snapshot of snapshots) {
      if (!snapshot || this.entries.has(snapshot.id)) continue;
      this.entries.set(snapshot.id, { snapshot, reuseCount: 0 });
    }
  }
  async ingest(snapshot) {
    const existing = this.entries.get(snapshot.id);
    if (existing && existing.snapshot.contentHash !== snapshot.contentHash)
      throw new Error("Knowledge snapshot id is already bound to different content");
    if (!existing) this.entries.set(snapshot.id, { snapshot, reuseCount: 0 });
    await this.persist();
    return existing?.snapshot ?? snapshot;
  }
  get(id) {
    const entry = this.entries.get(id);
    return entry ? { ...entry, snapshot: structuredClone(entry.snapshot) } : void 0;
  }
  list() {
    return [...this.entries.values()].map((entry) => ({ ...entry, snapshot: structuredClone(entry.snapshot) }));
  }
  find(request) {
    return [...this.entries.values()].map((entry) => checkKnowledgeSnapshotReuse(entry.snapshot, request)).sort((a, b) => Number(b.reusable) - Number(a.reusable) || a.snapshotId.localeCompare(b.snapshotId));
  }
  async reuse(id, request) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Knowledge snapshot not found: ${id}`);
    const decision = checkKnowledgeSnapshotReuse(entry.snapshot, request);
    if (!decision.reusable) return decision;
    const reusedAt = nowIso(request.now);
    this.entries.set(id, { ...entry, reuseCount: entry.reuseCount + 1, lastReusedAt: reusedAt });
    await this.persist();
    return { ...decision, reusedAt };
  }
  async persist() {
    if (!this.store) return;
    this.writeQueue = this.writeQueue.then(() => this.store?.write([...this.entries.values()].map((entry) => entry.snapshot)) ?? Promise.resolve());
    await this.writeQueue;
  }
};

export {
  resolveKnowledgeContext,
  validateKnowledgeSourceReceipt,
  checkKnowledgeReceiptFreshness,
  knowledgeEvidenceGradeRank,
  knowledgeReuseLevelRank,
  ingestKnowledgeSnapshot,
  checkKnowledgeSnapshotReuse,
  KnowledgeReuseIndex
};
