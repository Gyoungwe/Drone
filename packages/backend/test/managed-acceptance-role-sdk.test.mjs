// A task milestone checked by another plugin, through a real SDK session, real restricted workers and
// installed packages (docs/superpowers/specs/2026-11-05-task-acceptance-role-design.md, §1–3): the
// installed @gyoungwe/pi-core managed runtime consumes the role `acceptance`, and the real
// @gyoungwe/pi-research package provides `task.acceptance:zotero_item`. Only Zotero itself is fake: the
// host's network capability runs unchanged and answers through an injected transport for 127.0.0.1:23119.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { beginKnowledgeFlow, flowFor, noteKnowledgeOperation } from "@gyoungwe/pi-knowledge/host";
import { afterEach, expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { networkCapabilityHandlers } from "../src/plugins/network-capabilities";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

let root, backend, bridge;
afterEach(async () => {
	await bridge?.close();
	await backend?.dispose();
	bridge = backend = undefined;
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const require = createRequire(import.meta.url);
const TASKS_RUNTIME = `import {createManagedTaskApplication} from './dist/managed-runtime.mjs';
export default async context=>{
 const app=createManagedTaskApplication(context);
 return {...app,operations:{...app.operations,
  fixtureView:{effect:'read',inputSchema:{type:'null'},resultSchema:{type:'object'},execute:(_input,ctx)=>app.withCurrentSession(ctx.signal,session=>session.controller.journal.view())},
 }};
};`;
const DOI = "10.1000/gut.2021.001";
// The pi-core manifest gets these with the §5.3 cutover; the fixture only adds them early.
const CUTOVER_SERVICES = {
	requires: { knowledge: { service: "knowledge.binding", version: 1 } },
	consumes: { acceptance: { servicePrefix: "task.acceptance:", version: 1 } },
};

async function pack(dir) {
	const [packed] = JSON.parse(
		execFileSync(
			"npm",
			["pack", "--ignore-scripts", "--json", "--cache", join(root, "npm-cache"), "--pack-destination", root],
			{
				cwd: dir,
				encoding: "utf8",
			},
		),
	);
	return join(root, packed.filename);
}

async function install() {
	const tasks = join(root, "tasks");
	await mkdir(tasks);
	await writeFile(
		join(tasks, "package.json"),
		JSON.stringify({
			name: "@fixture/tasks",
			version: "1.0.0",
			type: "module",
			files: ["runtime.mjs", "native.mjs", "plugin.manifest.json", "dist"],
			pi: { extensions: ["./native.mjs"] },
		}),
	);
	await writeFile(join(tasks, "runtime.mjs"), TASKS_RUNTIME);
	await writeFile(
		join(tasks, "native.mjs"),
		"export default()=>{throw new Error('Desktop must use the managed owner.');};",
	);
	await cp(dirname(require.resolve("@gyoungwe/pi-core")), join(tasks, "dist"), { recursive: true });
	await writeFile(
		join(tasks, "plugin.manifest.json"),
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
				...CUTOVER_SERVICES,
				provides: { "fixture.tasks": { version: 1, operations: ["fixtureView"] } },
			},
			permissions: { filesystem: ["workspace-read"], network: [], subprocess: [] },
			tools: [],
		}),
	);
	const nodeModules = join(root, "installed", "node_modules");
	const taskPackage = join(nodeModules, "@fixture", "tasks");
	await mkdir(taskPackage, { recursive: true });
	execFileSync("tar", ["-xzf", await pack(tasks), "-C", taskPackage, "--strip-components=1"]);
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

/** Zotero desktop as the network capability's upstream: connector and local API, nothing else. */
function zoteroDesktop() {
	const received = [];
	let saved = false;
	const json = (value, headers = {}) =>
		new Response(JSON.stringify(value), {
			status: 200,
			headers: { "content-type": "application/json", ...headers },
		});
	const fetchImpl = async (url, init = {}) => {
		const { host, pathname } = new URL(url);
		if (host !== "127.0.0.1:23119") throw new Error(`Unexpected upstream ${host}`);
		received.push(`${init.method || "GET"} ${pathname}`);
		if (pathname === "/connector/ping") return json({});
		if (pathname === "/connector/getSelectedCollection")
			return json({ libraryID: 1, libraryName: "My Library", libraryEditable: true });
		if (pathname === "/connector/saveItems") {
			saved = true;
			return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
		}
		if (pathname.endsWith("/children")) return json([], { "total-results": "0" });
		if (pathname === "/api/users/0/items") {
			const items = saved
				? [
						{
							key: "ABCD2345",
							data: { DOI, title: "Gut signatures", itemType: "journalArticle", collections: [] },
						},
					]
				: [];
			return json(items, { "total-results": String(items.length) });
		}
		throw new Error(`Unexpected Zotero request ${pathname}`);
	};
	return { received, fetchImpl };
}

async function setup() {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-acceptance-role-")));
	const catalog = await install();
	const tasks = catalog.find((item) => item.source.pluginId === "@fixture/tasks");
	const home = join(root, "home"),
		cwd = join(home, "project"),
		agentDir = join(root, "agent");
	await mkdir(join(cwd, "outputs"), { recursive: true });
	await mkdir(agentDir);
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "zh");
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "acceptance-role-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	const owner = { id: 31, isDestroyed: () => false };
	const zotero = zoteroDesktop();
	const dialogs = [];
	const details = [];
	let service,
		approve = true;
	backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		permissionGates: true,
		tools: ["read", "task_plan", "task_wait", "task_status", "task_reconcile", "research_zotero_save"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: catalog.map((item) => item.source.nativeEntrypoint),
			pluginRuntimeDirectory: runtimeDirectory,
			nativeRuntime: {
				begin: () =>
					bridge.beginNative(owner, (path) => catalog.find((i) => i.source.nativeEntrypoint === path)?.name),
				manages: (path) => catalog.some((i) => i.source.nativeEntrypoint === path),
			},
		},
	});
	service = backend.sessions;
	service.modelRuntime = modelRuntime;
	bridge = new PluginRuntimeBridge({
		source: (name) => catalog.find((item) => item.name === name && item.state === "enabled")?.source,
		sources: () => catalog,
		enabled: (name) => catalog.some((item) => item.name === name && item.state === "enabled"),
		// The user answers the task authorization and any write dialog the same way.
		approve: async (_owner, _source, operation, detail) => {
			dialogs.push(operation);
			details.push(detail);
			return /^capability:(?:task\.grant\.request|network\.write)$/.test(operation ?? "") ? approve : true;
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
				...(source.networkHosts
					? networkCapabilityHandlers(
							{ hosts: source.networkHosts, reads: source.networkReads ?? [] },
							zotero.fetchImpl,
						)
					: {}),
			},
		}),
	});
	const meta = await service.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	const entry = service.registry.get(meta.sessionId);
	const errors = [];
	entry.session.extensionRunner.onError((error) => errors.push(`${error.event}: ${error.error}`));
	const binding = await bridge.bind(tasks.name, owner),
		selection = bridge.selectSession(owner, meta.sessionId);
	// The offline model plans one DOI-less Zotero milestone, saves one paper, then stops.
	const respond = (context) => {
		if (!getCurrentTools(context.messages || []).some((tool) => tool.name === "task_plan"))
			return fauxAssistantMessage("internal");
		const last = context.messages.findLast((m) => m.role === "assistant" || m.role === "toolResult");
		if (last?.role === "toolResult")
			return last.toolName === "task_plan"
				? fauxAssistantMessage(
						[fauxToolCall("research_zotero_save", { doi: DOI, title: "Gut signatures" })],
						{
							stopReason: "toolUse",
						},
					)
				: fauxAssistantMessage("saved");
		return fauxAssistantMessage(
			[
				fauxToolCall("task_plan", {
					goal: "Save the paper I read to Zotero",
					summary: "One paper into Zotero",
					writeDirectories: ["outputs"],
					milestones: [
						{ id: "z", title: "Paper in Zotero", dependsOn: [], acceptance: { kind: "zotero_item" } },
					],
				}),
			],
			{ stopReason: "toolUse" },
		);
	};
	faux.setResponses(Array.from({ length: 40 }, () => respond));
	const run = async () => {
		await entry.session.prompt("Save the paper I read to Zotero", { expandPromptTemplates: false });
		await entry.session.agent.waitForIdle?.();
		await entry.session.waitForIdle?.();
		await vi.waitFor(() => expect(entry.session.isStreaming).toBe(false));
	};
	const saveResult = () =>
		entry.session.messages.findLast((m) => m.role === "toolResult" && m.toolName === "research_zotero_save");
	return {
		zotero,
		dialogs,
		details,
		errors,
		run,
		saveResult,
		decline: () => {
			approve = false;
		},
		view: async () => (await bridge.invoke(owner, binding, "fixtureView", null, selection)).tasks[0],
	};
}

it("one save binds a DOI-less Zotero milestone from the actual tool event and the research package verifies it", async () => {
	const t = await setup();
	await t.run();
	expect(t.errors).toEqual([]);
	expect(t.saveResult()?.details).toMatchObject({ status: "saved", zoteroKey: "ABCD2345" });
	const task = await t.view();
	const result = t.saveResult();
	expect(result.details.cards).toEqual([
		expect.objectContaining({ key: `doi:${DOI}`, kind: "literature", status: "saved" }),
	]);
	const ctx = { sessionManager: { getSessionId: () => "managed-zotero-flow" } };
	beginKnowledgeFlow(ctx, { vaultId: "fixture", revision: 1, vault: "/vault" });
	noteKnowledgeOperation(ctx, { toolName: "research_zotero_save", toolCallId: result.toolCallId, result });
	expect(flowFor("managed-zotero-flow").cards).toEqual(
		result.details.cards.map((card) => ({ ...card, at: expect.any(Number) })),
	);
	expect(task.milestones).toEqual([
		expect.objectContaining({
			id: "z",
			state: "completed",
			bound: expect.objectContaining({ fields: { doi: DOI }, via: "research_zotero_save" }),
			evidence: expect.objectContaining({
				state: "found",
				itemId: "ABCD2345",
				kind: "zotero-read-only-item-identity",
			}),
		}),
	]);
	// The authorization names the Zotero write and the package that makes it, so the save itself asks nothing.
	const grant = t.dialogs.indexOf("capability:task.grant.request");
	expect(t.details[grant]).toContain("@gyoungwe/pi-research");
	expect(t.dialogs).not.toContain("capability:network.write");
	expect(t.zotero.received.filter((r) => r === "POST /connector/saveItems")).toHaveLength(1);
}, 120000);

it("a declined authorization leaves the write asking, and declining it binds nothing", async () => {
	const t = await setup();
	t.decline();
	await t.run();
	expect(t.dialogs).toContain("capability:network.write");
	expect(t.saveResult()?.details).toMatchObject({ status: "cancelled", reason: "user-declined" });
	expect(t.zotero.received).not.toContain("POST /connector/saveItems");
	const [milestone] = (await t.view()).milestones;
	expect(milestone.bound).toBeUndefined();
	expect(milestone.state).not.toBe("completed");
}, 120000);
