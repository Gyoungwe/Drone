/** Opt-in same-tar knowledge workflow. Synthetic notes/models only; no user Vault or network credentials. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, vi } from "vitest";
import { discoverInstalledPackages } from "../../../desktop/src/main/ui-plugins/installed-package-sources";
import { PiBackend } from "../../src/pi-backend";
import { PluginRuntimeBridge } from "../../src/plugins/coordinator";
import { fileCapabilityHandlers, PluginFileCapabilities } from "../../src/plugins/file-capabilities";
import { modelCapabilityHandlers } from "../../src/plugins/model-capabilities";
import { createProcessPluginRuntime } from "../../src/plugins/process-runtime";
import { PluginResourceManager } from "../../src/plugins/resource-capabilities";
import { getPluginSessionCaller } from "../../src/plugins/session-caller";
import { sessionCapabilityHandlers } from "../../src/plugins/session-capabilities";
import { sessionRecordCapabilityHandlers } from "../../src/plugins/session-record-capabilities";
import { canonicalProjectId } from "../../src/project-id";
import { SessionRecordStore } from "../../src/session-engine/session-records";
import { StorageRegistry } from "../../src/storage/registry";

export const packedKnowledgeAvailable = Boolean(process.env.DRONE_KNOWLEDGE_FULL_TARBALL);
const run = promisify(execFile),
	tarball = process.env.DRONE_KNOWLEDGE_FULL_TARBALL,
	apiTarball = process.env.DRONE_PLUGIN_API_TARBALL;
const runtimeDirectory = resolve(
	process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
		join(import.meta.dirname, `../../../desktop/plugin-runtime/${process.platform}-${process.arch}`),
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");


export async function withPackedKnowledgeOwner(work) {
	if (!apiTarball) throw new Error("A matching clean-install API tarball is required");
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-full-knowledge-publication-")));
	const prefix = join(root, "install"),
		state = join(root, "state"),
		vault = join(root, "Vault"),
		workspace = join(root, "Workspace"),
		agentDir = join(root, "agent"),
		cache = join(root, "cache"),
		leases = join(root, "leases");
	for (const path of [prefix, state, vault, workspace, agentDir, cache, leases]) await mkdir(path);
	let bridge, bootstrap, session, backend, sessions, engine;
	const records = new SessionRecordStore();
	const approvals = [],
		modelSteps = [],
		calls = [],
		errors = [],
		deliveries = [];
	try {
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
		await run(
			"npm",
			[
				"install",
				"--prefix",
				prefix,
				"--ignore-scripts",
				"--omit=peer",
				"--no-audit",
				"--no-fund",
				"--registry=https://registry.npmjs.org",
				await realpath(tarball),
				await realpath(apiTarball),
			],
			{ maxBuffer: 8 * 1024 * 1024 },
		);
		const catalog = await discoverInstalledPackages(join(prefix, "node_modules"));
		const selected = catalog.find(
			(item) => !("error" in item) && item.packageName === "@gyoungwe/pi-knowledge",
		);
		expect(selected, JSON.stringify(catalog)).toBeDefined();
		const source = selected.runtime;
		expect(source).toMatchObject({
			deliveryProjection: "required",
			requestsModel: true,
			requestsStateWrite: true,
			requires: { tasks: { service: "task.runtime", version: 1 } },
		});
		const sourcePath = "Library/Methods/orchid.md",
			answer = `Orchid was observed only under condition A. [[${sourcePath}]]`;
		const notes = {
			"Home.md": "# Home\n[[Wiki/Index]]\n",
			"Wiki/Index.md": "# Wiki\n[[Wiki/Orchid]]\n",
			"Wiki/Orchid.md": `# Orchid\n[[${sourcePath}]]\n`,
			[sourcePath]:
				"# Orchid\nAn Orchid observation under condition A only. No other conditions were measured.\n",
			"Projects/alpha/Context.md": "# Alpha context\n",
			"Projects/alpha/Index.md": "# Alpha\n[[Wiki/Orchid]]\n",
		};
		for (const [path, text] of Object.entries(notes)) {
			await mkdir(join(vault, path, ".."), { recursive: true });
			await writeFile(join(vault, path), text);
		}
		await mkdir(join(workspace, ".pi"));
		await writeFile(
			join(workspace, ".pi/research-workspace.json"),
			JSON.stringify({ knowledgeProjectId: "alpha" }),
		);
		await writeFile(
			join(state, "binding.json"),
			JSON.stringify({
				version: 1,
				vault,
				vaultId: sha256(vault).slice(0, 24),
				revision: 1,
				profile: "hybrid",
				depositMode: "verified",
				subagentPolicy: "read-local",
				updatedAt: new Date().toISOString(),
			}),
		);
		await writeFile(join(state, "review-policy.json"), JSON.stringify({ version: 1, mode: "strict" }));
		await writeFile(join(state, "specialists.json"), JSON.stringify({ mode: "manual", revision: 0 }));
		const storage = new StorageRegistry().register({
			id: "knowledge-state",
			path: state,
			owner: `plugin:${source.pluginId}`,
			schema: "plugin-owned",
			sensitivity: "private",
		});
		const modelRuntime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		const faux = fauxProvider({ provider: "knowledge-full-private", tokensPerSecond: 0 });
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey(faux.provider.id, "synthetic-offline-only");
		bridge = new PluginRuntimeBridge({
			source: () => source,
			sources: () => [{ name: "installed", source, state: "enabled" }],
			classifySelectedPath: (path) =>
				path === source.nativeEntrypoint
					? { kind: "managed", source, state: "enabled" }
					: { kind: "unconfirmed" },
			enabled: () => true,
			getSessionContext: (id) => getPluginSessionCaller(sessions, id),
			approve: async (_owner, _source, operation) => {
				approvals.push(operation);
				return true;
			},
			factory: (value) => createProcessPluginRuntime({ ...value, runtimeDirectory }),
			capabilities:
				() =>
				async ({ pluginId, applicationId, signal, events }) => {
					const files = await PluginFileCapabilities.create(
						[
							{
								handle: "state",
								path: state,
								kind: "state",
								scope: { kind: "application" },
								stateWrite: { registry: storage, storageId: "knowledge-state" },
							},
							{
								handle: "vault",
								path: vault,
								kind: "files",
								scope: { kind: "application" },
								fileWrite: true,
							},
							{
								handle: "workspace",
								path: workspace,
								kind: "files",
								scope: { kind: "workspace", workspaceId: canonicalProjectId(workspace) },
							},
						],
						cache,
					);
					const resources = new PluginResourceManager({
						pluginId,
						applicationId,
						packageRoot: source.packageRoot,
						entries: source.resources,
						runtimeDirectory,
						files,
						signal,
						events,
						leaseDirectory: leases,
					});
					const handlers = {
						...fileCapabilityHandlers(files),
						...resources.handlers(),
						...sessionCapabilityHandlers(sessions),
						...sessionRecordCapabilityHandlers(sessions, records),
						...modelCapabilityHandlers({
							registry: sessions,
							getRuntime: async () => modelRuntime,
							getProfileModel: async () => undefined,
							getProfileThinking: async () => undefined,
						}),
					};
					return {
						handlers: Object.fromEntries(
							Object.entries(handlers).map(([name, handler]) => [
								name,
								{
									...handler,
									execute: async (input, context) => {
										calls.push({
											name,
											kind: context.scope.kind,
											session: context.scope.kind === "session" ? context.scope.sessionId : null,
										});
										if (name === "model.toolStep")
											modelSteps.push({
												toolNames: input.tools.map((tool) => tool.name),
												messages: input.messages.length,
											});
										return handler.execute(input, context);
									},
								},
							]),
						),
						resources: [
							{ handle: "state", kind: "state", access: "read-write" },
							{ handle: "vault", kind: "files", access: "read-write" },
						],
						resourcesLifecycle: { dispose: () => resources.disposeResources() },
						async dispose() {
							await resources.disposeResources();
							await files.drain();
						},
						async finalRelease() {
							resources.releaseReservations();
							files.releaseReservations();
						},
					};
				},
		});
		const window = { id: 101, isDestroyed: () => false };
		const publicEvents = [];
		backend = new PiBackend({
			projectTrust: false,
			permissionGates: false,
			lazyCapabilities: false,
			desktopIntegration: {
				appendSystemPrompt: [],
				additionalSkillPaths: [],
				additionalExtensionPaths: [source.nativeEntrypoint],
				pluginRuntimeDirectory: runtimeDirectory,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noContextFiles: true,
				nativeRuntime: {
					manages: (path) => path === source.nativeEntrypoint,
					begin: () =>
						(bootstrap = bridge.beginNative(window, (path) =>
							path === source.nativeEntrypoint ? "installed" : undefined,
						)),
				},
			},
		});
		sessions = backend.registry;
		engine = backend.sessionEngine;
		backend.modelRuntime = modelRuntime;
		backend.onEvent((_id, event) => {
			publicEvents.push(structuredClone(event));
			if (event.type === "extension_error") errors.push(event);
		});
		const meta = await backend.createSession({
			cwd: workspace,
			provider: faux.provider.id,
			modelId: faux.getModel().id,
		});
		session = backend.registry.get(meta.sessionId).session;
		session.subscribe((event) => {
			if (event.type === "message_end" && event.message.role === "assistant")
				deliveries.push(structuredClone(event.message));
		});
		return await work({
			root,
			prefix,
			state,
			vault,
			workspace,
			agentDir,
			cache,
			leases,
			source,
			sourcePath,
			answer,
			storage,
			modelRuntime,
			faux,
			backend,
			bridge,
			bootstrap,
			session,
			sessions,
			engine,
			records,
			approvals,
			modelSteps,
			calls,
			errors,
			deliveries,
			publicEvents,
			tarball,
			apiTarball,
			sha256,
		});
	} finally {
		if (session && backend) {
			for (const entry of backend.registry.list()) await backend.closeSession(entry.session.sessionId);
		} else if (session) await engine.dispose(session);
		if (bootstrap) await bootstrap.dispose();
		if (bridge) await bridge.close();
		if (backend) await backend.dispose();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	}
}
