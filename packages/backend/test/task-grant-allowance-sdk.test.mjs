// Task authorization allowances through a real Pi SDK session and a real local HTTP server. The server's
// request log is the evidence: an approved write arrives without a second dialog, and a declined one never does.
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, onTestFinished, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { networkCapabilityHandlers } from "../src/plugins/network-capabilities";

const LABEL = "Save one item to Zotero";
const DENIED = "Plugin capability denied: network.write";
const taskRequest = {
	taskId: "save-paper",
	contractHash: "c".repeat(64),
	goal: "Save the paper",
	writeDirectories: [],
	acceptance: ["The item exists in Zotero"],
	maxCalls: 20,
	maxAutoResumes: 0,
	allowances: [{ id: "save-1", role: "acceptance", member: "zotero_item", label: LABEL }],
};

async function startServer() {
	const received = [];
	const server = createServer((request, response) => {
		received.push(`${request.method} ${request.url}`);
		request.resume();
		response.end("{}");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	onTestFinished(async () => {
		server.close();
		await once(server, "close");
	});
	return { received, host: `127.0.0.1:${server.address().port}` };
}

async function startSession() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-task-allowance-")));
	const agentDir = join(root, "agent");
	const cwd = join(root, "home", "project");
	await mkdir(agentDir);
	await mkdir(cwd, { recursive: true });
	await writeFile(join(agentDir, "permissions.json"), JSON.stringify({ autoApproveProjectEdits: false }));
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
	const faux = fauxProvider({ provider: "task-allowance-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	const backend = new PiBackend({
		projectTrust: false,
		lazyCapabilities: false,
		tools: ["read"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
		},
	});
	backend.modelRuntime = runtime;
	onTestFinished(async () => {
		for (const entry of backend.registry.list()) await backend.closeSession(entry.session.sessionId);
		backend.dispose();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	});
	const meta = await backend.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	return { root, backend, sessionId: meta.sessionId };
}

/** A task plugin that requests the grant, and the provider plugin the host resolves its allowance to. */
function fixturePlugins(root, host) {
	const operation = (execute) => ({
		effect: "read",
		inputSchema: {},
		resultSchema: {},
		execute,
	});
	const requester = {
		pluginId: "task-fixture",
		packageRoot: root,
		entrypoint: join(root, "task.mjs"),
		contentHash: "a".repeat(64),
		requestsTaskGrant: true,
		consumes: { acceptance: { servicePrefix: "acceptance.", version: 1 } },
	};
	const provider = {
		pluginId: "zotero-fixture",
		packageRoot: root,
		entrypoint: join(root, "zotero.mjs"),
		contentHash: "b".repeat(64),
		provides: { "acceptance.zotero_item": { version: 1, operations: ["save"] } },
	};
	const operations = {
		[requester.pluginId]: {
			start: operation((_input, context) => context.capabilities.call("task.grant.request", taskRequest)),
		},
		// Read-declared: the only question is the one network.write itself raises.
		[provider.pluginId]: {
			save: operation((input, context) =>
				context.capabilities.call("network.write", { method: "POST", url: `http://${host}/items`, ...input }),
			),
			allowances: operation((_input, context) => context.capabilities.call("task.grant.allowances", null)),
		},
	};
	return { requester, provider, operations };
}

async function setup() {
	const { received, host } = await startServer();
	const { root, backend, sessionId } = await startSession();
	const { requester, provider, operations } = fixturePlugins(root, host);
	const sources = { [requester.pluginId]: requester, [provider.pluginId]: provider };
	const dialogs = [];
	const bridge = new PluginRuntimeBridge({
		source: (name) => sources[name],
		sources: () =>
			Object.values(sources).map((source) => ({ name: source.pluginId, source, state: "enabled" })),
		enabled: () => true,
		taskGrants: backend.getTaskGrants(),
		getSessionContext: (id) => backend.getPluginCallerContext(id),
		capabilities: (source) => ({
			resources: [],
			handlers: {
				...backend.getPluginSourceCapabilities(source),
				...(source === provider ? networkCapabilityHandlers({ hosts: [host], reads: [] }) : {}),
			},
		}),
		// The user approves the task and declines every separate write dialog.
		approve: async (_owner, _source, operation, detail) => {
			if (!operation) return true;
			dialogs.push({ operation, detail });
			return operation === "capability:task.grant.request";
		},
		factory: (source) => async () => ({
			operations: operations[source.pluginId],
			dispose: () => Promise.resolve(),
		}),
	});
	onTestFinished(() => bridge.close());

	const owner = { id: 7, isDestroyed: () => false };
	const taskToken = await bridge.bind(requester.pluginId, owner);
	const providerToken = await bridge.bind(provider.pluginId, owner);
	const selection = bridge.selectSession(owner, sessionId);
	return {
		host,
		received,
		dialogs,
		start: () => bridge.invoke(owner, taskToken, "start", null, selection),
		save: (input = {}) => bridge.invoke(owner, providerToken, "save", input, selection),
		allowances: () => bridge.invoke(owner, providerToken, "allowances", null, selection),
	};
}

it("a write named in the authorization reaches the server once with no second dialog", async () => {
	const t = await setup();
	await t.start();
	expect(t.dialogs).toEqual([
		{
			operation: "capability:task.grant.request",
			detail: expect.stringMatching(new RegExp(`${LABEL}.*zotero-fixture`)),
		},
	]);
	t.dialogs.length = 0;
	expect(await t.allowances()).toMatchObject({
		taskId: "save-paper",
		allowances: [{ id: "save-1", member: "zotero_item", used: false }],
	});

	await expect(t.save({ allowance: "save-1" })).resolves.toMatchObject({ status: 200 });
	expect(t.received).toEqual(["POST /items"]);
	expect(t.dialogs).toEqual([]);
	expect(await t.allowances()).toMatchObject({ allowances: [{ id: "save-1", used: true }] });

	// One approved write is one write: using it again asks, and the declined retry never leaves the host.
	await expect(t.save({ allowance: "save-1" })).rejects.toThrow(DENIED);
	expect(t.dialogs.map((dialog) => dialog.operation)).toEqual(["capability:network.write"]);
	expect(t.received).toEqual(["POST /items"]);
});

it("a write outside the authorization asks, and declining sends nothing", async () => {
	const t = await setup();
	await t.start();
	t.dialogs.length = 0;

	await expect(t.save()).rejects.toThrow(DENIED);
	await expect(t.save({ allowance: "not-granted" })).rejects.toThrow(DENIED);
	expect(t.dialogs).toEqual([
		{ operation: "capability:network.write", detail: expect.stringContaining(`POST ${t.host}/items`) },
		{ operation: "capability:network.write", detail: expect.stringContaining(`POST ${t.host}/items`) },
	]);
	expect(t.received).toEqual([]);
	expect(await t.allowances()).toMatchObject({ allowances: [{ id: "save-1", used: false }] });
});
