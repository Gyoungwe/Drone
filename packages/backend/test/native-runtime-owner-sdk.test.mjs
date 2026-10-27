import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
import { createDroneRuntime as createStandaloneRuntime } from "../src/runtime";
import { SessionRegistry } from "../src/session/registry";
import { SessionEngine } from "../src/session-engine/engine";
import { registerTaskRuntime } from "./fixtures/task-plugin.mjs";

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
 let tools=0,sessions=0;const signals=[];
 const read=async()=>({pid:process.pid,tools,sessions,signals,scope:await capabilities.call("scope",null)});
 return {operations:{overview:{inputSchema:{type:"null"},resultSchema:{type:"object"},effect:"read",execute:read}},
 createNativeSession(){sessions++;let closed=false,contexts=0;const scopes=[];return {toolEffects:{owner_read:"read"},eventEffects:{context:"read",tool_result:"read",message_end:"read"},extension(pi){
 pi.registerTool({name:"owner_read",label:"Owner read",description:"Read shared owner",drone:{readOnly:true,capabilities:["files"]},parameters:{type:"object",properties:{}},async execute(){tools++;return {content:[{type:"text",text:JSON.stringify({...await read(),contexts,scopes})}]};}});
 pi.on("session_start",async()=>{await capabilities.call("scope",null);});
 const remove=pi.on("context",()=>{throw new Error("Unsubscribed context callback ran");});remove();
 pi.on("context",async(event,ctx)=>{ctx.signal.throwIfAborted();
 const last=event.messages.filter(message=>message.role==='user').at(-1);
 const text=JSON.stringify(last?.content);
 if(text.includes('hold managed hook')){
  const sessionId=ctx.sessionManager.getSessionId();await capabilities.call('entered',null);
  await new Promise(resolve=>ctx.signal.addEventListener('abort',resolve,{once:true}));
  let lateDenied=false;try{await capabilities.call('scope',null);}catch{lateDenied=true;}
  signals.push({sessionId,aborted:ctx.signal.aborted,lateDenied});
  return;
 }
 contexts++;scopes.push((await capabilities.call("scope",null)).sessionId);event.messages.push({role:"user",content:[{type:"text",text:"first managed context"}],timestamp:1});});
 pi.on("context",event=>{if(event.messages.at(-1)?.content[0]?.text!=="first managed context")throw new Error("SDK context chaining lost");return {messages:event.messages.slice(0,-1)};});
 pi.on("tool_result",event=>event.toolName==="owner_read"?{details:{stage:1}}:undefined);
 pi.on("tool_result",event=>{if(event.toolName!=="owner_read")return;if(event.details?.stage!==1)throw new Error("SDK result chaining lost");return {details:{stage:2}};});
 pi.on("message_end",event=>{if(event.message.role==="assistant"&&event.message.stopReason==="stop"&&!event.message.content.some(block=>block.type==="toolCall"))event.message.content=[{type:"text",text:"first managed answer"}];});
 pi.on("message_end",event=>{if(event.message.role!=="assistant"||event.message.stopReason!=="stop"||event.message.content.some(block=>block.type==="toolCall"))return;if(event.message.content[0]?.text!=="first managed answer")throw new Error("SDK message chaining lost");return {message:{...event.message,content:[{type:"text",text:"second managed answer"}]}};});
 },async dispose(){if(!closed){closed=true;sessions--;}}};},async dispose(){if(sessions)throw new Error("native sessions still attached");}};
};`,
		);
		const source = { pluginId: "fixture", packageRoot: pkg, entrypoint, nativeEntrypoint };
		const registry = new SessionRegistry();
		const enteredHooks = [];
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
					entered: {
						inputSchema: { type: "null" },
						resultSchema: { type: "null" },
						effect: "read",
						execute: async (_input, context) => {
							enteredHooks.push(context.scope.sessionId);
							return null;
						},
					},
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
						async (pi) => {
							const runtime = createStandaloneRuntime();
							pi.events.on("drone:runtime/request/v1", () =>
								pi.events.emit("drone:runtime/v1", { version: 1, runtime }),
							);
							await registerTaskRuntime(pi);
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
				expect(result.details).toEqual({ stage: 2 });
				const receipt = JSON.parse(result.content[0].text);
				pid ??= receipt.pid;
				expect(receipt).toMatchObject({
					pid,
					tools: i + 1,
					sessions: i + 1,
					scope: { kind: "session", sessionId: session.sessionId },
					contexts: 1,
					scopes: [session.sessionId],
				});
				expect(session.messages.filter((message) => message.role === "assistant").at(-1).content).toEqual([
					{ type: "text", text: "second managed answer" },
				]);
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

			let closingPrompt;
			if (shutdownOrder === "native-first") {
				providers[0].setResponses([fauxAssistantMessage("must be canceled before inference")]);
				const canceledPrompt = Promise.allSettled([sessions[0].prompt("hold managed hook cancel")]);
				await vi.waitFor(() => expect(enteredHooks).toEqual([sessions[0].sessionId]));
				await sessions[0].abort();
				await canceledPrompt;
				expect(await bridge.invoke(window, binding, "overview", null, application)).toMatchObject({
					signals: [{ sessionId: sessions[0].sessionId, aborted: true, lateDenied: true }],
				});
				providers[1].setResponses([
					fauxAssistantMessage(fauxToolCall("owner_read", {})),
					fauxAssistantMessage("second session remains live"),
				]);
				await sessions[1].prompt("Read after the other session was canceled.");
				await sessions[1].waitForIdle();
				const sibling = sessions[1].messages
					.filter((message) => message.role === "toolResult" && message.toolName === "owner_read")
					.at(-1);
				expect(sibling.isError, JSON.stringify(sibling)).toBe(false);
				closingPrompt = Promise.allSettled([sessions[0].prompt("hold managed hook close")]);
				await vi.waitFor(() => expect(enteredHooks).toEqual([sessions[0].sessionId, sessions[0].sessionId]));
			}

			expect(await bridge.invoke(window, binding, "overview", null, application)).toMatchObject({
				pid,
				tools: shutdownOrder === "host-first" ? 2 : 3,
				sessions: 2,
				scope: { kind: "application" },
			});
			const first = sessions.shift();
			registry.revoke(first.sessionId);
			await new SessionEngine().dispose(first);
			if (closingPrompt) {
				await closingPrompt;
				expect(await bridge.invoke(window, binding, "overview", null, application)).toMatchObject({
					signals: [
						{ sessionId: first.sessionId, aborted: true, lateDenied: true },
						{ sessionId: first.sessionId, aborted: true, lateDenied: true },
					],
				});
			}
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

it("chains managed before-start option mutations without replacing the SDK options object", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-native-prompt-options-")));
	const entrypoint = join(root, "runtime.mjs");
	await writeFile(
		entrypoint,
		`export default async () => ({operations:{},async dispose(){},createNativeSession(){return {async dispose(){},extension(pi){
 const remove=pi.on("before_agent_start",()=>{throw new Error("Unsubscribed before-start handler ran");});remove();
 pi.on("before_agent_start",event=>{
  const options=event.systemPromptOptions;
  delete options.forceSystemPrompt;delete options.fixtureRemove;
  options.sections.managed="managed mutation is rendered";
  options.promptGuidelines.push("managed guideline");
  Object.defineProperty(options,"__proto__",{value:{polluted:"own JSON data"},enumerable:true,writable:true,configurable:true});
  event.systemPromptOptions={...options,forceSystemPrompt:"replacement must be ignored"};
 });
 pi.on("before_agent_start",event=>{
  if(event.systemPromptOptions.fixtureRemove!==undefined||event.systemPromptOptions.forceSystemPrompt!==undefined)throw new Error("Option deletion or original reference was lost");
  if(!event.systemPrompt.includes("managed mutation is rendered")||!event.systemPrompt.includes("managed guideline"))throw new Error("Later handler missed rendered mutation");
  return {systemPrompt:"returned managed system prompt",message:{customType:"managed-prompt-proof",content:"managed before-start message",display:false,details:{workerPid:process.pid}}};
 });
}};}});`,
	);
	const lifecycle = new AbortController();
	let runtime;
	let native;
	let session;
	const observed = [];
	const modelContexts = [];
	const errors = [];
	let originalOptions;
	try {
		runtime = await createProcessPluginRuntime({
			pluginId: "prompt-options",
			packageRoot: root,
			entrypoint,
			runtimeDirectory,
		})({
			applicationId: "prompt-options-test",
			signal: lifecycle.signal,
			resources: [],
			capabilities: {
				call: async () => {
					throw new Error("No capabilities requested by this fixture");
				},
			},
			events: { changed() {} },
		});
		native = await runtime.createNativeSession();
		const settingsManager = SettingsManager.inMemory({});
		const resourceLoader = new DefaultResourceLoader({
			cwd: root,
			agentDir: root,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			extensionFactories: [
				(pi) =>
					pi.on("before_agent_start", (event) => {
						originalOptions = event.systemPromptOptions;
						event.systemPromptOptions.forceSystemPrompt = "initial override must be deleted";
						event.systemPromptOptions.fixtureRemove = "delete this own field";
					}),
				native.extension,
				(pi) =>
					pi.on("before_agent_start", (event) => {
						observed.push({
							identity: event.systemPromptOptions === originalOptions,
							removed: Object.hasOwn(event.systemPromptOptions, "fixtureRemove"),
							prototype: Object.getPrototypeOf(event.systemPromptOptions),
							ownProto: Object.getOwnPropertyDescriptor(event.systemPromptOptions, "__proto__")?.value,
							systemPrompt: event.systemPrompt,
							sections: event.systemPromptOptions.sections,
						});
					}),
			],
		});
		await resourceLoader.reload({ resolveProjectTrust: async () => true });
		expect(resourceLoader.getExtensions().errors).toEqual([]);
		const modelRuntime = await ModelRuntime.create({
			authPath: join(root, "auth.json"),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		const faux = fauxProvider({ provider: "native-prompt-options-offline", tokensPerSecond: 0 });
		modelRuntime.registerNativeProvider(faux.provider);
		vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
		faux.setResponses([
			(context) => {
				modelContexts.push(context);
				return fauxAssistantMessage("completed");
			},
		]);
		const sessionManager = SessionManager.inMemory(root);
		({ session } = await createAgentSession({
			cwd: root,
			agentDir: root,
			settingsManager,
			resourceLoader,
			modelRuntime,
			model: faux.getModel(),
			sessionManager,
		}));
		await session.bindExtensions({ onError: (error) => errors.push(error) });
		await session.prompt("Check managed prompt mutations.");
		await session.waitForIdle();
		expect(errors).toEqual([]);
		expect(observed).toEqual([
			{
				identity: true,
				removed: false,
				prototype: Object.prototype,
				ownProto: { polluted: "own JSON data" },
				systemPrompt: "returned managed system prompt",
				sections: { managed: "managed mutation is rendered" },
			},
		]);
		expect(Object.prototype).not.toHaveProperty("polluted");
		expect(modelContexts[0].messages.find((message) => message.role === "system")).toMatchObject({
			content: "returned managed system prompt",
		});
		// Pi persists the mutable structured sections; its exact returned override is request-only.
		const persistedSystem = sessionManager
			.getEntries()
			.filter((entry) => entry.type === "message" && entry.message.role === "system")
			.at(-1)?.message;
		expect(persistedSystem.sections.managed).toContain("managed mutation is rendered");
		expect(persistedSystem.sections.rules).toContain("managed guideline");
		const custom = session.messages.find(
			(message) => message.role === "custom" && message.customType === "managed-prompt-proof",
		);
		expect(custom).toMatchObject({ content: "managed before-start message", display: false });
		expect(custom.details.workerPid).not.toBe(process.pid);
		expect(
			sessionManager
				.getEntries()
				.some((entry) => entry.type === "custom_message" && entry.customType === "managed-prompt-proof"),
		).toBe(true);
	} finally {
		if (session) await new SessionEngine().dispose(session);
		if (native) await native.dispose();
		if (runtime) await runtime.dispose();
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	}
}, 20000);
