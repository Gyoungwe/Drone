// @vitest-environment jsdom
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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

it.skipIf(!tarball)(
	"routes actual installed discovery SDK tools through the production Desktop restricted worker, execution broker and creator-owned logical kernels",
	async () => {
		if (!api) throw new Error("An explicit candidate API tarball is required");
		const root = await realpath(await mkdtemp(join(tmpdir(), "discovery-execution-sdk-")));
		const sessions: Awaited<ReturnType<typeof createAgentSession>>["session"][] = [];
		const bootstraps: ReturnType<ReturnType<typeof createDesktopRuntime>["beginNative"]>[] = [];
		const holders: { bootstrap: ReturnType<ReturnType<typeof createDesktopRuntime>["beginNative"]> }[] = [];
		let bridge: ReturnType<typeof createDesktopRuntime> | undefined;
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
			// Build and mount the installed package's real UI using the production renderer client and registry.
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
			useSessionsStore.setState({ activeSessionId: sessions[1]!.sessionId });
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
			await screen.findByText(
				"The configured language image is not cached. No image is pulled and no code can run.",
			);
			expect(
				(screen.getByRole("button", { name: "Create logical kernel" }) as HTMLButtonElement).disabled,
			).toBe(true);
			// Explicit synthetic engine only: exercises acceptance/receipts and activation replay, not Docker success.
			const syntheticId = `sha256:${"a".repeat(64)}`;
			await writeFile(
				join(root, "docker"),
				`#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(root, "synthetic-engine-calls.jsonl"))},JSON.stringify(args)+'\\n');
if(args[0]==='version'){console.log('synthetic-engine');process.exit(0);}
if(args[0]==='image'&&args.at(-1)==='python:3.12-slim'){console.log(${JSON.stringify(syntheticId)});process.exit(0);}
if(args[0]==='image')process.exit(1);
if(args[0]==='run'){if(args.some(value=>value.includes('hold-protocol'))){fs.writeFileSync(${JSON.stringify(join(root, "synthetic-run-started"))},'running');setInterval(()=>{},1000);}else{console.log('[summary] synthetic protocol output');process.exit(0);}}
if(args[0]==='inspect')process.exit(1);
if(args[0]==='container'&&args[1]==='ls'){if(fs.existsSync(${JSON.stringify(join(root, "synthetic-run-started"))})){const wait=setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(root, "synthetic-cleanup-allowed"))})){clearInterval(wait);fs.unlinkSync(${JSON.stringify(join(root, "synthetic-run-started"))});process.exit(0);}},10);}else process.exit(0);}
if(args[0]!=='run'&&args[0]!=='container')process.exit(2);
`,
			);
			await chmod(join(root, "docker"), 0o755);
			vi.stubEnv("PATH", `${root}${delimiter}${process.env.PATH}`);
			let lateApproval!: (value: { response: number }) => void;
			let approvalDetail = "";
			desktop.approval = async (options) => {
				if (!options.message.includes("capability:execution.run")) return { response: 1 };
				approvalDetail = options.detail;
				return new Promise((resolve) => {
					lateApproval = resolve;
				});
			};
			expect(
				(
					await sdkCall(1, "discovery_create_kernel", {
						...kernel("approval-timeout"),
						image: syntheticId,
						executionTimeoutMs: 1000,
					})
				).isError,
			).toBe(false);
			const timedOut = await sdkCall(1, "discovery_execute_kernel", {
				sessionId: "approval-timeout",
				code: "print('late approval must not execute')",
			});
			expect(timedOut.isError, JSON.stringify(timedOut)).toBe(false);
			expect(timedOut.details).toMatchObject({ execution: { status: "failed", blockedReason: "timeout" } });
			expect(approvalDetail).toContain(desktop.workspace);
			expect(approvalDetail).toContain(sessions[1]!.sessionId);
			lateApproval({ response: 1 });
			let closeApproval!: (value: { response: number }) => void;
			let closeApprovalAsked = false;
			desktop.approval = async (options) => {
				if (!options.message.includes("capability:execution.run")) return { response: 1 };
				closeApprovalAsked = true;
				return new Promise((resolve) => {
					closeApproval = resolve;
				});
			};
			expect(
				(
					await sdkCall(1, "discovery_create_kernel", {
						...kernel("approval-close"),
						image: syntheticId,
						executionTimeoutMs: 30000,
					})
				).isError,
			).toBe(false);
			const awaitingClose = sdkCall(1, "discovery_execute_kernel", {
				sessionId: "approval-close",
				code: "print('closed approval must not execute')",
			});
			await vi.waitFor(() => expect(closeApprovalAsked).toBe(true));
			await bridge.invoke(
				desktop.window,
				token,
				"closeKernelSession",
				{ sessionId: "approval-close" },
				selection,
			);
			const closedExecution = await awaitingClose;
			expect(closedExecution.isError, JSON.stringify(closedExecution)).toBe(false);
			expect(closedExecution.details).toMatchObject({
				execution: { status: "failed", blockedReason: "cancelled" },
			});
			closeApproval({ response: 1 });
			desktop.approval = undefined;
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(await readdir(join(desktop.profile, "plugin-execution-receipts"))).toEqual([]);
			const beforeAcceptedCalls = (await readFile(join(root, "synthetic-engine-calls.jsonl"), "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as string[]);
			expect(beforeAcceptedCalls.filter((args) => args[0] === "run")).toEqual([]);

			expect(
				(
					await sdkCall(1, "discovery_create_kernel", {
						...kernel("synthetic-accepted"),
						image: syntheticId,
						executionTimeoutMs: 30000,
					})
				).isError,
			).toBe(false);
			const accepted = await sdkCall(1, "discovery_execute_kernel", {
				sessionId: "synthetic-accepted",
				code: "print('[summary] synthetic protocol only')",
			});
			expect(accepted.isError, JSON.stringify(accepted)).toBe(false);
			const acceptedIntent = (
				accepted.details as { intents: { requestId: string; status: string }[] }
			).intents.find((item) => item.status === "succeeded");
			if (!acceptedIntent)
				throw new Error(
					`Synthetic accepted transaction did not complete: ${JSON.stringify(accepted.details)}`,
				);
			expect(
				(await sdkCall(1, "discovery_execution_receipt", { requestId: acceptedIntent.requestId })).details,
			).toMatchObject({ kind: "value", receipt: { status: "succeeded" } });
			// Actual SDK tool cancellation remains pending until the synthetic owned-cleanup probe settles.
			expect(
				(
					await sdkCall(1, "discovery_create_kernel", {
						...kernel("accepted-cancel"),
						image: syntheticId,
						executionTimeoutMs: 30000,
					})
				).isError,
			).toBe(false);
			const pendingCall = sdkCall(1, "discovery_execute_kernel", {
				sessionId: "accepted-cancel",
				code: "# hold-protocol\nprint('synthetic cleanup only')",
			});
			await vi.waitFor(async () =>
				expect(await readFile(join(root, "synthetic-run-started"), "utf8")).toBe("running"),
			);
			let abortSettled = false;
			const aborting = sessions[1]!.abort().then(() => {
				abortSettled = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 650));
			expect(abortSettled).toBe(false);
			await writeFile(join(root, "synthetic-cleanup-allowed"), "allow only synthetic owned cleanup");
			await aborting;
			await pendingCall;
			const freshReconcile = await sdkCall(1, "discovery_reconcile_executions", {});
			expect(freshReconcile.isError, JSON.stringify(freshReconcile)).toBe(false);
			expect(
				(freshReconcile.details as { intents: { status: string }[] }).intents.some(
					(item) => item.status === "cancelled",
				),
			).toBe(true);
			await waitFor(() =>
				expect(
					(screen.getByRole("button", { name: "Create logical kernel" }) as HTMLButtonElement).disabled,
				).toBe(false),
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
			const uiKernelId = (
				screen.getByRole("combobox", { name: "Select your logical kernel" }) as HTMLSelectElement
			).value;
			fireEvent.change(screen.getByRole("textbox", { name: "Code (shown in the approval)" }), {
				target: { value: "print('[summary] UI and SDK share the owner')" },
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
			await screen.findByText("[summary] synthetic protocol output", {}, { timeout: 10000 });
			const fromNative = await sdkCall(1, "discovery_list_kernels", {});
			expect(
				(fromNative.details as { kernels: { sessionId: string; executionCount: number }[] }).kernels.find(
					(item) => item.sessionId === uiKernelId,
				),
			).toMatchObject({ executionCount: 1 });
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Close my kernel" }));
			});
			await waitFor(() =>
				expect((screen.getByRole("button", { name: "Close my kernel" }) as HTMLButtonElement).disabled).toBe(
					true,
				),
			);
			cleanup();
			useUiPluginRegistry.getState().removePlugin(pluginName);
			const receiptDirectory = join(desktop.profile, "plugin-execution-receipts");
			for (const name of await readdir(receiptDirectory)) await rm(join(receiptDirectory, name));
			await bridge.withTransition(() =>
				manager.updateConfig({
					enabled: false,
					plugins: { [pluginName]: { enabled: false, trusted: true } },
				}),
			);
			await bridge.withTransition(() =>
				manager.updateConfig({ enabled: true, plugins: { [pluginName]: { enabled: true, trusted: true } } }),
			);
			const nextBootstrap = bridge.beginNative(desktop.window, (path) =>
				path === source.nativeEntrypoint ? pluginName : undefined,
			);
			bootstraps.push(nextBootstrap);
			holders[1]!.bootstrap = nextBootstrap;
			nextBootstrap.bindSession(sessions[1]!.sessionId);
			await sessions[1]!.reload();
			const orphan = await sdkCall(1, "discovery_execution_receipt", { requestId: acceptedIntent.requestId });
			expect(orphan.isError).toBe(true);
			expect(JSON.stringify(orphan)).toContain("needs recovery");
			const oldKernel = await sdkCall(1, "discovery_execute_kernel", {
				sessionId: "synthetic-accepted",
				code: "print('must not replay')",
			});
			expect(oldKernel.isError).toBe(true);
			const engineCalls = (await readFile(join(root, "synthetic-engine-calls.jsonl"), "utf8"))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as string[]);
			expect(engineCalls.filter((args) => args[0] === "run")).toHaveLength(3);
			await nextBootstrap.dispose();
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
					syntheticAcceptedAcrossActivationMissingReceiptRejected: true,
					actualSdkLocalTimeoutLateApprovalZeroAccepted: true,
					actualSdkCloseLateApprovalZeroAccepted: true,
					actualSdkAcceptedCancelWaitsSyntheticOwnedCleanup: true,
					renderedInstalledKernelUiSharesSdkOwner: true,
					realContainerSuccess: "NOT_RUN_NO_CACHED_IMAGE",
					formalGui: "NOT_RUN",
				}),
			);
		} catch (error) {
			console.dir(error, { depth: 8 });
			throw error;
		} finally {
			cleanup();
			useUiPluginRegistry.getState().removePlugin("discovery-workspace");
			await Promise.allSettled(bootstraps.map((bootstrap) => bootstrap.dispose()));
			const [closed] = await Promise.allSettled([bridge?.close()]);
			if (closed.status === "rejected") console.dir(closed.reason, { depth: 8 });
			await Promise.allSettled(sessions.map((session) => session.dispose()));
			await rm(root, { recursive: true, force: true });
			desktop.approval = undefined;
			vi.unstubAllEnvs();
			vi.unstubAllGlobals();
			vi.restoreAllMocks();
			setReplyLanguage("zh");
		}
	},
	120000,
);
