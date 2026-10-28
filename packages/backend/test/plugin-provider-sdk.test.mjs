import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
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
 inspect:{effect:'read',inputSchema:{type:'object'},resultSchema:{type:'object'},execute:async(input,ctx)=>ctx.capabilities.call('provider.inspect',input)},
 read:{effect:'read',inputSchema:{type:'object'},resultSchema:{},execute:async(input,ctx)=>ctx.capabilities.call('provider.read',{alias:'store',...input})},
 write:{effect:'write',inputSchema:{type:'object'},resultSchema:{},execute:async(input,ctx)=>ctx.capabilities.call('provider.write',{alias:'store',...input})},
 cycle:{effect:'read',inputSchema:{type:'null'},resultSchema:{type:'null'},execute:async(_input,ctx)=>ctx.capabilities.call('provider.read',{alias:'store',operation:'cycle',input:null})}
},dispose:async()=>{}});`;
async function setup({ native = true } = {}) {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-provider-packed-")));
	const archives = [];
	for (const [name, source, drone] of [
		[
			"provider",
			providerSource,
			{
				provides: {
					"checkpoint.service": {
						version: 1,
						operations: ["status", "update", "hold", "cycle", "failClose"],
					},
				},
				requires: { back: { service: "cycle.service", version: 1 } },
			},
		],
		[
			"consumer",
			consumerSource,
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
			...(name === "provider" ? { extension: "./native.mjs" } : {}),
		};
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({
				name: `@fixture/${name}`,
				version: "1.0.0",
				type: "module",
				files: ["runtime.mjs", "native.mjs", "plugin.manifest.json"],
				...(name === "provider" ? { pi: { extensions: ["./native.mjs"] } } : {}),
			}),
		);
		await writeFile(join(dir, "runtime.mjs"), source);
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
				drone: { pluginApi: 1, resultContract: "drone-result/v3", ...drone },
				permissions: { filesystem: [], network: [], subprocess: [] },
				tools: name === "provider" ? ["service_count"] : [],
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
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
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
		approve = async () => true;
	const approvals = [],
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
		capabilities: () => ({
			resources: [],
			handlers: {
				...service.getPluginSessionCapabilities(),
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
		}),
	});
	backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: native ? [provider.source.nativeEntrypoint] : [],
			pluginRuntimeDirectory: resolve(
				import.meta.dirname,
				`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
			),
			nativeRuntime: {
				begin: () =>
					bridge.beginNative(owner, (path) =>
						path === provider.source.nativeEntrypoint ? provider.name : undefined,
					),
				manages: (path) => path === provider.source.nativeEntrypoint,
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
