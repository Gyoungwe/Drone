// Host-issued task grant through a real Pi SDK session (docs/superpowers/specs/2026-10-29-host-task-grant-design.md).
// A managed plugin asks for one task authorization; afterwards the model's writes inside the approved
// folder need no confirmation, writes elsewhere still ask, own bookkeeping never prompts, and the grant
// ends with the session or when the plugin source stops being current.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";

let root, backend, bridge;
afterEach(async () => {
	await bridge?.close();
	if (backend) {
		for (const entry of backend.registry.list()) await backend.closeSession(entry.session.sessionId);
		backend.dispose();
	}
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (root) await rm(root, { recursive: true, force: true });
	root = backend = bridge = undefined;
});

const request = {
	taskId: "figure-2",
	contractHash: "c".repeat(64),
	goal: "Reproduce figure 2",
	writeDirectories: ["outputs"],
	acceptance: ["outputs/figure.txt exists"],
	maxCalls: 20,
	maxAutoResumes: 1,
};

async function setup() {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-task-grant-")));
	const agentDir = join(root, "agent"),
		cwd = join(root, "home", "project");
	await mkdir(agentDir);
	await mkdir(join(cwd, "outputs"), { recursive: true });
	// Project edits ask (the task grant is what removes the question), as with automatic edits off.
	await writeFile(
		join(agentDir, "permissions.json"),
		JSON.stringify({ autoApproveProjectEdits: false, rules: { read: { "*": "allow", "*secret*": "deny" } } }),
	);
	vi.stubEnv("HOME", join(root, "home"));
	vi.stubEnv("USERPROFILE", join(root, "home"));
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "task-grant-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	backend = new PiBackend({
		projectTrust: false,
		lazyCapabilities: false,
		tools: ["read", "write"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
		},
	});
	backend.modelRuntime = runtime;
	const permissions = [];
	backend.onPermissionRequest((req) => {
		permissions.push(req.message);
		queueMicrotask(() => backend.respondPermission(req.id, "deny"));
	});
	const meta = await backend.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	const session = backend.registry.get(meta.sessionId).session;

	let current = true;
	const source = {
		pluginId: "task-fixture",
		packageRoot: root,
		entrypoint: join(root, "runtime.mjs"),
		requestsTaskGrant: true,
	};
	const dialogs = [];
	bridge = new PluginRuntimeBridge({
		source: () => (current ? source : undefined),
		sources: () => [{ name: "task-fixture", source, state: current ? "enabled" : "disabled" }],
		enabled: () => current,
		taskGrants: backend.getTaskGrants(),
		getSessionContext: (id) => backend.getPluginCallerContext(id),
		capabilities: () => ({
			resources: [],
			handlers: {
				"session.records.append": backend.getPluginSessionCapabilities()["session.records.append"],
				"session.notify": backend.getPluginSessionCapabilities()["session.notify"],
				...backend.getPluginTaskGrantCapabilities(source),
				...backend.getPluginWorkspaceCapabilities(),
			},
		}),
		approve: async (_owner, _source, operation, detail) => {
			if (operation) dialogs.push({ operation, detail });
			return true;
		},
		factory: () => async () => ({
			operations: {
				start: {
					effect: "read",
					inputSchema: { type: "null" },
					resultSchema: { type: "object" },
					execute: (_input, context) => context.capabilities.call("task.grant.request", request),
				},
				notify: {
					effect: "write",
					inputSchema: {},
					resultSchema: { type: "object" },
					execute: (input, context) => context.capabilities.call("session.notify", input),
				},
				readFile: {
					effect: "read",
					inputSchema: {},
					resultSchema: { type: "object" },
					execute: (input, context) => context.capabilities.call("workspace.readFile", input),
				},
				proceed: {
					effect: "write",
					inputSchema: { type: "null" },
					resultSchema: { type: "object" },
					execute: (_input, context) =>
						context.capabilities.call("task.continue", {
							taskId: request.taskId,
							prompt: "Continue the figure.",
						}),
				},
				checkpoint: {
					effect: "write",
					inputSchema: { type: "null" },
					resultSchema: { type: "object" },
					execute: (_input, context) =>
						context.capabilities.call("session.records.append", { type: "task.checkpoint", data: { n: 1 } }),
				},
			},
			dispose: async () => {},
		}),
	});
	const owner = { id: 7, isDestroyed: () => false };
	const token = await bridge.bind("task-fixture", owner);
	const selection = bridge.selectSession(owner, meta.sessionId);
	const invoke = (operation, input = null) => bridge.invoke(owner, token, operation, input, selection);
	const write = async (path) => {
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path, content: "result" })),
			fauxAssistantMessage("done"),
		]);
		await session.prompt(`write ${path}`, { expandPromptTemplates: false });
		await session.agent.waitForIdle?.();
	};
	return {
		faux,
		session,
		cwd,
		meta,
		permissions,
		dialogs,
		invoke,
		write,
		disable: () => {
			current = false;
		},
	};
}

it("one host dialog covers task writes inside the approved folder; elsewhere still asks", async () => {
	const t = await setup();
	await t.write("outputs/before.txt");
	expect(t.permissions).toHaveLength(1);
	expect(existsSync(join(t.cwd, "outputs/before.txt"))).toBe(false);
	t.permissions.length = 0;

	const grant = await t.invoke("start");
	expect(grant).toMatchObject({ taskId: "figure-2", writeRoots: [join(t.cwd, "outputs")] });
	expect(t.dialogs).toEqual([
		{ operation: "capability:task.grant.request", detail: expect.stringContaining("Reproduce figure 2") },
	]);
	t.dialogs.length = 0;

	await t.write("outputs/figure.txt");
	expect(await readFile(join(t.cwd, "outputs/figure.txt"), "utf8")).toBe("result");
	expect(t.permissions).toEqual([]);

	await t.write("elsewhere.txt");
	expect(t.permissions).toHaveLength(1);
	expect(existsSync(join(t.cwd, "elsewhere.txt"))).toBe(false);

	// The plugin's own checkpoint and its covered write operation need no dialog under the grant.
	await t.invoke("checkpoint");
	expect(t.dialogs).toEqual([]);
});

it("the grant ends when the plugin source stops being current", async () => {
	const t = await setup();
	await t.invoke("start");
	t.disable();
	await t.write("outputs/after.txt");
	expect(t.permissions).toHaveLength(1);
	expect(existsSync(join(t.cwd, "outputs/after.txt"))).toBe(false);
});

it("the grant ends with the session", async () => {
	const t = await setup();
	await t.invoke("start");
	expect(backend.getTaskGrants().writeRoots(t.meta.sessionId)).toEqual([join(t.cwd, "outputs")]);
	await backend.closeSession(t.meta.sessionId);
	expect(backend.getTaskGrants().writeRoots(t.meta.sessionId)).toBeUndefined();
});

it("status cards render as host status without a dialog; continuation starts one hidden turn within budget", async () => {
	const t = await setup();
	const view = { version: 2, revision: 3, tasks: [], limits: {} };
	await t.invoke("notify", { content: "Task is running", view });
	await expect(t.invoke("notify", { content: "bad", view: { version: 1 } })).rejects.toThrow(
		"Invalid task view",
	);
	expect(t.dialogs.filter((dialog) => dialog.operation === "capability:session.notify")).toEqual([]);
	const status = (await backend.getSessionMessages(t.meta.sessionId)).filter((message) => message.hostStatus);
	expect(status).toMatchObject([{ text: "Task is running", taskView: { revision: 3 } }]);

	await expect(t.invoke("proceed")).rejects.toThrow("current task authorization");
	await t.invoke("start");
	t.dialogs.length = 0;
	t.faux.setResponses([fauxAssistantMessage("continued")]);
	expect(await t.invoke("proceed")).toMatchObject({ remaining: 0 });
	await vi.waitFor(() => expect(t.faux.state.callCount).toBeGreaterThan(0));
	await t.session.agent.waitForIdle?.();
	const hidden = t.session.messages.find((message) => message.customType === "plugin-continue:task-fixture");
	expect(hidden).toMatchObject({
		display: false,
		content: "Continue the figure.",
		details: { taskId: "figure-2" },
	});
	await expect(t.invoke("proceed")).rejects.toThrow("used up");
	expect(t.dialogs).toEqual([]);
});

it("workspace reads follow the session's current read permissions, including through links", async () => {
	const t = await setup();
	await writeFile(join(t.cwd, "outputs", "table.csv"), "a,b\n");
	await writeFile(join(t.cwd, "secret.txt"), "token");
	await symlink(join(t.cwd, "secret.txt"), join(t.cwd, "outputs", "innocent.txt"));
	const read = await t.invoke("readFile", { path: "outputs/table.csv" });
	expect(read).toMatchObject({
		path: join(t.cwd, "outputs", "table.csv"),
		workspacePath: "outputs/table.csv",
		bytes: 4,
	});
	expect(Buffer.from(read.base64, "base64").toString()).toBe("a,b\n");
	await expect(t.invoke("readFile", { path: "secret.txt" })).rejects.toThrow("denied");
	await expect(t.invoke("readFile", { path: "outputs/innocent.txt" })).rejects.toThrow("denied");
	await backend.closeSession(t.meta.sessionId);
	await expect(t.invoke("readFile", { path: "outputs/table.csv" })).rejects.toThrow();
});
