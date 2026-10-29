// @vitest-environment jsdom
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
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
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { createElement } from "react";
import { expect, it, vi } from "vitest";
import { buildPlugin } from "../../desktop/src/main/ui-plugins/build";
import { InquiryService } from "../src/services/inquiry";
import "../../desktop/src/renderer/src/plugins/host-api";
import { useI18nStore } from "../../desktop/src/renderer/src/i18n";
import { invokePluginRuntime, subscribePluginRuntime } from "../../desktop/src/renderer/src/plugins/caller";
import { PluginEntryHost, usePluginEntries } from "../../desktop/src/renderer/src/plugins/PluginRegions";
import { useUiPluginRegistry } from "../../desktop/src/renderer/src/plugins/registry";
import { createPluginRuntimeClient } from "../../desktop/src/renderer/src/plugins/runtime";
import { UI_REGIONS } from "../../desktop/src/renderer/src/plugins/slots";
import { useSessionsStore } from "../../desktop/src/renderer/src/stores/sessions";
import { useUiPluginsStore } from "../../desktop/src/renderer/src/stores/ui-plugins";

vi.hoisted(() => {
	window.matchMedia = () =>
		({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});
function InstalledPanel() {
	const entries = usePluginEntries(UI_REGIONS.PanelTab);
	return createElement(
		React.Fragment,
		null,
		...entries.map((entry) => createElement(PluginEntryHost, { key: entry.id, entry })),
	);
}
const desktop = vi.hoisted(() => ({
	profile: "",
	state: "",
	workspace: "",
	dialogs: 0,
	approval: undefined as
		| undefined
		| ((options: { message: string; detail: string }) => Promise<{ response: number }>),
	window: { id: 17, isDestroyed: () => false },
	contents: { isDestroyed: () => false, send() {} },
}));
vi.mock("electron", () => ({
	app: { isPackaged: false, getPath: () => desktop.profile },
	BrowserWindow: { fromWebContents: () => desktop.window },
	webContents: { fromId: () => desktop.contents },
	dialog: {
		showMessageBox: async (_window: unknown, options: { message: string; detail: string }) => {
			desktop.dialogs++;
			return desktop.approval ? desktop.approval(options) : { response: 1 };
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
const tarball = process.env.DRONE_INQUIRY_PLUGIN_TARBALL;
const api = process.env.DRONE_PLUGIN_API_TARBALL;
const runtimeDirectory = resolve(
	process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
		join(import.meta.dirname, `../../desktop/plugin-runtime/${process.platform}-${process.arch}`),
);

it.skipIf(!tarball)(
	"shares one installed Inquiry SQLite owner through actual SDK and rendered UI with original restore",
	async () => {
		if (!api) throw new Error("An explicit candidate API tarball is required");
		const root = await realpath(await mkdtemp(join(tmpdir(), "inquiry-managed-ui-")));
		const sessions: Awaited<ReturnType<typeof createAgentSession>>["session"][] = [];
		const bootstraps: ReturnType<ReturnType<typeof createDesktopRuntime>["beginNative"]>[] = [];
		const holders: { bootstrap: ReturnType<ReturnType<typeof createDesktopRuntime>["beginNative"]> }[] = [];
		let bridge: ReturnType<typeof createDesktopRuntime> | undefined;
		let failure: unknown;
		try {
			setReplyLanguage("en");
			vi.stubGlobal("React", React);
			vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer));
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
			const seed = new SqliteInquiryStorage("legacy-project", join(desktop.state, "ledger.sqlite"));
			await seed.close();
			const original = await readFile(join(desktop.state, "ledger.sqlite"));
			const manager = new UiPluginManager({ installedPackageRoot: join(root, "node_modules") });
			await mkdir(join(desktop.profile, "ui-plugins"));
			await manager.scanAll();
			const pluginName = "inquiry-workspace";
			const source = manager.runtimeSource(pluginName);
			if (!source?.contentHash || !source.requestsBinaryStateWrite || !source.nativeEntrypoint)
				throw new Error("Actual installed scanner did not derive the binary state source");
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
				const bootstrap = bridge.beginNative(desktop.window, (path) => manager.nativeRuntimeName(path));
				bootstraps.push(bootstrap);
				const holder = { bootstrap };
				holders.push(holder);
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
					extensionFactoryForPath: (path) => holder.bootstrap.factoryForPath(path),
				});
				await loader.reload({ resolveProjectTrust: async () => true });
				expect(loader.getExtensions().errors).toEqual([]);
				const provider = fauxProvider({ provider: `inquiry-managed-${index}`, tokensPerSecond: 0 });
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
				await session.prompt("Use only the requested Inquiry operation on synthetic test data.");
				await session.waitForIdle();
				const receipt = session.messages.filter((message) => message.role === "toolResult").at(-1);
				if (!receipt) throw new Error("Actual SDK did not append a tool result");
				return receipt;
			};
			const token = (await bridge.bind(pluginName, desktop.window))!;
			let selection = bridge.selectSession(desktop.window, sessions[0]!.sessionId);
			const status = await sdkCall(0, "inquiry_read", { request: { action: "status" } });
			expect(status.isError, JSON.stringify(status)).toBe(false);
			expect(status.details).toMatchObject({ state: "needs-binding" });
			const packageRoot = join(root, "node_modules/@gyoungwe/pi-inquiry");
			const uiManifest = JSON.parse(await readFile(join(packageRoot, "ui/plugin.json"), "utf8"));
			expect(
				await buildPlugin(join(packageRoot, "ui"), uiManifest.main, { outDir: join(root, "built-ui") }),
			).toEqual({ ok: true });
			const uiCode = await readFile(join(root, "built-ui/index.js"), "utf8");
			const module = await import(`data:text/javascript;base64,${Buffer.from(uiCode).toString("base64")}`);
			(window as unknown as { pi: unknown }).pi = {
				pluginRuntimeSelectSession: async (id: string | null) =>
					(selection = bridge!.selectSession(desktop.window, id)),
				pluginRuntimeInvoke: (
					binding: string,
					operation: string,
					input: unknown,
					lease: string,
					requestId?: string,
				) => bridge!.invoke(desktop.window, binding, operation, input, lease, requestId),
				pluginRuntimeCancel: (binding: string, lease: string, requestId: string) =>
					bridge!.cancel(desktop.window, binding, lease, requestId),
				onPluginRuntimeEvent: (listener: Parameters<typeof subscribePluginRuntime>[1]) =>
					bridge!.onEvent((owner, event) => {
						if (owner === desktop.window) (listener as (event: unknown) => void)(event);
					}),
			};
			useI18nStore.setState({ language: "en" });
			useSessionsStore.setState({ activeSessionId: sessions[0]!.sessionId });
			useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
			const uiClient = createPluginRuntimeClient(
				(operation, input, signal) => invokePluginRuntime(token, operation, input, signal),
				(listener) => subscribePluginRuntime(token, listener),
			);
			expect(useUiPluginRegistry.getState().applyPlugin(uiManifest, module, [], uiClient)).toEqual({
				ok: true,
				missing: [],
			});
			render(createElement(InstalledPanel));
			const binary = await screen.findByRole(
				"combobox",
				{ name: "Binary state directory" },
				{ timeout: 10000 },
			);
			const metadata = screen.getByRole("combobox", { name: "JSON metadata directory" });
			fireEvent.change(binary, { target: { value: (binary as HTMLSelectElement).options[1]!.value } });
			fireEvent.change(metadata, { target: { value: (metadata as HTMLSelectElement).options[1]!.value } });
			fireEvent.click(screen.getByRole("checkbox"));
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Bind original directory" }));
			});
			await screen.findByText(/Original project.*legacy-project/, {}, { timeout: 10000 });
			expect(() => new InquiryService({ inquiryDir: desktop.state, projectId: "legacy-project" })).toThrow(
				/writer|reserved/,
			);
			fireEvent.change(screen.getByRole("textbox", { name: "Question ID" }), {
				target: { value: "ui-question" },
			});
			fireEvent.change(screen.getByRole("textbox", { name: "Research question" }), {
				target: { value: "Question written by actual installed UI" },
			});
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Save question" }));
			});
			await screen.findByText("Question written by actual installed UI", {}, { timeout: 10000 });
			const snapshot = await sdkCall(0, "inquiry_read", { request: { action: "snapshot" } });
			expect(snapshot.details).toMatchObject({ value: { questions: [{ id: "ui-question" }] } });
			const now = new Date().toISOString();
			const written = await sdkCall(1, "inquiry_write", {
				request: {
					action: "recordQuestion",
					record: {
						id: "sdk-question",
						schemaVersion: 2,
						projectId: "legacy-project",
						kind: "question",
						statement: "Question written by actual second SDK",
						competingExplanations: [],
						testsDone: [],
						testsPlanned: [],
						status: "open",
						proposer: "user",
						priority: 0.5,
						createdAt: now,
						updatedAt: now,
					},
				},
			});
			expect(written.isError, JSON.stringify(written)).toBe(false);
			await screen.findByText("Question written by actual second SDK", {}, { timeout: 10000 });
			await waitFor(
				() =>
					expect(
						(screen.getByRole("button", { name: "Restore original backup" }) as HTMLButtonElement).disabled,
					).toBe(false),
				{ timeout: 10000 },
			);
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Restore original backup" }));
			});
			await waitFor(() => expect(screen.getByRole("heading", { name: "Questions (0)" })).toBeTruthy(), {
				timeout: 10000,
			});
			expect(await readFile(join(desktop.state, "ledger.sqlite"))).toEqual(original);
			const restored = await sdkCall(0, "inquiry_read", { request: { action: "snapshot" } });
			expect(restored.details).toMatchObject({ value: { questions: [] } });
			cleanup();
			useUiPluginRegistry.getState().removePlugin(pluginName);
			await bridge.withTransition(() =>
				manager.updateConfig({
					enabled: false,
					plugins: { [pluginName]: { enabled: false, trusted: true } },
				}),
			);
			const legacy = new InquiryService({ inquiryDir: desktop.state, projectId: "legacy-project" });
			await legacy.dispose();
			await bridge.withTransition(() =>
				manager.updateConfig({ enabled: true, plugins: { [pluginName]: { enabled: true, trusted: true } } }),
			);
			const newToken = (await bridge.bind(pluginName, desktop.window))!;
			selection = bridge.selectSession(desktop.window, sessions[0]!.sessionId);
			expect(
				await bridge.invoke(desktop.window, newToken, "inquiry.read", { action: "snapshot" }, selection),
			).toMatchObject({ value: { questions: [] } });
			console.log(
				JSON.stringify({
					test: "packed-inquiry-managed-ui",
					actualSdkSessions: 2,
					productionInstalledScanner: true,
					productionDesktopFactory: true,
					ordinaryRestrictedWorker: true,
					actualNativeRuntimeName: true,
					renderedInstalledUiSameOwner: true,
					uiWriteSdkRead: true,
					sdkWriteUiEvent: true,
					exactOriginalRestore: true,
					legacyWriterCompetition: true,
					uiTransitionLeaseHandoff: true,
					freshBindingOriginalReadback: true,
					formalGui: "NOT_RUN",
				}),
			);
		} catch (error) {
			console.dir(error, { depth: 8 });
			failure = error;
		} finally {
			cleanup();
			useUiPluginRegistry.getState().removePlugin("inquiry-workspace");
			const results = await Promise.allSettled([
				...bootstraps.map((bootstrap) => bootstrap.dispose()),
				bridge?.close(),
				...sessions.map((session) => session.dispose()),
			]);
			const failed = results.filter((result) => result.status === "rejected");
			desktop.approval = undefined;
			vi.unstubAllEnvs();
			vi.unstubAllGlobals();
			vi.restoreAllMocks();
			setReplyLanguage("zh");
			if (failed.length)
				failure = new AggregateError(
					[...(failure ? [failure] : []), ...failed.map((result) => result.reason)],
					"Inquiry fixture cleanup failed; temporary evidence retained",
				);
			if (!failure) await rm(root, { recursive: true, force: true });
			else console.log(`Inquiry synthetic evidence retained: ${root}`);
		}
		if (failure) throw failure;
	},
	180000,
);
