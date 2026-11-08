// P4 switch acceptance (docs/handoff-2026-10-29-p4.md §5.3): the pi-core Drone ships in its read-only
// built-in root, found by the real UiPluginManager and run by its managed runtime in a restricted
// process, against real SDK sessions. Only the model is the offline faux provider.
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => environment.userData } }));

import { UiPluginManager } from "../../desktop/src/main/ui-plugins/manager";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

const repo = resolve(import.meta.dirname, "../../..");
/** The copy fetch-plugins staged for packaging; check-builtin-plugins proves it is the locked artifact. */
const shipped = join(repo, "packages/desktop/plugin-packages/node_modules/@gyoungwe/pi-core");
const runtimeDirectory = join(repo, `packages/desktop/plugin-runtime/${process.platform}-${process.arch}`);
const CORE_UI = "drone-task-ui";
const TASK_TOOLS = ["task_status", "task_plan", "task_wait", "task_reconcile", "task_evidence_restore"];

/** Per-test resources. */
const live = {};
afterEach(async () => {
	await live.bridge?.close();
	await live.backend?.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (live.root) await rm(live.root, { recursive: true, force: true });
	for (const key of Object.keys(live)) delete live[key];
});

const textOf = (message) =>
	typeof message.content === "string"
		? message.content
		: message.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("");
const stage = (...calls) => fauxAssistantMessage(calls, { stopReason: "toolUse" });
const plan = (stages) =>
	fauxToolCall("task_plan", {
		goal: "Write the staged results",
		summary: "Write one result file per stage",
		writeDirectories: ["outputs"],
		milestones: Array.from({ length: stages }, (_, i) => ({
			id: `m${i + 1}`,
			title: `Result ${i + 1}`,
			dependsOn: [],
			acceptance: { kind: "file", path: `outputs/m${i + 1}.txt`, rootKind: "workspace" },
		})),
	});

/**
 * The offline model answers from the session it sees, since sessions share one response queue:
 * "TASK n" plans n result files and writes them one per turn, "WRITE path" writes one file outside
 * any task, anything else is ordinary chat.
 */
const respond = (context) => {
	const messages = context.messages || [];
	if (!getCurrentTools(messages).some((tool) => tool.name === "task_plan"))
		return fauxAssistantMessage("internal");
	// Host notes reach the model as user turns too, so the user's request is the last scripted one.
	const asked = messages.filter((m) => m.role === "user").map(textOf);
	const last = messages.findLast((m) => m.role === "assistant" || m.role === "toolResult");
	const request = messages.findLastIndex((m) => m.role === "user" && /^(WRITE|TASK) /.test(textOf(m)));
	const direct = request >= 0 ? textOf(messages[request]).match(/^WRITE (\S+)/) : null;
	// Only this request's own results count; an earlier task's last tool result is history.
	const turn = messages.slice(request);
	if (direct)
		return turn.some((m) => m.role === "toolResult" && m.toolName === "write")
			? fauxAssistantMessage("written")
			: stage(fauxToolCall("write", { path: direct[1], content: "direct" }));
	const task = asked.findLast((text) => /^TASK \d+/.test(text));
	if (!task) return fauxAssistantMessage("Hello.");
	const stages = Number(task.split(" ")[1]);
	if (!messages.some((m) => m.role === "toolResult" && m.toolName === "task_plan"))
		return stage(plan(stages));
	const written = messages.filter(
		(m) => m.role === "toolResult" && m.toolName === "write" && !m.isError,
	).length;
	if (last?.role === "toolResult" && last.toolName === "write")
		return fauxAssistantMessage(`stage ${written} done`);
	if (written < stages)
		return stage(
			fauxToolCall("write", { path: `outputs/m${written + 1}.txt`, content: `result ${written + 1}` }),
		);
	return fauxAssistantMessage("all done");
};

async function offlineModels(agentDir) {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	live.faux = fauxProvider({ provider: "builtin-core-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(live.faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	live.faux.setResponses(Array.from({ length: 400 }, () => respond));
	return modelRuntime;
}

/** Desktop's composition (ui-plugins/runtime-host.ts) without Electron windows. */
function wire(manager, service, owner, record) {
	live.bridge = new PluginRuntimeBridge({
		source: (name) => manager.runtimeSource(name),
		sources: () => manager.runtimeSources(),
		classifySelectedPath: (path) => manager.classifyNativeSelection(path),
		enabled: (name) => manager.isEnabled(name) || manager.isNativeSourceAvailable(name),
		// As approveDesktopRuntime's caller: a built-in's activation is not a dialog; anything else is.
		approve: async (_owner, source, operation) => {
			if (operation === undefined && manager.builtinPackages.has(source.packageRoot)) return true;
			record.push(operation ?? `activation:${source.pluginId}`);
			return true;
		},
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		getSessionContext: (id) => service.getPluginCallerContext(id),
		taskGrants: service.getTaskGrants(),
		capabilities: (source) => () => ({
			resources: [],
			handlers: {
				...service.getPluginSessionCapabilities(source.recordAdoptions),
				...service.getPluginSourceCapabilities(source),
				...(source.requestsWorkspaceRead ? service.getPluginWorkspaceCapabilities() : {}),
			},
		}),
	});
	return {
		manages: (path) => manager.classifyNativeSelection(path).kind !== "ordinary",
		childExtensionPaths: () => manager.nativeChildExtensionPaths(),
		extensionPaths: () => manager.builtinExtensionPaths(),
		begin: (facts) => live.bridge.beginNative(owner, (path) => manager.nativeRuntimeName(path), facts),
	};
}

/** One SDK session as the test drives it: prompts, the built-in's loaded tools, its task status and grant. */
function attachSession({ service, owner, core, nativeEntry }, meta) {
	const entry = service.registry.get(meta.sessionId);
	const errors = [];
	entry.session.extensionRunner.onError((error) => errors.push(`${error.event}: ${error.error}`));
	const settle = async () => {
		await vi.waitFor(() => expect(entry.session.isStreaming).toBe(false));
		await entry.session.waitForIdle?.();
	};
	const prompt = async (text) => {
		await entry.session.prompt(text, { expandPromptTemplates: false });
		await entry.session.agent.waitForIdle?.();
		await settle();
		// Automatic task continuations start after the prompt settles.
		await new Promise((done) => setTimeout(done, 300));
		await settle();
	};
	const loaded = () =>
		entry.session.resourceLoader.getExtensions().extensions.find((e) => e.path === nativeEntry);
	const status = async () => {
		const binding = await live.bridge.bind(core.name, owner);
		return live.bridge.invoke(
			owner,
			binding,
			"status",
			null,
			live.bridge.selectSession(owner, meta.sessionId),
		);
	};
	return {
		meta,
		cwd: meta.cwd,
		session: entry.session,
		errors,
		prompt,
		status,
		tools: () => [...(loaded()?.tools.keys() ?? [])],
		commands: () => [...(loaded()?.commands.keys() ?? [])],
		writeRoots: () => service.getTaskGrants().writeRoots(meta.sessionId),
		/** The last write was refused: by the task owner (no current plan) or the host's dialog. */
		refused: (path) => {
			const result = entry.session.messages.findLast(
				(m) => m.role === "toolResult" && m.toolName === "write",
			);
			return result?.isError === true && !existsSync(join(meta.cwd, path));
		},
	};
}

/** The backend as Desktop composes it; every host permission request is recorded and denied. */
async function startBackend(manager, agentDir, owner, dialogs, permissions) {
	const holder = {};
	live.backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		permissionGates: true,
		tools: ["read", "write", ...TASK_TOOLS],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			pluginRuntimeDirectory: runtimeDirectory,
			nativeRuntime: {
				manages: (path) => holder.native.manages(path),
				childExtensionPaths: () => holder.native.childExtensionPaths(),
				extensionPaths: () => holder.native.extensionPaths(),
				begin: (facts) => holder.native.begin(facts),
			},
		},
	});
	const service = live.backend.sessions;
	service.modelRuntime = await offlineModels(agentDir);
	holder.native = wire(manager, service, owner, dialogs);
	service.onPermissionRequest((request) => {
		permissions.push(request.message);
		queueMicrotask(() => service.respondPermission(request.id, "deny"));
	});
	return service;
}

async function setup() {
	live.root = await realpath(await mkdtemp(join(tmpdir(), "drone-builtin-core-")));
	const builtinRoot = join(live.root, "builtin", "node_modules");
	await cp(shipped, join(builtinRoot, "@gyoungwe", "pi-core"), { recursive: true });
	const home = join(live.root, "home"),
		agentDir = join(live.root, "agent");
	environment.userData = join(live.root, "user-data");
	await mkdir(join(environment.userData, "ui-plugins"), { recursive: true });
	await mkdir(agentDir);
	for (const [key, value] of Object.entries({ HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: agentDir }))
		vi.stubEnv(key, value);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "zh");
	const manager = new UiPluginManager({
		installedPackageRoot: join(agentDir, "npm", "node_modules"),
		builtinPackageRoot: builtinRoot,
	});
	await manager.scanAll();
	const owner = { id: 41, isDestroyed: () => false };
	const dialogs = [],
		permissions = [];
	const service = await startBackend(manager, agentDir, owner, dialogs, permissions);
	const [core] = manager.runtimeSources();
	const nativeEntry = manager.builtinExtensionPaths()[0];
	const attach = (meta) => attachSession({ service, owner, core, nativeEntry }, meta);
	const open = async (name) => {
		const cwd = join(home, name);
		await mkdir(join(cwd, "outputs"), { recursive: true });
		return attach(
			await service.createSession({ cwd, provider: live.faux.provider.id, modelId: live.faux.getModel().id }),
		);
	};
	return { manager, service, core, nativeEntry, builtinRoot, dialogs, permissions, open, attach };
}

it("ordinary chat asks nothing; one authorization completes a task whose files read back", async () => {
	const t = await setup();
	expect(t.manager.info(CORE_UI)).toMatchObject({
		enabled: true,
		builtin: true,
		packageName: "@gyoungwe/pi-core",
	});
	const s = await t.open("project");
	expect(s.tools().sort()).toEqual([...TASK_TOOLS].sort());
	await s.prompt("hello");
	expect(t.dialogs).toEqual([]);
	expect(t.permissions).toEqual([]);

	await s.prompt("TASK 2");
	expect((await s.status()).snapshot).toMatchObject({ state: "completed" });
	for (const n of [1, 2])
		expect(await readFile(join(s.cwd, `outputs/m${n}.txt`), "utf8")).toBe(`result ${n}`);
	expect(t.dialogs).toEqual(["capability:task.grant.request"]);
	expect(t.permissions).toEqual([]);
	expect(s.errors).toEqual([]);
}, 120000);

it("two sessions keep their own tasks and grants; closing one leaves the other working", async () => {
	const t = await setup();
	const a = await t.open("a"),
		b = await t.open("b");
	await a.prompt("TASK 1");
	expect((await a.status()).snapshot).toMatchObject({ state: "completed" });
	expect(a.writeRoots()).toEqual([join(a.cwd, "outputs")]);
	expect((await b.status()).snapshot).toBeNull();
	expect(b.writeRoots()).toBeUndefined();

	await t.service.closeSession(a.meta.sessionId);
	expect(a.writeRoots()).toBeUndefined();
	await b.prompt("TASK 1");
	expect((await b.status()).snapshot).toMatchObject({ state: "completed" });
	expect(await readFile(join(b.cwd, "outputs/m1.txt"), "utf8")).toBe("result 1");
	expect(t.dialogs).toEqual(["capability:task.grant.request", "capability:task.grant.request"]);
	expect(b.errors).toEqual([]);
}, 120000);

it("turning the built-in off removes its tools, commands and UI; turning it on brings them back", async () => {
	const t = await setup();
	const before = await t.open("before");
	expect(before.commands().sort()).toEqual(["task-action", "task-status"]);

	await t.manager.updateConfig({ plugins: { [CORE_UI]: { enabled: false, trusted: true } } });
	expect(t.manager.info(CORE_UI)).toMatchObject({ enabled: false });
	const off = await t.open("off");
	expect(off.session.resourceLoader.getExtensions().extensions.map((e) => e.path)).not.toContain(
		t.nativeEntry,
	);
	expect(off.session.getAllTools().map((tool) => tool.name)).not.toContain("task_plan");
	await t.service.reloadMcpSessions();
	expect(before.tools()).toEqual([]);
	expect(before.session.getAllTools().map((tool) => tool.name)).not.toContain("task_plan");

	await t.manager.updateConfig({ plugins: { [CORE_UI]: { enabled: true, trusted: true } } });
	const on = await t.open("on");
	expect(on.tools().sort()).toEqual([...TASK_TOOLS].sort());
	expect(on.commands().sort()).toEqual(["task-action", "task-status"]);
	expect(t.dialogs).toEqual([]);
}, 120000);

it("a reopened session must be authorized again", async () => {
	const t = await setup();
	const s = await t.open("project");
	await s.prompt("TASK 1");
	expect(s.writeRoots()).toEqual([join(s.cwd, "outputs")]);
	const file = s.session.sessionFile;
	await t.service.closeSession(s.meta.sessionId);
	const reopened = await t.attach(await t.service.openSession(file));
	expect(reopened.writeRoots()).toBeUndefined();
	await reopened.prompt("WRITE outputs/after.txt");
	expect(reopened.refused("outputs/after.txt")).toBe(true);
	expect(reopened.writeRoots()).toBeUndefined();
	expect(t.dialogs).toEqual(["capability:task.grant.request"]);
}, 120000);

it("a new built-in generation does not inherit the authorization, and neither does rolling back", async () => {
	const t = await setup();
	const s = await t.open("project");
	await s.prompt("TASK 1");
	expect(s.writeRoots()).toEqual([join(s.cwd, "outputs")]);
	const runtime = join(t.builtinRoot, "@gyoungwe/pi-core/dist/managed-runtime.mjs");
	const original = await readFile(runtime);
	await writeFile(runtime, `${original}\n// next Drone release\n`);
	await t.manager.scanAll();
	expect(s.writeRoots()).toBeUndefined();
	await s.prompt("WRITE outputs/upgraded.txt");
	expect(s.refused("outputs/upgraded.txt")).toBe(true);

	await writeFile(runtime, original);
	await t.manager.scanAll();
	expect(s.writeRoots()).toBeUndefined();
	await s.prompt("WRITE outputs/rolled-back.txt");
	expect(s.refused("outputs/rolled-back.txt")).toBe(true);
	expect(s.writeRoots()).toBeUndefined();
	expect(t.dialogs).toEqual(["capability:task.grant.request"]);
}, 120000);
