import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { consentForSource, createBackend, hostEventsApproved } from "../src/index";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { PluginRuntimeRegistry } from "../src/plugins/runtime";

const live = {};
const runtimeDirectory = resolve(
	import.meta.dirname,
	"../../desktop/plugin-runtime",
	`${process.platform}-${process.arch}`,
);
const manifest = {
	schemaVersion: 1,
	id: "fixture.inquiry-host-events",
	version: "1.0.0",
	hosts: ["drone-desktop"],
	capabilities: [],
	entrypoints: { desktopRuntime: "./runtime.mjs" },
	drone: { pluginApi: 1, hostEvents: ["inquiry.local-execution", "inquiry.task-terminal"] },
	permissions: { filesystem: [], network: [], subprocess: [] },
	tools: [],
};
const runtimeSource = `const events=[];export default async({hostEvents})=>{
 hostEvents.subscribe('inquiry.task-terminal',event=>events.push(event));
 hostEvents.subscribe('inquiry.local-execution',event=>events.push(event));
 return {operations:{read:{inputSchema:{type:'null'},resultSchema:{type:'array',items:{type:'object'}},effect:'read',execute:async()=>events}},dispose:async()=>{}};
};`;

afterEach(async () => {
	await Promise.allSettled([live.registry?.deactivate(live.pluginId)]);
	await live.backend?.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (live.root) await rm(live.root, { recursive: true, force: true });
	for (const key of Object.keys(live)) delete live[key];
});

async function installedFixture() {
	const modules = join(live.root, "node_modules", "@fixture", "inquiry-events");
	await mkdir(modules, { recursive: true });
	await writeFile(
		join(modules, "package.json"),
		JSON.stringify({ name: "@fixture/inquiry-events", version: "1.0.0", type: "module" }),
	);
	await writeFile(join(modules, "plugin.manifest.json"), JSON.stringify(manifest));
	await writeFile(join(modules, "runtime.mjs"), runtimeSource);
	const packages = await discoverInstalledPackages(join(live.root, "node_modules"));
	const packageSource = packages.find(
		(item) => "runtime" in item && item.runtime?.pluginId === "@fixture/inquiry-events",
	);
	if (!packageSource || !("runtime" in packageSource) || !packageSource.runtime)
		throw new Error("Host event fixture package was not discovered");
	const source = {
		...packageSource.runtime,
		policyConsent: consentForSource(packageSource.runtime),
	};
	if (!hostEventsApproved(source)) throw new Error("Fixture host event consent did not validate");
	return source;
}

async function offlineModel(agentDir) {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	live.faux = fauxProvider({ provider: "inquiry-host-events-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(live.faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	return modelRuntime;
}

function createDiscoveryHostLoader() {
	const discoverySessions = new Map();
	return {
		contractVersion: 1,
		create(input) {
			return {
				contractVersion: 1,
				async createKernelSession(session) {
					await input.services.authorize({ kind: "create-kernel-session", projectId: input.projectId });
					discoverySessions.set(session.sessionId, session);
					return {
						sessionId: session.sessionId,
						language: session.language,
						dataClassification: session.dataClassification,
						runDirectory: session.runDirectory,
						status: "ready",
						executionCount: 0,
						remainingExecutions: 1,
						capabilities: {
							kind: "fixture",
							languages: [session.language],
							networkDisabled: true,
							writesOnlyToRunDirectory: true,
						},
					};
				},
				async executeKernel({ sessionId, code }) {
					const session = discoverySessions.get(sessionId);
					if (!session) throw new Error("Discovery kernel session was not found");
					await input.services.authorize({ kind: "execute-kernel", projectId: input.projectId, sessionId });
					const startedAt = new Date().toISOString();
					const runner = await input.services.runner(session.language);
					const result = await runner.run({
						requestId: "exec-1",
						language: session.language,
						code,
						runDirectory: session.runDirectory,
						timeoutMs: 60_000,
						maxOutputBytes: 1_000_000,
						dataClassification: session.dataClassification,
					});
					const finishedAt = new Date().toISOString();
					const execution = {
						id: "exec-1",
						code,
						startedAt,
						finishedAt,
						status: result.exitCode === 0 ? "succeeded" : "failed",
						exitCode: result.exitCode,
						output: result.outputs.map((output) => output.text).join("\\n"),
						outputClassification: "public",
						contentKinds: [...new Set(result.outputs.map((output) => output.contentKind))],
						producedBytes: result.producedBytes,
						redactedBytes: 0,
					};
					await input.services.onExecution({
						sessionId,
						runDirectory: session.runDirectory,
						language: session.language,
						code,
						execution,
					});
					return execution;
				},
			};
		},
	};
}

function createDiscoveryRunner() {
	return {
		capabilities: {
			kind: "fixture",
			languages: ["python"],
			networkDisabled: true,
			writesOnlyToRunDirectory: true,
		},
		run: async (request) => {
			await writeFile(join(request.runDirectory, "accepted.csv"), "value\n1\n");
			return {
				exitCode: 0,
				durationMs: 1,
				producedBytes: 8,
				outputs: [{ text: "accepted table", contentKind: "table", classification: "public" }],
			};
		},
	};
}

async function activateHostEventClient(service, source) {
	const registry = new PluginRuntimeRegistry(
		{ authorizeActivation: async () => true, authorizeInvocation: async () => true },
		"app",
		({ signal }) => {
			const hostEvents = service.getPluginHostEvents(source, signal);
			if (!hostEvents) throw new Error("Approved source did not receive host events");
			return { resources: [], handlers: {}, hostEvents };
		},
	);
	live.registry = registry;
	live.pluginId = source.pluginId;
	registry.register(source.pluginId, createProcessPluginRuntime({ ...source, runtimeDirectory }));
	const caller = {
		identity: {},
		scope: { kind: "application" },
		signal: new AbortController().signal,
	};
	return registry.activate(source.pluginId, () => caller);
}

async function runSdkTurn(service, cwd, client) {
	const meta = await service.createSession({
		cwd,
		provider: live.faux.provider.id,
		modelId: live.faux.getModel().id,
	});
	const sessionEntry = service.registry.get(meta.sessionId);
	if (!sessionEntry) throw new Error("SDK session was not registered");
	const terminalEvents = [];
	const detach = service.onEvent((sessionId, event) => {
		if (sessionId === meta.sessionId && event.type === "agent_end") terminalEvents.push(event);
	});
	try {
		live.faux.setResponses([fauxAssistantMessage("A bounded offline SDK turn.")]);
		await service.prompt(meta.sessionId, "Finish one offline turn");
		await sessionEntry.session.agent.waitForIdle?.();
		await sessionEntry.session.waitForIdle?.();
		await vi.waitFor(() => expect(sessionEntry.session.isStreaming).toBe(false));
		await vi.waitFor(async () => {
			const values = await client.invoke("read", null);
			expect(values.filter((event) => event.topic === "inquiry.task-terminal")).toHaveLength(1);
		});
		const taskEvent = (await client.invoke("read", null)).find(
			(event) => event.topic === "inquiry.task-terminal",
		);
		expect(terminalEvents).toHaveLength(1);
		expect(taskEvent.payload.status).toBe(terminalEvents[0].willRetry ? "partial" : "succeeded");
		return taskEvent;
	} finally {
		detach();
	}
}

async function runDiscoveryKernel(backend, client, taskEvent) {
	await backend.discovery.createKernelSession({
		sessionId: "discovery-session-1",
		language: "python",
		dataClassification: "public",
		runDirectory: "runs/task-1/run-1",
	});
	const execution = await backend.discovery.executeKernel("discovery-session-1", "print(1)");
	expect(execution.status).toBe("succeeded");
	await vi.waitFor(async () => {
		const values = await client.invoke("read", null);
		expect(values.filter((event) => event.topic === "inquiry.local-execution")).toHaveLength(1);
	});
	const received = await client.invoke("read", null);
	const localEvent = received.find((event) => event.topic === "inquiry.local-execution");
	expect(localEvent.payload.artifacts).toEqual(
		expect.arrayContaining([expect.objectContaining({ path: "runs/task-1/run-1/accepted.csv" })]),
	);
	const summary = [taskEvent, localEvent].map(({ topic, sequence, payload }) => ({
		topic,
		sequence,
		fields: Object.keys(payload).sort(),
	}));
	console.log(`SDK host events ${JSON.stringify(summary)}`);
	expect(localEvent.sequence).toBeGreaterThan(taskEvent.sequence);
}

it("delivers SDK session and discovery execution events through an approved restricted process", async () => {
	live.root = await realpath(await mkdtemp(join(tmpdir(), "inquiry-host-event-sdk-")));
	const source = await installedFixture();
	const home = join(live.root, "home");
	const cwd = join(home, "project");
	const agentDir = join(live.root, "agent");
	await Promise.all([cwd, agentDir].map((path) => mkdir(path, { recursive: true })));
	for (const [key, value] of Object.entries({ HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: agentDir }))
		vi.stubEnv(key, value);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "en");
	live.backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		permissionGates: true,
		defaultCwd: cwd,
		discoveryProjectRoot: cwd,
		discoveryAuthorize: async () => undefined,
		discoveryHostLoader: createDiscoveryHostLoader(),
		discoveryRunner: createDiscoveryRunner(),
		desktopIntegration: { appendSystemPrompt: [], additionalSkillPaths: [], additionalExtensionPaths: [] },
	});
	const service = live.backend.sessions;
	service.modelRuntime = await offlineModel(agentDir);
	const client = await activateHostEventClient(service, source);
	const taskEvent = await runSdkTurn(service, cwd, client);
	await runDiscoveryKernel(live.backend, client, taskEvent);
}, 120000);
