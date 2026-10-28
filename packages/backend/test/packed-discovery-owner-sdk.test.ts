// @vitest-environment jsdom
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { DiscoveryHostLoader } from "@gyoungwe/plugin-api";
import { PluginResourceReservations } from "@gyoungwe/plugin-api/node/reservations";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { createElement } from "react";
import { expect, it, vi } from "vitest";
import { buildPlugin } from "../../desktop/src/main/ui-plugins/build";
import "../../desktop/src/renderer/src/plugins/host-api";
import { useI18nStore } from "../../desktop/src/renderer/src/i18n";
import { PluginEntryHost, usePluginEntries } from "../../desktop/src/renderer/src/plugins/PluginRegions";
import { useUiPluginRegistry } from "../../desktop/src/renderer/src/plugins/registry";
import { UI_REGIONS } from "../../desktop/src/renderer/src/plugins/slots";
import { useSessionsStore } from "../../desktop/src/renderer/src/stores/sessions";
import { useUiPluginsStore } from "../../desktop/src/renderer/src/stores/ui-plugins";

vi.hoisted(() => {
	window.matchMedia = () =>
		({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
});

import { createDiscoveryService, type DiscoveryServicePort } from "../src/discovery/service";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { fileCapabilityHandlers, PluginFileCapabilities } from "../src/plugins/file-capabilities";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { getPluginSessionCaller } from "../src/plugins/session-caller";
import { canonicalProjectId } from "../src/project-id";
import { SessionRegistry } from "../src/session/registry";
import { StorageRegistry } from "../src/storage/registry";

function InstalledPanel() {
	const entries = usePluginEntries(UI_REGIONS.PanelTab);
	return createElement(
		React.Fragment,
		null,
		...entries.map((entry) => createElement(PluginEntryHost, { key: entry.id, entry })),
	);
}
const run = promisify(execFile);
const tarball = process.env.DRONE_DISCOVERY_PLUGIN_TARBALL;
const api = process.env.DRONE_PLUGIN_API_TARBALL;
const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const plan = (id: string) => ({
	id,
	hypothesisId: `hypothesis-${id}`,
	prior: { direction: "unknown", recordedAt: "2026-10-28T00:00:00.000Z" },
	budget: { maxExecutions: 2, maxWallTimeMs: 30000, maxOutputBytes: 65536, maxCostUnits: 2 },
	candidates: [
		{
			id: "candidate",
			statement: "Compare a predefined scientific explanation",
			surprise: 0.5,
			estimatedCost: 1,
			expectedExplanationsExcluded: 1,
			credibility: 0.5,
		},
	],
});

it.skipIf(!tarball)(
	"shares an installed discovery owner across real SDK/UI calls and excludes an independent native writer",
	async () => {
		vi.stubGlobal("React", React);
		vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer));
		if (!api) throw new Error("Discovery candidate requires explicit DRONE_PLUGIN_API_TARBALL");
		const root = await realpath(await mkdtemp(join(tmpdir(), "discovery-packed-owner-")));
		const opened: Awaited<ReturnType<typeof createAgentSession>>["session"][] = [];
		const bootstraps: ReturnType<PluginRuntimeBridge["beginNative"]>[] = [];
		let bridge: PluginRuntimeBridge | undefined;
		const legacy: DiscoveryServicePort[] = [];
		try {
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
			const packageRoot = await realpath(join(root, "node_modules/@gyoungwe/pi-discovery"));
			const manifest = JSON.parse(await readFile(join(packageRoot, "plugin.manifest.json"), "utf8"));
			expect(manifest.permissions.filesystem).toContain("application-state-write");
			expect(manifest.entrypoints.resources).toBeUndefined();
			const entrypoint = join(packageRoot, manifest.entrypoints.desktopRuntime),
				nativeEntrypoint = join(packageRoot, manifest.entrypoints.extension);
			const projectKey = createHash("sha256")
				.update(canonicalProjectId(join(root, "project-0")))
				.digest("hex")
				.slice(0, 32);
			const stateA = join(root, "legacy-agent", "discovery", projectKey),
				stateB = join(root, "selected-state-b"),
				cache = join(root, "private-cache"),
				leases = join(root, "leases");
			await Promise.all([stateA, stateB, cache].map((directory) => mkdir(directory, { recursive: true })));
			const storage = new StorageRegistry();
			const grants = [stateA, stateB].map((path, index) => ({
				handle: `state-${index}`,
				path,
				kind: "state" as const,
				scope: { kind: "application" as const },
				stateWrite: {
					registry: storage,
					storageId: storage.registerDiscoveredRoot(`state-${index}`, path, "test", "private").id,
				},
			}));
			const registry = new SessionRegistry();
			let denyWrite = false;
			const approvals: string[] = [];
			const source = {
				pluginId: "@gyoungwe/pi-discovery",
				packageRoot,
				entrypoint,
				nativeEntrypoint,
				requestsStateRead: true,
				requestsStateWrite: true,
			};
			bridge = new PluginRuntimeBridge({
				source: () => source,
				enabled: () => true,
				factory: () => createProcessPluginRuntime({ ...source, runtimeDirectory }),
				getSessionContext: (id) => getPluginSessionCaller(registry, id),
				approve: async (_owner, _source, operation) => {
					if (operation) approvals.push(operation);
					return !(denyWrite && operation === "capability:state.writeJson");
				},
				capabilities: () => async () => {
					const ports = await PluginFileCapabilities.create(grants, cache, leases);
					return {
						resources: grants.map((grant) => ({
							handle: grant.handle,
							kind: grant.kind,
							access: "read-write" as const,
						})),
						handlers: fileCapabilityHandlers(ports),
						dispose: () => ports.drain(),
						finalRelease: async () => ports.releaseReservations(),
					};
				},
			});
			const window = { id: 1, isDestroyed: () => false };
			const token = (await bridge.bind("discovery-workspace", window))!;
			const providers: ReturnType<typeof fauxProvider>[] = [];
			for (let index = 0; index < 2; index++) {
				const cwd = join(root, `project-${index}`);
				await mkdir(cwd);
				const bootstrap = bridge.beginNative(window, (path) =>
					path === nativeEntrypoint ? "discovery-workspace" : undefined,
				);
				bootstraps.push(bootstrap);
				const settingsManager = SettingsManager.inMemory({});
				const resourceLoader = new DefaultResourceLoader({
					cwd,
					agentDir: cwd,
					settingsManager,
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					additionalExtensionPaths: [nativeEntrypoint],
					extensionFactoryForPath: bootstrap.factoryForPath,
				});
				await resourceLoader.reload({ resolveProjectTrust: async () => true });
				expect(resourceLoader.getExtensions().errors).toEqual([]);
				const modelRuntime = await ModelRuntime.create({
					authPath: join(cwd, "auth.json"),
					modelsPath: null,
					allowModelNetwork: false,
					refreshOnCreate: false,
				});
				const provider = fauxProvider({ provider: `discovery-owner-${index}`, tokensPerSecond: 0 });
				providers.push(provider);
				modelRuntime.registerNativeProvider(provider.provider);
				vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
				const { session } = await createAgentSession({
					cwd,
					agentDir: cwd,
					settingsManager,
					resourceLoader,
					modelRuntime,
					sessionManager: SessionManager.inMemory(cwd),
					model: provider.getModel(),
				});
				opened.push(session);
				registry.add({ session, cwd, unsubscribe: () => {} });
				bootstrap.bindSession(session.sessionId);
				await session.bindExtensions({});
			}
			const { discoveryHostLoader } = (await import(
				/* @vite-ignore */ pathToFileURL(join(packageRoot, manifest.entrypoints.host)).href
			)) as { discoveryHostLoader: DiscoveryHostLoader };
			const legacyOptions = {
				projectId: `discovery-${projectKey}`,
				projectRoot: join(root, "project-0"),
				agentDir: stateA,
			};
			const old = createDiscoveryService(
				legacyOptions,
				discoveryHostLoader,
				new PluginResourceReservations(leases),
			).service;
			legacy.push(old);
			await old.createExplorationPlan(plan("legacy-plan-a"));
			const originalLegacyBytes = await readFile(join(stateA, "plans.json"), "utf8");
			let selection = bridge.selectSession(window, opened[0]!.sessionId);
			const invoke = (name: string, input: unknown) => bridge!.invoke(window, token, name, input, selection);
			const uiManifest = JSON.parse(await readFile(join(packageRoot, "ui/plugin.json"), "utf8"));
			expect(
				await buildPlugin(join(packageRoot, "ui"), uiManifest.main, { outDir: join(root, "built-ui") }),
			).toEqual({ ok: true });
			const uiCode = await readFile(join(root, "built-ui/index.js"), "utf8");
			const module = await import(`data:text/javascript;base64,${Buffer.from(uiCode).toString("base64")}`);
			const uiClient = {
				invoke,
				subscribe: (listener: (event: { type: "changed"; revision: number }) => void) =>
					bridge!.onEvent((eventOwner, event) => {
						if (eventOwner === window && event.binding === token && event.selectionToken === selection)
							listener({ type: event.type, revision: event.revision });
					}),
			};
			useI18nStore.setState({ language: "en" });
			useSessionsStore.setState({ activeSessionId: opened[0]!.sessionId });
			useUiPluginsStore.setState({ config: { enabled: true, plugins: {}, assignments: {} } });
			const installUi = () =>
				expect(useUiPluginRegistry.getState().applyPlugin(uiManifest, module, [], uiClient)).toEqual({
					ok: true,
					missing: [],
				});
			installUi();
			render(createElement(InstalledPanel));
			await screen.findByText(stateA);
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Take ownership and preserve records" }));
			});
			await screen.findByRole("alert");
			expect(screen.getByRole("alert").textContent).toContain("already reserved");
			expect(await readFile(join(stateA, "plans.json"), "utf8")).toBe(originalLegacyBytes);
			await old.dispose();
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Take ownership and preserve records" }));
			});
			await screen.findByRole("button", { name: "Save plan" });
			denyWrite = true;
			await expect(invoke("createExplorationPlan", plan("denied"))).rejects.toThrow("denied");
			denyWrite = false;
			await waitFor(() =>
				expect((screen.getByRole("button", { name: "Save plan" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.change(screen.getByRole("textbox", { name: "Hypothesis ID" }), {
				target: { value: "hypothesis-ui-plan-a" },
			});
			fireEvent.change(screen.getByRole("textbox", { name: "Candidate test" }), {
				target: { value: "Compare a predefined scientific explanation" },
			});
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
			});
			await screen.findByText("hypothesis-ui-plan-a");
			const savedPlans = JSON.parse(await readFile(join(stateA, "plans.json"), "utf8")) as {
				id: string;
				projectId: string;
			}[];
			const uiPlanId = savedPlans.find((record) => record.id !== "legacy-plan-a")!.id;
			expect(savedPlans.map((record) => record.projectId)).toEqual([
				legacyOptions.projectId,
				legacyOptions.projectId,
			]);
			const oldSecond = createDiscoveryService(
				legacyOptions,
				discoveryHostLoader,
				new PluginResourceReservations(leases),
			).service;
			legacy.push(oldSecond);
			expect((await oldSecond.listExplorationPlans()).map((record) => record.id)).toEqual([
				"legacy-plan-a",
				uiPlanId,
			]);
			await expect(oldSecond.createExplorationPlan(plan("legacy-blocked"))).rejects.toThrow(
				"already reserved",
			);
			await act(async () => {
				useUiPluginRegistry.getState().removePlugin("discovery-workspace");
			});
			expect(screen.queryByTestId("discovery-workspace")).toBeNull();

			const sdkCall = async (index: number, name: string, input: Record<string, unknown>) => {
				const session = opened[index]!;
				providers[index]!.setResponses([
					fauxAssistantMessage(fauxToolCall(name, input)),
					fauxAssistantMessage("verified"),
				]);
				await session.prompt("Use the specified discovery tool.");
				await session.waitForIdle();
				const result = session.messages.filter((message) => message.role === "toolResult").at(-1)!;
				return result;
			};
			const nativeA = await sdkCall(0, "discovery_list_records", { journal: "plans" });
			expect(nativeA.isError, JSON.stringify(nativeA)).toBe(false);
			expect((nativeA.details as { records: { id: string }[] }).records.map((record) => record.id)).toEqual([
				"legacy-plan-a",
				uiPlanId,
			]);
			const nativePlan = await sdkCall(0, "discovery_create_plan", plan("native-plan-a"));
			expect(nativePlan.isError, JSON.stringify(nativePlan)).toBe(false);
			await act(async () => {
				installUi();
			});
			await screen.findByText("hypothesis-ui-plan-a");
			await screen.findByText("hypothesis-native-plan-a");
			fireEvent.change(screen.getByRole("textbox", { name: "Hypothesis ID" }), {
				target: { value: "hypothesis-ui-after-native" },
			});
			fireEvent.change(screen.getByRole("textbox", { name: "Candidate test" }), {
				target: { value: "Read the native result before planning the next test" },
			});
			await waitFor(() =>
				expect((screen.getByRole("button", { name: "Save plan" }) as HTMLButtonElement).disabled).toBe(false),
			);
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
			});
			await screen.findByText("hypothesis-ui-after-native");
			const uiAfterNativeId = (
				JSON.parse(await readFile(join(stateA, "plans.json"), "utf8")) as {
					id: string;
					hypothesisId: string;
				}[]
			).find((record) => record.hypothesisId === "hypothesis-ui-after-native")!.id;
			selection = bridge.selectSession(window, opened[1]!.sessionId);
			await act(async () => {
				useSessionsStore.setState({ activeSessionId: opened[1]!.sessionId });
			});
			expect(((await invoke("overview", null)) as { readiness: string }).readiness).toBe("needs-binding");
			await invoke("bindCurrentWorkspace", { root: "state-1", acknowledgeExistingData: false });
			await invoke("createExplorationPlan", plan("ui-plan-b"));
			expect(
				(
					(await sdkCall(1, "discovery_list_records", { journal: "plans" })).details as {
						records: { id: string }[];
					}
				).records.map((record) => record.id),
			).toEqual(["ui-plan-b"]);
			await expect(
				invoke("bindCurrentWorkspace", { root: "state-0", acknowledgeExistingData: true }),
			).rejects.toThrow("another workspace");
			const sdkRoot = resolve(import.meta.dirname, "../../../node_modules/@earendil-works/pi-coding-agent"),
				aiRoot = resolve(import.meta.dirname, "../../../node_modules/@earendil-works/pi-ai");
			const sdkUrl = pathToFileURL(
				join(sdkRoot, JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8")).exports["."].import),
			).href;
			const aiUrl = pathToFileURL(
				join(aiRoot, JSON.parse(await readFile(join(aiRoot, "package.json"), "utf8")).exports["."].import),
			).href;
			const childPath = join(root, "native-child.mjs");
			await writeFile(
				childPath,
				`import {fauxProvider,fauxAssistantMessage,fauxToolCall} from ${JSON.stringify(aiUrl)};import {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager} from ${JSON.stringify(sdkUrl)};import {nativeDiscoveryExtension} from ${JSON.stringify(pathToFileURL(nativeEntrypoint).href)};import {join} from 'node:path';const cwd=${JSON.stringify(join(root, "project-0"))};const settingsManager=SettingsManager.inMemory({});const loader=new DefaultResourceLoader({cwd,agentDir:cwd,settingsManager,noExtensions:true,noSkills:true,noPromptTemplates:true,extensionFactories:[pi=>nativeDiscoveryExtension(pi,{stateDirectory:${JSON.stringify(stateA)},leaseDirectory:${JSON.stringify(leases)}})]});await loader.reload({resolveProjectTrust:async()=>true});if(loader.getExtensions().errors.length)throw new Error(JSON.stringify(loader.getExtensions().errors));const runtime=await ModelRuntime.create({authPath:join(cwd,'child-auth.json'),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});const faux=fauxProvider({provider:'discovery-independent',tokensPerSecond:0});runtime.registerNativeProvider(faux.provider);runtime.hasConfiguredAuth=()=>true;const {session}=await createAgentSession({cwd,agentDir:cwd,settingsManager,resourceLoader:loader,modelRuntime:runtime,sessionManager:SessionManager.inMemory(cwd),model:faux.getModel()});await session.bindExtensions({});faux.setResponses([fauxAssistantMessage(fauxToolCall('discovery_bind_workspace',{root:'native-state',acknowledgeExistingData:true})),fauxAssistantMessage('verified')]);await session.prompt('Bind the explicit selected state root.');await session.waitForIdle();const receipt=session.messages.filter(item=>item.role==='toolResult').at(-1);console.log('DISCOVERY_CHILD_RECEIPT '+JSON.stringify({isError:receipt.isError,text:receipt.content[0].text}));const shutdownErrors=[];session.extensionRunner.onError(error=>shutdownErrors.push(error));await session.extensionRunner.emit({type:'session_shutdown',reason:'quit'});await session.abort();session.dispose();if(shutdownErrors.length)throw new Error('Native shutdown hook failed: '+JSON.stringify(shutdownErrors));`,
			);
			const child = async () => {
				const result = await run(process.execPath, [childPath], { maxBuffer: 4 * 1024 * 1024 });
				const line = result.stdout.split("\n").find((value) => value.startsWith("DISCOVERY_CHILD_RECEIPT "))!;
				return JSON.parse(line.slice("DISCOVERY_CHILD_RECEIPT ".length));
			};
			const denied = await child();
			expect(denied.isError).toBe(true);
			expect(denied.text).toContain("already reserved");
			await bridge.revoke("discovery-workspace");
			const recovered = await child();
			expect(recovered.isError, recovered.text).toBe(false);
			expect(JSON.parse(recovered.text).readiness).toBe("ready");
			expect(
				JSON.parse(await readFile(join(stateA, "plans.json"), "utf8")).map(
					(record: { id: string }) => record.id,
				),
			).toEqual(["legacy-plan-a", uiPlanId, "native-plan-a", uiAfterNativeId]);
			expect(
				JSON.parse(await readFile(join(stateB, "plans.json"), "utf8")).map(
					(record: { id: string }) => record.id,
				),
			).toEqual(["ui-plan-b"]);
			await expect(oldSecond.createExplorationPlan(plan("legacy-stale"))).rejects.toThrow("journal changed");
			await oldSecond.dispose();
			const freshLegacy = createDiscoveryService(
				legacyOptions,
				discoveryHostLoader,
				new PluginResourceReservations(leases),
			).service;
			legacy.push(freshLegacy);
			await freshLegacy.createExplorationPlan(plan("legacy-resumed"));
			expect((await freshLegacy.listExplorationPlans()).map((record) => record.id)).toEqual([
				"legacy-plan-a",
				uiPlanId,
				"native-plan-a",
				uiAfterNativeId,
				"legacy-resumed",
			]);
			await freshLegacy.dispose();
			expect(approvals).toContain("capability:state.reserve");
			console.log(
				JSON.stringify({
					test: "packed-discovery-owner",
					sameTarball: true,
					sameDomainUiNativeUiWrite: true,
					managedProcess: true,
					resourceWorkers: 0,
					sdkSessions: 2,
					workspaceIsolation: true,
					writeDenialReadback: true,
					nativeOtherProcessDenied: true,
					legacyRealWriterDeniedBothDirections: true,
					legacyStaleSnapshotRejected: true,
					existingProjectIdentityPreserved: true,
					writerReleasedAfterDisable: true,
					formalGui: "NOT_RUN",
					fullExecution: "NOT_IMPLEMENTED",
				}),
			);
		} finally {
			cleanup();
			useUiPluginRegistry.getState().removePlugin("discovery-workspace");
			await bridge?.close();
			await Promise.allSettled(legacy.map((service) => service.dispose()));
			await Promise.allSettled(opened.map((session) => session.dispose()));
			await Promise.allSettled(bootstraps.map((bootstrap) => bootstrap.dispose()));
			await rm(root, { recursive: true, force: true });
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
		}
	},
	90000,
);
