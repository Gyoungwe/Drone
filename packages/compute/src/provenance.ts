import type {
	CompiledWorkflow,
	ComputeExecutorKind,
	MultiqcSummary,
	QcGateResult,
	RemoteJobProvenance,
	RemoteModuleProvenance,
} from "./types";

export interface RemoteProvenanceInput {
	jobId: string;
	hostAlias: string;
	executor: ComputeExecutorKind;
	schedulerJobId?: string;
	nextflowVersion?: string;
	pipeline: string;
	pipelineVersion: string;
	profile?: string;
	workflow: CompiledWorkflow;
	remoteInputs: readonly string[];
	remoteOutputs: readonly string[];
	authorizationContractHash: string;
	startedAt?: string;
	finishedAt?: string;
	executionStatus: RemoteJobProvenance["executionStatus"];
	qc?: QcGateResult;
	qcSummary?: MultiqcSummary;
}

const emptyQc = (): QcGateResult => ({
	status: "unknown",
	findings: [],
	reviewed: false,
	qcVerified: false,
	scientificallyVerified: false,
	qualifiedBy: "no-report",
});

const RESOLVED_DIGEST = /^sha256:[0-9a-f]{64}$/i;

/** Reject an execution record that would claim reproducibility without a
 * resolved OCI digest.  Fixture workflows are intentionally exempt because
 * they cannot be submitted to a production runner. */
export function assertResolvedContainerDigests(workflow: CompiledWorkflow): void {
	if (workflow.executionMode === "fixture") return;
	for (const [moduleId, digest] of Object.entries(workflow.containerDigests)) {
		if (!RESOLVED_DIGEST.test(digest))
			throw new Error(
				`Container digest for ${moduleId} is unresolved; resolve it from the registry manifest`,
			);
	}
	if (Object.keys(workflow.moduleCommits).some((moduleId) => !workflow.containerDigests[moduleId]))
		throw new Error("Every production workflow module must have a resolved container digest");
}

/** Compute provenance is an execution record; it intentionally cannot assert scientific validity. */
export function createRemoteJobProvenance(input: RemoteProvenanceInput): RemoteJobProvenance {
	if (input.executionStatus !== "unknown") assertResolvedContainerDigests(input.workflow);
	const modules: RemoteModuleProvenance[] = Object.entries(input.workflow.moduleCommits).map(
		([id, commit]) => ({
			id,
			name: id,
			source: id.startsWith("nf-core/") ? "nf-core" : id.startsWith("agent/") ? "agent" : "user",
			version: input.pipelineVersion,
			commit,
			...(input.workflow.containerDigests[id]
				? { containerDigest: input.workflow.containerDigests[id] }
				: {}),
		}),
	);
	return {
		schemaVersion: 1,
		jobId: input.jobId,
		hostAlias: input.hostAlias,
		executor: input.executor,
		...(input.schedulerJobId ? { schedulerJobId: input.schedulerJobId } : {}),
		...(input.nextflowVersion ? { nextflowVersion: input.nextflowVersion } : {}),
		pipeline: input.pipeline,
		pipelineVersion: input.pipelineVersion,
		...(input.profile ? { profile: input.profile } : {}),
		workflowSpecSha256: input.workflow.workflowSpecSha256,
		executionMode: input.workflow.executionMode,
		modules,
		remoteInputs: [...input.remoteInputs],
		remoteOutputs: [...input.remoteOutputs],
		authorizationContractHash: input.authorizationContractHash,
		...(input.startedAt ? { startedAt: input.startedAt } : {}),
		...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
		executionStatus: input.executionStatus,
		qc: input.qc ?? emptyQc(),
		reviewed: false,
		scientificallyVerified: false,
	};
}

/** Adapter payload for @drone/research/run-provenance without introducing a domain dependency. */
export function runProvenanceDeclarations(provenance: RemoteJobProvenance): Record<string, unknown> {
	return {
		compute: {
			schemaVersion: provenance.schemaVersion,
			jobId: provenance.jobId,
			hostAlias: provenance.hostAlias,
			executor: provenance.executor,
			schedulerJobId: provenance.schedulerJobId,
			workflowSpecSha256: provenance.workflowSpecSha256,
			executionMode: provenance.executionMode,
			pipeline: provenance.pipeline,
			pipelineVersion: provenance.pipelineVersion,
			authorizationContractHash: provenance.authorizationContractHash,
			profile: provenance.profile,
			nextflowVersion: provenance.nextflowVersion,
			remoteInputs: provenance.remoteInputs,
			remoteOutputs: provenance.remoteOutputs,
			startedAt: provenance.startedAt,
			finishedAt: provenance.finishedAt,
			executionStatus: provenance.executionStatus,
			moduleCommits: Object.fromEntries(provenance.modules.map((module) => [module.id, module.commit])),
			containerDigests: Object.fromEntries(
				provenance.modules
					.filter((module) => module.containerDigest)
					.map((module) => [module.id, module.containerDigest as string]),
			),
			qc: provenance.qc,
		},
		qcVerified: false,
		scientificallyVerified: false,
	};
}
