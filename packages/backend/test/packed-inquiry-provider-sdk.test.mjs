import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { SqliteInquiryStorage } from "@drone/inquiry";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { createDesktopResourceCapabilities } from "../../desktop/src/main/ui-plugins/runtime-host";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { getPluginSessionCaller } from "../src/plugins/session-caller";
import { InquiryService } from "../src/services/inquiry";
import { SessionRegistry } from "../src/session/registry";
import { StorageRegistry } from "../src/storage/registry";

vi.mock("electron", () => ({ app: {}, BrowserWindow: {}, dialog: {}, webContents: {} }));
const run = promisify(execFile),
	tarball = process.env.DRONE_INQUIRY_PLUGIN_TARBALL,
	api = process.env.DRONE_PLUGIN_API_TARBALL;
const runtimeDirectory = resolve(
	process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
		join(import.meta.dirname, `../../desktop/plugin-runtime/${process.platform}-${process.arch}`),
);
it.skipIf(!tarball)(
	"routes installed Inquiry SQLite through actual SDK generic provider and production scoped host ports",
	async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "packed-inquiry-provider-")));
		let bridge, session, bootstrap, legacy;
		try {
			if (!api) throw new Error("Explicit candidate API required");
			const binary = join(root, "original-ledger"),
				profile = join(root, "profile"),
				workspace = join(root, "workspace"),
				agent = join(root, "agent");
			await Promise.all([binary, profile, workspace, agent].map((path) => mkdir(path)));
			const seed = new SqliteInquiryStorage("legacy-project", join(binary, "ledger.sqlite"));
			await seed.close();
			const original = await readFile(join(binary, "ledger.sqlite"));
			const consumerDir = join(root, "consumer");
			await mkdir(consumerDir);
			await writeFile(
				join(consumerDir, "package.json"),
				JSON.stringify({
					name: "@fixture/inquiry-consumer",
					version: "1.0.0",
					type: "module",
					files: ["runtime.mjs", "native.mjs", "plugin.manifest.json"],
					pi: { extensions: ["./native.mjs"] },
				}),
			);
			await writeFile(
				join(consumerDir, "native.mjs"),
				`export default()=>{throw new Error('Use managed owner');};`,
			);
			await writeFile(
				join(consumerDir, "runtime.mjs"),
				`export default async context=>({operations:{},createNativeSession:async()=>({extension:pi=>pi.registerTool({name:'inquiry_provider_call',label:'Inquiry provider',description:'Explicit Inquiry provider call on synthetic data',parameters:{type:'object',properties:{effect:{enum:['read','write']},input:{type:'object'}},required:['effect','input'],additionalProperties:false},execute:async(_id,input)=>{const value=await context.capabilities.call(input.effect==='read'?'provider.read':'provider.write',{alias:'inquiry',operation:input.effect==='read'?'inquiry.read':'inquiry.write',input:input.input});return {content:[{type:'text',text:JSON.stringify(value)}],details:value};}}),dispose:async()=>{}}),dispose:async()=>{}});`,
			);
			await writeFile(
				join(consumerDir, "plugin.manifest.json"),
				JSON.stringify({
					schemaVersion: 1,
					id: "drone-fixture-inquiry-consumer",
					hosts: ["drone-desktop", "native-pi"],
					capabilities: ["research"],
					pi: { apiVersion: 1, minHostVersion: "1.1.0", testedHosts: ["1.1.0"] },
					version: "1.0.0",
					entrypoints: { desktopRuntime: "./runtime.mjs", extension: "./native.mjs" },
					drone: {
						pluginApi: 1,
						resultContract: "drone-result/v3",
						requires: { inquiry: { service: "inquiry.runtime", version: 1 } },
					},
					permissions: { filesystem: [], network: [], subprocess: [] },
					tools: ["inquiry_provider_call"],
				}),
			);
			const packed = JSON.parse(
				(
					await run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], {
						cwd: consumerDir,
					})
				).stdout,
			)[0];
			const installed = join(root, "installed");
			await mkdir(installed);
			await run(
				"npm",
				[
					"install",
					"--prefix",
					installed,
					"--ignore-scripts",
					"--omit=peer",
					"--no-audit",
					"--no-fund",
					tarball,
					api,
					join(root, packed.filename),
				],
				{ maxBuffer: 8 * 1024 * 1024 },
			);
			const catalog = (await discoverInstalledPackages(join(installed, "node_modules"))).map((item) => {
				if ("error" in item || !item.runtime) throw new Error(JSON.stringify(item));
				return { name: `package:${item.packageRoot}`, source: item.runtime, state: "enabled" };
			});
			const provider = catalog.find((item) => item.source.pluginId === "@gyoungwe/pi-inquiry"),
				consumer = catalog.find((item) => item.source.pluginId === "@fixture/inquiry-consumer");
			if (!provider || !consumer) throw new Error("Installed source catalog incomplete");
			expect(provider.source).toMatchObject({
				requestsBinaryStateRead: true,
				requestsBinaryStateWrite: true,
				requestsStateRead: true,
				requestsStateWrite: true,
				provides: { "inquiry.runtime": { version: 1, operations: ["inquiry.read", "inquiry.write"] } },
			});
			const registry = new SessionRegistry(),
				storage = new StorageRegistry(),
				factories = new Map();
			const window = { id: 81, isDestroyed: () => false };
			bridge = new PluginRuntimeBridge({
				source: (name) => catalog.find((item) => item.name === name && item.state === "enabled")?.source,
				sources: () => catalog,
				enabled: (name) => catalog.some((item) => item.name === name && item.state === "enabled"),
				approve: async () => true,
				getSessionContext: (id) => getPluginSessionCaller(registry, id),
				factory: (source) => {
					factories.set(source.pluginId, (factories.get(source.pluginId) ?? 0) + 1);
					return createProcessPluginRuntime({ ...source, runtimeDirectory });
				},
				capabilities: (source) =>
					createDesktopResourceCapabilities(source, runtimeDirectory, {
						profileDirectory: profile,
						storage,
						selectDirectories: async () => [binary],
					}),
			});
			bootstrap = bridge.beginNative(window, (path) =>
				path === consumer.source.nativeEntrypoint ? consumer.name : undefined,
			);
			const settings = SettingsManager.inMemory({ projectTrusted: true }),
				loader = new DefaultResourceLoader({
					cwd: workspace,
					agentDir: agent,
					settingsManager: settings,
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					additionalExtensionPaths: [consumer.source.nativeEntrypoint],
					extensionFactoryForPath: (path) => bootstrap.factoryForPath(path),
				});
			await loader.reload({ resolveProjectTrust: async () => true });
			expect(loader.getExtensions().errors).toEqual([]);
			const models = await ModelRuntime.create({
				authPath: join(agent, "auth.json"),
				modelsPath: null,
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const faux = fauxProvider({ provider: "inquiry-offline", tokensPerSecond: 0 });
			models.registerNativeProvider(faux.provider);
			vi.spyOn(models, "hasConfiguredAuth").mockReturnValue(true);
			({ session } = await createAgentSession({
				cwd: workspace,
				agentDir: agent,
				settingsManager: settings,
				resourceLoader: loader,
				modelRuntime: models,
				sessionManager: SessionManager.inMemory(workspace),
				model: faux.getModel(),
			}));
			registry.add({ session, cwd: workspace, unsubscribe() {} });
			bootstrap.bindSession(session.sessionId);
			await session.bindExtensions({});
			const call = async (effect, input) => {
				faux.setResponses([
					fauxAssistantMessage(fauxToolCall("inquiry_provider_call", { effect, input })),
					fauxAssistantMessage("Synthetic provider receipt"),
				]);
				await session.prompt(
					"Use only the specified Inquiry provider operation on synthetic temporary data.",
				);
				await session.waitForIdle();
				const result = session.messages.filter((message) => message.role === "toolResult").at(-1);
				if (!result) throw new Error("Missing actual SDK tool result");
				expect(result.isError, JSON.stringify(result)).toBe(false);
				return result.details;
			};
			const binding = await bridge.bind(provider.name, window);
			const status = await call("read", { action: "status" });
			expect(status.state).toBe("needs-binding");
			const dataRoot = status.roots.find((item) => item.kind === "binary-state"),
				metadataRoot = status.roots.find((item) => item.kind === "state");
			if (!dataRoot || !metadataRoot) throw new Error("Independent roots missing");
			expect(dataRoot.path).toBe(metadataRoot.path);
			await call("write", {
				action: "bind",
				root: dataRoot.handle,
				metadataRoot: metadataRoot.handle,
				acknowledgeExistingData: true,
			});
			expect(() => new InquiryService({ inquiryDir: binary, projectId: "legacy-project" })).toThrow(
				"already reserved",
			);
			const date = "2026-10-28T00:00:00.000Z";
			await call("write", {
				action: "recordQuestion",
				record: {
					id: "sdk-question",
					schemaVersion: 2,
					projectId: "legacy-project",
					kind: "hypothesis",
					statement: "Synthetic provider question",
					competingExplanations: [],
					testsDone: [],
					testsPlanned: [],
					status: "open",
					proposer: "user",
					priority: 1,
					createdAt: date,
					updatedAt: date,
				},
			});
			const selection = bridge.selectSession(window, session.sessionId);
			const direct = await bridge.invoke(window, binding, "inquiry.read", { action: "snapshot" }, selection);
			expect(direct.value.questions).toMatchObject([{ id: "sdk-question" }]);
			expect(direct.authority).toBe("plugin-asserted-or-imported");
			expect(factories.get(provider.source.pluginId)).toBe(1);
			const backup = await readFile(
				join(
					binary,
					`ledger.sqlite.pre-plugin-${(await import("node:crypto")).createHash("sha256").update(original).digest("hex")}.bak`,
				),
			);
			expect(backup).toEqual(original);
			await call("write", { action: "restoreOriginal" });
			expect(await readFile(join(binary, "ledger.sqlite"))).toEqual(original);
			await bridge.revoke(provider.name);
			provider.state = "disabled";
			legacy = new InquiryService({ inquiryDir: binary, projectId: "legacy-project" });
			expect((await legacy.readOnlySnapshot()).questions).toEqual([]);
			await legacy.dispose();
			legacy = undefined;
			console.log(
				JSON.stringify({
					test: "packed-inquiry-provider-sdk",
					actualInstalledTar: true,
					actualSdk: "1.1.0",
					genericProvider: true,
					productionDesktopPorts: true,
					realHostJsonStore: true,
					binaryRawSqlite: true,
					sameProviderFactory: true,
					originalProjectPreserved: true,
					originalBackupAndRestore: true,
					legacyWriterCompetition: true,
					nativeEntry: "NOT_IMPLEMENTED",
					renderedUi: "NOT_IMPLEMENTED",
					formalGui: "NOT_RUN",
				}),
			);
		} finally {
			await legacy?.dispose();
			await bootstrap?.dispose();
			await bridge?.close();
			await session?.dispose();
			vi.restoreAllMocks();
			await rm(root, { recursive: true, force: true });
		}
	},
	120000,
);
