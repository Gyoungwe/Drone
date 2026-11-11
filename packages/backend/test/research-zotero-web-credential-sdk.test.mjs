// The installed @gyoungwe/pi-research package changes an existing Zotero item through the Web API with the
// key Drone keeps for it (docs/superpowers/specs/2026-11-06-plugin-credentials-design.md, acceptance item 3).
// A real SDK session, the real restricted plugin process and the host's own capabilities; only the Web API
// upstream is fake, answering the host's outgoing fetch. Its request log is the evidence: every request
// carries the saved key as the declared header, and the key never reaches the plugin or the transcript.
// The same session also writes through Zotero 10's local API with the key Settings authorized, which the
// host keeps and attaches to pi-research's `zotero-local` slot (writes only).
import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { PluginCredentialStore } from "../src/plugins/plugin-credentials";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

const live = {};
afterEach(async () => {
	await live.bridge?.close();
	await live.backend?.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	if (live.root) await rm(live.root, { recursive: true, force: true });
	for (const key of Object.keys(live)) delete live[key];
});

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const SECRET = "fixture-secret-0123456789";
const ITEM = "ABCD2345";
const COLLECTION = "COLL2345";
const LOCAL_SECRET = "FakeLocalKey123";
const SERVER_ID = "TESTSERVER1";

async function installResearch() {
	const nodeModules = join(live.root, "builtin", "node_modules");
	await cp(
		resolve(import.meta.dirname, "../../desktop/plugin-packages/node_modules/@gyoungwe/pi-research"),
		join(nodeModules, "@gyoungwe", "pi-research"),
		{ recursive: true },
	);
	return (await discoverInstalledPackages(nodeModules)).map((item) => {
		if ("error" in item || !item.runtime) throw new Error(JSON.stringify(item));
		return { name: `package:${item.packageRoot}`, source: item.runtime, state: "enabled" };
	});
}

/**
 * Zotero for user library 42: one item, one collection, nothing else. It answers as the Web API and as
 * Zotero 10's local API on 127.0.0.1:23119 (library users/0, server SERVER_ID); the connector is offline.
 */
function zoteroApis() {
	const received = [];
	let collections = [];
	const json = (value, headers = {}) =>
		new Response(JSON.stringify(value), {
			status: 200,
			headers: { "content-type": "application/json", ...headers },
		});
	const fetchImpl = async (url, init = {}) => {
		const { host, pathname } = new URL(url);
		const local = host === "127.0.0.1:23119";
		if (!local && host !== "api.zotero.org") throw new Error(`Unexpected upstream ${host}`);
		const method = init.method || "GET";
		const headers = new Headers(init.headers);
		received.push({ request: `${method} ${host}${pathname}`, key: headers.get("zotero-api-key") });
		if (local && pathname.startsWith("/connector/")) throw new TypeError("fetch failed");
		if (local && pathname === "/api/") return json({}, { "zotero-server-id": SERVER_ID });
		const library = local ? "/api/users/0" : "/users/42";
		if (pathname === "/keys/current")
			return json({ userID: 42, username: "reader", access: { user: { library: true, write: true } } });
		if (pathname === `${library}/collections`)
			return json([{ key: COLLECTION, data: { name: "Gut" } }], { "total-results": "1" });
		if (pathname === `${library}/items/${ITEM}/children`) return json([], { "total-results": "0" });
		if (pathname === `${library}/items/${ITEM}` && method === "GET")
			return json({
				key: ITEM,
				version: 7,
				data: { title: "Gut signatures", itemType: "journalArticle", collections },
			});
		if (pathname === `${library}/items/${ITEM}` && method === "PATCH") {
			collections = JSON.parse(init.body).collections;
			return new Response(null, { status: 204 });
		}
		throw new Error(`Unexpected Zotero request ${method} ${host}${pathname}`);
	};
	return { received, fetchImpl };
}

async function isolateHome() {
	const home = join(live.root, "home"),
		cwd = join(home, "project"),
		agentDir = join(live.root, "agent");
	await mkdir(cwd, { recursive: true });
	await mkdir(agentDir);
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	// Zotero 10 local writes are authorized in Settings, which leaves the key in the host's environment.
	vi.stubEnv("ZOTERO_LOCAL_API_KEY", undefined);
	vi.stubEnv("ZOTERO_LOCAL_SERVER_ID", undefined);
	return { cwd, agentDir };
}

async function offlineModel(agentDir) {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "research-credential-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	return { modelRuntime, faux };
}

function startBackend(catalog) {
	const owner = { id: 41, isDestroyed: () => false };
	live.backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		permissionGates: true,
		tools: ["read", "research_zotero_update"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: catalog.map((item) => item.source.nativeEntrypoint),
			pluginRuntimeDirectory: runtimeDirectory,
			nativeRuntime: {
				begin: () =>
					live.bridge.beginNative(
						owner,
						(path) => catalog.find((i) => i.source.nativeEntrypoint === path)?.name,
					),
				manages: (path) => catalog.some((i) => i.source.nativeEntrypoint === path),
			},
		},
	});
	return live.backend.sessions;
}

function startBridge(catalog, service, dialogs, allowWrite) {
	live.bridge = new PluginRuntimeBridge({
		source: (name) => catalog.find((item) => item.name === name)?.source,
		sources: () => catalog,
		enabled: () => true,
		approve: async (_owner, _source, operation) => {
			dialogs.push(operation);
			return operation !== "capability:network.write" || allowWrite;
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
}

async function setup(allowWrite = true) {
	live.root = await realpath(await mkdtemp(join(tmpdir(), "drone-research-credential-")));
	const catalog = await installResearch();
	const research = catalog.find((item) => item.source.pluginId === "@gyoungwe/pi-research");
	const { cwd, agentDir } = await isolateHome();
	// The host's network capability fetches unchanged; the fake answers in place of api.zotero.org.
	const zotero = zoteroApis();
	vi.stubGlobal("fetch", zotero.fetchImpl);
	const { modelRuntime, faux } = await offlineModel(agentDir);
	const service = startBackend(catalog);
	service.modelRuntime = modelRuntime;
	const dialogs = [];
	startBridge(catalog, service, dialogs, allowWrite);
	const meta = await service.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	const entry = service.registry.get(meta.sessionId);
	const errors = [];
	entry.session.extensionRunner.onError((error) => errors.push(`${error.event}: ${error.error}`));
	// The offline model files the item into the collection once, then stops.
	faux.setResponses([
		fauxAssistantMessage(
			[fauxToolCall("research_zotero_update", { zotero_key: ITEM, collection_key: COLLECTION })],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage("filed"),
	]);
	const run = async () => {
		await entry.session.prompt("File the paper under Gut", { expandPromptTemplates: false });
		await entry.session.agent.waitForIdle?.();
		await entry.session.waitForIdle?.();
		await vi.waitFor(() => expect(entry.session.isStreaming).toBe(false));
	};
	return {
		zotero,
		dialogs,
		errors,
		run,
		result: () =>
			entry.session.messages.findLast(
				(m) => m.role === "toolResult" && m.toolName === "research_zotero_update",
			),
		save: () =>
			new PluginCredentialStore().save(research.source.pluginId, research.source.credentials[0], SECRET, {
				libraryType: "users",
				libraryId: "42",
			}),
		transcript: () => JSON.stringify(entry.session.messages),
	};
}

const web = (received) => received.filter((r) => r.request.includes(" api.zotero.org/"));

it("the research package files an item through the Web API with the key the host attaches", async () => {
	const t = await setup();
	await t.save();
	await t.run();
	expect(t.errors).toEqual([]);
	expect(t.result()?.details).toMatchObject({
		channel: "web",
		zoteroKey: ITEM,
		changes: { addCollection: { key: COLLECTION, httpStatus: 204, error: null, verified: true } },
		readBack: { collections: [COLLECTION] },
	});
	expect(web(t.zotero.received).map((r) => r.request)).toEqual([
		"GET api.zotero.org/keys/current",
		`GET api.zotero.org/users/42/items/${ITEM}`,
		"GET api.zotero.org/users/42/collections",
		`PATCH api.zotero.org/users/42/items/${ITEM}`,
		`GET api.zotero.org/users/42/items/${ITEM}`,
		`GET api.zotero.org/users/42/items/${ITEM}/children`,
	]);
	// Every request carries the saved key, never the plugin's stand-in; the key itself stays with the host.
	expect(web(t.zotero.received).every((r) => r.key === SECRET)).toBe(true);
	expect(t.zotero.received.some((r) => r.request.includes("/api/"))).toBe(false);
	expect(t.dialogs.filter((d) => d === "capability:network.write")).toHaveLength(1);
	expect(t.transcript()).not.toContain(SECRET);
}, 120000);

it("without a saved key the update is blocked and nothing reaches the Web API", async () => {
	const t = await setup();
	await t.run();
	expect(t.errors).toEqual([]);
	expect(t.result()?.details).toMatchObject({ status: "blocked", channel: "web" });
	expect(web(t.zotero.received)).toEqual([]);
	expect(t.zotero.received.filter((r) => r.request.startsWith("PATCH"))).toEqual([]);
	expect(t.dialogs).not.toContain("capability:network.write");
}, 120000);

it("a declined managed update reports denial and writes nothing", async () => {
	const t = await setup(false);
	await t.save();
	await t.run();
	expect(t.errors).toEqual([]);
	expect(t.result()?.isError).toBe(true);
	expect(t.result()?.content).toEqual([{ type: "text", text: "Plugin capability denied: network.write" }]);
	expect(t.zotero.received.filter((r) => r.request.startsWith("PATCH"))).toEqual([]);
	expect(t.dialogs.filter((d) => d === "capability:network.write")).toHaveLength(1);
}, 120000);

it("the research package files an item through Zotero 10's local API with the key Settings authorized", async () => {
	const t = await setup();
	vi.stubEnv("ZOTERO_LOCAL_API_KEY", LOCAL_SECRET);
	vi.stubEnv("ZOTERO_LOCAL_SERVER_ID", SERVER_ID);
	await t.run();
	expect(t.errors).toEqual([]);
	expect(t.result()?.details).toMatchObject({
		status: "updated",
		channel: "local",
		zoteroKey: ITEM,
		library: { type: "users", id: "0", local: true },
		changes: { addCollection: { key: COLLECTION, httpStatus: 204, error: null, verified: true } },
		readBack: { collections: [COLLECTION] },
	});
	expect(web(t.zotero.received)).toEqual([]);
	// Only the write carries the key, filled in by the host; reads and the plugin never see it.
	const writes = t.zotero.received.filter((r) => r.request.startsWith("PATCH"));
	expect(writes).toEqual([{ request: `PATCH 127.0.0.1:23119/api/users/0/items/${ITEM}`, key: LOCAL_SECRET }]);
	expect(t.zotero.received.filter((r) => r.key !== null)).toEqual(writes);
	expect(t.dialogs.filter((d) => d === "capability:network.write")).toHaveLength(1);
	expect(t.transcript()).not.toContain(LOCAL_SECRET);
}, 120000);
