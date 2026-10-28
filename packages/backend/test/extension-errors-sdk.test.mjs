import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { initLogging } from "../src/log";
import { PiBackend } from "../src/pi-backend";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { PluginRuntimeRegistry } from "../src/plugins/runtime";
import { SessionTraces } from "../src/session/traces";
import * as sdk from "../src/session-engine/sdk";
import { runSubagent } from "../src/tools/subagent/runner";

const roots = [],
	backends = [],
	runtimes = [];
const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
afterEach(async () => {
	for (const backend of backends.splice(0)) {
		for (const entry of backend.registry.list()) await backend.closeSession(entry.session.sessionId);
		backend.dispose();
	}
	for (const registry of runtimes.splice(0)) await registry.deactivate("error-fixture");
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(label) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-extension-errors-")));
	roots.push(root);
	const cwd = join(root, "project"),
		agentDir = join(root, "agent");
	await Promise.all([mkdir(cwd), mkdir(agentDir)]);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
	initLogging(join(root, "logs"), "error");
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: `extension-errors-${label}`, tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	const path = join(cwd, "sample.txt");
	await writeFile(path, "basic read survives extension hook failure\n");
	return { root, cwd, agentDir, modelRuntime, faux, path };
}
async function logs(root) {
	const files = await readdir(join(root, "logs"));
	return (await Promise.all(files.map((name) => readFile(join(root, "logs", name), "utf8")))).join("\n");
}
async function diagnostics(sessionDir, sessionId) {
	const content = await readFile(join(sessionDir, "traces", `trace-${sessionId}.jsonl`), "utf8");
	return content
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.filter((row) => row.type === "trace_custom" && row.kind === "extension_error");
}
async function managedIntegration(f) {
	const packageRoot = join(f.root, "plugin");
	await mkdir(packageRoot);
	const entrypoint = join(packageRoot, "runtime.mjs"),
		nativeEntrypoint = join(packageRoot, "extension.mjs");
	await writeFile(nativeEntrypoint, 'throw new Error("raw entry must not load");');
	await writeFile(
		entrypoint,
		`export default async()=>({operations:{},async dispose(){},createNativeSession:async()=>({eventEffects:{session_start:"read",context:"read"},extension(pi){pi.on("session_start",()=>{throw new Error("startup failure Bearer synthetic-secret");});pi.on("context",(_event,ctx)=>ctx.modelRegistry);},async dispose(){}})});`,
	);
	const registry = new PluginRuntimeRegistry({
		authorizeActivation: async () => true,
		authorizeInvocation: async () => true,
	});
	runtimes.push(registry);
	registry.register(
		"error-fixture",
		createProcessPluginRuntime({ pluginId: "error-fixture", packageRoot, entrypoint, runtimeDirectory }),
	);
	const abort = new AbortController();
	await registry.activate("error-fixture", () => ({
		identity: abort,
		scope: { kind: "application" },
		signal: abort.signal,
	}));
	return {
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		appendSystemPrompt: [],
		additionalExtensionPaths: [nativeEntrypoint],
		pluginRuntimeDirectory: runtimeDirectory,
		nativeRuntime: {
			manages: (path) => path === nativeEntrypoint,
			begin: () => ({
				bindSession() {},
				factoryForPath: async () => {
					const identity = {};
					const native = await registry.attachNative("error-fixture", (ctx) => ({
						identity,
						signal: ctx.signal ?? abort.signal,
						scope: {
							kind: "session",
							workspaceId: "fixture",
							workspaceDirectory: f.cwd,
							sessionId: ctx.sessionManager.getSessionId(),
						},
					}));
					return (pi) => native.extension(pi);
				},
				async dispose() {},
			}),
		},
	};
}
it.each([true, false])(
	"records managed hook failures across create/restore with permissionGates=%s",
	async (permissionGates) => {
		const f = await fixture(String(permissionGates));
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
		const backend = new PiBackend({
			projectTrust: false,
			permissionGates,
			lazyCapabilities: false,
			tools: ["read"],
			desktopIntegration: await managedIntegration(f),
		});
		backends.push(backend);
		backend.modelRuntime = f.modelRuntime;
		let meta = await backend.createSession({
				cwd: f.cwd,
				provider: f.faux.provider.id,
				modelId: f.faux.getModel().id,
			}),
			priorCount = 0;
		for (const phase of ["create", "restore"]) {
			const session = backend.registry.get(meta.sessionId).session;
			const originalRunner = session.extensionRunner;
			if (phase === "create") await session.reload();
			const runner = session.extensionRunner;
			const sessionDir = session.sessionManager.getSessionDir(),
				file = session.sessionFile;
			f.faux.setResponses([
				fauxAssistantMessage(fauxToolCall("read", { path: f.path })),
				fauxAssistantMessage("still usable"),
			]);
			await session.prompt(`Read the fixture after ${phase}.`);
			await session.waitForIdle();
			const result = session.messages
				.filter((message) => message.role === "toolResult" && message.toolName === "read")
				.at(-1);
			expect(result, "The real SDK read tool must still execute").toBeDefined();
			expect(result.isError, JSON.stringify(result)).toBe(false);
			expect(JSON.stringify(result)).toContain("basic read survives");
			await backend.closeSession(meta.sessionId);
			const rows = await diagnostics(sessionDir, meta.sessionId);
			expect(rows.length).toBeGreaterThan(priorCount);
			expect(rows.map((row) => row.data)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ event: "session_start", error: "startup failure Bearer [redacted]" }),
					expect.objectContaining({
						event: "context",
						error: "Unsupported native Pi context: modelRegistry",
					}),
				]),
			);
			expect(JSON.stringify(rows)).not.toContain("synthetic-secret");
			const before = await logs(f.root);
			expect(before).toContain("extension hook failed");
			originalRunner.emitError({ extensionPath: "/fixture", event: "context", error: "late original hook" });
			runner.emitError({ extensionPath: "/fixture", event: "context", error: "late closed hook" });
			expect(await logs(f.root)).toBe(before);
			priorCount = rows.length;
			if (phase === "create") meta = await backend.openSession(file);
		}
	},
);
it("records child hook errors while its SDK read remains usable and removes the listener", async () => {
	const f = await fixture("child");
	let runner;
	const create = sdk.createAgentSession;
	vi.spyOn(sdk, "createAgentSession").mockImplementation(async (options) => {
		const value = await create(options);
		runner = value.session.extensionRunner;
		return value;
	});
	f.faux.setResponses([
		fauxAssistantMessage(fauxToolCall("read", { path: f.path })),
		fauxAssistantMessage("child still usable"),
	]);
	const events = [];
	const childEntry = join(f.root, "child-hooks.mjs");
	await writeFile(childEntry, "export default () => {};\n");
	const result = await runSubagent(
		{
			getModelRuntime: async () => f.modelRuntime,
			getSubagentModel: async () => undefined,
			gate: { confirm: async () => true },
			traces: new SessionTraces(),
			onEvent: (_id, event) => events.push(event),
			// A package that declared read-only child support, whose hooks fail inside the child.
			nativeChildren: () => ({
				integration: {
					manages: (path) => path === childEntry,
					childExtensionPaths: () => [childEntry],
					begin: () => ({
						factoryForPath: async () => (pi) => {
							pi.on("session_start", () => {
								throw new Error("child startup failed");
							});
							pi.on("context", () => {
								throw new Error("child context failed");
							});
						},
						bindSession() {},
						async dispose() {},
					}),
				},
				register: () => () => undefined,
			}),
		},
		{
			cwd: f.cwd,
			projectTrusted: true,
			model: f.faux.getModel(),
			agent: { name: "test-reader", tools: ["read"], systemPrompt: "Read the local fixture." },
			task: "Read sample.txt",
		},
	);
	expect(result.exitCode, result.error).toBe(0);
	expect(events).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ type: "tool_execution_end", toolName: "read", isError: false }),
		]),
	);
	const rows = await diagnostics(dirname(result.artifactPaths.jsonlPath), result.sessionId);
	expect(rows.map((row) => row.data)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ event: "session_start", error: "child startup failed" }),
			expect.objectContaining({ event: "context", error: "child context failed" }),
		]),
	);
	const before = await logs(f.root);
	runner.emitError({ extensionPath: "/fixture", event: "context", error: "late closed child hook" });
	expect(await logs(f.root)).toBe(before);
});
