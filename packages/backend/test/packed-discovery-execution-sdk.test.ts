// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
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
import { expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({
	profile: "",
	state: "",
	workspace: "",
	dialogs: 0,
	window: { id: 17, isDestroyed: () => false },
	contents: { isDestroyed: () => false, send() {} },
}));
vi.mock("electron", () => ({
	app: { isPackaged: false, getPath: () => desktop.profile },
	BrowserWindow: { fromWebContents: () => desktop.window },
	webContents: { fromId: () => desktop.contents },
	dialog: {
		showMessageBox: async () => {
			desktop.dialogs++;
			return { response: 1 };
		},
		showOpenDialog: async (_window: unknown, options: { title: string }) => ({
			canceled: false,
			filePaths: [options.title.includes("state") ? desktop.state : desktop.workspace],
		}),
	},
}));

import { UiPluginManager } from "../../desktop/src/main/ui-plugins/manager";
import { createDesktopRuntime } from "../../desktop/src/main/ui-plugins/runtime-host";
import { modelCapabilityHandlers } from "../src/plugins/model-capabilities";
import { getPluginSessionCaller } from "../src/plugins/session-caller";
import { sessionCapabilityHandlers } from "../src/plugins/session-capabilities";
import { setReplyLanguage } from "../src/reply-language";
import { SessionRegistry } from "../src/session/registry";
import { StorageRegistry } from "../src/storage/registry";

const run = promisify(execFile);
const tarball = process.env.DRONE_DISCOVERY_PLUGIN_TARBALL;
const api = process.env.DRONE_PLUGIN_API_TARBALL;
const runtimeDirectory = resolve(
	process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
		join(import.meta.dirname, `../../desktop/plugin-runtime/${process.platform}-${process.arch}`),
);

it.skipIf(!tarball)(
	"routes actual installed discovery SDK tools through the production Desktop restricted worker, execution broker and creator-owned logical kernels",
	async () => {
		if (!api) throw new Error("An explicit candidate API tarball is required");
		const root = await realpath(await mkdtemp(join(tmpdir(), "discovery-execution-sdk-")));
		const sessions: Awaited<ReturnType<typeof createAgentSession>>["session"][] = [];
		const bootstraps: ReturnType<ReturnType<typeof createDesktopRuntime>["beginNative"]>[] = [];
		let bridge: ReturnType<typeof createDesktopRuntime> | undefined;
		try {
			setReplyLanguage("en");
			desktop.profile = join(root, "profile");
			desktop.state = join(root, "state");
			desktop.workspace = join(root, "workspace");
			desktop.dialogs = 0;
			await Promise.all([desktop.profile, desktop.state, desktop.workspace].map((path) => mkdir(path)));
			await run(
				"npm",
				[
					"install",
					"--prefix",
					root,
					"--ignore-scripts",
					"--omit=peer",
					"--no-audit",
					"--no-fund",
					await realpath(tarball!),
					await realpath(api),
				],
				{ maxBuffer: 8 * 1024 * 1024 },
			);
			const manager = new UiPluginManager({ installedPackageRoot: join(root, "node_modules") });
			await mkdir(join(desktop.profile, "ui-plugins"));
		await manager.scanAll();
			const pluginName = "discovery-workspace";
			const source = manager.runtimeSource(pluginName);
			if (!source?.contentHash || !source.requestsExecution || !source.nativeEntrypoint)
				throw new Error("Actual installed scanner did not derive the execution source");
				expect(source.resources).toBeUndefined();
			await manager.updateConfig({
				enabled: true,
				plugins: { [pluginName]: { enabled: true, trusted: true } },
			});
			const registry = new SessionRegistry(),
				storage = new StorageRegistry();
			const modelRuntime = await ModelRuntime.create({
				authPath: join(root, "offline-auth.json"),
				modelsPath: null,
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const providers: ReturnType<typeof fauxProvider>[] = [];
			bridge = createDesktopRuntime(manager, runtimeDirectory, {
				getPluginCallerContext: (id) => getPluginSessionCaller(registry, id),
				getStorageRegistry: () => storage,
				getPluginSessionCapabilities: () => ({
					...sessionCapabilityHandlers(registry),
					...modelCapabilityHandlers({
						registry,
						getRuntime: async () => modelRuntime,
						getProfileModel: async () => undefined,
						getProfileThinking: async () => undefined,
					}),
				}),
			});
			for (let index = 0; index < 2; index++) {
				const agentDir = join(root, `agent-${index}`);
				await mkdir(agentDir);
				const bootstrap = bridge.beginNative(desktop.window, (path) =>
					path === source.nativeEntrypoint ? pluginName : undefined,
				);
				bootstraps.push(bootstrap);
				const settingsManager = SettingsManager.inMemory({});
				settingsManager.setProjectTrusted(true);
				const loader = new DefaultResourceLoader({
					cwd: desktop.workspace,
					agentDir,
					settingsManager,
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					additionalExtensionPaths: [source.nativeEntrypoint],
					extensionFactoryForPath: bootstrap.factoryForPath,
				});
				await loader.reload({ resolveProjectTrust: async () => true });
				expect(loader.getExtensions().errors).toEqual([]);
				const provider = fauxProvider({ provider: `discovery-execution-${index}`, tokensPerSecond: 0 });
				providers.push(provider);
				modelRuntime.registerNativeProvider(provider.provider);
				vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
				const { session } = await createAgentSession({
					cwd: desktop.workspace,
					agentDir,
					settingsManager,
					resourceLoader: loader,
					modelRuntime,
					sessionManager: SessionManager.inMemory(desktop.workspace),
					model: provider.getModel(),
				});
				sessions.push(session);
				registry.add({ session, cwd: desktop.workspace, unsubscribe: () => {} });
				bootstrap.bindSession(session.sessionId);
				await session.bindExtensions({});
			}
			const sdkCall = async (index: number, name: string, input: Record<string, unknown>) => {
				const session = sessions[index]!;
				providers[index]!.setResponses([
					fauxAssistantMessage(fauxToolCall(name, input)),
					fauxAssistantMessage("Protocol receipt verified"),
				]);
				await session.prompt("Use only the requested discovery operation on synthetic test data.");
				await session.waitForIdle();
				const receipt = session.messages.filter((message) => message.role === "toolResult").at(-1);
				if (!receipt) throw new Error("Actual SDK did not append a tool result");
				return receipt;
			};
			const environment = await sdkCall(0, "discovery_execution_environment", {});
			expect(environment.isError, JSON.stringify(environment)).toBe(false);
			expect(environment.details).toMatchObject({ kind: "container" });
			expect((environment.details as { images: { python?: string } }).images.python).toBeUndefined();
			const token = (await bridge.bind(pluginName, desktop.window))!;
			let selection = bridge.selectSession(desktop.window, sessions[0]!.sessionId);
			expect(await bridge.invoke(desktop.window, token, "executionDescription", null, selection)).toEqual(
				environment.details,
			);
			const overview = (await bridge.invoke(desktop.window, token, "overview", null, selection)) as {
				roots: { root: { handle: string; kind: string } }[];
			};
			const stateRoot = overview.roots.find((item) => item.root.kind === "state");
			if (!stateRoot) throw new Error("Actual directory approval did not grant state root");
			expect(
				(
					await sdkCall(0, "discovery_bind_workspace", {
						root: stateRoot.root.handle,
						acknowledgeExistingData: true,
					})
				).isError,
			).toBe(false);
			const kernel = (sessionId: string) => ({
				sessionId,
				runDirectory: `runs/${sessionId}`,
				language: "python",
				image: `sha256:${"0".repeat(64)}`,
				dataClassification: "public",
				idleTimeoutMs: 120000,
				executionTimeoutMs: 1000,
				maxExecutions: 2,
				maxOutputBytes: 1024,
			});
			const createdA = await sdkCall(0, "discovery_create_kernel", kernel("creator-a"));
			expect(createdA.isError, JSON.stringify(createdA)).toBe(false);
			expect(createdA.details).toMatchObject({
				logicalOnly: true,
				creatorSessionId: sessions[0]!.sessionId,
				kernel: { status: "ready" },
			});
			const createdB = await sdkCall(1, "discovery_create_kernel", kernel("creator-b"));
			expect(createdB.isError, JSON.stringify(createdB)).toBe(false);
			const forbidden = await sdkCall(1, "discovery_execute_kernel", {
				sessionId: "creator-a",
				code: "print('must never run')",
			});
			expect(forbidden.isError).toBe(true);
			expect(JSON.stringify(forbidden)).toContain("another creator");
			const missing = await sdkCall(0, "discovery_execute_kernel", {
				sessionId: "creator-a",
				code: "print('[summary] synthetic missing-image request')",
			});
			expect(missing.isError, JSON.stringify(missing)).toBe(false);
			expect(missing.details).toMatchObject({
				execution: { status: "failed", blockedReason: "image-not-cached" },
				intents: [{ status: "not-accepted" }],
			});
			const intent = (missing.details as { intents: { requestId: string }[] }).intents[0]!;
			expect(
				(await sdkCall(0, "discovery_execution_receipt", { requestId: intent.requestId })).details,
			).toEqual({ kind: "missing" });
			expect(
				(await sdkCall(0, "discovery_cancel_execution", { requestId: intent.requestId })).details,
			).toEqual({ kind: "missing" });
			expect(await readdir(join(desktop.profile, "plugin-execution-receipts"))).toEqual([]);
			await expect(readFile(join(desktop.workspace, "runs"))).rejects.toMatchObject({ code: "ENOENT" });
			const before = await readFile(join(desktop.state, "sessions.json"));
			await bootstraps[0]!.dispose();
			selection = bridge.selectSession(desktop.window, sessions[1]!.sessionId);
			const afterA = (await bridge.invoke(desktop.window, token, "listKernelSessions", null, selection)) as {
				kernels: { sessionId: string; status: string }[];
			};
			expect(afterA.kernels.find((item) => item.sessionId === "creator-a")?.status).toBe("closed");
			expect(afterA.kernels.find((item) => item.sessionId === "creator-b")?.status).toBe("ready");
			expect(await readFile(join(desktop.state, "sessions.json"))).toEqual(before);
			expect((await sdkCall(1, "discovery_reconcile_executions", {})).isError).toBe(false);
			const persisted = JSON.parse(await readFile(join(desktop.state, "sessions.json"), "utf8")) as {
				sessionId: string;
				status: string;
			}[];
			expect(persisted.find((item) => item.sessionId === "creator-a")?.status).toBe("closed");
			await bootstraps[1]!.dispose();
			console.log(
				JSON.stringify({
					test: "packed-discovery-execution-protocol",
					source: "actual installed scanner",
					sdkSessions: 2,
					productionDesktopFactory: true,
					restrictedWorker: true,
					resourceWorkers: 0,
					realCallerIdentity: true,
					creatorIsolation: true,
					configuredImageMissingRejected: true,
					noAcceptedReceiptOrRunDirectory: true,
					missingCancelNotClosed: true,
					nativeCreatorResourceOnlyClose: true,
					nextLegalCallerClosureReconcile: true,
					realContainerSuccess: "NOT_RUN_NO_CACHED_IMAGE",
					formalGui: "NOT_RUN",
				}),
			);
		} finally {
			await Promise.allSettled(bootstraps.map((bootstrap) => bootstrap.dispose()));
			await bridge?.close();
			await Promise.allSettled(sessions.map((session) => session.dispose()));
			await rm(root, { recursive: true, force: true });
			vi.restoreAllMocks();
			setReplyLanguage("zh");
		}
	},
	120000,
);
