// Desktop's composition of the built-in pi-core, without Electron windows: the copy fetch-plugins staged
// for packaging (check-builtin-plugins proves it is the locked artifact) in a read-only built-in root,
// found by the real UiPluginManager and run by its managed runtime in a restricted process.
// The calling test file must mock "electron" so the manager's app.getPath returns `userData`.
import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, vi } from "vitest";
import { UiPluginManager } from "../../../desktop/src/main/ui-plugins/manager";
import { createBackend } from "../../src/create-backend";
import { PluginRuntimeBridge } from "../../src/plugins/coordinator";
import { createProcessPluginRuntime } from "../../src/plugins/process-runtime";

const repo = resolve(import.meta.dirname, "../../../..");
const shipped = join(repo, "packages/desktop/plugin-packages/node_modules/@gyoungwe/pi-core");
const runtimeDirectory = join(repo, `packages/desktop/plugin-runtime/${process.platform}-${process.arch}`);
export const CORE_UI = "drone-task-ui";
export const TASK_TOOLS = [
	"task_status",
	"task_plan",
	"task_wait",
	"task_reconcile",
	"task_evidence_restore",
];

async function offlineModels(agentDir, respond) {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "builtin-core-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	faux.setResponses(Array.from({ length: 400 }, () => respond));
	return { modelRuntime, faux };
}

/** As ui-plugins/runtime-host.ts: a built-in's activation is not a dialog; every other approval is recorded. */
function bridgeFor(manager, service, dialogs, answer, approve) {
	return new PluginRuntimeBridge({
		source: (name) => manager.runtimeSource(name),
		sources: () => manager.runtimeSources(),
		classifySelectedPath: (path) => manager.classifyNativeSelection(path),
		enabled: (name) => manager.isEnabled(name) || manager.isNativeSourceAvailable(name),
		approve: async (_owner, source, operation) => {
			if (operation === undefined && manager.builtinPackages.has(source.packageRoot)) return true;
			dialogs.push(operation ?? `activation:${source.pluginId}`);
			return approve(operation);
		},
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		getSessionContext: (id) => service.getPluginCallerContext(id),
		taskGrants: service.getTaskGrants(),
		// Plugin questions reach the simulated user. `answer` returns (or resolves to) an option value, the
		// text for an input question, or undefined to cancel.
		questionTransport: (owner) => ({
			ownerId: owner.id,
			send: (request) => {
				const question = request.questions[0];
				void Promise.resolve(answer(question)).then((value) =>
					service.respondAsk(
						request.id,
						value === undefined
							? { kind: "cancel" }
							: {
									kind: "answer",
									mode: "submit",
									answers: {
										[question.id ?? "value"]:
											question.type === "text" ? { customText: value } : { values: [value] },
									},
								},
						owner.id,
					),
				);
				return true;
			},
			resolved: () => undefined,
		}),
		capabilities: (source) => () => ({
			resources: [],
			handlers: {
				...service.getPluginSessionCapabilities(source.recordAdoptions),
				...service.getPluginSourceCapabilities(source),
				...(source.requestsWorkspaceRead ? service.getPluginWorkspaceCapabilities() : {}),
			},
		}),
	});
}

/** Copies the staged pi-core into a read-only-style built-in root and isolates home, agent dir and env. */
async function prepareRoot(root, setUserData) {
	const builtinRoot = join(root, "builtin", "node_modules");
	await cp(shipped, join(builtinRoot, "@gyoungwe", "pi-core"), { recursive: true });
	const home = join(root, "home"),
		agentDir = join(root, "agent");
	setUserData(join(root, "user-data"));
	await mkdir(join(root, "user-data", "ui-plugins"), { recursive: true });
	await mkdir(agentDir);
	// Project edits ask by default here, so only the host's task authorization lets task writes through.
	await writeFile(join(agentDir, "permissions.json"), JSON.stringify({ autoApproveProjectEdits: false }));
	for (const [key, value] of Object.entries({ HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: agentDir }))
		vi.stubEnv(key, value);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "zh");
	return { builtinRoot, home, agentDir };
}

/** createBackend wired to the manager's built-in native entries, as Desktop's main process does. */
function backendFor(manager, backend, begin) {
	const { desktopIntegration, ...options } = backend;
	return createBackend({
		projectTrust: false,
		permissionGates: true,
		...options,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			...desktopIntegration,
			pluginRuntimeDirectory: runtimeDirectory,
			nativeRuntime: {
				manages: (path) => manager.classifyNativeSelection(path).kind !== "ordinary",
				childExtensionPaths: () => manager.nativeChildExtensionPaths(),
				extensionPaths: () => manager.builtinExtensionPaths(),
				begin,
			},
		},
	});
}

/**
 * Starts the backend with the built-in pi-core under `root`. `respond` is the offline model,
 * `permission` answers host permission requests ("deny" or "allow"; each is recorded), `answer`
 * answers plugin questions, `approve` answers recorded host dialogs (default: approve), and
 * `backend` adds createBackend options. `decorateNativeBootstrap` composes test extensions with
 * the built-in's managed attachment while preserving its delivery and session binding.
 */
export async function startBuiltinCore({
	root,
	setUserData,
	respond,
	permission = "deny",
	answer = () => undefined,
	approve = () => true,
	backend = {},
	decorateNativeBootstrap = (bootstrap) => bootstrap,
}) {
	const { builtinRoot, home, agentDir } = await prepareRoot(root, setUserData);
	const manager = new UiPluginManager({
		installedPackageRoot: join(agentDir, "npm", "node_modules"),
		builtinPackageRoot: builtinRoot,
	});
	await manager.scanAll();
	const owner = { id: 41, isDestroyed: () => false };
	const dialogs = [],
		permissions = [],
		live = {};
	const services = backendFor(manager, backend, (facts) =>
		decorateNativeBootstrap(live.bridge.beginNative(owner, (path) => manager.nativeRuntimeName(path), facts)),
	);
	const service = services.sessions;
	const { modelRuntime, faux } = await offlineModels(agentDir, respond);
	service.modelRuntime = modelRuntime;
	live.bridge = bridgeFor(manager, service, dialogs, answer, approve);
	service.onPermissionRequest((request) => {
		permissions.push(request.message);
		queueMicrotask(() => service.respondPermission(request.id, permission));
	});
	const [core] = manager.runtimeSources();
	const nativeEntry = manager.builtinExtensionPaths()[0];
	const attach = (meta) => attachSession({ service, owner, core, nativeEntry, bridge: live.bridge }, meta);
	return {
		manager,
		service,
		faux,
		core,
		nativeEntry,
		builtinRoot,
		dialogs,
		permissions,
		attach,
		open: async (name) => {
			const cwd = join(home, name);
			await mkdir(join(cwd, "outputs"), { recursive: true });
			return attach(
				await service.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id }),
			);
		},
		close: async () => {
			await live.bridge.close();
			await services.dispose();
			vi.restoreAllMocks();
			vi.unstubAllEnvs();
			await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		},
	};
}

/** One SDK session as a test drives it: prompts, the built-in's loaded tools, its task status and grant. */
function attachSession({ service, owner, core, nativeEntry, bridge }, meta) {
	const entry = service.registry.get(meta.sessionId);
	const errors = [];
	entry.session.extensionRunner.onError((error) => errors.push(`${error.event}: ${error.error}`));
	const settle = async () => {
		await vi.waitFor(() => expect(entry.session.isStreaming).toBe(false));
		await entry.session.waitForIdle?.();
	};
	const prompt = async (text) => {
		await entry.session.prompt(text, { expandPromptTemplates: text.startsWith("/") });
		await entry.session.agent.waitForIdle?.();
		await settle();
		// Automatic task continuations start after the prompt settles.
		await new Promise((done) => setTimeout(done, 300));
		await settle();
	};
	const loaded = () =>
		entry.session.resourceLoader.getExtensions().extensions.find((e) => e.path === nativeEntry);
	const status = async () => {
		const binding = await bridge.bind(core.name, owner);
		return bridge.invoke(owner, binding, "status", null, bridge.selectSession(owner, meta.sessionId));
	};
	return {
		meta,
		cwd: meta.cwd,
		session: entry.session,
		errors,
		prompt,
		settle,
		status,
		/** The task view on the latest host-rendered task notice, as the chat shows it. */
		view: () => entry.session.messages.findLast((m) => m.details?.taskView)?.details.taskView,
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
