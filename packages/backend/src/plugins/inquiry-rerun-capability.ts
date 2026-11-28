import { Type } from "typebox";
import { canonicalProjectId } from "../project-id";
import { hostText } from "../reply-language";
import type { ComputeServicePort } from "../services/compute";
import type { ComputeHostAdapter } from "../services/compute-adapter";
import { computeInquiryMetadata, type InquiryRunProvenanceSummary } from "../services/inquiry-events";
import type { SessionDirectory } from "../session/registry";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";
import { requirePluginSession } from "./session-caller";

export interface InquiryArtifactProvenance {
	readonly artifact: {
		readonly id: string;
		readonly projectId: string;
		readonly path: string;
		readonly sha256: string;
		readonly runId?: string;
		readonly runProvenance?: InquiryRunProvenanceSummary;
	};
	readonly parentChain?: readonly unknown[];
	readonly parentChainTruncated?: boolean;
	readonly attempts?: readonly { readonly parameters?: Readonly<Record<string, unknown>> }[];
	readonly runProvenance?: InquiryRunProvenanceSummary;
	readonly sourceSessionId?: string;
	readonly sourceTurn?: number;
	readonly reproducibility: "reproducible" | "partial" | "not-reproducible";
	readonly rerun?: Readonly<Record<string, unknown>>;
}

export interface InquiryRerunResult {
	readonly status: "submitted" | "running" | "reproduced" | "superseded" | "failed";
	readonly jobId: string;
	readonly previousArtifactId: string;
	readonly previousSha256: string;
	readonly artifactId?: string;
	readonly sha256?: string;
	readonly difference?: string;
	readonly error?: string;
}

export interface VerifiedInquiryRerun {
	readonly originalJobId: string;
	readonly workflow?: string;
}

export interface InquiryRerunPort {
	verifyRerun(
		artifactId: string,
		projectId: string,
		provenance: InquiryArtifactProvenance,
	): Promise<VerifiedInquiryRerun>;
	rerunArtifact(
		artifactId: string,
		projectId: string,
		provenance: InquiryArtifactProvenance,
	): Promise<InquiryRerunResult>;
}

export interface InquiryRerunCapabilityHost {
	readonly inquiry: InquiryRerunPort;
	readonly sessions: SessionDirectory;
}

interface InquiryRerunRequest {
	readonly artifactId: string;
	readonly provenance: Record<string, unknown>;
}

interface PreparedInquiryRerun extends VerifiedInquiryRerun {
	readonly artifactId: string;
	readonly projectId: string;
	readonly provenance: InquiryArtifactProvenance;
}

const inputSchema = Type.Object(
	{
		artifactId: Type.String({ minLength: 1, maxLength: 512 }),
		provenance: Type.Object({}, { additionalProperties: true }),
	},
	{ additionalProperties: false },
);

const resultSchema = Type.Object(
	{
		status: Type.Union([
			Type.Literal("submitted"),
			Type.Literal("running"),
			Type.Literal("reproduced"),
			Type.Literal("superseded"),
			Type.Literal("failed"),
		]),
		jobId: Type.String({ minLength: 1 }),
		previousArtifactId: Type.String({ minLength: 1 }),
		previousSha256: Type.String({ minLength: 1 }),
		artifactId: Type.Optional(Type.String()),
		sha256: Type.Optional(Type.String()),
		difference: Type.Optional(Type.String()),
		error: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

function plainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function nonEmpty(value: unknown): string | undefined {
	const text = typeof value === "string" ? value.trim() : "";
	return text || undefined;
}

function validateArtifactId(value: string): string {
	const id = value.trim();
	if (!id || id.length > 512 || [...id].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127))
		throw new Error("Invalid inquiry rerun artifact id");
	return id;
}

function resolveProjectId(sessions: SessionDirectory, context: PluginCapabilityContext): string {
	context.signal.throwIfAborted();
	const raw =
		context.scope.kind === "session"
			? requirePluginSession(sessions, context).cwd
			: context.scope.kind === "workspace"
				? context.scope.workspaceDirectory
				: undefined;
	if (raw === undefined) throw new Error("inquiry.rerun requires a workspace or session scope");
	const projectId = canonicalProjectId(raw);
	if (!projectId) throw new Error("inquiry.rerun requires a project identity");
	return projectId;
}

function validateProvenance(raw: unknown, artifactId: string, projectId: string) {
	if (!plainObject(raw)) throw new Error("Invalid inquiry rerun provenance");
	if (raw.reproducibility !== "reproducible") throw new Error("Artifact is not reproducible");
	if (!plainObject(raw.artifact)) throw new Error("Invalid inquiry rerun artifact provenance");
	if (raw.artifact.id !== artifactId) throw new Error("Artifact provenance id does not match artifactId");
	const artifactProject = nonEmpty(raw.artifact.projectId);
	if (!artifactProject || canonicalProjectId(artifactProject) !== projectId)
		throw new Error("Artifact does not belong to the caller project");
	if (!nonEmpty(raw.artifact.path) || !nonEmpty(raw.artifact.sha256))
		throw new Error("Artifact provenance requires non-empty path and sha256");
	if (raw.attempts !== undefined && !Array.isArray(raw.attempts))
		throw new Error("Invalid inquiry rerun attempts provenance");
	let attemptJobId: string | undefined;
	for (const attempt of Array.isArray(raw.attempts) ? raw.attempts : []) {
		if (!plainObject(attempt) || !plainObject(attempt.parameters)) continue;
		attemptJobId = nonEmpty(attempt.parameters.jobId);
		if (attemptJobId) break;
	}
	const provenance = raw as unknown as InquiryArtifactProvenance;
	const originalJobId = attemptJobId ?? nonEmpty(provenance.artifact.runId);
	if (!originalJobId) throw new Error("No recorded compute job is available for this artifact");
	return { provenance, originalJobId };
}

export function createComputeInquiryRerunPort(
	compute: Pick<ComputeServicePort, "getJob">,
	computeAdapter: Pick<ComputeHostAdapter, "resubmitJob">,
): InquiryRerunPort {
	const verifyJob = async (artifactId: string, projectId: string, raw: InquiryArtifactProvenance) => {
		const { provenance, originalJobId } = validateProvenance(raw, validateArtifactId(artifactId), projectId);
		if (typeof computeAdapter.resubmitJob !== "function")
			throw new Error("Compute rerun submission is unavailable");
		const job = await compute.getJob(originalJobId);
		if (!job) throw new Error(`Compute job not found: ${originalJobId}`);
		if (canonicalProjectId(job.spec.workDir) !== projectId)
			throw new Error("Compute job does not belong to the caller project");
		const workflow =
			computeInquiryMetadata(job).runProvenance?.workflow ??
			provenance.runProvenance?.workflow ??
			provenance.artifact.runProvenance?.workflow;
		return { provenance, verified: { originalJobId, ...(workflow ? { workflow } : {}) } };
	};
	return {
		verifyRerun: async (artifactId, projectId, provenance) =>
			(await verifyJob(artifactId, projectId, provenance)).verified,
		rerunArtifact: async (artifactId, projectId, raw) => {
			const { provenance, verified } = await verifyJob(artifactId, projectId, raw);
			if (typeof computeAdapter.resubmitJob !== "function")
				throw new Error("Compute rerun submission is unavailable");
			const submitted = await computeAdapter.resubmitJob(verified.originalJobId);
			return {
				status: "submitted",
				jobId: submitted.id,
				previousArtifactId: provenance.artifact.id,
				previousSha256: provenance.artifact.sha256,
			};
		},
	};
}

function approvalDetail(
	prepared: PreparedInquiryRerun,
	context: Pick<PluginCapabilityContext, "scope">,
): string {
	const workflow =
		nonEmpty(prepared.workflow) ??
		(plainObject(prepared.provenance.runProvenance)
			? nonEmpty(prepared.provenance.runProvenance.workflow)
			: undefined);
	const scope =
		context.scope.kind === "session"
			? hostText(`会话 ${context.scope.sessionId}`, `session ${context.scope.sessionId}`)
			: context.scope.kind === "workspace"
				? hostText("工作区", "workspace")
				: hostText("应用", "application");
	return [
		hostText("操作: inquiry.rerun", "Action: inquiry.rerun"),
		`${hostText("项目", "Project")}: ${prepared.projectId}`,
		`${hostText("产物", "Artifact")}: ${prepared.provenance.artifact.id}`,
		`${hostText("路径", "Path")}: ${prepared.provenance.artifact.path}`,
		`${hostText("SHA-256", "SHA-256")}: ${prepared.provenance.artifact.sha256}`,
		...(prepared.originalJobId ? [`${hostText("原任务", "Original job")}: ${prepared.originalJobId}`] : []),
		...(workflow ? [`${hostText("工作流", "Workflow")}: ${workflow}`] : []),
		`${hostText("调用范围", "Caller scope")}: ${scope}`,
	].join("\n");
}

export function inquiryRerunCapabilityHandlers(
	host: InquiryRerunCapabilityHost,
): Record<"inquiry.rerun", PluginCapabilityHandler> {
	return {
		"inquiry.rerun": {
			inputSchema,
			resultSchema,
			effect: "write",
			approval: "always",
			prepare: async (input, context): Promise<PreparedInquiryRerun> => {
				const request = input as InquiryRerunRequest;
				const artifactId = validateArtifactId(request.artifactId);
				const projectId = resolveProjectId(host.sessions, context);
				const { provenance } = validateProvenance(request.provenance, artifactId, projectId);
				const verified = await host.inquiry.verifyRerun(artifactId, projectId, provenance);
				return Object.freeze({ artifactId, projectId, provenance, ...verified });
			},
			approvalDetail: (input, facts) => approvalDetail(input as PreparedInquiryRerun, facts),
			execute: async (input, context) => {
				const prepared = input as PreparedInquiryRerun;
				if (resolveProjectId(host.sessions, context) !== prepared.projectId)
					throw new Error("Inquiry rerun caller scope changed during approval");
				validateProvenance(prepared.provenance, prepared.artifactId, prepared.projectId);
				const rechecked = await host.inquiry.verifyRerun(
					prepared.artifactId,
					prepared.projectId,
					prepared.provenance,
				);
				if (rechecked.originalJobId !== prepared.originalJobId || rechecked.workflow !== prepared.workflow)
					throw new Error("Compute job changed during approval");
				return host.inquiry.rerunArtifact(prepared.artifactId, prepared.projectId, prepared.provenance);
			},
		},
	};
}
