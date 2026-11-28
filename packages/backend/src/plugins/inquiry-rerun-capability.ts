import { isDeepStrictEqual } from "node:util";
import type { ArtifactProvenance, ArtifactRerunResult } from "@drone/inquiry";
import { Type } from "typebox";
import { canonicalProjectId } from "../project-id";
import { hostText } from "../reply-language";
import type { SessionDirectory } from "../session/registry";
import type { PluginCapabilityContext, PluginCapabilityHandler } from "./runtime-capabilities";
import { requirePluginSession } from "./session-caller";

export interface InquiryRerunPort {
	artifactProvenance(artifactId: string, projectId?: string): Promise<ArtifactProvenance | undefined>;
	rerunArtifact(artifactId: string, projectId?: string): Promise<ArtifactRerunResult>;
}

export interface InquiryRerunCapabilityHost {
	readonly inquiry: InquiryRerunPort;
	readonly sessions: SessionDirectory;
}

interface InquiryRerunRequest {
	readonly artifactId: string;
	readonly provenance: Record<string, unknown>;
}

interface PreparedInquiryRerun {
	readonly artifactId: string;
	readonly projectId: string;
	readonly provenance: ArtifactProvenance;
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

function validateArtifactId(value: string): string {
	const artifactId = value.trim();
	if (
		!artifactId ||
		artifactId.length > 512 ||
		[...artifactId].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
	)
		throw new Error("Invalid inquiry rerun artifact id");
	return artifactId;
}

function resolveProjectId(sessions: SessionDirectory, context: PluginCapabilityContext): string {
	context.signal.throwIfAborted();
	let projectId: string;
	if (context.scope.kind === "session") {
		projectId = canonicalProjectId(requirePluginSession(sessions, context).cwd);
	} else if (context.scope.kind === "workspace") {
		projectId = canonicalProjectId(context.scope.workspaceDirectory);
	} else {
		throw new Error("inquiry.rerun requires a workspace or session scope");
	}
	if (!projectId) throw new Error("inquiry.rerun requires a project identity");
	return projectId;
}

function assertCurrentProvenance(
	current: ArtifactProvenance | undefined,
	artifactId: string,
	projectId: string,
	expected?: ArtifactProvenance,
): asserts current is ArtifactProvenance {
	if (!current) throw new Error(`Artifact not found: ${artifactId}`);
	if (canonicalProjectId(current.artifact.projectId) !== projectId)
		throw new Error("Artifact does not belong to the caller project");
	if (current.reproducibility !== "reproducible") throw new Error("Artifact is not reproducible");
	if (expected && !isDeepStrictEqual(expected, current))
		throw new Error("Artifact provenance does not match current host provenance");
}

function approvalDetail(
	prepared: PreparedInquiryRerun,
	context: Pick<PluginCapabilityContext, "scope">,
): string {
	const workflow = prepared.provenance.runProvenance?.workflow;
	const scope =
		context.scope.kind === "session"
			? hostText(`会话 ${context.scope.sessionId}`, `session ${context.scope.sessionId}`)
			: context.scope.kind === "workspace"
				? hostText("工作区", "workspace")
				: hostText("应用", "application");
	const fields = [
		hostText("操作: inquiry.rerun", "Action: inquiry.rerun"),
		`${hostText("项目", "Project")}: ${prepared.projectId}`,
		`${hostText("产物", "Artifact")}: ${prepared.provenance.artifact.id}`,
		`${hostText("路径", "Path")}: ${prepared.provenance.artifact.path}`,
		`${hostText("SHA-256", "SHA-256")}: ${prepared.provenance.artifact.sha256}`,
		...(workflow ? [`${hostText("工作流", "Workflow")}: ${workflow}`] : []),
		`${hostText("调用范围", "Caller scope")}: ${scope}`,
	];
	return fields.join("\n");
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
				if (!plainObject(request.provenance)) throw new Error("Invalid inquiry rerun provenance");
				const projectId = resolveProjectId(host.sessions, context);
				const current = await host.inquiry.artifactProvenance(artifactId, projectId);
				assertCurrentProvenance(current, artifactId, projectId);
				if (!isDeepStrictEqual(request.provenance, current))
					throw new Error("Artifact provenance does not match current host provenance");
				return Object.freeze({ artifactId: current.artifact.id, projectId, provenance: current });
			},
			approvalDetail: (input, facts) => approvalDetail(input as PreparedInquiryRerun, facts),
			execute: async (input, context) => {
				const prepared = input as PreparedInquiryRerun;
				if (resolveProjectId(host.sessions, context) !== prepared.projectId)
					throw new Error("Inquiry rerun caller scope changed during approval");
				const latest = await host.inquiry.artifactProvenance(prepared.artifactId, prepared.projectId);
				assertCurrentProvenance(latest, prepared.artifactId, prepared.projectId, prepared.provenance);
				return host.inquiry.rerunArtifact(prepared.artifactId, prepared.projectId);
			},
		},
	};
}
