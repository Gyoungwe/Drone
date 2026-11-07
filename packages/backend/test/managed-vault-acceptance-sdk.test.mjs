// A Vault file milestone accepted by the managed task runtime, through a real SDK session, real restricted
// plugin processes, the installed @gyoungwe/pi-core runtime and the real @gyoungwe/pi-knowledge package
// (docs/handoff-2026-10-29-p4.md §5.2 item 2). pi-core learns the bound Vault only from the knowledge
// plugin's knowledge.binding service, which reads its own binding.json; the host reads the note under
// the session's read permissions. The model is the offline faux provider.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { fileCapabilityHandlers, PluginFileCapabilities } from "../src/plugins/file-capabilities";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

/** Per-test resources: temp root, backend, plugin bridge and the offline model. */
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
const pdfjsRoot = await realpath(dirname(require.resolve("pdfjs-dist/package.json")));
const RUNTIME = `import {createManagedTaskApplication} from './dist/managed-runtime.mjs';
export default async context=>{
 const app=createManagedTaskApplication(context);
 return {...app,operations:{...app.operations,
  fixtureView:{effect:'read',inputSchema:{type:'null'},resultSchema:{type:'object'},execute:(_input,ctx)=>app.withCurrentSession(ctx.signal,session=>session.controller.journal.view())},
 }};
};`;

async function writeFixture(dir) {
	await mkdir(dir);
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({
			name: "@fixture/tasks",
			version: "1.0.0",
			type: "module",
			files: ["runtime.mjs", "native.mjs", "plugin.manifest.json", "dist"],
			pi: { extensions: ["./native.mjs"] },
		}),
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
				// As pi-core's manifest declares it at the managed switch: Vault acceptance asks the knowledge plugin.
				requires: { knowledge: { service: "knowledge.binding", version: 1 } },
				provides: { "fixture.tasks": { version: 1, operations: ["fixtureView"] } },
			},
			permissions: { filesystem: ["workspace-read"], network: [], subprocess: [] },
			tools: [],
		}),
	);
}

async function installPackages() {
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
	// The locked knowledge package as the app ships it: bundled, so its own files are all it needs.
	await cp(
		resolve(import.meta.dirname, "../../../vendor/plugins/pi-knowledge"),
		join(prefix, "node_modules/@gyoungwe/pi-knowledge"),
		{ recursive: true },
	);
	return (await discoverInstalledPackages(join(prefix, "node_modules"))).map((item) => {
		if ("error" in item || !item.runtime) throw new Error(JSON.stringify(item));
		return { name: `package:${item.packageRoot}`, source: item.runtime, state: "enabled" };
	});
}

/** The knowledge plugin's application state: its binding.json names the Vault. */
async function bindVault(state, vault, revision = 1) {
	await writeFile(
		join(state, "binding.json"),
		JSON.stringify({
			version: 1,
			vault,
			vaultId: createHash("sha256").update(vault).digest("hex").slice(0, 24),
			revision,
			profile: "hybrid",
			depositMode: "verified",
			subagentPolicy: "none",
			updatedAt: new Date().toISOString(),
		}),
	);
}

/** Host capabilities per source; the knowledge plugin additionally gets its state root, read-only. */
const hostCapabilities = (service, paths) => (source) => async () => {
	const handlers = {
		...service.getPluginSessionCapabilities(),
		...service.getPluginSourceCapabilities(source),
		...service.getPluginWorkspaceCapabilities({ runtimeDirectory, pdfjsRoot }),
	};
	if (source.pluginId !== "@gyoungwe/pi-knowledge") return { resources: [], handlers };
	const files = await PluginFileCapabilities.create(
		[{ handle: "state", path: paths.state, kind: "state", scope: { kind: "application" } }],
		paths.cache,
	);
	return {
		handlers: { ...handlers, ...fileCapabilityHandlers(files) },
		resources: [{ kind: "state", handle: "state", access: "read" }],
		resourcesLifecycle: { dispose: async () => undefined },
		dispose: () => files.drain(),
		finalRelease: async () => files.releaseReservations(),
	};
};

async function startBackend(catalog, paths) {
	const owner = { id: 23, isDestroyed: () => false };
	const tasks = catalog.find((item) => item.source.pluginId === "@fixture/tasks");
	live.backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		permissionGates: true,
		tools: ["read", "task_plan", "task_wait", "task_status", "task_reconcile"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			// Only the task runtime runs in the session; the knowledge plugin is here as a service provider.
			additionalExtensionPaths: [tasks.source.nativeEntrypoint],
			pluginRuntimeDirectory: runtimeDirectory,
			nativeRuntime: {
				begin: () =>
					live.bridge.beginNative(
						owner,
						(path) => catalog.find((i) => i.source.nativeEntrypoint === path)?.name,
					),
				manages: (path) => path === tasks.source.nativeEntrypoint,
			},
		},
	});
	const service = live.backend.sessions;
	service.modelRuntime = await offlineModels(paths.agentDir);
	live.bridge = new PluginRuntimeBridge({
		source: (name) => catalog.find((item) => item.name === name)?.source,
		sources: () => catalog,
		enabled: () => true,
		approve: async () => true,
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		getSessionContext: (id) => service?.getPluginCallerContext(id),
		taskGrants: service.getTaskGrants(),
		capabilities: hostCapabilities(service, paths),
	});
	return { service, owner, tasks };
}

async function offlineModels(agentDir) {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	live.faux = fauxProvider({ provider: "managed-vault-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(live.faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	return modelRuntime;
}

/** The offline model plans one Vault note, then stops; the user writes the note. */
const respond = (context) => {
	if (!getCurrentTools(context.messages || []).some((tool) => tool.name === "task_plan"))
		return fauxAssistantMessage("internal");
	const last = context.messages.findLast((m) => m.role === "assistant" || m.role === "toolResult");
	if (last?.role === "toolResult") return fauxAssistantMessage("write the note in your Vault");
	return fauxAssistantMessage(
		[
			fauxToolCall("task_plan", {
				goal: "Keep a summary note in my Vault",
				summary: "One summary note in the bound Vault",
				writeDirectories: ["outputs"],
				milestones: [
					{
						id: "v",
						title: "Summary note",
						dependsOn: [],
						acceptance: { kind: "file", path: "notes/summary.md", rootKind: "vault" },
					},
				],
			}),
		],
		{ stopReason: "toolUse" },
	);
};

async function setup() {
	live.root = await realpath(await mkdtemp(join(tmpdir(), "drone-managed-vault-")));
	const catalog = await installPackages();
	const home = join(live.root, "home");
	const paths = {
		cwd: join(home, "project"),
		vault: join(home, "Vault"),
		state: join(live.root, "knowledge-state"),
		cache: join(live.root, "plugin-cache"),
		agentDir: join(live.root, "agent"),
	};
	for (const dir of [
		join(paths.cwd, "outputs"),
		join(paths.vault, "notes"),
		paths.state,
		paths.cache,
		paths.agentDir,
	])
		await mkdir(dir, { recursive: true });
	await bindVault(paths.state, paths.vault);
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", paths.agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "zh");
	const { service, owner, tasks } = await startBackend(catalog, paths);
	const meta = await service.createSession({
		cwd: paths.cwd,
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
	const view = () => live.bridge.invoke(owner, binding, "fixtureView", null, selection);
	/** The task panel's refresh: re-check the milestones against the current files. */
	const refresh = async () => {
		const before = await view();
		const input = { taskId: before.tasks[0].id, revision: before.revision, action: "refresh" };
		await prompt(`/task-action ${Buffer.from(JSON.stringify(input)).toString("base64url")}`);
		return (await view()).tasks[0].milestones[0];
	};
	return { ...paths, errors, prompt, refresh };
}

it("a note in the Vault the knowledge plugin names completes the managed task's Vault milestone", async () => {
	const t = await setup();
	await t.prompt("Keep a summary note in my Vault");
	await writeFile(join(t.vault, "notes/summary.md"), "# Summary");
	const milestone = await t.refresh();
	expect(milestone).toMatchObject({
		state: "completed",
		evidence: {
			rootKind: "vault",
			path: "notes/summary.md",
			absolutePath: join(t.vault, "notes/summary.md"),
		},
	});
	expect(t.errors).toEqual([]);
}, 120000);

it("after the Vault is rebound, the note accepted under the old binding is no longer accepted", async () => {
	const t = await setup();
	await t.prompt("Keep a summary note in my Vault");
	await writeFile(join(t.vault, "notes/summary.md"), "# Summary");
	expect((await t.refresh()).state).toBe("completed");
	await bindVault(t.state, t.vault, 2);
	expect(await t.refresh()).toMatchObject({ state: "blocked", evidence: { code: "file-unavailable" } });
}, 120000);
