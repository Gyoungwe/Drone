// The installed @gyoungwe/pi-core managed runtime takes the host facts the native path read from
// in-process bridges (docs/handoff-2026-10-29-p4.md §5.2 item 4): the capability checkpoint through
// session.capabilities, the panel's task authorization as a decision record through
// session.decision.record, and drone:context-evicted to make an evicted read window recoverable.
// Real SDK session, real restricted plugin process, offline faux model.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

/** Per-test resources: temp root, backend and plugin bridge. */
const live = {};
afterEach(async () => {
	await live.bridge?.close();
	await live.backend?.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (live.root) await rm(live.root, { recursive: true, force: true });
	for (const key of Object.keys(live)) delete live[key];
});

const require = createRequire(import.meta.url);
const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const RUNTIME = `import {createManagedTaskApplication} from './dist/managed-runtime.mjs';
export default async context=>{
 const app=createManagedTaskApplication(context);
 return {...app,operations:{...app.operations,
  fixtureView:{effect:'read',inputSchema:{type:'null'},resultSchema:{type:'object'},execute:(_input,ctx)=>app.withCurrentSession(ctx.signal,session=>session.controller.journal.view())},
 }};
};`;

async function writeFixture(dir) {
	await mkdir(dir);
	const files = ["runtime.mjs", "native.mjs", "plugin.manifest.json", "dist"];
	const pkg = { name: "@fixture/tasks", version: "1.0.0", type: "module", files };
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({ ...pkg, pi: { extensions: ["./native.mjs"] } }),
	);
	await writeFile(join(dir, "runtime.mjs"), RUNTIME);
	await writeFile(
		join(dir, "native.mjs"),
		"export default()=>{throw new Error('Desktop must use the managed owner.');};",
	);
	await cp(dirname(require.resolve("@gyoungwe/pi-core")), join(dir, "dist"), { recursive: true });
	await writeFile(
		join(dir, "plugin.manifest.json"),
		JSON.stringify({
			schemaVersion: 1,
			id: "drone-fixture-tasks",
			version: "1.0.0",
			pi: { apiVersion: 1, minHostVersion: "1.1.0", testedHosts: ["1.1.0"] },
			capabilities: ["core"],
			hosts: ["drone-desktop", "native-pi"],
			entrypoints: { desktopRuntime: "./runtime.mjs", extension: "./native.mjs" },
			drone: {
				pluginApi: 1,
				resultContract: "drone-result/v3",
				taskGrants: "request",
				workspaceRead: "session",
				// As pi-core's manifest declares it at the managed switch.
				requires: { knowledge: { service: "knowledge.binding", version: 1 } },
				provides: { "fixture.tasks": { version: 1, operations: ["fixtureView"] } },
			},
			permissions: { filesystem: ["workspace-read"], network: [], subprocess: [] },
			tools: [],
		}),
	);
}

async function installPackage() {
	const dir = join(live.root, "source");
	await writeFixture(dir);
	const [pack] = JSON.parse(
		execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", live.root], {
			cwd: dir,
			encoding: "utf8",
		}),
	);
	const prefix = join(live.root, "installed");
	await mkdir(prefix);
	await writeFile(join(prefix, "package.json"), JSON.stringify({ private: true, type: "module" }));
	const flags = ["--ignore-scripts", "--offline", "--no-audit", "--no-fund", "--package-lock=false"];
	execFileSync("npm", ["install", "--prefix", prefix, ...flags, join(live.root, pack.filename)], {
		encoding: "utf8",
	});
	return (await discoverInstalledPackages(join(prefix, "node_modules"))).map((item) => {
		if ("error" in item || !item.runtime) throw new Error(JSON.stringify(item));
		return { name: `package:${item.packageRoot}`, source: item.runtime, state: "enabled" };
	});
}

async function offlineModels(agentDir) {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	live.faux = fauxProvider({ provider: "managed-host-events-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(live.faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	return modelRuntime;
}

/** The task grant dialog answers as `grants.allow` says; every plugin dialog is recorded. */
async function startBackend(catalog, agentDir, grants) {
	const owner = { id: 31, isDestroyed: () => false };
	const [tasks] = catalog;
	live.backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		permissionGates: true,
		tools: ["read", "task_plan", "task_wait", "task_status", "task_reconcile", "task_evidence_restore"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: [tasks.source.nativeEntrypoint],
			pluginRuntimeDirectory: runtimeDirectory,
			nativeRuntime: {
				begin: () => live.bridge.beginNative(owner, () => tasks.name),
				manages: (path) => path === tasks.source.nativeEntrypoint,
			},
		},
	});
	const service = live.backend.sessions;
	service.modelRuntime = await offlineModels(agentDir);
	live.bridge = new PluginRuntimeBridge({
		source: (name) => catalog.find((item) => item.name === name)?.source,
		sources: () => catalog,
		enabled: () => true,
		approve: async (_owner, _source, operation) => {
			grants.dialogs.push(operation);
			return operation !== "capability:task.grant.request" || grants.allow;
		},
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		getSessionContext: (id) => service?.getPluginCallerContext(id),
		taskGrants: service.getTaskGrants(),
		capabilities: (source) => () => ({
			resources: [],
			handlers: {
				...service.getPluginSessionCapabilities(),
				...service.getPluginSourceCapabilities(source),
				...service.getPluginWorkspaceCapabilities(),
			},
		}),
	});
	return { service, owner, tasks };
}

const textOf = (message) =>
	typeof message.content === "string"
		? message.content
		: message.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("");
const called = (messages, name) =>
	messages.some((m) => m.role === "assistant" && m.content.some((part) => part.name === name));
const toolUse = (call) => fauxAssistantMessage([call], { stopReason: "toolUse" });

/** Plans one result once, reads line two of data.txt once, and restores that read once when the test asks. */
const respond = (context) => {
	const messages = context.messages || [];
	if (!getCurrentTools(messages).some((tool) => tool.name === "task_plan"))
		return fauxAssistantMessage("internal");
	if (live.restore) {
		live.restore = false;
		return toolUse(fauxToolCall("task_evidence_restore", { receiptId: "read-1", path: "data.txt" }));
	}
	if (!called(messages, "task_plan"))
		return toolUse(
			fauxToolCall("task_plan", {
				goal: "Summarize data.txt",
				summary: "One summary of data.txt",
				writeDirectories: ["outputs"],
				milestones: [
					{
						id: "s",
						title: "Summary",
						dependsOn: [],
						acceptance: { kind: "file", path: "outputs/summary.md", rootKind: "workspace" },
					},
				],
			}),
		);
	if (live.read && !called(messages, "read"))
		return toolUse(fauxToolCall("read", { path: "data.txt", offset: 2, limit: 1 }, { id: "read-1" }));
	return fauxAssistantMessage("waiting");
};

async function setup() {
	live.root = await realpath(await mkdtemp(join(tmpdir(), "drone-managed-host-events-acc-")));
	const catalog = await installPackage();
	const home = join(live.root, "home"),
		cwd = join(home, "project"),
		agentDir = join(live.root, "agent");
	await mkdir(join(cwd, "outputs"), { recursive: true });
	await mkdir(agentDir);
	await writeFile(join(cwd, "data.txt"), "one\ntwo\nthree");
	for (const [key, value] of Object.entries({ HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: agentDir }))
		vi.stubEnv(key, value);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "zh");
	const grants = { allow: true, dialogs: [] };
	const { service, owner, tasks } = await startBackend(catalog, agentDir, grants);
	const meta = await service.createSession({
		cwd,
		provider: live.faux.provider.id,
		modelId: live.faux.getModel().id,
	});
	const entry = service.registry.get(meta.sessionId);
	const errors = [];
	entry.session.extensionRunner.onError((error) => errors.push(`${error.event}: ${error.error}`));
	const binding = await live.bridge.bind(tasks.name, owner),
		selection = live.bridge.selectSession(owner, meta.sessionId);
	live.faux.setResponses(Array.from({ length: 40 }, () => respond));
	const prompt = async (text) => {
		await entry.session.prompt(text, { expandPromptTemplates: text.startsWith("/") });
		await entry.session.agent.waitForIdle?.();
		await entry.session.waitForIdle?.();
		await vi.waitFor(() => expect(entry.session.isStreaming).toBe(false));
	};
	const decisions = [];
	service.onDecision((event) => decisions.push(event));
	return {
		cwd,
		session: entry.session,
		errors,
		grants,
		decisions,
		prompt,
		view: () => live.bridge.invoke(owner, binding, "fixtureView", null, selection),
		panel: (input) => prompt(`/task-action ${Buffer.from(JSON.stringify(input)).toString("base64url")}`),
	};
}

it("the task keeps the host checkpoint, and authorizing it from the panel records the decision", async () => {
	const t = await setup();
	t.session.sessionManager.appendCustomEntry("drone-capability-checkpoint-v1", {
		capabilities: ["literature"],
	});
	t.grants.allow = false;
	await t.prompt("Summarize data.txt");
	// Declining the authorization records nothing.
	expect(t.decisions).toEqual([]);
	const before = await t.view();
	const task = before.tasks[0];
	expect(task.capabilities).toEqual(["literature"]);
	t.grants.allow = true;
	await t.panel({ action: "authorize-task", taskId: task.id, revision: before.revision });
	expect(t.decisions).toEqual([
		{
			id: `@fixture/tasks:task-authorization:${task.id}:${before.revision}`,
			kind: "task-authorization",
			summary: "One summary of data.txt",
			basis: [`task:${task.id}`, `revision:${before.revision}`],
			at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			projectId: t.cwd,
		},
	]);
	// The decision record raises no dialog of its own: activation, then the two authorization requests.
	expect(t.grants.dialogs).toEqual([
		undefined,
		"capability:task.grant.request",
		"capability:task.grant.request",
	]);
	expect(t.errors).toEqual([]);
}, 120000);

it("a context eviction the session reports makes the task's read window recoverable", async () => {
	const t = await setup();
	live.read = true;
	await t.prompt("Summarize data.txt");
	// Only a window the host reports evicted is recoverable. Asking before the eviction would fail,
	// and the host's repeated-failure guard would then block the identical retry, so the eviction
	// comes first; without it this restore fails (mutation-checked).
	t.session.resourceLoader.eventBus.emit("drone:context-evicted", {
		sessionId: t.session.sessionId,
		toolCallIds: ["read-1"],
	});
	await new Promise((done) => setTimeout(done, 300));
	live.restore = true;
	await t.prompt("Restore the read window");
	const result = t.session.messages.findLast((m) => m.toolName === "task_evidence_restore");
	expect(result.isError).toBe(false);
	expect(JSON.parse(textOf(result))).toMatchObject({ status: "restored", path: "data.txt", text: "two" });
	expect(t.errors).toEqual([]);
}, 120000);
