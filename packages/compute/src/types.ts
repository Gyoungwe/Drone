/** A host profile is safe to persist: it deliberately contains no credentials. */
export interface HostProfile {
	readonly alias: string;
	readonly host: string;
	readonly port?: number;
	readonly username?: string;
	readonly transport?: "builtin-ssh" | "openssh";
	readonly identityFile?: string;
	readonly jumpHosts?: readonly string[];
	readonly hostKeyFingerprint?: string;
}

export type SchedulerKind = "direct" | "slurm" | "unsupported";

export interface HostCapability {
	readonly alias: string;
	readonly runnerVersion: string;
	readonly protocolVersion: number;
	readonly scheduler: SchedulerKind;
	readonly containerRuntime?: string | null;
	readonly nextflowVersion?: string | null;
	readonly cpuCount?: number | null;
	readonly memoryBytes?: number | null;
	readonly diskBytes?: number | null;
	readonly maxUploadBytes?: number;
	readonly maxCollectBytes?: number;
	readonly loginNode?: boolean;
	readonly probedAt: number;
}

export interface HostRecord extends HostProfile {
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly capability?: HostCapability;
	readonly connection: "unknown" | "ready" | "needs-login" | "offline";
}

/** Transport requests are argv-shaped; callers never provide a shell command string. */
export interface ExecRequest {
	readonly argv: readonly string[];
	readonly stdin?: string | Uint8Array;
	readonly timeoutMs?: number;
}

export interface ExecResult {
	readonly exitCode: number;
	readonly stdout: Uint8Array;
	readonly stderr: Uint8Array;
}

export interface UploadRequest {
	readonly remotePath: string;
	readonly data: Uint8Array | AsyncIterable<Uint8Array>;
	readonly expectedSha256?: string;
}

export interface DownloadRequest {
	readonly remotePath: string;
	readonly maxBytes?: number;
}

export interface ShellChannel {
	readonly stdin: WritableByteChannel;
	readonly stdout: AsyncIterable<Uint8Array>;
	readonly stderr: AsyncIterable<Uint8Array>;
	readonly close: () => Promise<void>;
}

export interface WritableByteChannel {
	write(data: Uint8Array | string): Promise<void>;
	close(): Promise<void>;
}

/** Common transport boundary for built-in SSH and system OpenSSH adapters. */
export interface Transport {
	exec(request: ExecRequest): Promise<ExecResult>;
	upload(request: UploadRequest): Promise<void>;
	download(request: DownloadRequest): Promise<Uint8Array>;
	openShell(): Promise<ShellChannel>;
	close?(): Promise<void>;
}

export const RUNNER_COMMANDS = [
	"version",
	"capabilities",
	"prepare",
	"start",
	"status",
	"logs",
	"cancel",
	"collect",
] as const;
export type RunnerCommand = (typeof RUNNER_COMMANDS)[number];
export const RUNNER_PROTOCOL_VERSION = 1 as const;

export interface RunnerRequest<TPayload = unknown> {
	readonly protocolVersion: number;
	readonly requestId: string;
	readonly command: RunnerCommand;
	readonly jobId?: string;
	readonly payload?: TPayload;
}

export interface RunnerError {
	readonly code: string;
	readonly message: string;
	readonly retryable?: boolean;
}

export interface RunnerResponse<TPayload = unknown> {
	readonly protocolVersion: number;
	readonly requestId?: string;
	readonly ok: boolean;
	readonly payload?: TPayload;
	readonly data?: TPayload;
	readonly result?: TPayload;
	readonly error?: RunnerError;
}

export interface RunnerVersion {
	readonly runnerVersion: string;
	readonly version?: string;
	readonly protocolVersion: number;
	readonly compatibleVersions?: readonly string[];
	readonly commit?: string;
}

export interface RunnerCapabilities extends RunnerVersion {
	readonly scheduler: SchedulerKind;
	readonly containerRuntime?: string | null;
	readonly nextflowVersion?: string | null;
	readonly maxCollectBytes?: number;
	readonly diskQuotaBytes?: number;
	readonly loginNodeOnly?: boolean;
	readonly maxConcurrentJobs?: number;
	readonly features?: readonly string[];
}

export interface RunnerClientPort {
	readonly invoke: <TResult = unknown, TPayload = unknown>(
		command: RunnerCommand,
		payload: TPayload,
	) => Promise<TResult>;
	readonly negotiate: () => Promise<RunnerCapabilities>;
}

export type JobState =
	| "draft"
	| "authorized"
	| "prepared"
	| "submitting"
	| "queued"
	| "running"
	| "collecting"
	| "succeeded"
	| "failed"
	| "cancelling"
	| "cancelled"
	| "unknown"
	| "needs-login"
	| "needs_login"
	| "blocked"
	| "partial";

/** Mutable status snapshot used by the job state machine. */
export interface JobStatus {
	readonly jobId: string;
	readonly state: JobState;
	readonly updatedAt: string;
	readonly remoteId?: string;
	/** Scheduler id and remoteId are aliases during the runner migration. */
	readonly schedulerJobId?: string;
	readonly pid?: number;
	readonly processStartedAt?: string;
	readonly exitCode?: number;
	readonly message?: string;
	readonly logCursor?: string;
	readonly artifacts?: readonly (string | ArtifactRecord)[];
	readonly usage?: Readonly<Record<string, number>>;
	readonly resourcesUsed?: {
		readonly cpuSeconds?: number;
		readonly memoryBytes?: number;
		readonly wallTimeSeconds?: number;
	};
}

export interface RemoteJobStatus extends Omit<JobStatus, "jobId" | "updatedAt"> {
	readonly updatedAt?: string;
}

export const JOB_TERMINAL_STATES: readonly JobState[] = [
	"succeeded",
	"failed",
	"cancelled",
	"blocked",
	"partial",
];
export const JOB_TERMINAL_STATUSES = JOB_TERMINAL_STATES;
export function isTerminalJobState(state: JobState): boolean {
	return JOB_TERMINAL_STATES.includes(state);
}

export interface ResourceRequest {
	readonly cpus?: number;
	readonly memoryBytes?: number;
	readonly wallTimeSeconds?: number;
}

export interface WorkflowModuleRef {
	readonly id: string;
	readonly source: "nf-core" | "user" | "agent";
	readonly name: string;
	readonly version: string;
	readonly commit?: string;
	readonly containerDigest?: string;
}

export interface WorkflowStep {
	readonly id: string;
	readonly module: WorkflowModuleRef;
	readonly dependsOn?: readonly string[];
	readonly parameters?: Readonly<Record<string, string | number | boolean>>;
}

/** Compact workflow identity accepted by the runner when a compiled graph is already present. */
export interface WorkflowRef {
	readonly name: string;
	readonly version: string;
	readonly source?: string;
	readonly specHash?: string;
}

/** Declarative workflow input; there is intentionally no script or shell field. */
export interface WorkflowSpec {
	readonly version: 1;
	readonly modules: readonly WorkflowModuleRef[];
	readonly steps: readonly WorkflowStep[];
	readonly inputs?: Readonly<Record<string, string>>;
	readonly outputs?: readonly string[];
}

export interface JobSpec {
	readonly jobId: string;
	readonly idempotencyKey?: string;
	readonly hostAlias: string;
	readonly workflow: WorkflowSpec | WorkflowRef;
	readonly workDir?: string;
	readonly remoteWorkDir?: string;
	readonly resources?: ResourceRequest;
	readonly remoteRead?: readonly string[];
	readonly remoteWrite?: readonly string[];
	readonly outputs?: readonly (string | ArtifactExpectation)[];
}

export interface JobUsage {
	readonly cpus?: number;
	readonly cpuSeconds?: number;
	readonly wallTimeSeconds?: number;
	readonly memoryBytes?: number;
}

export interface JobRecord {
	readonly jobId: string;
	readonly hostAlias: string;
	readonly spec: JobSpec;
	readonly status: JobState;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly remoteId?: string;
	readonly pid?: number;
	readonly cursor?: string;
	readonly error?: RunnerError | string;
	readonly artifacts?: ArtifactManifest;
	readonly usage?: JobUsage;
}

export interface JobLogChunk {
	readonly jobId: string;
	readonly cursor: string;
	readonly nextCursor: string;
	readonly entries: readonly JobLogEntry[];
	readonly truncated?: boolean;
}

export interface JobLogEntry {
	readonly timestamp: number;
	readonly stream: "stdout" | "stderr" | "event";
	readonly text: string;
}

export interface ArtifactManifest {
	readonly version: 1;
	readonly entries: readonly ArtifactEntry[];
	readonly totalBytes?: number;
}

export interface ArtifactEntry {
	readonly path: string;
	readonly size?: number;
	/** `bytes` is the runner v1 spelling; `size` remains for stored manifests. */
	readonly bytes?: number;
	readonly sha256?: string;
	readonly kind?: "file" | "directory";
	readonly symlink?: boolean;
}

export interface ArtifactExpectation {
	readonly path: string;
	readonly bytes?: number;
	readonly sha256?: string;
	readonly maxBytes?: number;
}

export interface ArtifactManifestEntry {
	readonly path: string;
	readonly bytes?: number;
	readonly sha256?: string;
	readonly symlink?: boolean;
}

export interface ArtifactRecord {
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly symlink?: boolean;
}

export interface ArtifactValidationResult {
	readonly valid: boolean;
	readonly errors: readonly string[];
	readonly entries: readonly ArtifactRecord[];
	readonly totalBytes: number;
}

export interface ArtifactVerification {
	readonly path: string;
	readonly expectedSha256: string;
	readonly actualSha256?: string;
	readonly ok: boolean;
	readonly reason?: "invalid-path" | "size-mismatch" | "checksum-mismatch";
}

export interface JobEvent {
	readonly id: string;
	readonly jobId: string;
	readonly at: string;
	readonly type: "state" | "runner" | "log" | "artifact" | "reconcile" | "submission";
	readonly state?: JobState;
	readonly payload?: unknown;
}

export interface SubmissionRecord {
	readonly jobId: string;
	readonly idempotencyKey: string;
	readonly remoteId?: string;
	readonly pid?: number;
	readonly processStartedAt?: string;
	readonly submittedAt: string;
}

export type SubmissionOutcome =
	| { readonly kind: "submitted"; readonly record: SubmissionRecord }
	| { readonly kind: "already-submitted"; readonly record: SubmissionRecord }
	| { readonly kind: "unknown"; readonly reason: string };

export function isJobState(value: unknown): value is JobState {
	return (
		typeof value === "string" &&
		[
			"draft",
			"authorized",
			"prepared",
			"submitting",
			"queued",
			"running",
			"collecting",
			"succeeded",
			"failed",
			"cancelling",
			"cancelled",
			"unknown",
			"needs-login",
			"needs_login",
			"blocked",
			"partial",
		].includes(value)
	);
}

/** B3 declarative workflow graph types. They intentionally remain separate from
 * the B1 runner-facing WorkflowSpec, whose shape is persisted by the backend. */
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
	/** Fixture modules may be compiled and previewed, but cannot be submitted. */
	execution?: "ready" | "fixture";
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

export interface ComputeWorkflowStep {
	id: string;
	module: string;
	inputs: Readonly<Record<string, WorkflowReference>>;
	params?: Readonly<Record<string, string | number | boolean>>;
}

export interface ComputeWorkflowSpec {
	version: 1;
	id: string;
	name: string;
	entrypoint?: string;
	modules?: readonly string[];
	inputs: readonly WorkflowInput[];
	steps: readonly ComputeWorkflowStep[];
	outputs: readonly WorkflowOutput[];
	parameters?: Readonly<Record<string, string | number | boolean>>;
	metadata?: Readonly<Record<string, string>>;
}

export type WorkflowNode = ComputeWorkflowStep;

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
	executionMode: "ready" | "fixture";
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

export interface ComputeWorkflowJobSpec {
	jobId: string;
	host: string;
	workflow: CompiledWorkflow;
	executor: ExecutorConfig;
	remoteRead: readonly string[];
	remoteWrite: readonly string[];
	authorization: ComputeAuthorization;
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
	executionMode: "ready" | "fixture";
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
