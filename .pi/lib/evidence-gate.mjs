// packages/research/src/evidence-gate.ts
var EVIDENCE_STAGES = Object.freeze([
  "created",
  "local_query_recorded",
  "external_search_recorded",
  "sources_inspected",
  "sources_archived",
  "claims_bound",
  "answerable"
]);
var TERMINAL_FAILURES = /* @__PURE__ */ new Set(["unavailable", "browser_required", "failed"]);
function createEvidenceGate({ scope = "factual-answer" } = {}) {
  const events = [];
  let stage = "created";
  const record = (type, details = {}) => {
    events.push({ type, at: (/* @__PURE__ */ new Date()).toISOString(), ...details });
  };
  const snapshot = () => ({
    scope,
    stage,
    status: "ok",
    answerable: stage === "answerable",
    events: [...events]
  });
  const advance = (next, details = {}) => {
    if (!EVIDENCE_STAGES.includes(next)) throw new Error(`Unknown evidence stage: ${next}`);
    const current = EVIDENCE_STAGES.indexOf(stage);
    const target = EVIDENCE_STAGES.indexOf(next);
    if (target < current) throw new Error(`Evidence stage cannot move backwards: ${stage} -> ${next}`);
    stage = next;
    record(next, details);
    return snapshot();
  };
  const fail = (status, details = {}) => {
    if (!TERMINAL_FAILURES.has(status)) throw new Error(`Unknown evidence failure: ${status}`);
    record(status, details);
    return { ...snapshot(), status, answerable: false };
  };
  return Object.freeze({ advance, fail, snapshot });
}
function assertEvidenceAnswerable(gate, { claimBindings = [] } = {}) {
  const state = gate.snapshot();
  if (state.stage !== "answerable" || !Array.isArray(claimBindings) || claimBindings.length === 0 || claimBindings.some((binding) => !binding || typeof binding !== "object" || Array.isArray(binding))) {
    throw new Error(
      "Evidence gate is closed: complete retrieval, inspection, archiving and structured claim binding first"
    );
  }
  return state;
}
export {
  EVIDENCE_STAGES,
  assertEvidenceAnswerable,
  createEvidenceGate
};
