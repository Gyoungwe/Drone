import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stableJson } from "@drone/compute";
import type {
	AnalysisContext,
	AnalysisExecutionContext,
	AnalysisMode,
	AnalysisProvenance,
	AnalysisReadinessInput,
	AnalysisReview,
	AnalysisReviewCheck,
} from "@drone/shared";
import { capabilityLoadRequest } from "@drone/shared";
import type { CapabilityRuntime } from "../capabilities/runtime";
import {
	type AnalysisAdapterRegistry,
	adapterSnapshotSha256,
	createAnalysisAdapterRegistry,
} from "./analysis-adapters";
import { readAnalysisArtifacts, type VerifiedAnalysisArtifact } from "./analysis-artifacts";
import type { AnalysisOrchestrationService } from "./analysis-orchestration";
import { unavailableAnalysisReview } from "./analysis-review-decision";
import type { ComputeServicePort } from "./compute";
import { assertComputePreflight, type ComputePreflightJobSpec } from "./compute-preflight";

export interface AnalysisTaskControllerOptions {
	readonly analysis: AnalysisOrchestrationService;
	readonly compute: Pick<ComputeServicePort, "submit" | "status"> &
		Partial<Pick<ComputeServicePort, "collect">>;
	/** Session-bound runtime; activation uses the same path as capability_load. */
	readonly capabilityRuntime: Pick<CapabilityRuntime, "activate">;
	/** Model-backed result review supplied by the host composition root. */
	readonly reviewer?: AnalysisResultReviewer;
	readonly adapters?: AnalysisAdapterRegistry;
}

export interface AnalysisComputeSubmission {
	readonly context: AnalysisContext;
	readonly job: Awaited<ReturnType<ComputeServicePort["submit"]>>;
}

export interface AnalysisReviewArtifact {
	readonly path: string;
	readonly bytes?: number;
	readonly sha256?: string;
	readonly text?: string;
}

export interface AnalysisReviewRequest {
	readonly context: AnalysisContext;
	readonly jobId: string;
	readonly workflow: unknown;
	readonly artifacts: readonly AnalysisReviewArtifact[];
	readonly limitations: readonly string[];
	readonly checks: readonly AnalysisReviewCheck[];
	readonly reviewInstructions: string;
}

export interface AnalysisReviewDecision {
	readonly approved: boolean;
	readonly detail: string;
	readonly reportMarkdown: string;
}

export type AnalysisResultReviewer = (request: AnalysisReviewRequest) => Promise<AnalysisReviewDecision>;

/** A blocked analysis never reaches ComputeService or an executor. */
export class AnalysisTaskGateError extends Error {
	readonly code = "analysis_task_gate_blocked" as const;
	readonly context: AnalysisContext;

	constructor(message: string, context: AnalysisContext) {
		super(message);
		this.name = "AnalysisTaskGateError";
		this.context = context;
	}
}

/**
 * Host controller for versioned analysis adapters.
 *
 * The durable orchestration service remains the source of truth. This adapter
 * adds the two host effects that must happen at the boundary: loading the
 * capabilities required by the current stage and running Compute preflight
 * before a job can be submitted.
 */
export class AnalysisTaskController {
	private readonly analysis: AnalysisOrchestrationService;
	private readonly compute: Pick<ComputeServicePort, "submit" | "status"> &
		Partial<Pick<ComputeServicePort, "collect">>;
	private readonly capabilityRuntime: Pick<CapabilityRuntime, "activate">;
	private readonly reviewer?: AnalysisResultReviewer;
	private readonly adapters: AnalysisAdapterRegistry;

	constructor(options: AnalysisTaskControllerOptions) {
		this.analysis = options.analysis;
		this.compute = options.compute;
		this.capabilityRuntime = options.capabilityRuntime;
		this.reviewer = options.reviewer;
		this.adapters = options.adapters ?? createAnalysisAdapterRegistry();
	}

	async create(input: {
		id: string;
		question: string;
		assay: string;
		mode: AnalysisMode;
	}): Promise<AnalysisContext> {
		const adapter = this.adapters.resolve(input.assay);
		return this.sync(await this.analysis.create({ ...input, adapter: adapter.identity }));
	}

	async recordDesign(id: string, detail?: string): Promise<AnalysisContext> {
		return this.sync(await this.analysis.recordDesign(id, detail));
	}

	/** Host evidence is bound to the exact submitted records, workflow and resources. */
	async prepareCompute(
		id: string,
		spec: ComputePreflightJobSpec,
		evidence: Pick<AnalysisReadinessInput, "destructiveOperation" | "publicationRequested"> & {
			readonly [key: string]: unknown;
		},
	): Promise<AnalysisContext> {
		const context = await this.requireContext(id);
		if (!spec.jobId || !spec.dataDesign || !spec.authorization)
			throw new Error("Analysis tasks require a stable job id, data-design records and host authorization");
		assertComputePreflight(spec);
		const adapter = this.adapters.resolve(context.assay, context.adapter);
		const plan = adapter.buildPlan(context, spec, evidence);
		const adapterHash = plan.adapterSnapshotSha256 || adapterSnapshotSha256(adapter);
		const toolContractSha256 = hashValue({
			adapterSnapshotSha256: adapterHash,
			workflow: spec.workflow,
			outputs: spec.outputs,
		});
		const executionContext = observedExecutionContext(evidence);
		return this.sync(
			await this.analysis.assessReadiness(
				id,
				{
					mode: context.mode,
					assay: context.assay,
					assessment: plan.assessment,
					computeAuthorized: true,
					destructiveOperation: evidence.destructiveOperation,
					publicationRequested: evidence.publicationRequested,
				},
				{
					jobId: spec.jobId,
					specSha256: submissionHash(spec),
					adapter: adapter.identity,
					workflow: workflowIdentity(spec),
					method: plan.method,
					adapterSnapshotSha256: adapterHash,
					toolContractSha256,
					...(executionContext ? { executionContext } : {}),
					requiredOutputs: plan.requiredOutputs,
					inputs: inputArtifacts(spec),
				},
			),
		);
	}

	async approveExecution(id: string): Promise<AnalysisContext> {
		return this.sync(await this.analysis.approveExecution(id));
	}

	async recordExecution(id: string, result: { ok: boolean; detail?: string }): Promise<AnalysisContext> {
		return this.sync(await this.analysis.recordExecution(id, result));
	}

	async finishReview(
		id: string,
		input: { outputsVerified: boolean; detail?: string; review?: AnalysisReview },
	): Promise<AnalysisContext> {
		return this.sync(await this.analysis.finishReview(id, input));
	}

	/** Collect verified outputs, run the host model review, and close delivery. */
	async reviewAndDeliver(
		id: string,
		input: { targetDir: string; expected: readonly string[] },
	): Promise<{
		readonly context: AnalysisContext;
		readonly reportPath?: string;
		readonly artifacts: readonly AnalysisReviewArtifact[];
	}> {
		const context = await this.requireContext(id);
		if (context.stage !== "review" || context.status !== "active")
			throw new AnalysisTaskGateError(`Analysis ${id} is not ready for result review`, context);
		const limitations = context.readiness?.warnings ?? [];
		let artifacts: readonly VerifiedAnalysisArtifact[] = [];
		let checks: readonly AnalysisReviewCheck[] = [];
		try {
			const binding = await this.analysis.getComputeBinding(id);
			if (!binding?.adapter || !context.provenance)
				throw new Error("Missing versioned Compute binding; legacy runs require an explicit revised plan");
			const adapter = this.adapters.resolve(context.assay, binding.adapter);
			const job = await this.compute.status(binding.jobId);
			if (
				job.jobId !== binding.jobId ||
				job.status !== "succeeded" ||
				submissionHash(job.spec) !== binding.specSha256
			)
				throw new Error("Compute receipt does not match the successful bound specification");
			if (!this.compute.collect) throw new Error("Compute artifact collection is not configured");
			const targetDir = resolve(input.targetDir);
			const expected = [...new Set([...binding.requiredOutputs, ...input.expected])];
			const collection = await this.compute.collect(binding.jobId, { targetDir, expected });
			artifacts = await readAnalysisArtifacts(targetDir, collection.manifest);
			checks = [
				{
					id: "required-outputs",
					passed:
						expected.length > 0 &&
						expected.every((path) => artifacts.some((artifact) => artifact.path === path)),
					detail: "All predeclared outputs must be collected and checksum-verified",
				},
				...adapter.reviewResults(context, artifacts),
			];
			const deterministicOk = checks.every((check) => check.passed);
			let decision: AnalysisReviewDecision;
			try {
				decision = this.reviewer
					? await this.reviewer({
							context,
							jobId: binding.jobId,
							workflow: job.spec.workflow,
							artifacts,
							limitations,
							checks,
							reviewInstructions: adapter.reviewInstructions,
						})
					: unavailableAnalysisReview("No model reviewer is configured");
				if (
					typeof decision.approved !== "boolean" ||
					!decision.detail?.trim() ||
					!decision.reportMarkdown?.trim()
				)
					decision = unavailableAnalysisReview("Model reviewer returned an incomplete decision");
			} catch (error) {
				decision = unavailableAnalysisReview(`Model review failed: ${String(error).slice(0, 300)}`);
			}
			const approved = decision.approved && deterministicOk;
			const detail = deterministicOk
				? decision.detail
				: "Deterministic result checks failed; delivery is paused";
			const reportText = `${decision.reportMarkdown.trim()}\n\n## Controller decision\n${approved ? "Approved for delivery" : "Paused"}: ${detail}\n\n## Checks\n${checks.map((check) => `- ${check.passed ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`).join("\n")}${limitations.length ? `\n\n## Limitations\n${limitations.map((item) => `- ${item}`).join("\n")}` : ""}\n`;
			await mkdir(targetDir, { recursive: true });
			const reportHash = createHash("sha256").update(reportText).digest("hex");
			const reportPath = join(targetDir, `analysis-review-${reportHash}.md`);
			await writeFile(reportPath, reportText, "utf8");
			const outputs = artifacts.map((artifact) => ({
				artifactId: `${binding.jobId}:${artifact.path}`,
				versionId: `sha256:${artifact.sha256}`,
				path: artifact.path,
				sha256: artifact.sha256,
				bytes: artifact.bytes,
				role: "output" as const,
				parentVersionIds: binding.inputs.map((item) => item.versionId),
				producedByJobId: binding.jobId,
			}));
			const provenance: AnalysisProvenance = {
				...context.provenance,
				artifacts: [
					...binding.inputs,
					...outputs,
					{
						artifactId: `${id}:review`,
						versionId: `sha256:${reportHash}`,
						path: reportPath,
						sha256: reportHash,
						bytes: Buffer.byteLength(reportText),
						role: "review",
						parentVersionIds: outputs.map((item) => item.versionId),
					},
				],
				reproducibility: {
					status: "recorded",
					detail:
						"Pinned workflow/method and checksummed input/output lineage recorded; independent rerun and environment equivalence remain unverified",
				},
			};
			const review: AnalysisReview = {
				approved,
				detail,
				limitations,
				reportPath,
				checks,
				modelStatus: this.reviewer ? (decision.approved ? "approved" : "rejected") : "unavailable",
			};
			const reviewed = await this.analysis.finishReview(id, {
				outputsVerified: deterministicOk,
				detail,
				review,
				provenance,
			});
			if (!approved) return { context: this.sync(reviewed), reportPath, artifacts };
			this.sync(reviewed);
			const completed = await this.analysis.complete(id, {
				publicationApproved: !reviewed.publicationRequested,
				detail: `Model review completed; report saved to ${reportPath}`,
			});
			return { context: this.sync(completed), reportPath, artifacts };
		} catch (error) {
			const current = await this.requireContext(id);
			if (current.stage !== "review" || current.status !== "active") throw error;
			const detail = `Result evidence could not be verified: ${String(error).slice(0, 500)}`;
			const paused = await this.analysis.finishReview(id, {
				outputsVerified: false,
				detail,
				review: { approved: false, detail, limitations, checks, modelStatus: "unavailable" },
			});
			return { context: this.sync(paused), artifacts };
		}
	}

	async complete(
		id: string,
		input: { publicationApproved?: boolean; detail?: string } = {},
	): Promise<AnalysisContext> {
		return this.sync(await this.analysis.complete(id, input));
	}

	async resume(id: string): Promise<AnalysisContext> {
		return this.sync(await this.analysis.resume(id));
	}

	/**
	 * Validate the analysis gate and B7 Compute contract before delegating to
	 * ComputeService. This method intentionally does not advance the analysis
	 * to review; the controller records that only after terminal job evidence.
	 */
	async submitCompute(id: string, spec: ComputePreflightJobSpec): Promise<AnalysisComputeSubmission> {
		const context = await this.analysis.get(id);
		if (!context) throw new Error(`Analysis not found: ${id}`);
		if (context.stage !== "execution" || context.status !== "active" || !context.readiness?.ok) {
			throw new AnalysisTaskGateError(
				`Analysis ${id} is not approved for Compute execution (${context.stage}/${context.status})`,
				context,
			);
		}
		// ComputeService repeats this check defensively; keeping it here makes the
		// controller's side-effect boundary explicit and testable for injected ports.
		const binding = await this.analysis.getComputeBinding(id);
		if (!binding?.adapter || !context.adapter || binding.specSha256 !== submissionHash(spec))
			throw new AnalysisTaskGateError(
				"Compute specification differs from the assessed analysis; prepare a revised plan",
				context,
			);
		this.adapters.resolve(context.assay, binding.adapter);
		assertComputePreflight(spec);
		this.sync(context);
		const job = await this.compute.submit(spec);
		return { context, job };
	}

	/** The exact request that would be sent to capability_load for this run. */
	async capabilityRequest(id: string): Promise<ReturnType<typeof capabilityLoadRequest>> {
		const context = await this.analysis.get(id);
		if (!context) throw new Error(`Analysis not found: ${id}`);
		return capabilityLoadRequest(context);
	}

	/** Only observed terminal Compute status may finish execution. Unknown remains pending. */
	async reconcile(id: string): Promise<AnalysisContext> {
		const context = await this.requireContext(id);
		if (context.stage !== "execution" || context.status !== "active") return this.sync(context);
		const binding = await this.analysis.getComputeBinding(id);
		if (!binding?.adapter) throw new AnalysisTaskGateError("No versioned bound Compute job", context);
		this.adapters.resolve(context.assay, binding.adapter);
		const job = await this.compute.status(binding.jobId);
		if (job.jobId !== binding.jobId || submissionHash(job.spec) !== binding.specSha256)
			throw new Error("Compute returned a different job or specification");
		if (job.status === "succeeded")
			return this.recordExecution(id, {
				ok: true,
				detail: `Compute ${job.jobId}: succeeded; outputs still require review`,
			});
		if (["failed", "cancelled", "blocked", "partial"].includes(job.status))
			return this.recordExecution(id, { ok: false, detail: `Compute ${job.jobId}: ${job.status}` });
		return this.sync(context);
	}

	private async requireContext(id: string): Promise<AnalysisContext> {
		const context = await this.analysis.get(id);
		if (!context) throw new Error(`Analysis not found: ${id}`);
		return context;
	}

	private sync(context: AnalysisContext): AnalysisContext {
		if (this.capabilityRuntime) {
			const request = capabilityLoadRequest(context);
			this.capabilityRuntime.activate(request.capabilities, request.task);
		}
		return context;
	}
}

function submissionHash(spec: ComputePreflightJobSpec): string {
	return createHash("sha256").update(stableJson(spec)).digest("hex");
}

function workflowIdentity(spec: ComputePreflightJobSpec): { id: string; version: string } {
	const workflow = spec.workflow;
	return "name" in workflow
		? { id: workflow.name, version: workflow.version }
		: {
				id: "workflow-spec",
				version: `sha256:${createHash("sha256").update(stableJson(workflow)).digest("hex")}`,
			};
}

function inputArtifacts(spec: ComputePreflightJobSpec) {
	const files = spec.dataDesign?.dataset.files ?? [];
	return files.map((file) => ({
		artifactId: `${spec.dataDesign?.dataset.datasetId}:${file.path}`,
		versionId: `sha256:${file.sha256}`,
		path: file.path,
		sha256: file.sha256,
		bytes: file.bytes,
		role: "input" as const,
		parentVersionIds: [],
	}));
}

function hashValue(value: unknown): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

function observedExecutionContext(value: Record<string, unknown>): AnalysisExecutionContext | undefined {
	const raw = value.executionContext;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const record = raw as Record<string, unknown>;
	const values: Record<string, string | number | boolean | null> = {};
	for (const [key, item] of Object.entries(record)) {
		if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null)
			values[key] = item;
	}
	if (!Object.keys(values).length) return undefined;
	return {
		schemaVersion: 1,
		revision: hashValue(values),
		observedAt: new Date().toISOString(),
		source: "host",
		values,
	};
}
