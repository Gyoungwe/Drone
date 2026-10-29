import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { fileCapabilityHandlers, PluginFileCapabilities } from "../src/plugins/file-capabilities";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

let root, backend, bridge;
afterEach(async () => {
	if (bridge) await bridge.close();
	if (backend) await backend.dispose();
	bridge = undefined;
	backend = undefined;
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (root) await rm(root, { recursive: true, force: true });
});
const providerSource = `
export default async context=>{
 const ownerId=Math.random().toString(36), check=()=>{context.signal.throwIfAborted();};
 let value=0, closeFailure=false;
 const status=async(_input,ctx)=>({ownerId,value,scope:await ctx.capabilities.call('caller.scope',null)});
 return {
  operations:{
   inspectBinary:{effect:'read',inputSchema:{type:'object'},resultSchema:{type:'object'},execute:async(input,ctx)=>{const snapshot=await ctx.capabilities.call('files.readBinary',{root:input.root,path:input.path});const roots=await ctx.capabilities.call('roots.describe',null);const selected=roots.find(root=>root.handle===input.root);const {inspectTaskBytes}=await import('./dist/managed-runtime.mjs');return inspectTaskBytes(Buffer.from(snapshot.base64,'base64'),{path:input.path,absolutePath:selected.path+'/'+input.path,rootKind:'workspace'},input.expected);}},
   readBinary:{effect:'read',inputSchema:{type:'object'},resultSchema:{type:'object'},execute:async(input,ctx)=>ctx.capabilities.call('files.readBinary',input)},
   adoptionInspect:{effect:'write',inputSchema:{type:'object'},resultSchema:{type:'object'},execute:async(input,ctx)=>ctx.capabilities.call('session.records.adoption.inspect',input)},
   adoptionCommit:{effect:'write',inputSchema:{type:'object'},resultSchema:{type:'object'},execute:async(input,ctx)=>ctx.capabilities.call('session.records.adoption.commit',input)},
   ownedRecords:{effect:'read',inputSchema:{type:'null'},resultSchema:{type:'object'},execute:async(input,ctx)=>ctx.capabilities.call('session.records.read',input)},
   failClose:{effect:'write',inputSchema:{type:'null'},resultSchema:{type:'null'},execute:async()=>{closeFailure=true;return null;}},
   status:{effect:'read',inputSchema:{type:'null'},resultSchema:{type:'object'},execute:status},
   update:{effect:'write',inputSchema:{type:'object',properties:{value:{type:'number'}},required:['value'],additionalProperties:false},resultSchema:{type:'object'},execute:async(input,ctx)=>{
    const saved=await ctx.capabilities.call('session.records.append',{type:'service-state',data:input});
    if(saved.durability!=='durable') throw new Error('Service update is deferred, not saved');
    value=input.value; return {ownerId,value,saved};
   }},
   hold:{effect:'read',inputSchema:{type:'null'},resultSchema:{type:'null'},execute:async(_input,ctx)=>{
    await ctx.capabilities.call('entered',null);
    await new Promise((_resolve,reject)=>ctx.signal.addEventListener('abort',()=>reject(ctx.signal.reason),{once:true}));return null;
   }},
   cycle:{effect:'read',inputSchema:{type:'null'},resultSchema:{type:'null'},execute:async(_input,ctx)=>ctx.capabilities.call('provider.read',{alias:'back',operation:'cycle',input:null})}
  },
  createNativeSession:async()=>({extension:pi=>pi.registerTool({name:'service_count',label:'Service count',description:'Read actual shared service owner',parameters:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>({content:[{type:'text',text:JSON.stringify({ownerId,value,records:await context.capabilities.call('session.records.read',null)})}]})}),dispose:async()=>{}}),
  dispose:async()=>{if(closeFailure)throw new Error('Actual provider cleanup failed');}
 };
};`;
const consumerSource = `export default async()=>({operations:{
 directAdoption:{effect:'write',inputSchema:{type:'object'},resultSchema:{type:'object'},execute:async(input,ctx)=>ctx.capabilities.call('session.records.adoption.inspect',input)},
 inspect:{effect:'read',inputSchema:{type:'object'},resultSchema:{type:'object'},execute:async(input,ctx)=>ctx.capabilities.call('provider.inspect',input)},
 read:{effect:'read',inputSchema:{type:'object'},resultSchema:{},execute:async(input,ctx)=>ctx.capabilities.call('provider.read',{alias:'store',...input})},
 write:{effect:'write',inputSchema:{type:'object'},resultSchema:{},execute:async(input,ctx)=>ctx.capabilities.call('provider.write',{alias:'store',...input})},
 cycle:{effect:'read',inputSchema:{type:'null'},resultSchema:{type:'null'},execute:async(_input,ctx)=>ctx.capabilities.call('provider.read',{alias:'store',operation:'cycle',input:null})}
},dispose:async()=>{}});`;
const roleProviderSource = `export default async()=>({operations:{
 ordinary:{effect:'read',inputSchema:{type:'null'},resultSchema:{},execute:async(_input,ctx)=>ctx.capabilities.call('provider.native',{alias:'self',operation:'observe',input:null})}
},dispose:async()=>{},createNativeSession:async()=>{
 let seen=0;
 const operation=(event,effect='read')=>({event,effect,inputSchema:{},resultSchema:{type:'object'},execute:async(input,actual,ctx)=>{
  if(input?.hold)await ctx.capabilities.call('entered',null);
  ctx.signal.throwIfAborted();
  if(effect==='write')await ctx.capabilities.call('session.records.append',{type:'role-result',data:{message:actual.message?.content,toolCallId:actual.toolCallId}});
  return {seen:++seen,kind:actual.type,message:actual.message?.content??null,toolCallId:actual.toolCallId??null,scope:ctx.scope};
 }});
 return {nativeOperations:{fail:{...operation('message_start'),execute:async()=>{throw new Error('Actual native receiver failed');}},observe:operation('message_start'),write:operation('message_start','write'),tool:operation('tool_execution_end')},
  toolEffects:{service_count:'read'},dispose:async()=>{},extension:pi=>pi.registerTool({name:'service_count',label:'count',description:'Actual native event fixture',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'Actual native tool result'}]})})};
}});`;
const roleConsumerSource = (effect) => `export default async context=>({operations:{
 spoof:{effect:'write',inputSchema:{},resultSchema:{},execute:async(input,ctx)=>ctx.capabilities.call('provider.native',{alias:'store',operation:'observe',input})},
 ordinary:{effect:'read',inputSchema:{type:'null'},resultSchema:{},execute:async(_input,ctx)=>ctx.capabilities.call('provider.read',{alias:'store',operation:'ordinary',input:null})}
},dispose:async()=>{},createNativeSession:async()=>({dispose:async()=>{},eventEffects:{message_start:'${effect}',tool_execution_end:'read',input:'read'},extension:pi=>{
 const invoke=async(operation,input,ctx)=>{
  let result;
  try{result={ok:true,value:await context.capabilities.call('provider.native',{alias:'store',operation,input})};}
  catch(error){if(operation==='fail')throw error;result={ok:false,error:error.message};}
  await context.capabilities.call('observed',result);
 };
 pi.on('message_start',async(event,ctx)=>{
  if(event.message?.role!=='user')return;
  const text=event.message.content.find(part=>part.type==='text')?.text;
  if(text?.startsWith('native:'))await invoke(text.slice(7),{copiedEvent:{type:'message_start',message:{role:'assistant',content:'FORGED'}},nonce:'FORGED'},ctx);
 });
 pi.on('tool_execution_end',async(event,ctx)=>{if(event.toolName==='service_count')await invoke('tool',null,ctx);});
 pi.on('input',async(event,ctx)=>{if(event.text==='ordinary-input')await invoke('observe',null,ctx);});
}})});`;
const taskProviderSource = `import {createManagedTaskApplication} from './dist/managed-runtime.mjs';
export default async context=>{
 const app=createManagedTaskApplication(context);
 return {...app,operations:{...app.operations,
  fixturePlan:{effect:'write',inputSchema:{type:'object'},resultSchema:{type:'object'},execute:async(input,ctx)=>{await app.withCurrentSession(ctx.signal,session=>session.controller.journal.plan(input));return app.operations.status.execute(null,ctx);}},
  fixtureReport:{effect:'write',inputSchema:{type:'null'},resultSchema:{type:'object'},execute:async(_input,ctx)=>{await app.withCurrentSession(ctx.signal,session=>session.controller.journal.requestReport());return app.operations.status.execute(null,ctx);}}
 }};
};`;
async function setup({
	native = true,
	roles = false,
	roleEffect = "read",
	providerNative = true,
	taskData = false,
	binaryFiles = false,
} = {}) {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-provider-packed-")));
	const archives = [];
	for (const [name, source, drone] of [
		[
			"provider",
			taskData ? taskProviderSource : roles ? roleProviderSource : providerSource,
			{
				provides: {
					"checkpoint.service": {
						version: 1,
						operations: [
							"status",
							"update",
							"hold",
							"cycle",
							"failClose",
							"adoptionInspect",
							"adoptionCommit",
							"ownedRecords",
							...(binaryFiles ? ["readBinary", "inspectBinary"] : []),
							...(roles ? ["observe", "write", "tool", "ordinary", "fail"] : []),
						],
					},
				},
				requires: {
					back: { service: "cycle.service", version: 1 },
					...(roles ? { self: { service: "checkpoint.service", version: 1 } } : {}),
				},
				recordAdoptions: {
					recovery: {
						legacyType: "legacy-session-checkpoint",
						fromVersions: ["0.9.0"],
						removeBeforeVersion: "2.0.0",
					},
				},
			},
		],
		[
			"consumer",
			roles ? roleConsumerSource(roleEffect) : consumerSource,
			{
				provides: { "cycle.service": { version: 1, operations: ["cycle"] } },
				requires: {
					store: { service: "checkpoint.service", version: 1 },
					unknown: { service: "absent.service", version: 1 },
				},
			},
		],
	]) {
		const dir = join(root, `source-${name}`);
		await mkdir(dir);
		const entrypoints = {
			desktopRuntime: "./runtime.mjs",
			...(name === "provider" || roles ? { extension: "./native.mjs" } : {}),
		};
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({
				name: `@fixture/${name}`,
				version: "1.0.0",
				type: "module",
				files: [
					"runtime.mjs",
					"native.mjs",
					"plugin.manifest.json",
					...(taskData || binaryFiles ? ["dist"] : []),
				],
				...(name === "provider" || roles ? { pi: { extensions: ["./native.mjs"] } } : {}),
			}),
		);
		await writeFile(join(dir, "runtime.mjs"), source);
		if ((taskData || binaryFiles) && name === "provider")
			await cp(dirname(createRequire(import.meta.url).resolve("@gyoungwe/pi-core")), join(dir, "dist"), {
				recursive: true,
			});
		await writeFile(
			join(dir, "native.mjs"),
			`export default pi=>{throw new Error('Desktop must select the managed runtime owner, never execute the root extension file.');};`,
		);
		await writeFile(
			join(dir, "plugin.manifest.json"),
			JSON.stringify({
				schemaVersion: 1,
				id: `drone-fixture-${name}`,
				version: "1.0.0",
				pi: { apiVersion: 1, minHostVersion: "1.1.0", testedHosts: ["1.1.0"] },
				capabilities: ["core"],
				hosts: ["drone-desktop", "native-pi"],
				entrypoints,
				drone: {
					pluginApi: 1,
					resultContract: "drone-result/v3",
					...drone,
					...(taskData
						? name === "provider"
							? {
									provides: {
										"task.runtime": {
											version: 1,
											operations: [
												"status",
												"pause",
												"advanceStage",
												"takeReport",
												"fixturePlan",
												"fixtureReport",
											],
										},
									},
								}
							: { requires: { store: { service: "task.runtime", version: 1 } } }
						: {}),
				},
				permissions: {
					filesystem: binaryFiles && name === "provider" ? ["workspace-read"] : [],
					network: [],
					subprocess: [],
				},
				tools: name === "provider" && !taskData ? ["service_count"] : [],
			}),
		);
		const [pack] = JSON.parse(
			execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], {
				cwd: dir,
				encoding: "utf8",
			}),
		);
		archives.push(join(root, pack.filename));
	}
	const prefix = join(root, "installed");
	await mkdir(prefix);
	await writeFile(join(prefix, "package.json"), JSON.stringify({ private: true, type: "module" }));
	execFileSync(
		"npm",
		[
			"install",
			"--prefix",
			prefix,
			"--ignore-scripts",
			"--offline",
			"--no-audit",
			"--no-fund",
			"--package-lock=false",
			...archives,
		],
		{ encoding: "utf8" },
	);
	let catalog = (await discoverInstalledPackages(join(prefix, "node_modules"))).map((item) => {
		if ("error" in item || !item.runtime) throw new Error(JSON.stringify(item));
		return { name: `package:${item.packageRoot}`, source: item.runtime, state: "enabled" };
	});
	const provider = catalog.find((item) => item.source.pluginId === "@fixture/provider"),
		consumer = catalog.find((item) => item.source.pluginId === "@fixture/consumer");
	const cwd = join(root, "project"),
		agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	const fileCache = join(root, "file-cache");
	await mkdir(fileCache);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "en");
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "provider-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	let service,
		approve = async () => true,
		beforeBinaryRead = async () => {};
	const approvals = [],
		observations = [],
		entered = [];
	const owner = { id: 71, isDestroyed: () => false };
	bridge = new PluginRuntimeBridge({
		source: (name) => catalog.find((item) => item.name === name && item.state === "enabled")?.source,
		sources: () => catalog,
		enabled: (name) => catalog.some((item) => item.name === name && item.state === "enabled"),
		approve: async (...args) => {
			approvals.push(args);
			return approve(...args);
		},
		factory: (source) =>
			createProcessPluginRuntime({
				...source,
				runtimeDirectory: resolve(
					import.meta.dirname,
					`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
				),
			}),
		getSessionContext: (id) => service?.getPluginCallerContext(id),
		capabilities: (source) => async () => {
			const files = source.requestsFileRead
				? await PluginFileCapabilities.create(
						[{ handle: "sdk-files", path: cwd, kind: "files", scope: { kind: "application" } }],
						fileCache,
					)
				: undefined;
			return {
				resources: files ? [{ handle: "sdk-files", kind: "files" }] : [],
				...(files ? { dispose: () => files.drain(), finalRelease: () => files.releaseReservations() } : {}),
				handlers: {
					...service.getPluginSessionCapabilities(source.recordAdoptions),
					...(files
						? (() => {
								const handlers = fileCapabilityHandlers(files);
								return {
									...handlers,
									"files.readBinary": {
										...handlers["files.readBinary"],
										execute: async (input, ctx) => {
											await beforeBinaryRead();
											return handlers["files.readBinary"].execute(input, ctx);
										},
									},
								};
							})()
						: {}),
					observed: {
						effect: "read",
						inputSchema: { type: "object" },
						resultSchema: { type: "null" },
						execute: async (input, ctx) => {
							observations.push({ input, scope: ctx.scope });
							return null;
						},
					},
					entered: {
						effect: "read",
						inputSchema: { type: "null" },
						resultSchema: { type: "null" },
						execute: async (_input, context) => {
							entered.push(context.scope);
							return null;
						},
					},
				},
			};
		},
	});
	backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: native
				? [
						...(providerNative ? [provider.source.nativeEntrypoint] : []),
						...(roles ? [consumer.source.nativeEntrypoint] : []),
					]
				: [],
			pluginRuntimeDirectory: resolve(
				import.meta.dirname,
				`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
			),
			nativeRuntime: {
				begin: () =>
					bridge.beginNative(
						owner,
						(path) => catalog.find((item) => item.source.nativeEntrypoint === path)?.name,
					),
				manages: (path) => catalog.some((item) => item.source.nativeEntrypoint === path),
			},
		},
	});
	service = backend.sessions;
	service.modelRuntime = modelRuntime;
	const meta = await service.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	const entry = service.registry.get(meta.sessionId);
	const binding = await bridge.bind(consumer.name, owner),
		selection = bridge.selectSession(owner, meta.sessionId);
	const invoke = (operation, input, requestId) =>
		bridge.invoke(owner, binding, operation, input, selection, requestId);
	const converse = async () => {
		faux.setResponses([fauxAssistantMessage("Offline service session ready.")]);
		await entry.session.prompt("Initialize this real conversation.");
		await entry.session.waitForIdle();
	};
	return {
		service,
		entry,
		meta,
		faux,
		provider,
		consumer,
		owner,
		binding,
		selection,
		invoke,
		converse,
		approvals,
		entered,
		observations,
		beforeBinaryRead: (fn) => {
			beforeBinaryRead = fn;
		},
		approve: (fn) => {
			approve = fn;
		},
		catalog: () => catalog,
		setState: (state) => {
			provider.state = state;
		},
		rescan: async () => {
			catalog = (await discoverInstalledPackages(join(prefix, "node_modules"))).map((item) => {
				if ("error" in item || !item.runtime) throw new Error("Source scan failed");
				return { name: `package:${item.packageRoot}`, source: item.runtime, state: "enabled" };
			});
		},
	};
}
it("real installed tarballs share one restricted provider owner between capability routing and the actual SDK; read cannot call write", async () => {
	const { entry, meta, invoke, converse, faux, approvals } = await setup();
	await converse();
	expect(await invoke("inspect", { alias: "store" })).toMatchObject({
		state: "available",
		service: "checkpoint.service",
		requestedVersion: 1,
		provider: { pluginId: "@fixture/provider", contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
	});
	const before = await invoke("read", { operation: "status", input: null });
	await expect(invoke("read", { operation: "update", input: { value: 9 } })).rejects.toThrow(
		/Read-only provider call/,
	);
	expect((await invoke("read", { operation: "status", input: null })).value).toBe(0);
	await expect(invoke("write", { operation: "update", input: { value: 7 } })).resolves.toMatchObject({
		ownerId: before.ownerId,
		value: 7,
		saved: { durability: "durable" },
	});
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("service_count", {}), { stopReason: "toolUse" }),
		fauxAssistantMessage("Service read verified."),
	]);
	await entry.session.prompt("Read the shared service owner.");
	await entry.session.waitForIdle();
	const result = entry.session.messages.findLast(
		(message) => message.role === "toolResult" && message.toolName === "service_count",
	);
	expect(result.isError).toBeFalsy();
	expect(JSON.parse(result.content[0].text)).toMatchObject({
		ownerId: before.ownerId,
		value: 7,
		records: { state: "durable", records: [{ type: "service-state", data: { value: 7 } }] },
	});
	expect(before.scope.sessionId).toBe(meta.sessionId);
	expect(
		approvals
			.filter((args) => args[2] === "capability:session.records.append")
			.every((args) => args[0].id === 71),
	).toBe(true);
}, 20000);
it("same installed catalog reports absent/disabled/unavailable/incompatible/ambiguous without activating an arbitrary provider", async () => {
	const { provider, invoke, setState, catalog, rescan } = await setup();
	expect(await invoke("inspect", { alias: "unknown" })).toMatchObject({ state: "absent", provider: null });
	await expect(invoke("inspect", { alias: "undeclared" })).rejects.toThrow(/Undeclared provider alias/);
	setState("disabled");
	expect(await invoke("inspect", { alias: "store" })).toMatchObject({ state: "disabled" });
	setState("unavailable");
	expect(await invoke("inspect", { alias: "store" })).toMatchObject({ state: "unavailable" });
	setState("enabled");
	const copy = {
		...provider,
		name: "second-installation",
		source: { ...provider.source, packageRoot: join(root, "other-root") },
	};
	catalog().push(copy);
	expect(await invoke("inspect", { alias: "store" })).toMatchObject({ state: "ambiguous" });
	catalog().pop();
	const manifestPath = join(provider.source.packageRoot, "plugin.manifest.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	manifest.drone.provides["checkpoint.service"].version = 2;
	await writeFile(manifestPath, JSON.stringify(manifest));
	await rescan();
	expect(await invoke("inspect", { alias: "store" })).toMatchObject({ state: "incompatible" });
}, 20000);
it("actual nested restricted workers reject a source/operation cycle instead of preserving a function bus or recursing", async () => {
	const { invoke } = await setup();
	await expect(invoke("cycle", null)).rejects.toThrow(/Recursive provider source\/operation call rejected/);
}, 20000);
it("real caller cancellation drains the borrowed provider call, rejects late approval, and actual source stop aborts a running worker", async () => {
	const { invoke, entry, converse, approve, owner, binding, selection, provider, entered, setState } =
		await setup();
	await converse();
	let release;
	approve(async (_owner, source, operation) =>
		source.pluginId === "@fixture/provider" && operation === "update"
			? new Promise((resolve) => {
					release = resolve;
				})
			: true,
	);
	const pending = invoke("write", { operation: "update", input: { value: 4 } }, "provider-cancel").catch(
		(error) => error,
	);
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	const cancelling = bridge.cancel(owner, binding, selection, "provider-cancel");
	release(true);
	await expect(cancelling).resolves.toBe(true);
	expect(await pending).toBeInstanceOf(Error);
	expect(
		entry.session.sessionManager
			.getBranch()
			.some((row) => row.customType === "plugin-record:%40fixture%2Fprovider:service-state"),
	).toBe(false);
	approve(async () => true);
	const held = invoke("read", { operation: "hold", input: null }, "provider-stop").catch((error) => error);
	await vi.waitFor(() => expect(entered).toHaveLength(1));
	setState("disabled");
	await bridge.revoke(provider.name);
	expect(await held).toBeInstanceOf(Error);
	expect(await invoke("inspect", { alias: "store" })).toMatchObject({ state: "disabled" });
}, 20000);
it("actual installed bytes changed during target approval revoke both source bindings before any SDK checkpoint can be written", async () => {
	const { invoke, entry, provider, approve, rescan, converse } = await setup();
	await converse();
	let release;
	approve(async (_owner, source, operation) =>
		source.pluginId === "@fixture/provider" && operation === "update"
			? new Promise((resolve) => {
					release = resolve;
				})
			: true,
	);
	const pending = invoke("write", { operation: "update", input: { value: 8 } }).catch((error) => error);
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	await writeFile(
		provider.source.entrypoint,
		`${await readFile(provider.source.entrypoint, "utf8")}\n// New installed generation\n`,
	);
	await rescan();
	release(true);
	expect(await pending).toBeInstanceOf(Error);
	expect(
		entry.session.sessionManager
			.getBranch()
			.some((row) => row.customType === "plugin-record:%40fixture%2Fprovider:service-state"),
	).toBe(false);
}, 20000);

it("a real short-lease provider cleanup failure rejects its receipt and retains the source teardown barrier", async () => {
	const { invoke, approvals } = await setup({ native: false });
	const failure = await invoke("write", { operation: "failClose", input: null }).catch((error) => error);
	const activationCount = () =>
		approvals.filter((args) => args[1].pluginId === "@fixture/provider" && args[2] === undefined).length;
	const count = activationCount();
	const blocked = await invoke("read", { operation: "status", input: null }).catch((error) => error);
	const after = activationCount();
	const stopped = await bridge.close().catch((error) => error);
	bridge = undefined;
	expect(failure).toBeInstanceOf(Error);
	expect(failure.message).toMatch(/Plugin runtime disposal failed/);
	expect(blocked).toBeInstanceOf(Error);
	expect(after).toBe(count);
	expect(stopped).toBeInstanceOf(AggregateError);
	expect(stopped.message).toBe("Plugin runtime shutdown failed");
}, 20000);

const inspectLegacy = (invoke) =>
	invoke("write", { operation: "adoptionInspect", input: { type: "recovery" } });
const commitLegacy = (invoke, candidate, data, requestId) =>
	invoke(
		"write",
		{
			operation: "adoptionCommit",
			input: { type: "recovery", legacyId: candidate.id, legacyHash: candidate.hash, data },
		},
		requestId,
	);
it("verified installed legacy declarations require two write approvals, retain unknown provenance, preserve old bytes and never grant execution from JSON", async () => {
	const { entry, invoke, converse, approve, approvals, meta, faux } = await setup();
	await converse();
	const modelCalls = faux.state.callCount;
	const legacyData = {
		scope: meta.sessionId,
		approved: true,
		roots: ["/"],
		proof: "UNTRUSTED_LEGACY_JSON",
		note: "Synthetic historical checkpoint",
	};
	const oldId = entry.session.sessionManager.appendCustomEntry("legacy-session-checkpoint", legacyData);
	approve(async (_owner, _source, operation) => operation !== "capability:session.records.adoption.inspect");
	await expect(inspectLegacy(invoke)).rejects.toThrow(/denied/);
	approve(async () => true);
	await expect(invoke("directAdoption", { type: "recovery" })).rejects.toThrow(
		/Undeclared legacy checkpoint adoption/,
	);
	const inspection = await inspectLegacy(invoke);
	expect(inspection).toMatchObject({
		state: "candidate",
		creator: "unknown",
		packageVersion: "unknown",
		supportedFromVersions: ["0.9.0"],
		candidate: { id: oldId, data: legacyData },
	});
	const transformed = { scope: meta.sessionId, historicalNote: inspection.candidate.data.note };
	const adopted = await commitLegacy(invoke, inspection.candidate, transformed);
	expect(adopted).toMatchObject({
		state: "adopted",
		durability: "durable",
		legacyId: oldId,
		legacyHash: inspection.candidate.hash,
	});
	expect(entry.session.sessionManager.getEntry(oldId).data).toEqual(legacyData);
	expect(entry.session.sessionManager.getEntry(adopted.id)).toMatchObject({
		customType: "plugin-record:%40fixture%2Fprovider:recovery",
		data: transformed,
	});
	expect((await invoke("read", { operation: "ownedRecords", input: null })).records).toEqual([
		{ id: adopted.id, type: "recovery", data: transformed },
	]);
	expect(await inspectLegacy(invoke)).toMatchObject({ state: "already-adopted", candidate: null });
	const inspectApprovals = approvals.filter(
		(args) => args[2] === "capability:session.records.adoption.inspect",
	);
	expect(inspectApprovals.length).toBeGreaterThan(0);
	expect(
		inspectApprovals.every(
			(args) =>
				args[0].id === 71 && args[3].includes("legacy-session-checkpoint") && args[3].includes("unknown"),
		),
	).toBe(true);
	expect(approvals.some((args) => args[2] === "capability:session.records.adoption.commit")).toBe(true);
	expect(backend.approvals.getGate(meta.sessionId).isRunAllowed()).toBe(false);
	expect(faux.state.callCount).toBe(modelCalls);
}, 20000);
it("legacy commit rechecks actual branch/id/hash, and an ordinary own-source checkpoint closes the temporary read path", async () => {
	const { entry, invoke, converse } = await setup();
	await converse();
	const before = entry.session.sessionManager.getLeafId();
	entry.session.sessionManager.appendCustomEntry("legacy-session-checkpoint", { version: 1, note: "first" });
	const first = await inspectLegacy(invoke);
	const latest = entry.session.sessionManager.appendCustomEntry("legacy-session-checkpoint", {
		version: 1,
		note: "changed",
	});
	await expect(commitLegacy(invoke, first.candidate, { note: "stale" })).rejects.toThrow(
		/changed or is no longer/,
	);
	entry.session.sessionManager.branch(before);
	await expect(commitLegacy(invoke, first.candidate, { note: "off branch" })).rejects.toThrow(
		/changed or is no longer/,
	);
	entry.session.sessionManager.branch(latest);
	expect(await invoke("read", { operation: "ownedRecords", input: null })).toMatchObject({
		state: "durable",
		records: [],
	});
	const current = await inspectLegacy(invoke);
	await commitLegacy(invoke, current.candidate, { note: "current" });
	await expect(commitLegacy(invoke, current.candidate, { note: "duplicate" })).rejects.toThrow(
		/already exists/,
	);
	expect(await inspectLegacy(invoke)).toMatchObject({ state: "already-adopted", candidate: null });
}, 20000);
it("deferred legacy storage exposes no candidate or adopted receipt, and a cancelled real approval cannot append after its late answer", async () => {
	const { entry, invoke, converse, approve, owner, binding, selection } = await setup();
	entry.session.sessionManager.appendCustomEntry("legacy-session-checkpoint", { version: 1, note: "lazy" });
	const file = entry.session.sessionManager.getSessionFile();
	expect(await inspectLegacy(invoke)).toMatchObject({ state: "deferred", candidate: null });
	await expect(
		commitLegacy(invoke, { id: "not-a-receipt", hash: "0".repeat(64) }, { note: "not saved" }),
	).rejects.toThrow(/requires durable/);
	await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
	await converse();
	const inspection = await inspectLegacy(invoke);
	entry.readOnly = true;
	await expect(inspectLegacy(invoke)).rejects.toThrow(/denied/);
	entry.readOnly = false;
	let release;
	approve(async (_owner, _source, operation) =>
		operation === "capability:session.records.adoption.commit"
			? new Promise((resolve) => {
					release = resolve;
				})
			: true,
	);
	const pending = commitLegacy(
		invoke,
		inspection.candidate,
		{ note: "never saved" },
		"adoption-cancel",
	).catch((error) => error);
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	const cancel = bridge.cancel(owner, binding, selection, "adoption-cancel");
	release(true);
	await expect(cancel).resolves.toBe(true);
	expect(await pending).toBeInstanceOf(Error);
	expect(await invoke("read", { operation: "ownedRecords", input: null })).toMatchObject({
		state: "durable",
		records: [],
	});
}, 20000);
it("a real SDK adoption append failure is never an adopted receipt and fences the same entry through the ordinary record port", async () => {
	const { entry, invoke, converse } = await setup();
	await converse();
	entry.session.sessionManager.appendCustomEntry("legacy-session-checkpoint", {
		version: 1,
		note: "keep old record",
	});
	const inspection = await inspectLegacy(invoke),
		file = entry.session.sessionManager.getSessionFile(),
		backup = `${file}.saved`;
	const before = await readFile(file, "utf8");
	const append = entry.session.sessionManager.appendCustomEntry.bind(entry.session.sessionManager);
	vi.spyOn(entry.session.sessionManager, "appendCustomEntry").mockImplementationOnce((...args) => {
		renameSync(file, backup);
		mkdirSync(file);
		return append(...args);
	});
	await expect(commitLegacy(invoke, inspection.candidate, { note: "not committed" })).rejects.toThrow(
		/EISDIR/,
	);
	await rm(file, { recursive: true });
	await rename(backup, file);
	await expect(inspectLegacy(invoke)).rejects.toThrow(/reopen/);
	await expect(invoke("write", { operation: "update", input: { value: 8 } })).rejects.toThrow(/reopen/);
	expect(await invoke("read", { operation: "ownedRecords", input: null })).toMatchObject({
		state: "needs-reopen",
		records: [],
	});
	expect(await readFile(file, "utf8")).toBe(before);
}, 20000);

it("actual packed native providers receive only the current SDK event on the exact receiver session", async () => {
	const { entry, observations, faux, invoke, service, meta } = await setup({ roles: true });
	faux.setResponses([fauxAssistantMessage("Observed actual source.")]);
	await entry.session.prompt("native:observe");
	await entry.session.waitForIdle();
	expect(observations).toHaveLength(1);
	expect(observations[0]).toMatchObject({
		scope: { sessionId: meta.sessionId },
		input: {
			ok: true,
			value: {
				seen: 1,
				kind: "message_start",
				message: [{ type: "text", text: "native:observe" }],
				scope: { sessionId: meta.sessionId },
			},
		},
	});
	await expect(
		invoke("spoof", { type: "message_start", event: { message: { role: "assistant" } }, nonce: "FORGED" }),
	).rejects.toThrow(/in-flight actual SDK native event/);
	await expect(invoke("ordinary", null)).rejects.toThrow(/in-flight actual SDK native event/);
	const second = await service.createSession({
		cwd: entry.cwd,
		provider: faux.provider.id,
		modelId: faux.getModel().id,
	});
	const other = service.registry.get(second.sessionId);
	faux.setResponses([fauxAssistantMessage("Second actual owner.")]);
	await other.session.prompt("native:observe");
	await other.session.waitForIdle();
	expect(observations[1]).toMatchObject({
		scope: { sessionId: second.sessionId },
		input: { ok: true, value: { seen: 1, scope: { sessionId: second.sessionId } } },
	});
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("service_count", {}), { stopReason: "toolUse" }),
		fauxAssistantMessage("Actual tool observed."),
	]);
	await entry.session.prompt("Run the actual tool.");
	await entry.session.waitForIdle();
	const result = entry.session.messages.findLast(
		(message) => message.role === "toolResult" && message.toolName === "service_count",
	);
	expect(observations[2]).toMatchObject({
		input: {
			ok: true,
			value: {
				seen: 2,
				kind: "tool_execution_end",
				toolCallId: result.toolCallId,
				scope: { sessionId: meta.sessionId },
			},
		},
	});
	faux.setResponses([fauxAssistantMessage("No authority from input.")]);
	await entry.session.prompt("ordinary-input");
	await entry.session.waitForIdle();
	expect(observations[3].input).toMatchObject({
		ok: false,
		error: expect.stringMatching(/in-flight actual SDK native event/),
	});
}, 30000);
it("read native events cannot upgrade to receiver writes and wrong event kinds remain unavailable", async () => {
	const { entry, faux, observations } = await setup({ roles: true });
	for (const operation of ["write", "tool"]) {
		faux.setResponses([fauxAssistantMessage("Rejected source event.")]);
		await entry.session.prompt("native:" + operation);
		await entry.session.waitForIdle();
	}
	expect(observations.map((item) => item.input)).toEqual([
		{ ok: false, error: expect.stringMatching(/Read-only provider call/) },
		{ ok: false, error: expect.stringMatching(/does not accept this SDK event/) },
	]);
	expect(
		entry.session.sessionManager
			.getBranch()
			.some((row) => row.customType === "plugin-record:%40fixture%2Fprovider:role-result"),
	).toBe(false);
}, 20000);
it("write native events await actual receiver approval with operation and effect before durable namespaced output", async () => {
	const { entry, faux, observations, approvals } = await setup({ roles: true, roleEffect: "write" });
	faux.setResponses([fauxAssistantMessage("Write observed.")]);
	await entry.session.prompt("native:write");
	await entry.session.waitForIdle();
	expect(observations[0].input).toMatchObject({ ok: true });
	expect(
		approvals.some(
			(args) =>
				args[2] === "native:provider:write" && args[3].includes("write") && args[3].includes("effect=write"),
		),
	).toBe(true);
	expect(
		entry.session.sessionManager
			.getBranch()
			.filter((row) => row.customType === "plugin-record:%40fixture%2Fprovider:role-result"),
	).toHaveLength(1);
}, 20000);
it("a service declaration never auto-attaches a missing native receiver", async () => {
	const { entry, faux, observations } = await setup({ roles: true, providerNative: false });
	faux.setResponses([fauxAssistantMessage("Receiver absent.")]);
	await entry.session.prompt("native:observe");
	await entry.session.waitForIdle();
	expect(observations[0].input).toMatchObject({
		ok: false,
		error: expect.stringMatching(/native attachment is unavailable/),
	});
}, 20000);

it("revoking the actual provider while its write approval waits rejects the late answer and commits no record", async () => {
	const { entry, faux, observations, approve, provider, setState } = await setup({
		roles: true,
		roleEffect: "write",
	});
	let release;
	approve(async (_owner, source, operation) =>
		source.pluginId === "@fixture/provider" && operation === "native:provider:write"
			? new Promise((resolve) => {
					release = resolve;
				})
			: true,
	);
	faux.setResponses([fauxAssistantMessage("Provider stopped without a write.")]);
	const prompt = entry.session.prompt("native:write");
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	setState("disabled");
	const stopping = bridge.revoke(provider.name);
	release(true);
	await stopping;
	await prompt;
	await entry.session.waitForIdle();
	expect(observations.every((item) => item.input.ok === false)).toBe(true);
	expect(
		entry.session.sessionManager
			.getBranch()
			.some((row) => row.customType === "plugin-record:%40fixture%2Fprovider:role-result"),
	).toBe(false);
}, 20000);
it("changing installed provider bytes during native approval cannot publish a late successful receipt", async () => {
	const { entry, faux, observations, approve, provider, rescan } = await setup({
		roles: true,
		roleEffect: "write",
	});
	let release;
	approve(async (_owner, source, operation) =>
		source.pluginId === "@fixture/provider" && operation === "native:provider:write"
			? new Promise((resolve) => {
					release = resolve;
				})
			: true,
	);
	faux.setResponses([fauxAssistantMessage("Changed source rejected.")]);
	const prompt = entry.session.prompt("native:write");
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	await writeFile(
		provider.source.entrypoint,
		(await readFile(provider.source.entrypoint, "utf8")) + "\n// Changed real installed generation\n",
	);
	await rescan();
	release(true);
	await prompt;
	await entry.session.waitForIdle();
	expect(observations.every((item) => item.input.ok === false)).toBe(true);
	expect(
		entry.session.sessionManager
			.getBranch()
			.some((row) => row.customType === "plugin-record:%40fixture%2Fprovider:role-result"),
	).toBe(false);
}, 20000);
it("concurrent actual sessions preserve separate receiver attachments without sending caller-selected session ids", async () => {
	const { entry, service, faux, observations, meta } = await setup({ roles: true });
	const second = await service.createSession({
		cwd: entry.cwd,
		provider: faux.provider.id,
		modelId: faux.getModel().id,
	});
	const other = service.registry.get(second.sessionId);
	faux.setResponses([fauxAssistantMessage("Concurrent A."), fauxAssistantMessage("Concurrent B.")]);
	await Promise.all([entry.session.prompt("native:observe"), other.session.prompt("native:observe")]);
	await Promise.all([entry.session.waitForIdle(), other.session.waitForIdle()]);
	expect(observations).toHaveLength(2);
	expect(observations.map((item) => item.scope.sessionId).sort()).toEqual(
		[meta.sessionId, second.sessionId].sort(),
	);
	for (const row of observations)
		expect(row.input).toMatchObject({
			ok: true,
			value: { seen: 1, scope: { sessionId: row.scope.sessionId } },
		});
}, 20000);

it("a receiver failure reaches the actual SDK error channel exactly once", async () => {
	const { entry, faux, observations } = await setup({ roles: true });
	const errors = [];
	const stop = entry.session.extensionRunner.onError((error) => errors.push(error));
	faux.setResponses([fauxAssistantMessage("Failed operation remains visible.")]);
	await entry.session.prompt("native:fail");
	await entry.session.waitForIdle();
	stop();
	expect(errors).toHaveLength(1);
	expect(errors[0]).toMatchObject({ event: "message_start", error: "Actual native receiver failed" });
	expect(observations).toEqual([]);
}, 20000);
it("revoking the actual event sender aborts a pending receiver approval without duplicate failures per SDK event", async () => {
	const { entry, faux, observations, approve, consumer } = await setup({ roles: true, roleEffect: "write" });
	let release;
	approve(async (_owner, source, operation) =>
		source.pluginId === "@fixture/provider" && operation === "native:provider:write"
			? new Promise((resolve) => {
					release = resolve;
				})
			: true,
	);
	const errors = [],
		starts = [];
	const unsubscribe = entry.session.subscribe((event) => {
		if (event.type === "message_start") starts.push(event.message.role);
	});
	const stop = entry.session.extensionRunner.onError((error) => errors.push(error));
	faux.setResponses([fauxAssistantMessage("Sender stopped without writing.")]);
	const prompt = entry.session.prompt("native:write");
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	const stopping = bridge.revoke(consumer.name);
	release(true);
	await stopping;
	await prompt;
	await entry.session.waitForIdle();
	stop();
	unsubscribe();
	expect(starts).toEqual(["system", "user", "assistant"]);
	// The initial system event precedes revocation. Each subsequent SDK event fails once.
	expect(errors).toHaveLength(2);
	expect(errors[0]).toMatchObject({ event: "message_start" });
	expect(observations).toEqual([]);
	expect(
		entry.session.sessionManager
			.getBranch()
			.some((row) => row.customType === "plugin-record:%40fixture%2Fprovider:role-result"),
	).toBe(false);
}, 20000);

const taskPlan = {
	goal: "Preserve a real managed task checkpoint",
	summary: "Data slice only; no execution or file authorization",
	milestones: [
		{
			id: "review",
			title: "Review the supplied result",
			dependsOn: [],
			acceptance: { kind: "human_review" },
		},
	],
};
it("canonical managed task state is unavailable without an actual native attachment", async () => {
	const { invoke, owner, binding, faux } = await setup({ taskData: true, native: false });
	await expect(invoke("read", { operation: "status", input: null })).rejects.toThrow(
		/no native attachment for this SDK session/,
	);
	const applicationSelection = bridge.selectSession(owner, null);
	await expect(
		bridge.invoke(owner, binding, "read", { operation: "status", input: null }, applicationSelection),
	).rejects.toThrow(/requires an actual attached SDK session/);
	expect(faux.state.callCount).toBe(0);
}, 20000);
it("a real packed managed adapter owns one canonical TaskSession and serves status/actions through its actual SDK entry", async () => {
	const { invoke, entry, converse } = await setup({ taskData: true });
	expect(await invoke("read", { operation: "status", input: null })).toMatchObject({
		snapshot: null,
		storage: { mode: "persistent", state: "deferred" },
	});
	await converse();
	const planned = await invoke("write", { operation: "fixturePlan", input: taskPlan });
	expect(planned).toMatchObject({
		snapshot: { goal: taskPlan.goal, state: "waiting_user" },
		storage: { mode: "persistent", state: "durable" },
	});
	expect(JSON.stringify(planned)).not.toMatch(/executionConsent|writeRoots|planApproved|approvedAt/);
	const record = entry.session.sessionManager
		.getBranch()
		.findLast((row) => row.customType === "plugin-record:%40fixture%2Fprovider:drone-task-session-v1");
	expect(record.data.workbench.tasks[0].goal).toBe(taskPlan.goal);
	expect(
		await invoke("write", { operation: "pause", input: { reason: "actual-data-review" } }),
	).toMatchObject({
		snapshot: { id: planned.snapshot.id, reason: "actual-data-review" },
		storage: { state: "durable" },
	});
	expect(await invoke("write", { operation: "advanceStage", input: null })).toMatchObject({
		advanced: false,
		snapshot: { id: planned.snapshot.id },
	});
	await invoke("write", { operation: "fixtureReport", input: null });
	expect(await invoke("write", { operation: "takeReport", input: null })).toMatchObject({
		report: expect.stringContaining(taskPlan.goal),
	});
	expect(await invoke("write", { operation: "takeReport", input: null })).toMatchObject({ report: null });
}, 20000);
it("two real managed TaskSessions share an application but never expose another session's task", async () => {
	const { invoke, service, entry, faux, owner, binding, converse, meta } = await setup({ taskData: true });
	await converse();
	const first = await invoke("write", { operation: "fixturePlan", input: taskPlan });
	const otherMeta = await service.createSession({
		cwd: entry.cwd,
		provider: faux.provider.id,
		modelId: faux.getModel().id,
	});
	const other = service.registry.get(otherMeta.sessionId);
	faux.setResponses([fauxAssistantMessage("Other managed task scope.")]);
	await other.session.prompt("Initialize another task scope.");
	await other.session.waitForIdle();
	const otherSelection = bridge.selectSession(owner, otherMeta.sessionId);
	expect(
		await bridge.invoke(owner, binding, "read", { operation: "status", input: null }, otherSelection),
	).toMatchObject({ snapshot: null });
	const second = await bridge.invoke(
		owner,
		binding,
		"write",
		{ operation: "fixturePlan", input: { ...taskPlan, goal: "Independent second managed goal" } },
		otherSelection,
	);
	expect(second.snapshot.id).not.toBe(first.snapshot.id);
	const restoredSelection = bridge.selectSession(owner, meta.sessionId);
	expect(
		await bridge.invoke(owner, binding, "read", { operation: "status", input: null }, restoredSelection),
	).toMatchObject({ snapshot: { id: first.snapshot.id, goal: taskPlan.goal } });
}, 20000);
it("an actual SDK append failure fences the managed owner through reload and status retains only its last committed task", async () => {
	const { entry, invoke, converse } = await setup({ taskData: true });
	await converse();
	const planned = await invoke("write", { operation: "fixturePlan", input: taskPlan });
	const original = entry.session.sessionManager.appendCustomEntry;
	const failure = vi
		.spyOn(entry.session.sessionManager, "appendCustomEntry")
		.mockImplementationOnce(function (type, data) {
			original.call(this, type, data);
			throw new Error("Actual managed checkpoint append failed");
		});
	await expect(invoke("write", { operation: "pause", input: { reason: "must-not-commit" } })).rejects.toThrow(
		/Actual managed checkpoint append failed/,
	);
	failure.mockRestore();
	const status = await invoke("read", { operation: "status", input: null });
	expect(status).toMatchObject({
		snapshot: { id: planned.snapshot.id, reason: planned.snapshot.reason },
		storage: { state: "needs-reopen" },
	});
	const count = entry.session.sessionManager.getBranch().length;
	await expect(
		invoke("write", { operation: "pause", input: { reason: "no-phantom-chain" } }),
	).rejects.toThrow(/reopen the application from disk/);
	expect(entry.session.sessionManager.getBranch()).toHaveLength(count);
	await entry.session.reload();
	expect(await invoke("read", { operation: "status", input: null })).toMatchObject({
		storage: { state: "needs-reopen" },
		snapshot: { id: planned.snapshot.id },
	});
}, 20000);

it("a normal actual SDK reload restores the source-owned task checkpoint without exposing execution authority", async () => {
	const { entry, invoke, converse } = await setup({ taskData: true });
	await converse();
	const planned = await invoke("write", { operation: "fixturePlan", input: taskPlan });
	await entry.session.reload();
	const restored = await invoke("read", { operation: "status", input: null });
	expect(restored).toMatchObject({
		snapshot: { id: planned.snapshot.id, goal: taskPlan.goal },
		storage: { mode: "persistent", state: "durable" },
	});
	expect(JSON.stringify(restored)).not.toMatch(/executionConsent|writeRoots|planApproved|approvedAt/);
	await expect(
		invoke("read", { operation: "pause", input: { reason: "cannot-upgrade-status-read" } }),
	).rejects.toThrow(/Read-only provider call/);
}, 20000);
it("actual UI cancellation at the managed checkpoint permission waits for cleanup and cannot turn its late answer into a save", async () => {
	const { entry, invoke, converse, approve, owner, binding, selection } = await setup({ taskData: true });
	await converse();
	const planned = await invoke("write", { operation: "fixturePlan", input: taskPlan });
	const count = entry.session.sessionManager.getBranch().length;
	let release;
	approve(async (_owner, source, operation) =>
		source.pluginId === "@fixture/provider" && operation === "capability:session.records.append"
			? new Promise((resolve) => {
					release = resolve;
				})
			: true,
	);
	const pending = invoke(
		"write",
		{ operation: "pause", input: { reason: "cancel-before-append" } },
		"managed-checkpoint-cancel",
	).catch((error) => error);
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	const cancelling = bridge.cancel(owner, binding, selection, "managed-checkpoint-cancel");
	release(true);
	await expect(cancelling).resolves.toBe(true);
	expect(await pending).toBeInstanceOf(Error);
	expect(entry.session.sessionManager.getBranch()).toHaveLength(count);
	approve(async () => true);
	const status = await invoke("read", { operation: "status", input: null });
	expect(status).toMatchObject({
		snapshot: { id: planned.snapshot.id, reason: planned.snapshot.reason },
		storage: { state: "needs-reopen" },
	});
}, 20000);

it("a real installed restricted worker receives complete multi-MiB binary bytes through actual approved file-root RPC", async () => {
	const { entry, invoke, faux } = await setup({ binaryFiles: true });
	const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 255);
	bytes.writeUInt32LE(0, 0);
	await writeFile(join(entry.cwd, "binary-artifact.bin"), bytes);
	const result = await invoke("read", {
		operation: "readBinary",
		input: { root: "sdk-files", path: "binary-artifact.bin" },
	});
	expect(result).toMatchObject({
		bytes: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		version: { size: bytes.length },
	});
	expect(Buffer.from(result.base64, "base64").equals(bytes)).toBe(true);
	expect(faux.state.callCount).toBe(0);
	await expect(
		invoke("read", { operation: "readBinary", input: { root: "not-approved", path: "binary-artifact.bin" } }),
	).rejects.toThrow(/not granted/);
	await writeFile(join(entry.cwd, "oversized.bin"), Buffer.alloc(8 * 1024 * 1024 + 1));
	await expect(
		invoke("read", { operation: "readBinary", input: { root: "sdk-files", path: "oversized.bin" } }),
	).rejects.toThrow(/8 MiB/);
}, 20000);

it("actual binary RPC bytes feed the canonical PDF magic/hash algorithm without claiming identity extraction", async () => {
	const { entry, invoke } = await setup({ binaryFiles: true });
	const pdf = Buffer.from("%PDF-1.4\nSynthetic magic/hash boundary only; not a valid parsed PDF.");
	await writeFile(join(entry.cwd, "artifact.pdf"), pdf);
	const inspect = (expected) =>
		invoke("read", {
			operation: "inspectBinary",
			input: { root: "sdk-files", path: "artifact.pdf", expected },
		});
	expect(await inspect({ kind: "pdf" })).toMatchObject({
		kind: "pdf",
		identity: "needs-review",
		bytes: pdf.length,
		sha256: createHash("sha256").update(pdf).digest("hex"),
	});
	expect(
		await inspect({ kind: "pdf", sha256: createHash("sha256").update(pdf).digest("hex") }),
	).toMatchObject({ identity: "hash-matched" });
	await expect(inspect({ kind: "pdf", sha256: "0".repeat(64) })).rejects.toThrow(/hash does not match/);
	await writeFile(join(entry.cwd, "artifact.pdf"), "<html>Not PDF bytes</html>");
	await expect(inspect({ kind: "pdf" })).rejects.toThrow(/Not a PDF/);
}, 20000);
it("actual scoped cancellation drains a held binary RPC and never delivers the late snapshot", async () => {
	const { entry, invoke, owner, binding, selection, beforeBinaryRead } = await setup({ binaryFiles: true });
	const bytes = Buffer.alloc(2 * 1024 * 1024, 127);
	await writeFile(join(entry.cwd, "artifact.bin"), bytes);
	let release;
	beforeBinaryRead(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const pending = invoke(
		"read",
		{ operation: "readBinary", input: { root: "sdk-files", path: "artifact.bin" } },
		"cancel-binary-snapshot",
	).catch((error) => error);
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	const cancelling = bridge.cancel(owner, binding, selection, "cancel-binary-snapshot");
	release();
	await expect(cancelling).resolves.toBe(true);
	expect(await pending).toBeInstanceOf(Error);
	beforeBinaryRead(async () => {});
	const read = await invoke("read", {
		operation: "readBinary",
		input: { root: "sdk-files", path: "artifact.bin" },
	});
	expect(read.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
}, 20000);
