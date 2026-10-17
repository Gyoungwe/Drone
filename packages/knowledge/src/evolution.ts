import {
	approveEvolutionCandidate,
	approveKnowledgeReuse,
	createEvolutionCandidate,
	createKnowledgeReuseDecision,
	revokeEvolutionCandidate,
	revokeKnowledgeReuse,
	supersedeEvolutionCandidate,
	type EvolutionCandidate,
	type KnowledgeReuseDecisionRecord,
	type ContractParentRef,
} from "@drone/shared";

export interface EvolutionIndexStore {
	read(): Promise<{
		readonly candidates: readonly EvolutionCandidate[];
		readonly decisions: readonly KnowledgeReuseDecisionRecord[];
	}>;
	write(value: {
		readonly candidates: readonly EvolutionCandidate[];
		readonly decisions: readonly KnowledgeReuseDecisionRecord[];
	}): Promise<void>;
}

/**
 * Durable host-neutral index for knowledge reuse and evolution proposals.
 * JsonStore is injected by the backend; this package only owns lifecycle and
 * fail-closed approval rules.
 */
export class EvolutionIndex {
	private readonly candidates = new Map<string, EvolutionCandidate>();
	private readonly decisions = new Map<string, KnowledgeReuseDecisionRecord>();
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(private readonly store?: EvolutionIndexStore) {}

	async load(): Promise<void> {
		if (!this.store) return;
		const value = await this.store.read();
		for (const candidate of value.candidates) this.candidates.set(candidate.id, candidate);
		for (const decision of value.decisions) this.decisions.set(decision.id, decision);
	}

	async propose(input: Parameters<typeof createEvolutionCandidate>[0]): Promise<EvolutionCandidate> {
		if (this.candidates.has(input.id)) throw new Error(`Evolution candidate already exists: ${input.id}`);
		const candidate = createEvolutionCandidate(input);
		this.candidates.set(candidate.id, candidate);
		await this.persist();
		return candidate;
	}

	getCandidate(id: string): EvolutionCandidate | undefined {
		return this.candidates.get(id);
	}

	listCandidates(): readonly EvolutionCandidate[] {
		return [...this.candidates.values()];
	}

	async approveCandidate(id: string, approvalRef: ContractParentRef, now: string): Promise<EvolutionCandidate> {
		const candidate = this.requireCandidate(id);
		const updated = approveEvolutionCandidate(candidate, approvalRef, now);
		this.candidates.set(id, updated);
		await this.persist();
		return updated;
	}

	async supersedeCandidate(id: string, supersedingRef: ContractParentRef, now: string): Promise<EvolutionCandidate> {
		const candidate = this.requireCandidate(id);
		const updated = supersedeEvolutionCandidate(candidate, supersedingRef, now);
		this.candidates.set(id, updated);
		await this.persist();
		return updated;
	}

	async revokeCandidate(id: string, revokedByRef: ContractParentRef, reason: string, now: string): Promise<EvolutionCandidate> {
		const candidate = this.requireCandidate(id);
		const updated = revokeEvolutionCandidate(candidate, revokedByRef, reason, now);
		this.candidates.set(id, updated);
		await this.persist();
		return updated;
	}

	async recordReuseDecision(input: Parameters<typeof createKnowledgeReuseDecision>[0]): Promise<KnowledgeReuseDecisionRecord> {
		if (this.decisions.has(input.id)) throw new Error(`Reuse decision already exists: ${input.id}`);
		const decision = createKnowledgeReuseDecision(input);
		this.decisions.set(decision.id, decision);
		await this.persist();
		return decision;
	}

	getReuseDecision(id: string): KnowledgeReuseDecisionRecord | undefined {
		return this.decisions.get(id);
	}

	listReuseDecisions(): readonly KnowledgeReuseDecisionRecord[] {
		return [...this.decisions.values()];
	}

	async approveReuse(id: string, approvalRef: ContractParentRef, now: string): Promise<KnowledgeReuseDecisionRecord> {
		const decision = this.requireDecision(id);
		const updated = approveKnowledgeReuse(decision, approvalRef, now);
		this.decisions.set(id, updated);
		await this.persist();
		return updated;
	}

	async revokeReuse(id: string, revokedByRef: ContractParentRef, now: string): Promise<KnowledgeReuseDecisionRecord> {
		const decision = this.requireDecision(id);
		const updated = revokeKnowledgeReuse(decision, revokedByRef, now);
		this.decisions.set(id, updated);
		await this.persist();
		return updated;
	}

	private requireCandidate(id: string): EvolutionCandidate {
		const candidate = this.candidates.get(id);
		if (!candidate) throw new Error(`Evolution candidate not found: ${id}`);
		return candidate;
	}

	private requireDecision(id: string): KnowledgeReuseDecisionRecord {
		const decision = this.decisions.get(id);
		if (!decision) throw new Error(`Reuse decision not found: ${id}`);
		return decision;
	}

	private async persist(): Promise<void> {
		const store = this.store;
		if (!store) return;
		const operation = this.writeQueue.then(() =>
			store.write({ candidates: this.listCandidates(), decisions: this.listReuseDecisions() }),
		);
		// Keep the current failure observable while allowing later mutations to retry.
		this.writeQueue = operation.catch(() => undefined);
		await operation;
	}
}
