export type WorkflowPortType =
	| "any"
	| "fastq"
	| "fastq-pair"
	| "samplesheet"
	| "reference"
	| "bam"
	| "counts"
	| "table"
	| "directory"
	| "json"
	| "report";

export type ModuleSource = "nf-core" | "user" | "agent";

export interface WorkflowPort {
	name: string;
	type: WorkflowPortType;
	required?: boolean;
}

/** A catalogue entry is metadata only; module code remains in the pinned module directory. */
export interface WorkflowModule {
	id: string;
	name: string;
	source: ModuleSource;
	version: string;
	commit: string;
	path: string;
	process: string;
	inputs: readonly WorkflowPort[];
	outputs: readonly WorkflowPort[];
	containerDigest?: string;
	container?: string;
}

export interface WorkflowInput {
	name: string;
	type: WorkflowPortType;
	param?: string;
}

export interface WorkflowOutput {
	name: string;
	type: WorkflowPortType;
	from: string;
}

export type WorkflowReference = string | { input: string } | { step: string; output: string };

export interface WorkflowStep {
	id: string;
	module: string;
	inputs: Readonly<Record<string, WorkflowReference>>;
	params?: Readonly<Record<string, string | number | boolean>>;
}

export interface WorkflowSpec {
	version: 1;
	id: string;
	name: string;
	/** Optional explicit entrypoint for adapters that expose more than one graph. */
	entrypoint?: string;
	/** Module ids referenced by this graph; the catalogue remains the source of metadata. */
	modules?: readonly string[];
	inputs: readonly WorkflowInput[];
	steps: readonly WorkflowStep[];
	outputs: readonly WorkflowOutput[];
	parameters?: Readonly<Record<string, string | number | boolean>>;
	metadata?: Readonly<Record<string, string>>;
}

export type WorkflowNode = WorkflowStep;
export type WorkflowModuleRef = Pick<
	WorkflowModule,
	"id" | "source" | "version" | "commit" | "containerDigest"
>;

export interface WorkflowValidationIssue {
	code: string;
	message: string;
	path?: string;
}

export interface WorkflowValidationResult {
	ok: boolean;
	errors: readonly WorkflowValidationIssue[];
	warnings: readonly WorkflowValidationIssue[];
	workflowSpecSha256?: string;
}

export interface CompiledWorkflow {
	mainNf: string;
	nextflowConfig: string;
	workflowSpecSha256: string;
	moduleCommits: Readonly<Record<string, string>>;
	containerDigests: Readonly<Record<string, string>>;
}

export interface CommandResult {
	exitCode: number;
	stdout?: string;
	stderr?: string;
}

export interface CommandRunner {
	run(command: string, args: readonly string[], options?: { cwd?: string }): Promise<CommandResult>;
}

export type ComputeExecutorKind = "direct" | "slurm";

export interface ExecutorConfig {
	kind: ComputeExecutorKind;
	cpus: number;
	memoryMb: number;
	walltimeMinutes: number;
	queue?: string;
	partition?: string;
	profile?: string;
}

export interface ExecutorLaunch {
	command: string;
	args: readonly string[];
	environment: Readonly<Record<string, string>>;
}

export interface ComputeBudget {
	maxCoreHours: number;
	maxWalltimeMinutes: number;
	maxConcurrentJobs: number;
	maxDiskGb: number;
}

export interface ComputeAuthorization {
	approved: boolean;
	contractHash: string;
	hosts: readonly string[];
	remoteRead: readonly string[];
	remoteWrite: readonly string[];
	workflows: readonly string[];
	budget: ComputeBudget;
	agentCode?: boolean;
}

export interface JobSpec {
	jobId: string;
	host: string;
	workflow: CompiledWorkflow;
	executor: ExecutorConfig;
	remoteRead: readonly string[];
	remoteWrite: readonly string[];
	authorization: ComputeAuthorization;
	/** Full contract hash supplied by the task host; it binds workflow, resources and paths. */
	contractHash: string;
}

export interface MultiqcFinding {
	ruleId: string;
	metric: string;
	value: number | string | boolean | null;
	threshold: number | string | boolean | null;
	severity: "warning" | "error";
	message: string;
}

export interface QcGateResult {
	status: "pass" | "fail" | "unknown";
	findings: readonly MultiqcFinding[];
	reviewed: false;
	qcVerified: false;
	scientificallyVerified: false;
	qualifiedBy: "deterministic-thresholds" | "no-report" | "parse-error";
}

export interface MultiqcSummary {
	sampleCount: number;
	modules: readonly string[];
	metrics: Readonly<Record<string, number | string | boolean>>;
	raw: unknown;
}

export interface RemoteModuleProvenance {
	id: string;
	name: string;
	source: ModuleSource;
	version: string;
	commit: string;
	containerDigest?: string;
}

export interface RemoteJobProvenance {
	schemaVersion: 1;
	jobId: string;
	hostAlias: string;
	executor: ComputeExecutorKind;
	schedulerJobId?: string;
	nextflowVersion?: string;
	pipeline: string;
	pipelineVersion: string;
	profile?: string;
	workflowSpecSha256: string;
	modules: readonly RemoteModuleProvenance[];
	remoteInputs: readonly string[];
	remoteOutputs: readonly string[];
	authorizationContractHash: string;
	startedAt?: string;
	finishedAt?: string;
	executionStatus: "submitted" | "running" | "succeeded" | "failed" | "unknown";
	qc: QcGateResult;
	reviewed: false;
	scientificallyVerified: false;
}
