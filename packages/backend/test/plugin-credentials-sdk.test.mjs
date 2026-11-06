// Host-kept plugin credentials through a real Pi SDK session and a real local HTTP server
// (docs/superpowers/specs/2026-11-06-plugin-credentials-design.md). The server's request log is the evidence:
// the saved secret arrives as the declared header, the plugin only ever sees status, and nothing is sent unsaved.
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, onTestFinished, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { PluginCredentialStore } from "../src/plugins/plugin-credentials";

const SECRET = "fixture-secret-0123456789";

async function startServer() {
	const received = [];
	const server = createServer((request, response) => {
		received.push({ path: `${request.method} ${request.url}`, key: request.headers["zotero-api-key"] });
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
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-plugin-credentials-")));
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
	const faux = fauxProvider({ provider: "plugin-credentials-offline", tokensPerSecond: 0 });
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
	return { root, agentDir, backend, sessionId: meta.sessionId };
}

async function setup() {
	const { received, host } = await startServer();
	const { root, agentDir, backend, sessionId } = await startSession();
	const slot = {
		slot: "zotero-web",
		label: { zh: "Zotero 网页 API 密钥", en: "Zotero Web API key" },
		hosts: [host],
		header: "Zotero-API-Key",
		fields: ["libraryId"],
	};
	const source = {
		pluginId: "zotero-fixture",
		packageRoot: root,
		entrypoint: join(root, "zotero.mjs"),
		contentHash: "b".repeat(64),
		networkHosts: [host, "127.0.0.1:1"],
		credentials: [slot],
	};
	const operation = (execute) => ({ effect: "read", inputSchema: {}, resultSchema: {}, execute });
	const bridge = new PluginRuntimeBridge({
		source: () => source,
		sources: () => [{ name: source.pluginId, source, state: "enabled" }],
		enabled: () => true,
		taskGrants: backend.getTaskGrants(),
		getSessionContext: (id) => backend.getPluginCallerContext(id),
		capabilities: (s) => ({ resources: [], handlers: backend.getPluginSourceCapabilities(s) }),
		approve: async () => true,
		factory: () => async () => ({
			operations: {
				get: operation((input, context) =>
					context.capabilities.call("network.read", { method: "GET", url: `http://${host}/keys`, ...input }),
				),
				status: operation((_input, context) => context.capabilities.call("credentials.status", null)),
			},
			dispose: () => Promise.resolve(),
		}),
	});
	onTestFinished(() => bridge.close());
	const owner = { id: 9, isDestroyed: () => false };
	const token = await bridge.bind(source.pluginId, owner);
	const selection = bridge.selectSession(owner, sessionId);
	return {
		host,
		received,
		agentDir,
		save: () => new PluginCredentialStore().save(source.pluginId, slot, SECRET, { libraryId: "123" }),
		get: (input = {}) => bridge.invoke(owner, token, "get", input, selection),
		status: () => bridge.invoke(owner, token, "status", null, selection),
	};
}

it("the host adds the saved secret as the declared header; the plugin sees only status", async () => {
	const t = await setup();
	await t.save();
	expect((await stat(join(t.agentDir, "plugin-credentials.json"))).mode & 0o777).toBe(0o600);

	const status = await t.status();
	expect(status).toEqual({ slots: { "zotero-web": { configured: true, fields: { libraryId: "123" } } } });
	expect(JSON.stringify(status)).not.toContain(SECRET);

	await expect(t.get({ credential: "zotero-web" })).resolves.toMatchObject({ status: 200 });
	await expect(t.get()).resolves.toMatchObject({ status: 200 });
	expect(t.received).toEqual([
		{ path: "GET /keys", key: SECRET },
		{ path: "GET /keys", key: undefined },
	]);
});

it("nothing leaves the host when the secret is unsaved, sent elsewhere, or the header is forged", async () => {
	const t = await setup();
	await expect(t.get({ credential: "zotero-web" })).rejects.toThrow("not configured");
	expect(await t.status()).toEqual({ slots: { "zotero-web": { configured: false, fields: {} } } });

	await t.save();
	await expect(t.get({ credential: "zotero-web", url: "http://127.0.0.1:1/keys" })).rejects.toThrow(
		"may not be sent",
	);
	await expect(t.get({ credential: "other" })).rejects.toThrow("not declared");
	await expect(t.get({ headers: { "zotero-api-key": "forged" } })).rejects.toThrow("reserved for the host");
	expect(t.received).toEqual([]);
});
