import { createHash } from "node:crypto";
import {
	type CompiledWorkflow,
	type ComputeWorkflowSpec,
	compileWorkflow,
	createRnaseqWorkflowSpec,
	type JobRecord,
	type JobSpec,
	type JobState,
	type ResourceRequest,
	RNASEQ_PIPELINE,
	RNASEQ_REVISION,
	RNASEQ_TEST_PROFILE,
	rnaseqModuleCatalog,
	validateWorkflowSpec,
	type WorkflowRef,
} from "@drone/compute";
import type {
	ComputeTaskBinding,
	ExecutionReceipt,
	ExecutionReceiptStatus,
	ExecutionRoute,
} from "@drone/shared";
import type { ComputeJobInput, ComputeServicePort } from "./compute";

const MAX_INTENT_LENGTH = 400;
const FIXTURE_HOST = "fixture-local";

/** Input accepted by the route resolver. The route remains deterministic for a given value. */
export interface RnaseqIntentInput {
	readonly intent: string;
	readonly samplesheet?: string;
	readonly taskId?: string;
	readonly hostAlias?: string;
	readonly profile?: string;
	readonly genome?: string;
	readonly strandedness?: "unstranded" | "forward" | "reverse";
	readonly executionMode?: "fixture" | "production";
	readonly remoteWorkDir?: string;
	readonly outdir?: string;
	/** Optional scheduler request; omitted means the registered host/profile chooses it. */
	readonly resources?: ResourceRequest;
}

export interface RnaseqExecutionPlan {
	readonly route: ExecutionRoute;
	readonly workflowSpec: ComputeWorkflowSpec;
	readonly compiledWorkflow: CompiledWorkflow;
	readonly binding: ComputeTaskBinding;
	readonly job: JobSpec;
}

export interface RnaseqPreflight {
	readonly ok: boolean;
	readonly route?: ExecutionRoute;
	readonly workflowSpec?: ComputeWorkflowSpec;
	readonly compiledWorkflow?: CompiledWorkflow;
	readonly binding?: ComputeTaskBinding;
	readonly job?: JobSpec;
	readonly workflowSpecSha256?: string;
	readonly errors: readonly string[];
	readonly warnings: readonly string[];
}

export interface RnaseqSubmitResult {
	readonly jobId?: string;
	readonly remoteId?: string;
	readonly status?: JobState | "submitted";
	readonly error?: string;
}

export type RnaseqSubmitter = (spec: ComputeJobInput) => Promise<RnaseqSubmitResult | JobRecord>;

export interface RnaseqExecutionServiceOptions {
	/** A real ComputeService or a small test/fixture submit port. */
	readonly compute?: Pick<ComputeServicePort, "submit">;
	readonly submit?: RnaseqSubmitter;
	readonly now?: () => Date;
}

function cleanIntent(value: string): string {
	if (typeof value !== "string") throw new Error("RNA-seq intent must be text");
	const intent = value.replace(/\s+/gu, " ").trim();
	if (!intent || intent.length > MAX_INTENT_LENGTH) throw new Error("RNA-seq intent is empty or too long");
	return intent;
}

function safeIdentifier(value: string, label: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new Error(`Invalid ${label}`);
	return value;
}

function safeBoundedToken(value: string, label: string, maxLength: number): string {
	if (value.length < 1 || value.length > maxLength || !/^[A-Za-z0-9_.-]+$/u.test(value))
		throw new Error(`Invalid ${label}`);
	return value;
}

function safePath(value: string, label: string): string {
	if (!value || value.length > 1024 || value.includes("\0") || value.startsWith("-") || value.includes(".."))
		throw new Error(`${label} must be a bounded path`);
	return value;
}

function safeAbsolutePath(value: string, label: string): string {
	const checked = safePath(value, label);
	if (!checked.startsWith("/"))
		throw new Error(`${label} must be an absolute remote path for production execution`);
	return checked;
}

function safeRunnerOutputPath(value: string, label: string): string {
	const checked = safePath(value, label);
	if (checked.startsWith("/"))
		throw new Error(`${label} must be relative to the runner output root for production execution`);
	return checked;
}

function safeResources(value: ResourceRequest | undefined): ResourceRequest | undefined {
	if (!value) return undefined;
	const entries: Array<[keyof ResourceRequest, number | undefined]> = [
		["cpus", value.cpus],
		["memoryBytes", value.memoryBytes],
		["wallTimeSeconds", value.wallTimeSeconds],
	];
	for (const [label, amount] of entries) {
		if (amount === undefined) continue;
		if (!Number.isSafeInteger(amount) || amount <= 0)
			throw new Error(`RNA-seq ${label} must be a positive safe integer when provided`);
	}
	return { ...value };
}

function parameterFromIntent(intent: string, pattern: RegExp): string | undefined {
	const match = pattern.exec(intent);
	return match?.[1] ? match[1].replace(/[),.;]+$/gu, "") : undefined;
}

function taskIdFor(input: RnaseqIntentInput, route: ExecutionRoute): string {
	if (input.taskId) return safeIdentifier(input.taskId, "task id");
	const fingerprint = createHash("sha256")
		.update(
			JSON.stringify({
				intent: route.intent,
				route,
				hostAlias: input.hostAlias,
				remoteWorkDir: input.remoteWorkDir,
				outdir: input.outdir,
				resources: input.resources,
				executionMode: input.executionMode ?? "production",
			}),
		)
		.digest("hex")
		.slice(0, 20);
	return `rnaseq-${fingerprint}`;
}

function workflowRef(spec: ComputeWorkflowSpec, specHash: string): WorkflowRef {
	const parameters = Object.fromEntries(
		Object.entries(spec.parameters ?? {}).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
	const profile = spec.steps.find((step) => step.module === RNASEQ_PIPELINE)?.params?.profile;
	return {
		name: RNASEQ_PIPELINE,
		version: RNASEQ_REVISION,
		source: "nf-core",
		specHash,
		...(typeof profile === "string" ? { profile } : {}),
		...(Object.keys(parameters).length > 0 ? { parameters } : {}),
	};
}

function statusFromSubmit(value: RnaseqSubmitResult | JobRecord): ExecutionReceiptStatus {
	if (value.error) return "failed";
	const status = value.status;
	if (status === "failed") return "failed";
	if (status === "running") return "running";
	if (status === "succeeded") return "succeeded";
	if (status === "queued" || status === "prepared" || status === "submitting") return "queued";
	if (status === "submitted") return "submitted";
	if (status === "blocked") return "blocked";
	if (status === "cancelled") return "failed";
	if (status === "unknown") return "unknown";
	return "submitted";
}

/**
 * Resolve only the supported RNA-seq intent. Returning null is intentional:
 * callers can hand unrelated requests back to the normal task router.
 */
export function routeRnaseqIntent(
	input: string | RnaseqIntentInput,
	options: Omit<RnaseqIntentInput, "intent"> = {},
): ExecutionRoute | null {
	const value: RnaseqIntentInput = typeof input === "string" ? { ...options, intent: input } : input;
	const intent = cleanIntent(value.intent);
	// Single-cell and counts-stage requests belong to different workflows.
	if (
		/(?:single[- ]?cell|scrna|sc\s*rna|单细胞|counts?\s*(?:matrix|data)|计数矩阵|from\s+counts|counts[- ]stage|已有\s*counts)/iu.test(
			intent,
		)
	)
		return null;
	if (!/(?:rna(?:[- ]?seq(?:uencing)?|\s+sequencing)|rna测序|转录组|转录组学|transcriptom)/iu.test(intent))
		return null;
	if (/(?:differential|差异|deSeq2|富集|pathway|火山图|gsea)/iu.test(intent)) return null;
	const samplesheetValue =
		value.samplesheet ??
		parameterFromIntent(
			intent,
			/(?:samplesheet|sample\s*sheet|样本表)\s*(?:=|:|是|为|of|is|at)?\s*([^\s,;]+)/iu,
		);
	if (!samplesheetValue) throw new Error("RNA-seq samplesheet is required; provide the staged remote path");
	const samplesheet = safePath(samplesheetValue, "RNA-seq samplesheet");
	const profile =
		value.profile ??
		parameterFromIntent(intent, /(?:profile|配置)\s*(?:=|:|是|为|is)?\s*([A-Za-z0-9_.-]+)/iu) ??
		RNASEQ_TEST_PROFILE;
	safeBoundedToken(profile, "RNA-seq profile", 64);
	const genome =
		value.genome ??
		parameterFromIntent(intent, /(?:genome|参考基因组|基因组)\s*(?:=|:|是|为|is)?\s*([A-Za-z0-9_.-]+)/iu);
	if (genome) safeBoundedToken(genome, "RNA-seq genome", 128);
	if (value.strandedness && !["unstranded", "forward", "reverse"].includes(value.strandedness))
		throw new Error("Invalid RNA-seq strandedness");
	return {
		version: 1,
		routeId: "rnaseq",
		intent,
		workflow: "rnaseq",
		pipeline: RNASEQ_PIPELINE,
		inputStage: "fastq",
		profile,
		samplesheet,
		...(genome ? { genome } : {}),
		...(value.outdir ? { outdir: safePath(value.outdir, "RNA-seq output directory") } : {}),
		...(value.remoteWorkDir
			? { remoteWorkDir: safePath(value.remoteWorkDir, "RNA-seq remote work directory") }
			: {}),
		...(value.strandedness ? { strandedness: value.strandedness } : {}),
	};
}

/** Alias used by host code that treats all intent resolvers uniformly. */
export const routeExecutionIntent = routeRnaseqIntent;

/** Build and validate the immutable B3 graph before any submit side effect. */
export function planRnaseqExecution(input: string | RnaseqIntentInput): RnaseqExecutionPlan {
	const normalized: RnaseqIntentInput = typeof input === "string" ? { intent: input } : input;
	const route = routeRnaseqIntent(normalized);
	if (!route) throw new Error("Intent is not a supported bulk RNA-seq execution request");
	const executionMode = normalized.executionMode ?? "production";
	if (executionMode !== "fixture" && executionMode !== "production")
		throw new Error("Invalid RNA-seq execution mode");
	if (executionMode === "production" && !normalized.hostAlias)
		throw new Error("Production RNA-seq execution requires a registered host alias");
	const hostAlias = safeIdentifier(normalized.hostAlias ?? FIXTURE_HOST, "compute host alias");
	const resources = safeResources(normalized.resources);
	const remoteWorkDir = normalized.remoteWorkDir
		? executionMode === "production"
			? safeAbsolutePath(normalized.remoteWorkDir, "RNA-seq remote work directory")
			: safePath(normalized.remoteWorkDir, "RNA-seq remote work directory")
		: undefined;
	const outdir = normalized.outdir
		? executionMode === "production"
			? safeRunnerOutputPath(normalized.outdir, "RNA-seq output directory")
			: safePath(normalized.outdir, "RNA-seq output directory")
		: undefined;
	if (executionMode === "production" && !route.samplesheet.startsWith("/"))
		throw new Error("Production RNA-seq execution requires an absolute staged remote samplesheet path");
	if (executionMode === "production" && !outdir)
		throw new Error(
			"Production RNA-seq execution requires an output directory relative to the runner output root",
		);
	const workflowSpec = createRnaseqWorkflowSpec({
		samplesheet: route.samplesheet,
		profile: route.profile,
		...(route.genome ? { genome: route.genome } : {}),
		...(route.strandedness ? { strandedness: route.strandedness } : {}),
		...(outdir ? { outdir } : {}),
	});
	const catalog = rnaseqModuleCatalog();
	const validation = validateWorkflowSpec(workflowSpec, catalog);
	if (!validation.ok || !validation.workflowSpecSha256)
		throw new Error(
			validation.errors.map((issue) => issue.message).join("; ") || "RNA-seq workflow validation failed",
		);
	const compiledWorkflow = compileWorkflow(workflowSpec, catalog);
	const taskId = taskIdFor(normalized, route);
	const idempotencyKey = `execution:${taskId}:${validation.workflowSpecSha256.slice(0, 16)}`;
	const binding: ComputeTaskBinding = {
		version: 1,
		taskId,
		routeId: route.routeId,
		workflowId: workflowSpec.id as "rnaseq",
		pipeline: route.pipeline,
		hostAlias,
		workflowSpecSha256: validation.workflowSpecSha256,
		samplesheet: route.samplesheet,
		...(outdir ? { outdir } : {}),
		...(remoteWorkDir ? { remoteWorkDir } : {}),
		revision: RNASEQ_REVISION,
		profile: route.profile,
		executionMode,
		idempotencyKey,
	};
	const job: JobSpec = {
		jobId: taskId,
		idempotencyKey,
		hostAlias,
		workflow: workflowRef(workflowSpec, validation.workflowSpecSha256),
		...(remoteWorkDir ? { remoteWorkDir } : {}),
		...(resources ? { resources } : {}),
		remoteRead: [route.samplesheet],
		...(outdir ? { remoteWrite: [outdir] } : {}),
		...(executionMode === "fixture"
			? { outputs: ["results/multiqc_report.html", "results/counts.tsv"] }
			: {}),
	};
	return { route, workflowSpec, compiledWorkflow, binding, job };
}

/** A pure preflight projection suitable for a plan/proposal card. */
export function preflightRnaseqExecution(input: string | RnaseqIntentInput): RnaseqPreflight {
	try {
		const plan = planRnaseqExecution(input);
		const warnings =
			plan.binding.executionMode === "fixture"
				? ["Fixture execution is a deterministic demo and is not a production scientific result."]
				: [];
		return {
			ok: true,
			...plan,
			workflowSpecSha256: plan.binding.workflowSpecSha256,
			errors: [],
			warnings,
		};
	} catch (error) {
		return {
			ok: false,
			errors: [error instanceof Error ? error.message : String(error)],
			warnings: [],
		};
	}
}

/** Alias for callers that expose a generic execution preflight endpoint. */
export const preflightExecution = preflightRnaseqExecution;

function fixtureSubmitter(): RnaseqSubmitter {
	return async (spec) => ({
		jobId: spec.jobId,
		remoteId: `fixture:${spec.jobId}`,
		status: "succeeded",
	});
}

/**
 * Backend execution seam. With no submitter it runs the deterministic fixture
 * (the default for demos/tests); a ComputeService can be injected for a real
 * host without changing routing or the immutable plan.
 */
export class RnaseqExecutionService {
	private readonly submitter: RnaseqSubmitter;
	private readonly fixtureFallback: boolean;
	private readonly now: () => Date;

	constructor(options: RnaseqExecutionServiceOptions = {}) {
		const compute = options.compute;
		this.fixtureFallback = !options.submit && !compute;
		this.submitter =
			options.submit ?? (compute ? (spec) => compute.submit(spec).then((job) => job) : fixtureSubmitter());
		this.now = options.now ?? (() => new Date());
	}

	async execute(input: string | RnaseqIntentInput): Promise<ExecutionReceipt> {
		const preflight = preflightRnaseqExecution(input);
		const createdAt = this.now().toISOString();
		if (
			!preflight.ok ||
			!preflight.route ||
			!preflight.binding ||
			!preflight.job ||
			!preflight.workflowSpecSha256
		)
			return {
				version: 1,
				executionId: `rnaseq-blocked-${createHash("sha256")
					.update(String(typeof input === "string" ? input : input.intent))
					.digest("hex")
					.slice(0, 16)}`,
				status: "blocked",
				fixture: typeof input === "string" ? true : input.executionMode !== "production",
				workflowSpecSha256: preflight.workflowSpecSha256 ?? "0".repeat(64),
				preflight: { ok: false, errors: [...preflight.errors], warnings: [...preflight.warnings] },
				createdAt,
				error: preflight.errors.join("; "),
			};
		const fixture = preflight.binding.executionMode === "fixture";
		if (preflight.binding.executionMode === "production" && this.fixtureFallback) {
			const message = "Production RNA-seq execution requires an injected ComputeService or submitter";
			return {
				version: 1,
				executionId: preflight.binding.taskId,
				status: "blocked",
				fixture: false,
				route: preflight.route,
				binding: preflight.binding,
				workflowSpecSha256: preflight.binding.workflowSpecSha256,
				preflight: { ok: false, errors: [message], warnings: [...preflight.warnings] },
				createdAt,
				error: message,
			};
		}
		try {
			const result = await this.submitter(preflight.job);
			const receiptStatus = statusFromSubmit(result);
			const finishedAt = ["succeeded", "failed"].includes(receiptStatus)
				? this.now().toISOString()
				: undefined;
			const record = result as RnaseqSubmitResult & Partial<JobRecord>;
			return {
				version: 1,
				executionId: preflight.binding.taskId,
				status: receiptStatus,
				fixture,
				route: preflight.route,
				binding: preflight.binding,
				workflowSpecSha256: preflight.binding.workflowSpecSha256,
				preflight: { ok: true, errors: [], warnings: [...preflight.warnings] },
				jobId: record.jobId ?? preflight.job.jobId,
				...(record.remoteId ? { remoteId: record.remoteId } : {}),
				createdAt,
				submittedAt: createdAt,
				...(finishedAt ? { finishedAt } : {}),
				...(record.error ? { error: String(record.error) } : {}),
			};
		} catch (error) {
			return {
				version: 1,
				executionId: preflight.binding.taskId,
				status: "failed",
				fixture,
				route: preflight.route,
				binding: preflight.binding,
				workflowSpecSha256: preflight.binding.workflowSpecSha256,
				preflight: { ok: true, errors: [], warnings: [...preflight.warnings] },
				jobId: preflight.job.jobId,
				createdAt,
				submittedAt: createdAt,
				finishedAt: this.now().toISOString(),
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/** Naming alias for hosts that model execution as a submit operation. */
	submit(input: string | RnaseqIntentInput): Promise<ExecutionReceipt> {
		return this.execute(input);
	}

	/** Naming alias for small CLI/demo hosts. */
	run(input: string | RnaseqIntentInput): Promise<ExecutionReceipt> {
		return this.execute(input);
	}
}

export function createRnaseqExecutionService(
	options: RnaseqExecutionServiceOptions = {},
): RnaseqExecutionService {
	return new RnaseqExecutionService(options);
}

/** One-call offline demo: route, preflight and complete the fixture. */
export function executeRnaseqFixture(input: string | RnaseqIntentInput): Promise<ExecutionReceipt> {
	return new RnaseqExecutionService().execute(
		typeof input === "string" ? input : { ...input, executionMode: "fixture" },
	);
}

export const runRnaseqFixture = executeRnaseqFixture;
