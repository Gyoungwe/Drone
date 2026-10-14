import type {
	AnalysisContext,
	AnalysisExecutionContext,
	AnalysisIdentity,
	AnalysisMode,
	AnalysisOrchestratorOptions,
	AnalysisOrchestrator as AnalysisOrchestratorType,
	AnalysisProvenance,
	AnalysisReadinessInput,
	AnalysisReview,
	AnalysisStatus,
} from "@drone/shared";
import { AnalysisOrchestrator } from "@drone/shared";
import type { JsonStore } from "../json-store";

export interface AnalysisLedger {
	readonly version: 1;
	readonly runs: Record<string, AnalysisContext>;
	bindings?: Record<string, AnalysisComputeBinding>;
}

export interface AnalysisComputeBinding {
	readonly jobId: string;
	readonly specSha256: string;
	readonly adapter: AnalysisIdentity;
	readonly workflow: AnalysisIdentity;
	readonly method: AnalysisIdentity;
	readonly adapterSnapshotSha256: string;
	readonly toolContractSha256: string;
	readonly executionContext?: AnalysisExecutionContext;
	readonly requiredOutputs: readonly string[];
	readonly inputs: AnalysisProvenance["artifacts"];
	/** Additive execution lineage; old ledgers may omit it. */
	readonly lineage?: AnalysisProvenance["lineage"];
}

export interface AnalysisOrchestrationServiceOptions {
	readonly store: JsonStore<AnalysisLedger>;
	readonly orchestrator?: AnalysisOrchestratorOptions;
}

/**
 * Host-owned durable facade around the pure analysis state machine. It never
 * executes a workflow; compute submission must still pass ComputeService's
 * existing authorization and data-design preflight.
 */
export class AnalysisOrchestrationService {
	private readonly machine: AnalysisOrchestratorType;
	private readonly store: JsonStore<AnalysisLedger>;

	constructor(options: AnalysisOrchestrationServiceOptions) {
		this.store = options.store;
		this.machine = new AnalysisOrchestrator(options.orchestrator);
	}

	async create(input: {
		id: string;
		question: string;
		assay: string;
		mode: AnalysisMode;
		adapter?: AnalysisIdentity;
	}): Promise<AnalysisContext> {
		let created: AnalysisContext | undefined;
		await this.store.update((ledger) => {
			if (ledger.runs[input.id]) throw new Error(`Analysis already exists: ${input.id}`);
			created = this.machine.create(input);
			ledger.runs[created.id] = created;
		});
		return created as AnalysisContext;
	}

	/** Fork scientific context only: execution bindings, reviews and approval never cross branches. */
	async forkCheckpoint(
		snapshot: AnalysisContext,
		branch: { id: string; checkpointId: string; workspace: string },
	): Promise<AnalysisContext> {
		let created: AnalysisContext | undefined;
		await this.store.update((ledger) => {
			if (Object.hasOwn(ledger.runs, branch.id)) throw new Error("Analysis branch already exists");
			const initial = this.machine.create({
				id: branch.id,
				question: snapshot.question,
				assay: snapshot.assay,
				mode: snapshot.mode,
				...(snapshot.adapter ? { adapter: snapshot.adapter } : {}),
			});
			created = {
				...initial,
				branchOf: { analysisId: snapshot.id, checkpointId: branch.checkpointId, workspace: branch.workspace },
			};
			ledger.runs[branch.id] = created;
		});
		return created as AnalysisContext;
	}

	async get(id: string): Promise<AnalysisContext | undefined> {
		return (await this.store.read()).runs[id];
	}

	async list(): Promise<readonly AnalysisContext[]> {
		return Object.values((await this.store.read()).runs).sort((a, b) => a.id.localeCompare(b.id));
	}

	async recordDesign(id: string, detail?: string): Promise<AnalysisContext> {
		return this.transition(id, (context) => this.machine.recordDesign(context, detail));
	}

	async assessReadiness(
		id: string,
		input: AnalysisReadinessInput,
		binding?: AnalysisComputeBinding,
	): Promise<AnalysisContext> {
		let next: AnalysisContext | undefined;
		await this.store.update((ledger) => {
			const context = ledger.runs[id];
			if (!context) throw new Error(`Analysis not found: ${id}`);
			next = this.machine.assessReadiness(context, input);
			ledger.runs[id] = next;
			ledger.bindings ??= {};
			delete ledger.bindings[id];
			if (next.readiness?.ok && binding) {
				ledger.bindings[id] = binding;
				next = {
					...next,
					adapter: binding.adapter,
					provenance: {
						adapter: binding.adapter,
						workflow: binding.workflow,
						method: binding.method,
						specSha256: binding.specSha256,
						adapterSnapshotSha256: binding.adapterSnapshotSha256,
						toolContractSha256: binding.toolContractSha256,
						...(binding.executionContext ? { executionContext: binding.executionContext } : {}),
						artifacts: binding.inputs,
						...(binding.lineage ? { lineage: binding.lineage } : {}),
						reproducibility: { status: "not-assessed", detail: "Execution and output evidence pending" },
					},
				};
				ledger.runs[id] = next;
			}
		});
		return next as AnalysisContext;
	}

	async getComputeBinding(id: string): Promise<AnalysisComputeBinding | undefined> {
		return (await this.store.read()).bindings?.[id];
	}

	async approveExecution(id: string): Promise<AnalysisContext> {
		return this.transition(id, (context) => this.machine.approveExecution(context));
	}

	async recordExecution(id: string, result: { ok: boolean; detail?: string }): Promise<AnalysisContext> {
		return this.transition(id, (context) => this.machine.recordExecution(context, result));
	}

	async finishReview(
		id: string,
		input: {
			outputsVerified: boolean;
			detail?: string;
			review?: AnalysisReview;
			provenance?: AnalysisProvenance;
		},
	): Promise<AnalysisContext> {
		return this.transition(id, (context) => this.machine.finishReview(context, input));
	}

	async complete(
		id: string,
		input: { publicationApproved?: boolean; detail?: string } = {},
	): Promise<AnalysisContext> {
		return this.transition(id, (context) => this.machine.complete(context, input));
	}

	async resume(id: string): Promise<AnalysisContext> {
		return this.transition(id, (context) => this.machine.resume(context));
	}

	private async transition(
		id: string,
		update: (context: AnalysisContext) => AnalysisContext,
	): Promise<AnalysisContext> {
		let next: AnalysisContext | undefined;
		await this.store.update((ledger) => {
			const current = ledger.runs[id];
			if (!current) throw new Error(`Analysis not found: ${id}`);
			next = update(current);
			ledger.runs[id] = next;
		});
		return next as AnalysisContext;
	}
}

export function emptyAnalysisLedger(): AnalysisLedger {
	return { version: 1, runs: {} };
}

export function analysisStatus(context: AnalysisContext): AnalysisStatus {
	return context.status;
}
