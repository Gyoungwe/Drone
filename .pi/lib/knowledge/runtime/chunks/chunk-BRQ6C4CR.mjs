// packages/knowledge/src/orchestration-policy.ts
import { createHash } from "node:crypto";
var SPECIALIST_DECISIONS = ["run", "skip", "wait", "ask-user"];
var clean = (value, limit = 120) => [...String(value || "")].map((char) => char.charCodeAt(0) < 32 ? " " : char).join("").trim().slice(0, limit);
var digest = (value) => createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
function specialistRequestSignature({
  role,
  task = "",
  sourcePaths = [],
  sourceHashes = [],
  summary = "",
  targetPath = null
} = {}) {
  return JSON.stringify({
    role: clean(role, 40),
    task: clean(task, 4e3),
    sourcePaths: [
      ...new Set((Array.isArray(sourcePaths) ? sourcePaths : []).map((p) => clean(p, 512)))
    ].sort(),
    sourceHashes: (Array.isArray(sourceHashes) ? sourceHashes : []).map((p) => clean(p, 128)).sort(),
    summary: digest(clean(summary, 12e3)),
    targetPath: targetPath ? clean(targetPath, 512) : null
  });
}
function decideSpecialistRun({
  role,
  task = "",
  sourcePaths = [],
  targetPath = null,
  sourceHashes = [],
  summary = "",
  automatic = false,
  mode = "automatic",
  trusted = true,
  policy = "read-local",
  hasEvidence = false,
  taskNeedsSpecialist,
  observedNeed,
  duplicate = false,
  turnRuns = 0,
  maxRunsPerTurn = 4,
  sessionRuns = 0,
  maxRunsPerSession = 20,
  active = 0,
  concurrency = 2,
  queueLength = 0,
  queueLimit = 8
} = {}) {
  const base = {
    role,
    signature: specialistRequestSignature({ role, task, sourcePaths, sourceHashes, summary, targetPath })
  };
  if (!trusted || policy !== "read-local")
    return { ...base, decision: "skip", reasonCode: "permission-denied" };
  if (mode === "off") return { ...base, decision: "skip", reasonCode: "mode-disabled" };
  if (automatic && mode !== "automatic") return { ...base, decision: "skip", reasonCode: "mode-disabled" };
  if (duplicate) return { ...base, decision: "skip", reasonCode: "duplicate-request" };
  if (taskNeedsSpecialist === false || observedNeed === false)
    return { ...base, decision: "skip", reasonCode: "task-does-not-need-specialist" };
  if (turnRuns >= maxRunsPerTurn) return { ...base, decision: "skip", reasonCode: "turn-budget-exhausted" };
  if (sessionRuns >= maxRunsPerSession)
    return { ...base, decision: "ask-user", reasonCode: "session-budget-exhausted" };
  if (automatic && ["evidence", "wiki", "explainer"].includes(role || "") && !hasEvidence)
    return { ...base, decision: "skip", reasonCode: "no-evidence" };
  if (active >= concurrency && queueLength >= queueLimit)
    return { ...base, decision: "wait", reasonCode: "queue-full" };
  return {
    ...base,
    decision: "run",
    reasonCode: automatic ? "automatic-sequence" : "explicit-delegation"
  };
}
function createSpecialistBudget({
  maxRunsPerTurn = 4,
  maxRunsPerSession = 20,
  maxToolOperations = 80,
  maxTokensPerTurn = 24e3,
  maxTokensPerSession = 12e4,
  maxCostPerTurn = 1,
  maxCostPerSession = 5
} = {}) {
  let turnRuns = 0;
  let sessionRuns = 0;
  let toolOperations = 0;
  let turnTokens = 0;
  let sessionTokens = 0;
  let turnCost = 0;
  let sessionCost = 0;
  let reservations = 0;
  let turn = 0;
  const signatures = /* @__PURE__ */ new Map();
  const completed = /* @__PURE__ */ new Set();
  const begin = () => {
    turn++;
    turnRuns = 0;
    turnTokens = 0;
    turnCost = 0;
    reservations = 0;
    signatures.clear();
  };
  const configure = (next = {}) => {
    const integerOr = (value, fallback) => typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
    maxRunsPerTurn = Math.min(4, Math.max(1, integerOr(next.maxRunsPerTurn, maxRunsPerTurn)));
    maxRunsPerSession = Math.min(20, Math.max(1, integerOr(next.maxRunsPerSession, maxRunsPerSession)));
    maxToolOperations = Math.min(80, Math.max(1, integerOr(next.maxToolOperations, maxToolOperations)));
    maxTokensPerTurn = Math.min(24e3, Math.max(1, integerOr(next.maxTokensPerTurn, maxTokensPerTurn)));
    maxTokensPerSession = Math.min(
      12e4,
      Math.max(1, integerOr(next.maxTokensPerSession, maxTokensPerSession))
    );
    maxCostPerTurn = Math.min(
      1,
      Math.max(0, typeof next.maxCostPerTurn === "number" ? next.maxCostPerTurn : maxCostPerTurn)
    );
    maxCostPerSession = Math.min(
      5,
      Math.max(0, typeof next.maxCostPerSession === "number" ? next.maxCostPerSession : maxCostPerSession)
    );
  };
  const reserve = (signature, reservationTurn = turn, { dedupe = true } = {}) => {
    if (turnRuns + reservations >= maxRunsPerTurn || sessionRuns + reservations >= maxRunsPerSession)
      return false;
    if (signatures.has(signature) || dedupe && completed.has(signature)) return false;
    reservations++;
    signatures.set(signature, reservationTurn);
    return true;
  };
  const commit = (signature, reservationTurn = turn) => {
    if (reservationTurn !== turn || signatures.get(signature) !== reservationTurn) return false;
    reservations = Math.max(0, reservations - 1);
    turnRuns++;
    sessionRuns++;
    signatures.delete(signature);
    completed.add(signature);
    return true;
  };
  const release = (signature, reservationTurn = turn) => {
    if (signatures.get(signature) !== reservationTurn) return false;
    signatures.delete(signature);
    reservations = Math.max(0, reservations - 1);
    return true;
  };
  const updateUsage = (usage = {}, usageTurn = turn) => {
    if (usageTurn !== turn) return false;
    const nonnegativeFinite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    const tokens = nonnegativeFinite(usage.totalTokens);
    const cost = nonnegativeFinite(usage.cost);
    if (tokens !== null) {
      turnTokens += tokens;
      sessionTokens += tokens;
    }
    if (cost !== null) {
      turnCost += cost;
      sessionCost += cost;
    }
    if (turnTokens > maxTokensPerTurn || sessionTokens > maxTokensPerSession)
      throw new Error("Specialist token budget exhausted");
    if (turnCost > maxCostPerTurn || sessionCost > maxCostPerSession)
      throw new Error("Specialist cost budget exhausted");
    return true;
  };
  const addToolOperation = () => {
    if (toolOperations >= maxToolOperations) return false;
    toolOperations++;
    return true;
  };
  return {
    begin,
    reserve,
    commit,
    release,
    addToolOperation,
    configure,
    updateUsage,
    recordUsage: updateUsage,
    checkUsage: () => {
      if (turnTokens >= maxTokensPerTurn || sessionTokens >= maxTokensPerSession || turnCost >= maxCostPerTurn || sessionCost >= maxCostPerSession)
        throw new Error("Specialist usage budget exhausted");
      return true;
    },
    get snapshot() {
      return {
        turn,
        turnRuns,
        sessionRuns,
        toolOperations,
        reservations,
        maxRunsPerTurn,
        maxRunsPerSession,
        maxToolOperations,
        turnTokens,
        sessionTokens,
        turnCost,
        sessionCost,
        maxTokensPerTurn,
        maxTokensPerSession,
        maxCostPerTurn,
        maxCostPerSession
      };
    }
  };
}

export {
  SPECIALIST_DECISIONS,
  specialistRequestSignature,
  decideSpecialistRun,
  createSpecialistBudget
};
