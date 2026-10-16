// @ts-nocheck
import {
  approveEvolutionCandidate,
  approveKnowledgeReuse,
  createEvolutionCandidate,
  createKnowledgeReuseDecision,
  revokeEvolutionCandidate,
  revokeKnowledgeReuse,
  supersedeEvolutionCandidate
} from "./chunk-SRDFC2QO.mjs";

// packages/knowledge/src/evolution.ts
var EvolutionIndex = class {
  constructor(store) {
    this.store = store;
  }
  candidates = /* @__PURE__ */ new Map();
  decisions = /* @__PURE__ */ new Map();
  writeQueue = Promise.resolve();
  async load() {
    if (!this.store) return;
    const value = await this.store.read();
    for (const candidate of value.candidates) this.candidates.set(candidate.id, candidate);
    for (const decision of value.decisions) this.decisions.set(decision.id, decision);
  }
  async propose(input) {
    if (this.candidates.has(input.id)) throw new Error(`Evolution candidate already exists: ${input.id}`);
    const candidate = createEvolutionCandidate(input);
    this.candidates.set(candidate.id, candidate);
    await this.persist();
    return candidate;
  }
  getCandidate(id) {
    return this.candidates.get(id);
  }
  listCandidates() {
    return [...this.candidates.values()];
  }
  async approveCandidate(id, approvalRef, now) {
    const candidate = this.requireCandidate(id);
    const updated = approveEvolutionCandidate(candidate, approvalRef, now);
    this.candidates.set(id, updated);
    await this.persist();
    return updated;
  }
  async supersedeCandidate(id, supersedingRef, now) {
    const candidate = this.requireCandidate(id);
    const updated = supersedeEvolutionCandidate(candidate, supersedingRef, now);
    this.candidates.set(id, updated);
    await this.persist();
    return updated;
  }
  async revokeCandidate(id, revokedByRef, reason, now) {
    const candidate = this.requireCandidate(id);
    const updated = revokeEvolutionCandidate(candidate, revokedByRef, reason, now);
    this.candidates.set(id, updated);
    await this.persist();
    return updated;
  }
  async recordReuseDecision(input) {
    if (this.decisions.has(input.id)) throw new Error(`Reuse decision already exists: ${input.id}`);
    const decision = createKnowledgeReuseDecision(input);
    this.decisions.set(decision.id, decision);
    await this.persist();
    return decision;
  }
  getReuseDecision(id) {
    return this.decisions.get(id);
  }
  listReuseDecisions() {
    return [...this.decisions.values()];
  }
  async approveReuse(id, approvalRef, now) {
    const decision = this.requireDecision(id);
    const updated = approveKnowledgeReuse(decision, approvalRef, now);
    this.decisions.set(id, updated);
    await this.persist();
    return updated;
  }
  async revokeReuse(id, revokedByRef, now) {
    const decision = this.requireDecision(id);
    const updated = revokeKnowledgeReuse(decision, revokedByRef, now);
    this.decisions.set(id, updated);
    await this.persist();
    return updated;
  }
  requireCandidate(id) {
    const candidate = this.candidates.get(id);
    if (!candidate) throw new Error(`Evolution candidate not found: ${id}`);
    return candidate;
  }
  requireDecision(id) {
    const decision = this.decisions.get(id);
    if (!decision) throw new Error(`Reuse decision not found: ${id}`);
    return decision;
  }
  async persist() {
    const store = this.store;
    if (!store) return;
    const operation = this.writeQueue.then(
      () => store.write({ candidates: this.listCandidates(), decisions: this.listReuseDecisions() })
    );
    this.writeQueue = operation.catch(() => void 0);
    await operation;
  }
};

export {
  EvolutionIndex
};
