// Network for managed plugins through a real SDK session, a real restricted worker and an npm-installed
// package (docs/superpowers/specs/2026-11-05-task-acceptance-role-design.md, N1). The worker has no
// network of its own; the host sends only to declared hosts, a POST counts as a read only when the
// manifest lists it in drone.networkReads, and each real write asks once with the plugin's description.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { networkCapabilityHandlers } from "../src/plugins/network-capabilities";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

let root, backend, bridge, server;
afterEach(async () => {
	await bridge?.close();
	await backend?.dispose();
	await new Promise((done) => (server ? server.close(done) : done()));
	bridge = backend = server = undefined;
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
// One tool shaped like a Zotero save: two reading POSTs, one GET, then the single real write.
const RUNTIME = `export default async context=>({operations:{},dispose:async()=>{},createNativeSession:async()=>({
 toolEffects:{fixture_save:'read'},dispose:async()=>{},
 extension:pi=>pi.registerTool({name:'fixture_save',label:'save',description:'Save one record',parameters:{type:'object',properties:{origin:{type:'string'},via:{type:'string'}},required:['origin']},
  execute:async(_id,input,signal)=>{
   const call=(name,request)=>context.capabilities.call(name,request,signal);
   const done=[];
   if(input.via==='direct'){
    try{await fetch(input.origin+'/ping',{method:'POST'});done.push('direct fetch sent');}
    catch(error){done.push('direct fetch '+(error.cause?.code??error.code??error.message));}
    return {content:[{type:'text',text:JSON.stringify(done)}]};
   }
   const step=async(name,method,path,extra={})=>{
    try{const r=await call(name,{method,url:input.origin+path,...extra});done.push(name+' '+method+' '+path+' '+r.status);}
    catch(error){done.push(name+' '+method+' '+path+' '+error.message);}
   };
   await step('network.read','POST','/ping');
   await step('network.read','POST','/selected');
   await step('network.read','GET','/items');
   const body={bodyBase64:Buffer.from('{}').toString('base64')};
   await step(input.via==='read'?'network.read':'network.write','POST','/save',input.via==='read'?body:{...body,summary:'Save "Gut signatures" (DOI 10.1000/x)'});
   return {content:[{type:'text',text:JSON.stringify(done)}]};
  }})
})});`;

async function setup() {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-plugin-network-")));
	const received = [];
	server = createServer((request, response) => {
		received.push(`${request.method} ${request.url}`);
		response.setHeader("content-type", "application/json");
		response.end("{}");
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const host = new URL(origin).host;

	const dir = join(root, "source");
	await mkdir(dir);
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({
			name: "@fixture/network",
			version: "1.0.0",
			type: "module",
			files: ["runtime.mjs", "native.mjs", "plugin.manifest.json"],
			pi: { extensions: ["./native.mjs"] },
		}),
	);
	await writeFile(join(dir, "runtime.mjs"), RUNTIME);
	await writeFile(
		join(dir, "native.mjs"),
		"export default()=>{throw new Error('Desktop must use the managed owner.');};",
	);
	await writeFile(
		join(dir, "plugin.manifest.json"),
		JSON.stringify({
			schemaVersion: 1,
			id: "drone-fixture-network",
			version: "1.0.0",
			pi: { apiVersion: 1, minHostVersion: "1.1.0", testedHosts: ["1.1.0"] },
			capabilities: ["core"],
			hosts: ["drone-desktop", "native-pi"],
			entrypoints: { desktopRuntime: "./runtime.mjs", extension: "./native.mjs" },
			drone: {
				pluginApi: 1,
				resultContract: "drone-result/v3",
				networkReads: [`${host}/ping`, `${host}/selected`],
			},
			permissions: { filesystem: [], network: [host], subprocess: [] },
			tools: [],
		}),
	);
	const [pack] = JSON.parse(
		execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], {
			cwd: dir,
			encoding: "utf8",
		}),
	);
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
			join(root, pack.filename),
		],
		{ encoding: "utf8" },
	);
	const catalog = (await discoverInstalledPackages(join(prefix, "node_modules"))).map((item) => {
		if ("error" in item || !item.runtime) throw new Error(JSON.stringify(item));
		return { name: `package:${item.packageRoot}`, source: item.runtime, state: "enabled" };
	});
	const [plugin] = catalog;

	const cwd = join(root, "project"),
		agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "en");
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "plugin-network-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	const owner = { id: 21, isDestroyed: () => false };
	let service,
		answer = true;
	const dialogs = [];
	backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		tools: ["read", "fixture_save"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: [plugin.source.nativeEntrypoint],
			pluginRuntimeDirectory: runtimeDirectory,
			nativeRuntime: {
				begin: () =>
					bridge.beginNative(owner, (path) => catalog.find((i) => i.source.nativeEntrypoint === path)?.name),
				manages: (path) => catalog.some((i) => i.source.nativeEntrypoint === path),
			},
		},
	});
	service = backend.sessions;
	service.modelRuntime = modelRuntime;
	bridge = new PluginRuntimeBridge({
		source: (name) => catalog.find((item) => item.name === name)?.source,
		sources: () => catalog,
		enabled: () => true,
		approve: async (_owner, _source, operation, detail) => {
			dialogs.push({ operation, detail });
			return answer;
		},
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		getSessionContext: (id) => service?.getPluginCallerContext(id),
		capabilities: (source) => () => ({
			resources: [],
			handlers: {
				...service.getPluginSessionCapabilities(),
				...(source.networkHosts
					? networkCapabilityHandlers({ hosts: source.networkHosts, reads: source.networkReads ?? [] })
					: {}),
			},
		}),
	});
	const meta = await service.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	const entry = service.registry.get(meta.sessionId);
	const save = async (via) => {
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("fixture_save", { origin, ...(via ? { via } : {}) })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await entry.session.prompt("save it", { expandPromptTemplates: false });
		await entry.session.waitForIdle?.();
		const result = entry.session.messages.findLast(
			(m) => m.role === "toolResult" && m.toolName === "fixture_save",
		);
		return JSON.parse(result.content[0].text);
	};
	return { host, received, dialogs, save, decline: () => (answer = false) };
}

it("a save sends its declared reading POSTs freely and asks once, with the plugin's description, for the write", async () => {
	const t = await setup();
	expect(await t.save()).toEqual([
		"network.read POST /ping 200",
		"network.read POST /selected 200",
		"network.read GET /items 200",
		"network.write POST /save 200",
	]);
	expect(t.received).toEqual(["POST /ping", "POST /selected", "GET /items", "POST /save"]);
	const writes = t.dialogs.filter((dialog) => dialog.operation === "capability:network.write");
	expect(writes).toHaveLength(1);
	expect(writes[0].detail).toContain(`POST ${t.host}/save`);
	expect(writes[0].detail).toContain('Save "Gut signatures" (DOI 10.1000/x)');
}, 60000);

it("a declined write reaches nothing, and an undeclared POST cannot pass as a read", async () => {
	const t = await setup();
	t.decline();
	expect((await t.save()).at(-1)).toBe("network.write POST /save Plugin capability denied: network.write");
	expect(t.received).not.toContain("POST /save");
	expect((await t.save("read")).at(-1)).toMatch(
		/network\.read POST \/save .*network write unless drone\.networkReads/,
	);
	expect(t.received).not.toContain("POST /save");
}, 60000);

it("the restricted worker cannot reach the network by itself", async () => {
	const t = await setup();
	expect(await t.save("direct")).toEqual(["direct fetch ERR_ACCESS_DENIED"]);
	expect(t.received).toEqual([]);
}, 60000);
