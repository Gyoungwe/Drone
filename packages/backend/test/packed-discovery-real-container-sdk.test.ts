// @vitest-environment jsdom
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
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
const tarball = process.env.DRONE_DISCOVERY_PLUGIN_TARBALL;
const api = process.env.DRONE_PLUGIN_API_TARBALL;
const runtimeDirectory = resolve(
	process.env.DRONE_PLUGIN_RUNTIME_DIRECTORY ??
		join(import.meta.dirname, `../../desktop/plugin-runtime/${process.platform}-${process.arch}`),
);

it.skipIf(!tarball || process.env.DRONE_REAL_DISCOVERY_CONTAINER !== "1")(
	"executes one installed discovery owner through actual SDK and rendered UI with cached local Docker",
	async () => {
		if (!api) throw new Error("An explicit candidate API tarball is required");
		const root = await realpath(await mkdtemp(join(tmpdir(), "discovery-execution-sdk-")));
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
			const realDocker = (await run("which", ["docker"])).stdout.trim();
			const observedDocker = join(root, "docker-calls.jsonl");
			const bin = join(root, "bin");
			await mkdir(bin);
			await writeFile(
				join(bin, "docker"),
				`#!${process.execPath}\nimport fs from 'node:fs';import {spawnSync} from 'node:child_process';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(observedDocker)},JSON.stringify(args)+'\\n');const child=spawnSync(${JSON.stringify(realDocker)},args,{stdio:'inherit'});if(child.error)throw child.error;process.exit(child.status ?? 1);`,
			);
			await chmod(join(bin, "docker"), 0o755);
			vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH}`);
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
			const image = (environment.details as { images: { python?: string } }).images.python;
			if (!image || !/^sha256:[a-f0-9]{64}$/.test(image))
				throw new Error(`Configured Python image is not cached: ${JSON.stringify(environment.details)}`);
			const inspected = JSON.parse(
				(await run(realDocker, ["image", "inspect", "python:3.12-slim"])).stdout,
			)[0];
			expect(inspected.Id).toBe(image);
			const token = (await bridge.bind(pluginName, desktop.window))!;
			let selection = bridge.selectSession(desktop.window, sessions[0]!.sessionId);
			const overview = (await bridge.invoke(desktop.window, token, "overview", null, selection)) as {
				roots: { root: { handle: string; kind: string } }[];
			};
			const stateRoot = overview.roots.find((item) => item.root.kind === "state");
			if (!stateRoot) throw new Error("Approved state root unavailable");
			expect(
				(
					await sdkCall(0, "discovery_bind_workspace", {
						root: stateRoot.root.handle,
						acknowledgeExistingData: true,
					})
				).isError,
			).toBe(false);
			expect(
				(
					await sdkCall(0, "discovery_create_kernel", {
						sessionId: "real-sdk",
						runDirectory: "runs/real-sdk",
						language: "python",
						image,
						dataClassification: "public",
						idleTimeoutMs: 120000,
						executionTimeoutMs: 30000,
						maxExecutions: 2,
						maxOutputBytes: 4096,
					})
				).isError,
			).toBe(false);
			const code =
				"from pathlib import Path\nPath('sdk-proof.txt').write_text('synthetic sdk proof')\nprint('[summary] actual Docker SDK proof')";
			const executed = await sdkCall(0, "discovery_execute_kernel", { sessionId: "real-sdk", code });
			expect(executed.isError, JSON.stringify(executed)).toBe(false);
			expect(executed.details).toMatchObject({
				execution: { status: "succeeded", output: "[summary] actual Docker SDK proof\n" },
			});
			const intent = (executed.details as { intents: { requestId: string; status: string }[] }).intents.find(
				(item) => item.status === "succeeded",
			);
			if (!intent) throw new Error(`No successful host intent: ${JSON.stringify(executed.details)}`);
			expect(
				(await sdkCall(0, "discovery_execution_receipt", { requestId: intent.requestId })).details,
			).toMatchObject({ kind: "value", receipt: { status: "succeeded", image } });
			expect(
				(await sdkCall(1, "discovery_execution_receipt", { requestId: intent.requestId })).details,
			).toEqual({ kind: "missing" });
			expect(await readFile(join(desktop.workspace, "runs/real-sdk/sdk-proof.txt"), "utf8")).toBe(
				"synthetic sdk proof",
			);
			const packageRoot = join(root, "node_modules/@gyoungwe/pi-discovery");
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
			await waitFor(
				() =>
					expect(
						(screen.getByRole("button", { name: "Create logical kernel" }) as HTMLButtonElement).disabled,
					).toBe(false),
				{ timeout: 10000 },
			);
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Create logical kernel" }));
			});
			await waitFor(
				() =>
					expect(
						(screen.getByRole("combobox", { name: "Select your logical kernel" }) as HTMLSelectElement).value,
					).toMatch(/^kernel-/),
				{ timeout: 10000 },
			);
			const uiKernel = (
				screen.getByRole("combobox", { name: "Select your logical kernel" }) as HTMLSelectElement
			).value;
			fireEvent.change(screen.getByRole("textbox", { name: "Code (shown in the approval)" }), {
				target: {
					value:
						"from pathlib import Path\nPath('ui-proof.txt').write_text('synthetic ui proof')\nprint('[summary] actual Docker UI proof')",
				},
			});
			await waitFor(
				() =>
					expect(
						(screen.getByRole("button", { name: "Approve and run code" }) as HTMLButtonElement).disabled,
					).toBe(false),
				{ timeout: 10000 },
			);
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Approve and run code" }));
			});
			await screen.findByText("[summary] actual Docker UI proof", {}, { timeout: 30000 });
			const listed = await sdkCall(0, "discovery_list_kernels", {});
			expect(
				(listed.details as { kernels: { sessionId: string; executionCount: number }[] }).kernels.find(
					(item) => item.sessionId === uiKernel,
				),
			).toMatchObject({ executionCount: 1 });
			const reconciled = await sdkCall(0, "discovery_reconcile_executions", {});
			const uiIntent = (
				reconciled.details as { intents: { sessionId: string; requestId: string; status: string }[] }
			).intents.find((item) => item.sessionId === uiKernel && item.status === "succeeded");
			if (!uiIntent)
				throw new Error(`UI run missing successful host intent: ${JSON.stringify(reconciled.details)}`);
			expect(
				(await sdkCall(0, "discovery_execution_receipt", { requestId: uiIntent.requestId })).details,
			).toMatchObject({ kind: "value", receipt: { status: "succeeded", image } });
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Close my kernel" }));
			});
			await waitFor(
				() =>
					expect(
						(screen.getByRole("button", { name: "Close my kernel" }) as HTMLButtonElement).disabled,
					).toBe(true),
				{ timeout: 10000 },
			);
			expect((await sdkCall(0, "discovery_close_kernel", { sessionId: "real-sdk" })).isError).toBe(false);
			cleanup();
			useUiPluginRegistry.getState().removePlugin(pluginName);
			await bridge.withTransition(() =>
				manager.updateConfig({
					enabled: false,
					plugins: { [pluginName]: { enabled: false, trusted: true } },
				}),
			);
			const calls = (await readFile(observedDocker, "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as string[]);
			const runs = calls.filter((args) => args[0] === "run");
			expect(runs).toHaveLength(2);
			for (const args of runs) {
				expect(args).toContain("--pull=never");
				expect(args).toContain("--read-only");
				expect(args).toContain("none");
				expect(args).toContain(image);
				const name = args[args.indexOf("--name") + 1]!;
				expect(
					(
						await run(realDocker, [
							"container",
							"ls",
							"--all",
							"--filter",
							`name=^/${name}$`,
							"--format",
							"{{.Names}}",
						])
					).stdout.trim(),
				).toBe("");
			}
			console.log(
				JSON.stringify({
					test: "packed-discovery-real-container",
					sameInstalledTar: true,
					productionDesktopFactory: true,
					actualSdkSessions: 2,
					restrictedWorker: true,
					actualLocalDocker: true,
					configuredCachedExactImage: image,
					noImagePull: true,
					sdkExecutionReceipt: true,
					renderedInstalledUiSameOwner: true,
					uiExecutionReceipt: true,
					otherCreatorReceiptHidden: true,
					ownedContainersAbsentAfterClose: true,
					realContainerSuccess: "PASS",
					formalGui: "NOT_RUN",
				}),
			);
		} catch (error) {
			console.dir(error, { depth: 8 });
			failure = error;
		} finally {
			cleanup();
			useUiPluginRegistry.getState().removePlugin("discovery-workspace");
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
					"Real container fixture cleanup failed; temporary evidence retained",
				);
			if (!failure) await rm(root, { recursive: true, force: true });
			else console.log(`Real container synthetic evidence retained: ${root}`);
		}
		if (failure) throw failure;
	},
	180000,
);
