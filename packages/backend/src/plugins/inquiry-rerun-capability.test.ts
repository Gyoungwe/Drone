import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactProvenance, ArtifactRerunResult } from "@drone/inquiry";
import type { ComputeJob } from "@drone/shared";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalProjectId } from "../project-id";
import { clearReplyLanguage, hostText, setReplyLanguage } from "../reply-language";
import { InquiryService } from "../services/inquiry";
import { createInquiryComputeRerun } from "../services/inquiry-compute";
import type { SessionDirectory } from "../session/registry";
import { type InquiryRerunPort, inquiryRerunCapabilityHandlers } from "./inquiry-rerun-capability";
import type { PluginCredentialStore } from "./plugin-credentials";
import type { PluginRuntimeSource } from "./plugin-source";
import { PluginCapabilityBroker } from "./runtime-capabilities";
import { sourceCapabilityHandlers } from "./source-capabilities";
import type { TaskGrantStore } from "./task-grants";

const projectId = canonicalProjectId("/tmp/inquiry-rerun-project");
const provenance: ArtifactProvenance = {
	artifact: {
		id: "artifact-1",
		schemaVersion: 2,
		projectId,
		location: "remote",
		path: "results/result.csv",
		bytes: 12,
		sha256: "a".repeat(64),
		source: { kind: "run", id: "run-1" },
		purpose: "deliverable",
		status: "valid",
		parentIds: [],
		runProvenance: { workflow: "workflow-1" },
		createdAt: "2026-11-28T00:00:00.000Z",
		updatedAt: "2026-11-28T00:00:00.000Z",
	},
	parentChain: [],
	parentChainTruncated: false,
	attempts: [],
	runProvenance: { workflow: "workflow-1" },
	reproducibility: "reproducible",
};
const result: ArtifactRerunResult = {
	status: "submitted",
	jobId: "rerun-job-1",
	previousArtifactId: provenance.artifact.id,
	previousSha256: provenance.artifact.sha256,
};
const roots: string[] = [];

afterEach(async () => {
	clearReplyLanguage();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixture(selected: ArtifactProvenance | undefined = provenance) {
	let current: ArtifactProvenance | undefined = selected;
	const abort = new AbortController().signal;
	const entry = { cwd: projectId, session: { sessionId: "session-1" } };
	const sessions = {
		get: (sessionId: string) => (sessionId === "session-1" ? entry : undefined),
		signalFor: () => abort,
	} as unknown as SessionDirectory;
	const inquiry: InquiryRerunPort = {
		artifactProvenance: vi.fn(async () => current),
		rerunArtifact: vi.fn(async () => result),
	};
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
		invoke,
		setCurrent: (next: ArtifactProvenance | undefined) => {
			current = next;
		},
	};
}

const request = (snapshot = provenance) => ({ artifactId: "artifact-1", provenance: snapshot });

it("prepares a host snapshot, requests always approval with bilingual facts, then reruns", async () => {
	setReplyLanguage("en");
	const f = fixture();
	await expect(f.invoke(request())).resolves.toEqual(result);
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
		"workflow-1",
		"session",
	])
		expect(detail).toContain(value);
	expect(f.inquiry.rerunArtifact).toHaveBeenCalledWith("artifact-1", projectId);
	setReplyLanguage("zh");
	const chinese = fixture();
	await chinese.invoke(request());
	const chineseDetail = chinese.authorize.mock.calls[0]?.[3] ?? "";
	for (const value of ["操作: inquiry.rerun", "项目", "产物", "路径", "SHA-256", "工作流", "会话"])
		expect(chineseDetail).toContain(value);
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
	expect(f.inquiry.rerunArtifact).not.toHaveBeenCalled();
});

it.each([
	["application", { kind: "application" }],
	[
		"stale session",
		{ kind: "session", workspaceId: projectId, workspaceDirectory: projectId, sessionId: "session-1" },
	],
])("rejects an unsupported or stale caller scope before approval (%s)", async (_label, scope) => {
	const f = fixture();
	const identity = scope.kind === "session" ? {} : undefined;
	await expect(f.invoke(request(), scope, identity)).rejects.toThrow();
	expect(f.authorize).not.toHaveBeenCalled();
});

it.each([
	["missing", undefined, "Artifact not found"],
	[
		"cross-project",
		{ ...provenance, artifact: { ...provenance.artifact, projectId: "/other-project" } },
		"does not belong",
	],
	["not reproducible", { ...provenance, reproducibility: "partial" as const }, "not reproducible"],
])("rejects unavailable artifact provenance before approval (%s)", async (_label, current, message) => {
	const f = fixture(current);
	if (_label === "missing") f.setCurrent(undefined);
	await expect(f.invoke(request())).rejects.toThrow(message);
	expect(f.authorize).not.toHaveBeenCalled();
	expect(f.inquiry.rerunArtifact).not.toHaveBeenCalled();
});

it("rejects altered sha256, parentChain, attempts, or reproducibility snapshots before approval", async () => {
	const variants: ArtifactProvenance[] = [
		{ ...provenance, artifact: { ...provenance.artifact, sha256: "b".repeat(64) } },
		{ ...provenance, parentChain: [{ ...provenance.artifact, id: "parent" }] },
		{
			...provenance,
			attempts: [
				{
					id: "attempt-1",
					schemaVersion: 2,
					projectId,
					hypothesisIds: [],
					parameters: {},
					artifactIds: [],
					outcome: "succeeded",
					enteredReport: false,
					startedAt: "2026-11-28T00:00:00.000Z",
				},
			],
		},
		{ ...provenance, reproducibility: "partial" },
	];
	for (const snapshot of variants) {
		const f = fixture();
		await expect(f.invoke(request(snapshot))).rejects.toThrow("does not match current host provenance");
		expect(f.authorize).not.toHaveBeenCalled();
	}
});

it("does not rerun when the user declines or provenance changes while approval is open", async () => {
	const declined = fixture();
	declined.authorize.mockResolvedValue(false);
	await expect(declined.invoke(request())).rejects.toThrow("Plugin capability denied: inquiry.rerun");
	expect(declined.inquiry.rerunArtifact).not.toHaveBeenCalled();

	const changed = fixture();
	changed.authorize.mockImplementation(async () => {
		changed.setCurrent({ ...provenance, artifact: { ...provenance.artifact, sha256: "c".repeat(64) } });
		return true;
	});
	await expect(changed.invoke(request())).rejects.toThrow("does not match current host provenance");
	expect(changed.inquiry.rerunArtifact).not.toHaveBeenCalled();
});

it("keeps Inquiry's durable rerun deduplication through the existing compute adapter", async () => {
	const root = await mkdtemp(join(tmpdir(), "inquiry-rerun-dedup-"));
	roots.push(root);
	const inquiry = new InquiryService(
		{ inquiryDir: join(root, "ledger"), projectId: root },
		new PluginResourceReservations(join(root, "leases")),
	);
	const resubmitJob = vi.fn(async () => ({ id: "rerun-job-1" }) as ComputeJob);
	inquiry.setRerunHandler(
		createInquiryComputeRerun({
			adapter: { resubmitJob },
			collectionRoot: root,
			drainEvents: async () => undefined,
		}),
	);
	await inquiry.recordComputeEvent({
		id: "compute-event-1",
		jobId: "source-job-1",
		type: "collected",
		at: "2026-11-28T00:00:00.000Z",
		status: "succeeded",
		projectId: root,
		runId: "source-run-1",
		codeFingerprint: "d".repeat(64),
		runProvenance: { workflow: "workflow-1" },
		artifacts: [
			{
				path: "results/result.csv",
				bytes: 12,
				sha256: "a".repeat(64),
				sourceKind: "run",
				sourceId: "source-run-1",
			},
		],
	});
	const artifact = (await inquiry.listArtifacts(root))[0];
	if (!artifact) throw new Error("Expected a recorded compute artifact");
	const port: InquiryRerunPort = inquiry;
	const handler = inquiryRerunCapabilityHandlers({ inquiry: port, sessions: {} as SessionDirectory });
	const broker = new PluginCapabilityBroker({ resources: [], handlers: handler });
	const call = (snapshot: ArtifactProvenance) =>
		broker.run(
			{
				pluginId: "plugin",
				applicationId: "app",
				callerIdentity: {},
				bootstrap: false,
				scope: { kind: "workspace", workspaceId: canonicalProjectId(root), workspaceDirectory: root },
				signal: new AbortController().signal,
			},
			"write",
			() => undefined,
			async () => true,
			() => broker.port.call("inquiry.rerun", { artifactId: artifact.id, provenance: snapshot }),
		);
	try {
		const current = await inquiry.artifactProvenance(artifact.id, canonicalProjectId(root));
		if (!current) throw new Error("Expected host provenance");
		expect(await call(current)).toMatchObject({ status: "submitted", jobId: "rerun-job-1" });
		const refreshed = await inquiry.artifactProvenance(artifact.id, canonicalProjectId(root));
		if (!refreshed) throw new Error("Expected refreshed host provenance");
		expect(refreshed.rerun).toBeDefined();
		expect(await call(refreshed)).toMatchObject({ status: "submitted", jobId: "rerun-job-1" });
		expect(resubmitJob).toHaveBeenCalledTimes(1);
	} finally {
		await inquiry.dispose();
	}
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
