/** Opt-in same-tar knowledge workflow. Synthetic notes/models only; no user Vault or network credentials. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { fileCapabilityHandlers, PluginFileCapabilities } from "../src/plugins/file-capabilities";
import { modelCapabilityHandlers } from "../src/plugins/model-capabilities";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { PluginResourceManager } from "../src/plugins/resource-capabilities";
import { getPluginSessionCaller } from "../src/plugins/session-caller";
import { sessionCapabilityHandlers } from "../src/plugins/session-capabilities";
import { sessionRecordCapabilityHandlers } from "../src/plugins/session-record-capabilities";
import { canonicalProjectId } from "../src/project-id";
import { SessionRegistry } from "../src/session/registry";
import { SessionEngine } from "../src/session-engine/engine";
import { SessionRecordStore } from "../src/session-engine/session-records";
import { StorageRegistry } from "../src/storage/registry";

const run = promisify(execFile),
	tarball = process.env.DRONE_KNOWLEDGE_FULL_TARBALL,
	apiTarball = process.env.DRONE_PLUGIN_API_TARBALL;
const runtimeDirectory = resolve(
	process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
		join(import.meta.dirname, `../../desktop/plugin-runtime/${process.platform}-${process.arch}`),
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

it.skipIf(!tarball)(
	"installs one exact package and runs real prepare/read/search/delegate/check/publication with actual scoped worker and SQLite ownership",
	async () => {
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
		let bridge, bootstrap, session;
		const sessions = new SessionRegistry(),
			records = new SessionRecordStore(),
			engine = new SessionEngine();
		const approvals = [],
			modelSteps = [],
			calls = [],
			errors = [],
			deliveries = [];
		try {
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
			bootstrap = bridge.beginNative(window, (path) =>
				path === source.nativeEntrypoint ? "installed" : undefined,
			);
			const settingsManager = SettingsManager.inMemory({});
			const resourceLoader = new DefaultResourceLoader({
				cwd: workspace,
				agentDir,
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noContextFiles: true,
				additionalExtensionPaths: [source.nativeEntrypoint],
				extensionFactoryForPath: async (path) => {
					bootstrap.delivery.observeSelectedPath(path);
					return bootstrap.factoryForPath(path);
				},
			});
			await resourceLoader.reload({ resolveProjectTrust: async () => true });
			expect(resourceLoader.getExtensions().errors).toEqual([]);
			const actualSelectedPaths = resourceLoader
				.getExtensions()
				.extensions.map((extension) => extension.path);
			expect(actualSelectedPaths).toEqual([source.nativeEntrypoint]);
			bootstrap.delivery.confirmSelection(actualSelectedPaths);
			({ session } = await createAgentSession({
				cwd: workspace,
				agentDir,
				settingsManager,
				resourceLoader,
				modelRuntime,
				model: faux.getModel(),
				sessionManager: SessionManager.create(workspace, join(root, "history")),
				noTools: true,
				hostDeliveryRunStart: (signal) => bootstrap.delivery.start(signal),
				hostDeliveryBoundary: (event, signal) => bootstrap.delivery.finalize(event, signal),
			}));
			settingsManager.setProjectTrusted(true);
			sessions.add({ session, cwd: workspace, unsubscribe() {} });
			bootstrap.bindSession(session.sessionId, () => engine.abort(session));
			await session.bindExtensions({
				onError: (error) => errors.push({ event: error.event, error: error.error }),
			});
			session.subscribe((event) => {
				if (event.type === "message_end" && event.message.role === "assistant")
					deliveries.push(structuredClone(event.message));
			});
			const tool = (name, input) =>
				fauxAssistantMessage(fauxToolCall(name, input), { stopReason: "toolUse" });
			faux.setResponses([
				tool("research_prepare_knowledge", { query: "Orchid condition A" }),
				tool("research_read_knowledge", { path: "Wiki/Orchid.md" }),
				tool("research_search_knowledge", { query: "Orchid" }),
				tool("research_read_knowledge", { path: sourcePath }),
				tool("research_delegate_knowledge", {
					role: "evidence",
					task: "Describe only assigned method scope",
					source_paths: [sourcePath],
				}),
				tool("knowledge_read", { path: sourcePath }),
				tool("knowledge_submit", {
					summary: "The assigned note only supports condition A.",
					source_paths: [sourcePath],
					cautions: ["No other conditions were measured."],
				}),
				tool("research_check_answer", { draft: answer }),
				fauxAssistantMessage(answer),
			]);
			await session.prompt("知识库 Orchid 方法条件 A 说明，使用本地资料，并请证据整理员核对适用范围。");
			await session.waitForIdle();
			expect(errors).toEqual([]);
			const results = session.messages.filter((message) => message.role === "toolResult");
			for (const name of [
				"research_prepare_knowledge",
				"research_read_knowledge",
				"research_search_knowledge",
				"research_delegate_knowledge",
				"research_check_answer",
			])
				expect(
					results.some((result) => result.toolName === name) &&
						results.filter((result) => result.toolName === name).every((result) => !result.isError),
					JSON.stringify(results),
				).toBe(true);
			expect(
				results.find((result) => result.toolName === "research_delegate_knowledge").details,
			).toMatchObject({ status: "completed", role: "evidence", usageReported: true });
			expect(modelSteps).toHaveLength(2);
			expect(modelSteps.every((step) => step.toolNames.join(",") === "knowledge_read,knowledge_submit")).toBe(
				true,
			);
			const final = deliveries.at(-1);
			expect(final.knowledgePublication).toMatchObject({ status: "released", scientificallyVerified: false });
			expect(final.content).toEqual([{ type: "text", text: answer }]);
			const persisted = session.sessionManager.getBranch();
			expect(
				persisted.findLast((entry) => entry.type === "message" && entry.message.role === "assistant").message,
			).toEqual(final);
			expect(
				persisted.some(
					(entry) =>
						entry.type === "custom" &&
						entry.customType ===
							`plugin-record:${encodeURIComponent(source.pluginId)}:drone-knowledge-recovery-v1`,
				),
			).toBe(true);
			expect(JSON.parse(await readFile(join(state, "answer-metrics.json"), "utf8"))).toMatchObject({
				answered: 1,
				total: 1,
				rate: 1,
			});
			expect(approvals).toContain("capability:model.toolStep");
			expect(
				calls
					.filter((call) => call.name === "model.toolStep")
					.every((call) => call.session === session.sessionId),
			).toBe(true);
			console.log(
				JSON.stringify({
					scope: "same-tar knowledge publication candidate",
					packageSha256: sha256(await readFile(tarball)),
					apiSha256: sha256(await readFile(apiTarball)),
					modelSteps: modelSteps.length,
					tools: results.map((result) => ({ name: result.toolName, error: !!result.isError })),
					finalStatus: final.knowledgePublication.status,
					scientificVerification: false,
					fullP2: "INCOMPLETE: historical export, service composition and formal installer remain",
				}),
			);
		} finally {
			if (session) await engine.dispose(session);
			if (bootstrap) await bootstrap.dispose();
			if (bridge) await bridge.close();
			await rm(root, { recursive: true, force: true });
		}
	},
	120000,
);
