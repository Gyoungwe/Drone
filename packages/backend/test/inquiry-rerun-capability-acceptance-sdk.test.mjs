import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { createBackend } from "../src/create-backend";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { PluginRuntimeRegistry } from "../src/plugins/runtime";
import { canonicalProjectId } from "../src/project-id";

const live = {};
const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const runtimeSource = `export default async()=>({operations:{rerun:{effect:'write',inputSchema:{type:'object'},resultSchema:{type:'object'},execute:(input,context)=>context.capabilities.call('inquiry.rerun',input)}},dispose:async()=>{}});`;

afterEach(async () => {
	await Promise.allSettled([...(live.pluginIds ?? []).map((id) => live.registry?.deactivate(id))]);
	await live.backend?.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (live.root) await rm(live.root, { recursive: true, force: true });
	for (const key of Object.keys(live)) delete live[key];
});

async function writeFixturePackage(name, drone) {
	const packageRoot = join(live.root, "node_modules", ...name.split("/"));
	await mkdir(packageRoot, { recursive: true });
	await Promise.all([
		writeFile(join(packageRoot, "package.json"), JSON.stringify({ name, version: "1.0.0", type: "module" })),
		writeFile(
			join(packageRoot, "plugin.manifest.json"),
			JSON.stringify({
				schemaVersion: 1,
				id: name,
				version: "1.0.0",
				hosts: ["drone-desktop"],
				capabilities: [],
				entrypoints: { desktopRuntime: "./runtime.mjs" },
				drone: { pluginApi: 1, ...drone },
				permissions: { filesystem: [], network: [], subprocess: [] },
				tools: [],
			}),
		),
		writeFile(join(packageRoot, "runtime.mjs"), runtimeSource),
	]);
}

async function discoverFixtureSources() {
	await writeFixturePackage("@fixture/inquiry-rerun", { inquiryRerun: "request" });
	await writeFixturePackage("@fixture/p5-only", { p5: { rerun: "request" } });
	const packages = await discoverInstalledPackages(join(live.root, "node_modules"));
	return new Map(
		packages.map((item) => {
			if ("error" in item || !item.runtime) throw new Error("Rerun fixture package was not discovered");
			return [item.runtime.pluginId, item.runtime];
		}),
	);
}

async function offlineModel(agentDir) {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	live.faux = fauxProvider({ provider: "inquiry-rerun-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(live.faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	return modelRuntime;
}

async function startBackend(cwd, projectsDir, agentDir, sources) {
	const resubmitJob = vi.fn(async () => ({ id: "rerun-job-1" }));
	live.resubmitJob = resubmitJob;
	live.backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		permissionGates: true,
		defaultCwd: cwd,
		projectsDir,
		compute: { listHosts: async () => [], resubmitJob },
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: [],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
		},
	});
	const service = live.backend.sessions;
	service.modelRuntime = await offlineModel(agentDir);
	const approvals = [];
	let allowApproval = false;
	const registry = new PluginRuntimeRegistry(
		{
			authorizeActivation: async () => true,
			authorizeInvocation: async (request) => {
				if (request.operation !== "capability:inquiry.rerun") return true;
				approvals.push(request);
				return allowApproval;
			},
		},
		"inquiry-rerun-sdk",
		({ pluginId }) => {
			const source = sources.get(pluginId);
			if (!source) throw new Error("Rerun fixture source is unavailable");
			return {
				resources: [],
				handlers: {
					...service.getPluginSessionCapabilities(),
					...service.getPluginSourceCapabilities(source),
				},
			};
		},
	);
	live.registry = registry;
	live.pluginIds = [...sources.keys()];
	for (const source of sources.values())
		registry.register(source.pluginId, createProcessPluginRuntime({ ...source, runtimeDirectory }));
	return {
		backend: live.backend,
		service,
		registry,
		approvals,
		setApproval: (allowed) => (allowApproval = allowed),
		resubmitJob,
	};
}

async function createClients(service, registry, sources, cwd) {
	const meta = await service.createSession({
		cwd,
		provider: live.faux.provider.id,
		modelId: live.faux.getModel().id,
	});
	const sessionCaller = service.getPluginCallerContext(meta.sessionId);
	if (!sessionCaller) throw new Error("SDK session caller was not available");
	const caller = { ...sessionCaller };
	const resolveCaller = () => caller;
	const clients = new Map();
	for (const source of sources.values())
		clients.set(source.pluginId, await registry.activate(source.pluginId, resolveCaller));
	return { clients, meta };
}

async function recordArtifact(inquiry, cwd, sha256 = "a".repeat(64)) {
	const projectId = canonicalProjectId(cwd);
	await inquiry.recordComputeEvent({
		id: "compute-event-1",
		jobId: "source-job-1",
		type: "collected",
		at: "2026-11-28T00:00:00.000Z",
		status: "succeeded",
		projectId,
		runId: "source-run-1",
		codeFingerprint: "d".repeat(64),
		runProvenance: { workflow: "workflow-1" },
		artifacts: [
			{
				path: "results/result.csv",
				bytes: 12,
				sha256,
				sourceKind: "run",
				sourceId: "source-run-1",
			},
		],
	});
	await inquiry.drainEvents();
	const artifact = (await inquiry.listArtifacts(projectId))[0];
	if (!artifact) throw new Error("Compute event did not persist its artifact");
	const provenance = await inquiry.artifactProvenance(artifact.id, projectId);
	if (!provenance) throw new Error("Host artifact provenance was not available");
	return { artifact, projectId, provenance };
}

async function invokeRerun(client, artifactId, provenance, extra = {}) {
	return client.invoke("rerun", { artifactId, provenance, ...extra });
}

async function verifyGates(
	clients,
	approvals,
	resubmitJob,
	artifact,
	foreignArtifact,
	projectId,
	provenance,
) {
	const p5 = clients.get("@fixture/p5-only");
	const rerun = clients.get("@fixture/inquiry-rerun");
	await expect(invokeRerun(p5, artifact.id, provenance)).rejects.toThrow(
		"Plugin capability is not registered: inquiry.rerun",
	);
	await expect(invokeRerun(rerun, foreignArtifact.artifact.id, foreignArtifact.provenance)).rejects.toThrow(
		`Artifact not found: ${foreignArtifact.artifact.id}`,
	);
	const modified = { ...provenance, artifact: { ...provenance.artifact, sha256: "b".repeat(64) } };
	await expect(invokeRerun(rerun, artifact.id, modified)).rejects.toThrow(
		"Artifact provenance does not match current host provenance",
	);
	await expect(invokeRerun(rerun, artifact.id, provenance, { projectId })).rejects.toThrow(
		"Invalid plugin capability input: inquiry.rerun",
	);
	expect(approvals).toHaveLength(0);
	expect(resubmitJob).not.toHaveBeenCalled();
}

async function verifyApprovalAndRerun(host, clients, artifact, projectId, provenance) {
	const client = clients.get("@fixture/inquiry-rerun");
	await expect(invokeRerun(client, artifact.id, provenance)).rejects.toThrow(
		"Plugin capability denied: inquiry.rerun",
	);
	const approval = host.approvals[0];
	expect(approval).toMatchObject({
		operation: "capability:inquiry.rerun",
		effect: "write",
		approval: "always",
	});
	for (const value of [projectId, artifact.id, artifact.path, artifact.sha256, "workflow-1", "session"])
		expect(approval.approvalDetail).toContain(value);
	expect(host.resubmitJob).not.toHaveBeenCalled();
	host.setApproval(true);
	const first = await invokeRerun(client, artifact.id, provenance);
	expect(first).toMatchObject({
		status: "submitted",
		jobId: "rerun-job-1",
		previousArtifactId: artifact.id,
		previousSha256: artifact.sha256,
	});
	const afterFirst = host.resubmitJob.mock.calls.length;
	expect(afterFirst).toBe(1);
	const refreshed = await host.backend.inquiry.artifactProvenance(artifact.id, projectId);
	if (!refreshed) throw new Error("Rerun did not persist updated host provenance");
	expect(refreshed.rerun).toBeDefined();
	const deduplicated = await invokeRerun(client, artifact.id, refreshed);
	expect(deduplicated).toEqual(first);
	expect(host.resubmitJob).toHaveBeenCalledTimes(1);
	return { afterFirst, afterDeduplication: host.resubmitJob.mock.calls.length };
}

it("accepts only declared SDK reruns with fresh provenance and durable deduplication", async () => {
	live.root = await realpath(await mkdtemp(join(tmpdir(), "inquiry-rerun-sdk-")));
	const home = join(live.root, "home");
	const cwd = join(home, "project-one");
	const secondProject = join(home, "project-two");
	const agentDir = join(live.root, "agent");
	const projectsDir = join(live.root, "inquiry-projects");
	await Promise.all(
		[home, cwd, secondProject, agentDir, projectsDir].map((path) => mkdir(path, { recursive: true })),
	);
	for (const [key, value] of Object.entries({ HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: agentDir }))
		vi.stubEnv(key, value);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "en");
	const sources = await discoverFixtureSources();
	const host = await startBackend(cwd, projectsDir, agentDir, sources);
	const { clients } = await createClients(host.service, host.registry, sources, cwd);
	const { artifact, projectId, provenance } = await recordArtifact(host.backend.inquiry, cwd);
	const foreignArtifact = await recordArtifact(host.backend.inquiry, secondProject, "e".repeat(64));
	await verifyGates(
		clients,
		host.approvals,
		host.resubmitJob,
		artifact,
		foreignArtifact,
		projectId,
		provenance,
	);
	host.setApproval(false);
	const calls = await verifyApprovalAndRerun(host, clients, artifact, projectId, provenance);
	console.log(
		`SDK inquiry rerun ${JSON.stringify({ p5Only: "not registered", staleProvenanceBlocked: true, extraProjectIdBlocked: true, approval: "always", approvalDetailVerified: true, resubmitAfterDecline: 0, ...calls })}`,
	);
}, 120000);
