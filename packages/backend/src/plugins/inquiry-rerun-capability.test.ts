import type { JobRecord } from "@drone/compute";
import type { ComputeJob } from "@drone/shared";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalProjectId } from "../project-id";
import { clearReplyLanguage, hostText, setReplyLanguage } from "../reply-language";
import type { SessionDirectory } from "../session/registry";
import {
	createComputeInquiryRerunPort,
	type InquiryArtifactProvenance,
	type InquiryRerunResult,
	inquiryRerunCapabilityHandlers,
} from "./inquiry-rerun-capability";
import type { PluginCredentialStore } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import { PluginCapabilityBroker } from "./runtime-capabilities";
import { sourceCapabilityHandlers } from "./source-capabilities";
import type { TaskGrantStore } from "./task-grants";

const projectId = canonicalProjectId("/tmp/inquiry-rerun-project");
const otherProjectId = canonicalProjectId("/tmp/inquiry-rerun-other-project");

function makeJob(overrides: { jobId?: string; workDir?: string; workflowName?: string } = {}): JobRecord {
	const jobId = overrides.jobId ?? "source-job-1";
	return {
		jobId,
		hostAlias: "hpc-1",
		status: "succeeded",
		spec: {
			workDir: overrides.workDir ?? projectId,
			workflow: {
				name: overrides.workflowName ?? "workflow-1",
				modules: [],
				steps: [],
			},
		},
	} as unknown as JobRecord;
}

const provenance: InquiryArtifactProvenance = {
	artifact: {
		id: "artifact-1",
		projectId,
		path: "results/result.csv",
		sha256: "a".repeat(64),
		runId: "source-run-1",
		runProvenance: { workflow: "fallback-workflow" },
	},
	parentChain: [],
	parentChainTruncated: false,
	attempts: [{ parameters: { jobId: "source-job-1" } }],
	runProvenance: { workflow: "fallback-workflow" },
	reproducibility: "reproducible",
};

const expectedResult: InquiryRerunResult = {
	status: "submitted",
	jobId: "rerun-job-1",
	previousArtifactId: provenance.artifact.id,
	previousSha256: provenance.artifact.sha256,
};

afterEach(() => {
	clearReplyLanguage();
});

function fixture(options: { job?: JobRecord | null; withResubmit?: boolean } = {}) {
	let currentJob: JobRecord | null = options.job === undefined ? makeJob() : options.job;
	const abort = new AbortController().signal;
	const entry = { cwd: projectId, session: { sessionId: "session-1" } };
	const sessions = {
		get: (sessionId: string) => (sessionId === "session-1" ? entry : undefined),
		signalFor: () => abort,
	} as unknown as SessionDirectory;
	const getJob = vi.fn(async (jobId: string) => (currentJob?.jobId === jobId ? currentJob : null));
	const resubmitJob = vi.fn(async () => ({ id: "rerun-job-1" }) as ComputeJob);
	const inquiry = createComputeInquiryRerunPort(
		{ getJob },
		options.withResubmit === false ? {} : { resubmitJob },
	);
	const broker = new PluginCapabilityBroker({
		resources: [],
		handlers: inquiryRerunCapabilityHandlers({ inquiry, sessions }),
	});
	const authorize = vi.fn<Parameters<PluginCapabilityBroker["run"]>[3]>(async () => true);
	const invoke = (
		input: unknown,
		scope: object = {
			kind: "session",
			workspaceId: projectId,
			workspaceDirectory: projectId,
			sessionId: "session-1",
		},
		sessionIdentity: object | undefined = entry,
	) =>
		broker.run(
			{
				pluginId: "@fixture/inquiry-rerun",
				applicationId: "application-1",
				callerIdentity: {},
				sessionIdentity,
				scope: scope as Parameters<PluginCapabilityBroker["run"]>[0]["scope"],
				signal: abort,
				bootstrap: false,
			},
			"write",
			() => undefined,
			authorize,
			() => broker.port.call("inquiry.rerun", input),
		);
	return {
		broker,
		authorize,
		inquiry,
		getJob,
		resubmitJob,
		invoke,
		setJob: (next: JobRecord | null) => {
			currentJob = next;
		},
	};
}

const request = (snapshot: unknown = provenance) => ({ artifactId: "artifact-1", provenance: snapshot });

it("verifies compute job ownership, shows bilingual approval facts, and submits rerun", async () => {
	setReplyLanguage("en");
	const f = fixture();
	await expect(f.invoke(request())).resolves.toEqual(expectedResult);
	expect(f.authorize).toHaveBeenCalledWith(
		"inquiry.rerun",
		request(),
		"write",
		expect.stringContaining(hostText("操作", "Action")),
		expect.any(AbortSignal),
		"always",
		undefined,
	);
	const detail = f.authorize.mock.calls[0]?.[3] ?? "";
	for (const value of [
		projectId,
		provenance.artifact.id,
		provenance.artifact.path,
		provenance.artifact.sha256,
		"source-job-1",
		"workflow-1",
		"session",
	])
		expect(detail).toContain(value);
	expect(f.resubmitJob).toHaveBeenCalledWith("source-job-1");
	expect(f.getJob).toHaveBeenCalledTimes(3);

	setReplyLanguage("zh");
	const chinese = fixture();
	await chinese.invoke(request());
	const chineseDetail = chinese.authorize.mock.calls[0]?.[3] ?? "";
	for (const value of ["操作: inquiry.rerun", "项目", "产物", "路径", "SHA-256", "原任务", "工作流", "会话"])
		expect(chineseDetail).toContain(value);
});

it("falls back to artifact.runId when attempts have no jobId", async () => {
	const f = fixture({ job: makeJob({ jobId: "source-run-1" }) });
	const snapshot: InquiryArtifactProvenance = { ...provenance, attempts: [] };
	await expect(f.invoke(request(snapshot))).resolves.toEqual(expectedResult);
	expect(f.resubmitJob).toHaveBeenCalledWith("source-run-1");
});

it.each([
	["empty id", { artifactId: "", provenance }],
	["blank id", { artifactId: "  \t", provenance }],
	["oversized id", { artifactId: "x".repeat(513), provenance }],
	["control character", { artifactId: "artifact\u0001", provenance }],
	["null provenance", { artifactId: "artifact-1", provenance: null }],
	["array provenance", { artifactId: "artifact-1", provenance: [] }],
	["extra project identity", { ...request(), projectId }],
])("rejects malformed input before approval (%s)", async (_label, input) => {
	const f = fixture();
	await expect(f.invoke(input)).rejects.toThrow();
	expect(f.authorize).not.toHaveBeenCalled();
	expect(f.resubmitJob).not.toHaveBeenCalled();
});

it.each([
	["application", { kind: "application" }],
	[
		"stale session",
		{ kind: "session", workspaceId: projectId, workspaceDirectory: projectId, sessionId: "session-1" },
	],
])("rejects unsupported or stale caller scope before approval (%s)", async (_label, scope) => {
	const f = fixture();
	const identity = scope.kind === "session" ? {} : undefined;
	await expect(f.invoke(request(), scope, identity)).rejects.toThrow();
	expect(f.authorize).not.toHaveBeenCalled();
});

it.each([
	["not reproducible", { ...provenance, reproducibility: "partial" as const }, "not reproducible"],
	[
		"mismatched artifact id",
		{ ...provenance, artifact: { ...provenance.artifact, id: "other-artifact" } },
		"does not match artifactId",
	],
	[
		"cross-project artifact",
		{ ...provenance, artifact: { ...provenance.artifact, projectId: otherProjectId } },
		"does not belong",
	],
	["empty path", { ...provenance, artifact: { ...provenance.artifact, path: "  " } }, "non-empty path"],
	["empty sha256", { ...provenance, artifact: { ...provenance.artifact, sha256: "" } }, "non-empty path"],
	[
		"non-array attempts",
		{ ...provenance, attempts: "not-an-array" as unknown as InquiryArtifactProvenance["attempts"] },
		"Invalid inquiry rerun attempts provenance",
	],
	[
		"missing original job id",
		{ ...provenance, attempts: [null as never], artifact: { ...provenance.artifact, runId: undefined } },
		"No recorded compute job",
	],
])("rejects invalid provenance before approval (%s)", async (_label, snapshot, message) => {
	const f = fixture();
	await expect(f.invoke(request(snapshot))).rejects.toThrow(message);
	expect(f.authorize).not.toHaveBeenCalled();
	expect(f.resubmitJob).not.toHaveBeenCalled();
});

it("rejects unknown, forged cross-project, or unresubmittable compute jobs before approval", async () => {
	const missing = fixture({ job: null });
	await expect(missing.invoke(request())).rejects.toThrow("Compute job not found: source-job-1");
	expect(missing.authorize).not.toHaveBeenCalled();

	const forged = fixture({ job: makeJob({ workDir: otherProjectId }) });
	await expect(forged.invoke(request())).rejects.toThrow("Compute job does not belong to the caller project");
	expect(forged.authorize).not.toHaveBeenCalled();
	expect(forged.resubmitJob).not.toHaveBeenCalled();

	const noResubmit = fixture({ withResubmit: false });
	await expect(noResubmit.invoke(request())).rejects.toThrow("Compute rerun submission is unavailable");
	expect(noResubmit.authorize).not.toHaveBeenCalled();
});

it("does not rerun when declined or when compute job changes during approval", async () => {
	const declined = fixture();
	declined.authorize.mockResolvedValue(false);
	await expect(declined.invoke(request())).rejects.toThrow("Plugin capability denied: inquiry.rerun");
	expect(declined.resubmitJob).not.toHaveBeenCalled();

	const vanished = fixture();
	vanished.authorize.mockImplementation(async () => {
		vanished.setJob(null);
		return true;
	});
	await expect(vanished.invoke(request())).rejects.toThrow("Compute job not found: source-job-1");
	expect(vanished.resubmitJob).not.toHaveBeenCalled();

	const crossProjectAfterApproval = fixture();
	crossProjectAfterApproval.authorize.mockImplementation(async () => {
		crossProjectAfterApproval.setJob(makeJob({ workDir: otherProjectId }));
		return true;
	});
	await expect(crossProjectAfterApproval.invoke(request())).rejects.toThrow(
		"Compute job does not belong to the caller project",
	);
	expect(crossProjectAfterApproval.resubmitJob).not.toHaveBeenCalled();

	const workflowChangedAfterApproval = fixture();
	workflowChangedAfterApproval.authorize.mockImplementation(async () => {
		workflowChangedAfterApproval.setJob(makeJob({ workflowName: "workflow-tampered" }));
		return true;
	});
	await expect(workflowChangedAfterApproval.invoke(request())).rejects.toThrow(
		"Compute job changed during approval",
	);
	expect(workflowChangedAfterApproval.resubmitJob).not.toHaveBeenCalled();
});

it("registers the capability only for the dedicated source declaration and available port", () => {
	const source: PluginRuntimeSource = { pluginId: "p", packageRoot: "/p", entrypoint: "/p/index.mjs" };
	const f = fixture();
	const host = {
		taskGrants: {} as TaskGrantStore,
		sessions: {} as SessionDirectory,
		credentials: {} as PluginCredentialStore,
	};
	expect(sourceCapabilityHandlers(host, source)).not.toHaveProperty("inquiry.rerun");
	expect(sourceCapabilityHandlers(host, { ...source, p5: { rerun: "request" } })).not.toHaveProperty(
		"inquiry.rerun",
	);
	expect(
		sourceCapabilityHandlers({ ...host, inquiryRerun: f.inquiry }, { ...source, requestsInquiryRerun: true }),
	).toHaveProperty("inquiry.rerun");
	expect(sourceCapabilityHandlers(host, { ...source, requestsInquiryRerun: true })).not.toHaveProperty(
		"inquiry.rerun",
	);
});
