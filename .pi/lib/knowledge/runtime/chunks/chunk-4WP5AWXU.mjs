// @ts-nocheck
import {
  runRuntimeExclusive
} from "./chunk-4VUDROQV.mjs";
import {
  knowledgeDirectory
} from "./chunk-CXEKIGAQ.mjs";

// packages/knowledge/src/experience-store.ts
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
var EXPERIENCE_VERSION = 1;
var EXPERIENCE_LIMITS = Object.freeze({
  maxRecords: 128,
  maxFileBytes: 512 * 1024,
  maxSummaryChars: 1200,
  maxReasonChars: 600,
  maxTags: 16,
  maxArtifacts: 16,
  maxSources: 16,
  maxObservationIds: 8,
  maxJobIds: 8,
  maxWorkflowSpecDiffs: 16,
  maxQcMetrics: 24,
  maxQcValues: 128,
  maxModelSummaryChars: 500,
  maxSearchResults: 24,
  maxHostIdChars: 64,
  maxProjectChars: 96,
  maxQueryChars: 200
});
var HASH = (value) => createHash("sha256").update(value).digest("hex");
var now = () => (/* @__PURE__ */ new Date()).toISOString();
function text(value, limit) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).normalize("NFKC").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/(?:bearer\s+)[^\s,;"']+/gi, "Bearer [redacted]").replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]").replace(/https?:\/\/[^\s<>"]+/gi, (raw) => {
    try {
      const url = new URL(raw);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "[URL omitted]";
    }
  }).trim().slice(0, limit);
}
function id(value, label, limit = 180) {
  const result = text(value, limit);
  if (!result) throw new Error(`${label} is required`);
  if (/[\\/]/.test(result) || result === "." || result === "..") throw new Error(`Invalid ${label}`);
  return result;
}
function projectKey(value) {
  const project = text(value, EXPERIENCE_LIMITS.maxProjectChars).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project)) throw new Error("Invalid experience project");
  return project;
}
function hostKey(value) {
  const host = text(value, EXPERIENCE_LIMITS.maxHostIdChars).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(host)) throw new Error("Invalid experience host");
  return host;
}
function vaultKey(value) {
  const vault = text(value, 64).toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(vault)) throw new Error("Invalid experience binding");
  return vault;
}
function hash(value) {
  const result = text(value, 128).toLowerCase();
  return /^[a-f0-9]{64}$/.test(result) ? result : null;
}
function opaqueRef(value, limit = 180) {
  const result = text(value, limit);
  if (!result || /[\\/]/.test(result)) return "";
  return result;
}
function boundedStringList(value, limit) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 240)).filter(Boolean))].slice(0, limit);
}
function finiteNonNegative(value, maximum = 1e12) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) return null;
  return value;
}
function finiteNumber(value, maximum = 1e12) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maximum) return null;
  return value;
}
function normalizeExitCode(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= -1 && value <= 255 ? value : null;
}
function normalizeRepair(value) {
  if (typeof value === "boolean") return { succeeded: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value;
  const succeeded = item.succeeded === true || item.success === true;
  const summary = text(item.summary, 400) || null;
  const observationId = opaqueRef(item.observationId, 180) || null;
  if (item.succeeded !== void 0 && typeof item.succeeded !== "boolean" || item.success !== void 0 && typeof item.success !== "boolean")
    return null;
  return {
    succeeded,
    ...summary ? { summary } : {},
    ...observationId ? { observationId } : {}
  };
}
function normalizeDiffValue(value) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : void 0;
  if (typeof value === "string") return text(value, 240) || null;
  return void 0;
}
function normalizeWorkflowSpecDiff(value) {
  let entries = [];
  if (Array.isArray(value)) entries = value;
  else if (value && typeof value === "object") {
    entries = Object.entries(value).map(([path, after]) => ({ path, after }));
  }
  const result = [];
  for (const entry of entries.slice(0, EXPERIENCE_LIMITS.maxWorkflowSpecDiffs)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry;
    const path = text(item.path ?? item.field ?? item.key, 180);
    if (!path || /[\\]/.test(path)) continue;
    const before = normalizeDiffValue(item.before);
    const after = normalizeDiffValue(item.after ?? item.value);
    if (before === void 0 && after === void 0) continue;
    result.push({ path, ...before === void 0 ? {} : { before }, ...after === void 0 ? {} : { after } });
  }
  return result;
}
function normalizeResourceUse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value).slice(0, 32)) {
    const name = text(key, 64);
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) || /(token|secret|password|credential|command|output|path|url)/i.test(name)) continue;
    const number = finiteNonNegative(raw);
    if (number !== null) result[name] = number;
    if (Object.keys(result).length >= 16) break;
  }
  return result;
}
function normalizeQcMetrics(value) {
  let entries = [];
  if (Array.isArray(value)) {
    entries = value.map((entry) => ["", entry]);
  } else if (value && typeof value === "object") {
    entries = Object.entries(value);
  }
  const result = [];
  for (const [mapName, raw] of entries.slice(0, EXPERIENCE_LIMITS.maxQcMetrics)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw;
    const name = text(item.name ?? mapName, 120);
    if (!name) continue;
    const unit = text(item.unit, 32) || null;
    const valueNumber = finiteNonNegative(item.value, 1e12);
    const count = finiteNonNegative(item.count, 1e9);
    const distributionInput = item.distribution && typeof item.distribution === "object" ? item.distribution : item;
    const distribution = {};
    for (const [rawKey, rawValue] of Object.entries(distributionInput).slice(0, 16)) {
      const key = text(rawKey, 32);
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,31}$/.test(key) || ["count", "name", "unit", "value", "values"].includes(key)) continue;
      const number = finiteNumber(rawValue, 1e12);
      if (number !== null) distribution[key] = number;
    }
    const distributionCount = finiteNonNegative(distributionInput.count, 1e9);
    if (distributionCount !== null) distribution.count = distributionCount;
    const values = Array.isArray(item.values) ? item.values.map((entry) => finiteNumber(entry, 1e12)).filter((entry) => entry !== null).slice(0, EXPERIENCE_LIMITS.maxQcValues) : [];
    if (valueNumber === null && count === null && Object.keys(distribution).length === 0 && values.length === 0) continue;
    result.push({
      name,
      ...unit ? { unit } : {},
      ...valueNumber === null ? {} : { value: valueNumber },
      ...count === null ? {} : { count },
      ...Object.keys(distribution).length ? { distribution } : {},
      ...values.length ? { values } : {}
    });
  }
  return result;
}
function normalizeArtifact(value) {
  if (!value || typeof value !== "object") return null;
  const item = value;
  const sha256 = hash(item.sha256);
  if (!sha256) return null;
  const bytes = typeof item.bytes === "number" && Number.isSafeInteger(item.bytes) && item.bytes >= 0 ? item.bytes : void 0;
  const pathValue = text(item.path, 240).replaceAll("\\", "/");
  const safePath = pathValue && !isAbsolute(pathValue) && !pathValue.split("/").includes("..") && !/(?:^|\/)(?:\.env(?:\.[^/]*)?|auth\.json|credentials(?:\.json)?|\.ssh|\.git)(?:\/|$)/i.test(pathValue) ? pathValue : "";
  return {
    ...safePath ? { path: safePath } : {},
    sha256,
    ...bytes === void 0 ? {} : { bytes }
  };
}
function normalizeProvenance(input) {
  if (!input || typeof input !== "object") throw new Error("Experience provenance is required");
  const item = input;
  const manifestSha256 = hash(item.manifestSha256 ?? item.manifestHash);
  const artifactHashes = Array.isArray(item.artifactHashes) ? item.artifactHashes.map(normalizeArtifact).filter((value) => Boolean(value)).slice(0, EXPERIENCE_LIMITS.maxArtifacts) : [];
  const runId = opaqueRef(item.runId);
  const observationId = opaqueRef(item.observationId);
  const receiptId = opaqueRef(item.receiptId);
  const result = {
    ...runId ? { runId } : {},
    ...observationId ? { observationId } : {},
    ...receiptId ? { receiptId } : {},
    ...manifestSha256 ? { manifestSha256 } : {},
    ...artifactHashes.length ? { artifactHashes } : {}
  };
  if (!result.runId && !result.receiptId && !result.manifestSha256 && !result.artifactHashes?.length)
    throw new Error("Experience provenance must reference a host receipt or manifest");
  return result;
}
function blank(vaultId, project, hostId) {
  return { version: EXPERIENCE_VERSION, vaultId, project, hostId, revision: 0, updatedAt: now(), records: [] };
}
function validateDocument(value, vaultId, project, hostId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Corrupt experience document");
  const item = value;
  if (item.version !== EXPERIENCE_VERSION || item.vaultId !== vaultId || item.project !== project || item.hostId !== hostId)
    throw new Error("Experience binding mismatch");
  if (!Number.isSafeInteger(item.revision) || Number(item.revision) < 0 || !Array.isArray(item.records))
    throw new Error("Corrupt experience document");
  if (item.records.length > EXPERIENCE_LIMITS.maxRecords) throw new Error("Experience record limit exceeded");
  return {
    version: EXPERIENCE_VERSION,
    vaultId,
    project,
    hostId,
    revision: Number(item.revision),
    updatedAt: text(item.updatedAt, 40) || now(),
    records: item.records.map((record) => normalizeRecord(record, vaultId, project, hostId))
  };
}
function normalizeRecord(value, vaultId, project, hostId) {
  if (!value || typeof value !== "object") throw new Error("Invalid experience record");
  const item = value;
  const status = item.status === "verified" ? "verified" : item.status === "observed" ? "observed" : null;
  const outcome = ["success", "failure", "blocked", "unknown"].includes(String(item.outcome)) ? item.outcome : null;
  if (!status || !outcome || item.navigationOnly !== true || item.evidenceEligible !== false || item.instructionEligible !== false)
    throw new Error("Invalid experience record safety flags");
  const result = {
    id: id(item.id, "experience id"),
    version: EXPERIENCE_VERSION,
    vaultId,
    project,
    hostId,
    jobId: id(item.jobId, "jobId"),
    featureKey: id(item.featureKey, "featureKey", 240),
    topicId: text(item.topicId, 180) || null,
    summary: text(item.summary, EXPERIENCE_LIMITS.maxSummaryChars),
    reason: text(item.reason, EXPERIENCE_LIMITS.maxReasonChars) || null,
    outcome,
    status,
    observedAt: text(item.observedAt, 40) || now(),
    observationIds: boundedStringList(item.observationIds, EXPERIENCE_LIMITS.maxObservationIds),
    observationCount: Number.isSafeInteger(item.observationCount) && Number(item.observationCount) > 0 ? Number(item.observationCount) : 1,
    jobIds: (() => {
      const values = boundedStringList(item.jobIds, EXPERIENCE_LIMITS.maxJobIds);
      return values.length ? values : [id(item.jobId, "jobId")];
    })(),
    jobCount: Number.isSafeInteger(item.jobCount) && Number(item.jobCount) > 0 ? Math.min(Number(item.jobCount), EXPERIENCE_LIMITS.maxJobIds) : 1,
    failureSignature: text(item.failureSignature, 240) || null,
    exitCode: normalizeExitCode(item.exitCode),
    failedStep: text(item.failedStep, 240) || null,
    repair: normalizeRepair(item.repair),
    workflowSpecDiff: normalizeWorkflowSpecDiff(item.workflowSpecDiff ?? item.workflowSpecDiffs),
    resourceUse: normalizeResourceUse(item.resourceUse),
    qcMetrics: normalizeQcMetrics(item.qcMetrics ?? item.qc ?? item.qcMetricDistribution),
    modelSummary: text(item.modelSummary, EXPERIENCE_LIMITS.maxModelSummaryChars) || null,
    modelGenerated: item.modelGenerated === true && Boolean(text(item.modelSummary, EXPERIENCE_LIMITS.maxModelSummaryChars)),
    provenance: normalizeProvenance(item.provenance || {}),
    tags: boundedStringList(item.tags, EXPERIENCE_LIMITS.maxTags),
    sourceRefs: boundedStringList(item.sourceRefs, EXPERIENCE_LIMITS.maxSources),
    navigationOnly: true,
    evidenceEligible: false,
    instructionEligible: false,
    createdAt: text(item.createdAt, 40) || now(),
    updatedAt: text(item.updatedAt, 40) || now()
  };
  if (!result.summary) throw new Error("Experience summary is required");
  return result;
}
function pathFor(directory, vaultId, project, hostId) {
  if (!isAbsolute(directory)) throw new Error("Experience directory must be absolute");
  return join(resolve(directory), vaultId, "experience", project, `${hostId}.json`);
}
async function ensureSafePath(directory, path) {
  const root = resolve(directory);
  const relativePath = relative(root, resolve(path));
  if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) throw new Error("Experience path escapes knowledge directory");
  let current = root;
  for (const segment of relativePath.split(sep).slice(0, -1)) {
    current = join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error("Experience path cannot traverse symlinks");
      if (!stat.isDirectory()) throw new Error("Experience path parent must be a directory");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 448 });
    }
  }
}
async function readDocument(path, vaultId, project, hostId) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Experience file must be a regular file");
    if (stat.size > EXPERIENCE_LIMITS.maxFileBytes) throw new Error("Experience file exceeds size limit");
    return validateDocument(JSON.parse(await readFile(path, "utf8")), vaultId, project, hostId);
  } catch (error) {
    if (error.code === "ENOENT") return blank(vaultId, project, hostId);
    if (error instanceof SyntaxError) throw new Error("Corrupt experience document");
    throw error;
  }
}
async function atomicWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}
`, { flag: "wx", mode: 384 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
function tokenSet(value) {
  return new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1));
}
function scoreRecord(record, query) {
  if (!query) return 0;
  const queryTokens = tokenSet(query);
  const fields = [
    record.featureKey,
    record.summary,
    record.reason || "",
    record.failureSignature || "",
    record.failedStep || "",
    record.modelSummary || "",
    ...record.tags,
    record.topicId || ""
  ];
  const recordTokens = tokenSet(fields.join(" "));
  let score = 0;
  for (const token of queryTokens) if (recordTokens.has(token)) score++;
  if (record.featureKey.toLowerCase().includes(query.toLowerCase())) score += 2;
  return score;
}
function experienceInputFromTerminalJob(input) {
  const featureKey = text(input.featureKey || input.failureSignature || input.step || "terminal-job", 240);
  if (!featureKey) throw new Error("Terminal job experience requires a failure signature or step");
  return {
    jobId: id(input.jobId, "jobId"),
    featureKey,
    summary: text(input.summary, EXPERIENCE_LIMITS.maxSummaryChars),
    observation: {
      id: id(input.observationId, "observation id"),
      outcome: input.outcome,
      exitCode: input.exitCode ?? null,
      featureKey,
      repairSucceeded: input.repairSucceeded === true,
      failureSignature: input.failureSignature,
      failedStep: input.failedStep || input.step,
      repair: input.repair || (input.repairSucceeded === true ? { succeeded: true } : null),
      workflowSpecDiff: input.workflowSpecDiff,
      resourceUse: input.resourceUse,
      qcMetrics: input.qcMetrics ?? input.qc,
      modelSummary: input.modelSummary,
      observedAt: input.observedAt,
      provenance: input.provenance
    },
    provenance: input.provenance,
    topicId: input.topicId,
    tags: input.tags,
    sourceRefs: input.sourceRefs,
    exitCode: input.exitCode,
    failureSignature: input.failureSignature,
    failedStep: input.failedStep || input.step,
    repair: input.repair,
    workflowSpecDiff: input.workflowSpecDiff,
    resourceUse: input.resourceUse,
    qcMetrics: input.qcMetrics ?? input.qc,
    modelSummary: input.modelSummary
  };
}
var terminalJobExperienceInput = experienceInputFromTerminalJob;
async function recordTerminalJobExperience(store, input, expectedRevision) {
  return store.record(experienceInputFromTerminalJob(input), expectedRevision);
}
function createExperienceStore(options) {
  const vaultId = vaultKey(options.binding?.vaultId);
  const project = projectKey(options.project);
  const hostId = hostKey(options.hostId);
  const directory = options.directory === void 0 || options.directory === null ? knowledgeDirectory() : options.directory;
  if (!directory) throw new Error("Knowledge directory is not configured");
  const path = pathFor(directory, vaultId, project, hostId);
  const read = async () => {
    await ensureSafePath(directory, path);
    return readDocument(path, vaultId, project, hostId);
  };
  const mutate = async (expectedRevision, updater) => runRuntimeExclusive("experience-store", path, async () => {
    await ensureSafePath(directory, path);
    const current = await readDocument(path, vaultId, project, hostId);
    if (expectedRevision !== void 0 && current.revision !== expectedRevision) throw new Error("Experience revision changed");
    const next = updater(structuredClone(current));
    if (next.noop) return { document: current, result: next.result };
    const candidate = { ...next.document, version: EXPERIENCE_VERSION, vaultId, project, hostId, revision: current.revision + 1, updatedAt: now(), records: next.document.records.slice(-EXPERIENCE_LIMITS.maxRecords) };
    const document = validateDocument(candidate, vaultId, project, hostId);
    await atomicWrite(path, document);
    return { document, result: next.result };
  });
  return {
    path,
    scope: { vaultId, project, hostId },
    read,
    record: async (input, expectedRevision) => {
      if (!input || typeof input !== "object") throw new Error("Invalid experience input");
      const rawInput = input;
      const jobId = id(input.jobId || rawInput.job?.id || rawInput.terminalJob?.id, "jobId");
      const observation = input.observation || input.hostObservation;
      const featureKey = id(
        input.featureKey || observation?.featureKey || input.failureSignature || observation?.failureSignature || input.failedStep || input.step,
        "featureKey",
        240
      );
      if (!observation || typeof observation !== "object") throw new Error("Terminal host observation is required");
      const observationId = id(observation.id, "observation id");
      const outcome = observation.outcome;
      if (!["success", "failure", "blocked", "unknown"].includes(outcome)) throw new Error("Invalid experience outcome");
      const provenance = normalizeProvenance(input.provenance || observation.provenance || {});
      const summary = text(input.summary, EXPERIENCE_LIMITS.maxSummaryChars);
      if (!summary) throw new Error("Experience summary is required");
      const failureSignature = text(input.failureSignature ?? observation.failureSignature, 240) || null;
      const exitCode = normalizeExitCode(input.exitCode ?? observation.exitCode);
      const failedStep = text(input.failedStep ?? input.step ?? observation.failedStep ?? observation.step, 240) || null;
      const repair = normalizeRepair(input.repair ?? observation.repair ?? (input.repairSucceeded === true || observation.repairSucceeded === true ? { succeeded: true } : null));
      const repairSucceeded = input.repairSucceeded === true || observation.repairSucceeded === true || repair?.succeeded === true;
      const workflowSpecDiff = normalizeWorkflowSpecDiff(input.workflowSpecDiff ?? observation.workflowSpecDiff);
      const resourceUse = normalizeResourceUse(input.resourceUse ?? observation.resourceUse);
      const qcMetrics = normalizeQcMetrics(input.qcMetrics ?? input.qc ?? observation.qcMetrics ?? observation.qc);
      const modelSummary = text(input.modelSummary ?? observation.modelSummary, EXPERIENCE_LIMITS.maxModelSummaryChars) || null;
      const observedAt = text(observation.observedAt, 40) || now();
      const sanitizedTags = boundedStringList(input.tags, EXPERIENCE_LIMITS.maxTags);
      const sanitizedSources = boundedStringList(input.sourceRefs, EXPERIENCE_LIMITS.maxSources);
      const key = featureKey;
      const out = await mutate(expectedRevision, (document) => {
        const matching = document.records.filter((record2) => record2.featureKey === featureKey);
        const existing = document.records.find((record2) => record2.id === HASH(key).slice(0, 32));
        if (existing?.observationIds.includes(observationId)) return { document, result: { classification: "duplicate", record: existing }, noop: true };
        const observations = new Set(matching.flatMap((record2) => record2.observationIds));
        observations.add(observationId);
        const jobs = new Set(matching.flatMap((record2) => record2.jobIds.length ? record2.jobIds : [record2.jobId]));
        jobs.add(jobId);
        const status = repairSucceeded || jobs.size >= 2 ? "verified" : "observed";
        const record = existing || {
          id: HASH(key).slice(0, 32),
          version: EXPERIENCE_VERSION,
          vaultId,
          project,
          hostId,
          jobId,
          featureKey,
          topicId: text(input.topicId, 180) || null,
          summary,
          // A failure reason may be supplied as summary context, but raw output is never accepted.
          reason: text(input.reason, EXPERIENCE_LIMITS.maxReasonChars) || null,
          outcome,
          status,
          observedAt,
          observationIds: [],
          observationCount: 0,
          jobIds: [],
          jobCount: 0,
          failureSignature,
          exitCode,
          failedStep,
          repair,
          workflowSpecDiff,
          resourceUse,
          qcMetrics,
          modelSummary,
          modelGenerated: Boolean(modelSummary),
          provenance,
          tags: sanitizedTags,
          sourceRefs: sanitizedSources,
          navigationOnly: true,
          evidenceEligible: false,
          instructionEligible: false,
          createdAt: now(),
          updatedAt: now()
        };
        record.observationIds = [...observations].slice(-EXPERIENCE_LIMITS.maxObservationIds);
        record.observationCount = Math.min(observations.size, EXPERIENCE_LIMITS.maxObservationIds);
        record.jobIds = [...jobs].slice(-EXPERIENCE_LIMITS.maxJobIds);
        record.jobCount = Math.min(jobs.size, EXPERIENCE_LIMITS.maxJobIds);
        record.status = status;
        record.updatedAt = now();
        record.observedAt = observedAt;
        record.outcome = outcome;
        record.summary = summary;
        record.provenance = provenance;
        record.tags = sanitizedTags;
        record.sourceRefs = sanitizedSources;
        if (failureSignature) record.failureSignature = failureSignature;
        if (input.exitCode !== void 0 || observation.exitCode !== void 0) record.exitCode = exitCode;
        if (failedStep) record.failedStep = failedStep;
        if (repair) record.repair = repair;
        if (input.workflowSpecDiff !== void 0 || observation.workflowSpecDiff !== void 0) record.workflowSpecDiff = workflowSpecDiff;
        if (input.resourceUse !== void 0 || observation.resourceUse !== void 0) record.resourceUse = resourceUse;
        if (input.qcMetrics !== void 0 || input.qc !== void 0 || observation.qcMetrics !== void 0 || observation.qc !== void 0) record.qcMetrics = qcMetrics;
        if (modelSummary) {
          record.modelSummary = modelSummary;
          record.modelGenerated = true;
        }
        if (!existing) document.records.unshift(record);
        return { document, result: { classification: existing ? "updated" : "new", record } };
      });
      return { ...out.result, revision: out.document.revision, record: out.result.record };
    },
    search: async (query = "", options2 = {}) => {
      const document = await read();
      const q = text(query, EXPERIENCE_LIMITS.maxQueryChars);
      const limit = Math.min(EXPERIENCE_LIMITS.maxSearchResults, Math.max(1, Math.floor(options2.limit || EXPERIENCE_LIMITS.maxSearchResults)));
      const records = document.records.filter((record) => options2.includeObserved !== false || record.status === "verified").map((record) => ({ record, score: scoreRecord(record, q) })).filter((hit) => !q || hit.score > 0).sort((left, right) => right.score - left.score || right.record.updatedAt.localeCompare(left.record.updatedAt) || left.record.id.localeCompare(right.record.id)).slice(0, limit);
      return { revision: document.revision, query: q, records, navigationOnly: true, evidenceEligible: false, instructionEligible: false };
    }
  };
}
async function searchExperiences(options) {
  const { query = "", limit, includeObserved, ...storeOptions } = options;
  return createExperienceStore(storeOptions).search(query, { limit, includeObserved });
}

export {
  EXPERIENCE_VERSION,
  EXPERIENCE_LIMITS,
  experienceInputFromTerminalJob,
  terminalJobExperienceInput,
  recordTerminalJobExperience,
  createExperienceStore,
  searchExperiences
};
