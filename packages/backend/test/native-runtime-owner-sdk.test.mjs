import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registerTaskRuntime } from "@drone/tasks/runtime";
import { createStandaloneRuntime } from "@drone/tasks/runtime-bridge";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { SkillVisibility } from "../src/capabilities/resource-loader";
import { CapabilityRuntime } from "../src/capabilities/runtime";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { getPluginSessionCaller } from "../src/plugins/session-caller";
import { SessionRegistry } from "../src/session/registry";
import { SessionEngine } from "../src/session-engine/engine";

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);

it.each(["native-first", "host-first", "approval-window-closed"])(
	"real SDK sessions share a desktop owner and support %s shutdown",
	async (shutdownOrder) => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-shared-native-")));
		const pkg = join(root, "package");
		await mkdir(pkg);
		const entrypoint = join(pkg, "runtime.mjs");
		const nativeEntrypoint = join(pkg, "extension.mjs");
		await writeFile(nativeEntrypoint, 'throw new Error("legacy native entry must not import");');
		await writeFile(
			entrypoint,
			`export default async ({capabilities})=>{
 let tools=0,sessions=0;
 const read=async()=>({pid:process.pid,tools,sessions,scope:await capabilities.call("scope",null)});
 return {operations:{overview:{inputSchema:{type:"null"},resultSchema:{type:"object"},effect:"read",execute:read}},
 createNativeSession(){sessions++;let closed=false;return {toolEffects:{owner_read:"read"},extension(pi){
 pi.registerTool({name:"owner_read",label:"Owner read",description:"Read shared owner",drone:{readOnly:true,capabilities:["files"]},parameters:{type:"object",properties:{}},async execute(){tools++;return {content:[{type:"text",text:JSON.stringify(await read())}]};}});
 pi.on("session_start",async()=>{await capabilities.call("scope",null);});
 },async dispose(){if(!closed){closed=true;sessions--;}}};},async dispose(){if(sessions)throw new Error("native sessions still attached");}};
};`,
		);
		const source = { pluginId: "fixture", packageRoot: pkg, entrypoint, nativeEntrypoint };
		const registry = new SessionRegistry();
		let originalDestroyed = false;
		let window = { id: 1, isDestroyed: () => originalDestroyed };
		const bridge = new PluginRuntimeBridge({
			source: () => source,
			enabled: () => true,
			approve: async () => true,
			factory: () => createProcessPluginRuntime({ ...source, runtimeDirectory }),
			getSessionContext: (id) => getPluginSessionCaller(registry, id),
			capabilities: () => () => ({
				resources: [],
				handlers: {
					scope: {
						inputSchema: { type: "null" },
						resultSchema: { type: "object" },
						effect: "read",
						execute: async (_input, context) => context.scope,
					},
				},
			}),
		});
		const sessions = [];
		const providers = [];
		const bootstraps = [];
		let pid;
		try {
			let binding = await bridge.bind("fixture-ui", window);
			let application = bridge.selectSession(window, null);
			for (let i = 0; i < 2; i++) {
				const cwd = join(root, `project-${i}`);
				await mkdir(cwd);
				const bootstrap = bridge.beginNative(window, (path) =>
					path === nativeEntrypoint ? "fixture-ui" : undefined,
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
					extensionFactories: [
						(pi) => {
							const runtime = createStandaloneRuntime();
							pi.events.on("drone:runtime/request/v1", () =>
								pi.events.emit("drone:runtime/v1", { version: 1, runtime }),
							);
							registerTaskRuntime(pi);
							pi.on("session_shutdown", () => runtime.dispose());
						},
					],
				});
				await resourceLoader.reload({ resolveProjectTrust: async () => true });
				expect(resourceLoader.getExtensions().errors).toEqual([]);
				const modelRuntime = await ModelRuntime.create({
					authPath: join(cwd, "auth.json"),
					modelsPath: null,
					allowModelNetwork: false,
					refreshOnCreate: false,
				});
				const faux = fauxProvider({ provider: `shared-native-offline-${i}`, tokensPerSecond: 0 });
				modelRuntime.registerNativeProvider(faux.provider);
				providers.push(faux);
				vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
				faux.setResponses([
					fauxAssistantMessage(fauxToolCall("owner_read", {})),
					fauxAssistantMessage("verified"),
				]);
				const { session } = await createAgentSession({
					cwd,
					agentDir: cwd,
					settingsManager,
					resourceLoader,
					modelRuntime,
					sessionManager: SessionManager.inMemory(cwd),
					model: faux.getModel(),
				});
				const capabilities = new CapabilityRuntime(new SkillVisibility());
				capabilities.bind(session);
				capabilities.activate(["files"]);
				expect(session.getActiveToolNames()).toContain("owner_read");
				sessions.push(session);
				registry.add({ session, cwd, unsubscribe: () => {} });
				bootstrap.bindSession(session.sessionId);
				await session.bindExtensions({});
				await session.prompt("Read the shared owner.");
				await session.waitForIdle();
				const result = session.messages.find(
					(message) => message.role === "toolResult" && message.toolName === "owner_read",
				);
				expect(result?.isError, JSON.stringify(result)).toBe(false);
				const receipt = JSON.parse(result.content[0].text);
				pid ??= receipt.pid;
				expect(receipt).toMatchObject({
					pid,
					tools: i + 1,
					sessions: i + 1,
					scope: { kind: "session", sessionId: session.sessionId },
				});
			}
			if (shutdownOrder === "approval-window-closed") {
				const prior = window;
				originalDestroyed = true;
				await bridge.revoke(undefined, prior.id);
				window = { id: 2, isDestroyed: () => false };
				binding = await bridge.bind("fixture-ui", window);
				application = bridge.selectSession(window, null);
				providers[1].setResponses([
					fauxAssistantMessage(fauxToolCall("owner_read", {})),
					fauxAssistantMessage("still available"),
				]);
				await sessions[1].prompt("Read after the original window closed.");
				await sessions[1].waitForIdle();
				const latest = sessions[1].messages
					.filter((message) => message.role === "toolResult" && message.toolName === "owner_read")
					.at(-1);
				expect(latest.isError, JSON.stringify(latest)).toBe(false);
				expect(JSON.parse(latest.content[0].text)).toMatchObject({ pid, tools: 3 });
			}

			expect(await bridge.invoke(window, binding, "overview", null, application)).toMatchObject({
				pid,
				tools: shutdownOrder === "approval-window-closed" ? 3 : 2,
				sessions: 2,
				scope: { kind: "application" },
			});
			const first = sessions.shift();
			registry.revoke(first.sessionId);
			await new SessionEngine().dispose(first);
			registry.delete(first.sessionId);
			expect(await bridge.invoke(window, binding, "overview", null, application)).toMatchObject({
				pid,
				sessions: 1,
			});
			await bridge.revoke(undefined, window.id);
			const second = sessions.shift();
			registry.revoke(second.sessionId);
			if (shutdownOrder === "host-first") await bridge.close();
			await new SessionEngine().dispose(second);
			registry.delete(second.sessionId);
			await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
		} finally {
			for (const session of sessions) await new SessionEngine().dispose(session);
			for (const bootstrap of bootstraps) await bootstrap.dispose();
			await bridge.close();
			vi.restoreAllMocks();
			await rm(root, { recursive: true, force: true });
		}
	},
	20000,
);
