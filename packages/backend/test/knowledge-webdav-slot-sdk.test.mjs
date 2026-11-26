// Real SDK tool -> restricted worker -> host credential store -> challenged loopback HTTP.
// Synthetic fixtures only. This test requires permission to listen on a local port.
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, onTestFinished, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { PluginCredentialStore } from "../src/plugins/plugin-credentials";
import { consentForSource } from "../src/plugins/policy-consent";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

const secrets = {
	saved: "TEST_ONLY_W2C_SAVED_MARKER",
	env: "TEST_ONLY_W2C_ENV_MARKER",
	wrongEnv: "TEST_ONLY_W2C_WRONG_ENV_MARKER",
};
const username = "fixture-user";
const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const RUNTIME = `export default async context=>({operations:{},dispose:async()=>{},createNativeSession:async()=>({
 toolEffects:{fixture_webdav:'read'},dispose:async()=>{},
 extension:pi=>pi.registerTool({name:'fixture_webdav',label:'WebDAV fixture',description:'Exercise host HTTP authentication',
 parameters:{type:'object',properties:{origin:{type:'string'},method:{type:'string'},path:{type:'string'},username:{type:'string'}},required:['origin','method','path']},
 execute:async(_id,input,signal)=>{
  const read=['GET','HEAD','PROPFIND'].includes(input.method);
  try {
   const result=await context.capabilities.call(read?'network.read':'network.write',{
    method:input.method,url:input.origin+input.path,credential:'webdav',httpAuth:{username:input.username??'fixture-user'},
    headers:input.method==='PROPFIND'?{Depth:'0'}:{},
    ...(input.method==='PUT'?{bodyBase64:Buffer.from('fixture upload').toString('base64')} : {}),
    ...(!read?{summary:'Mutate synthetic WebDAV fixture'}:{}),
   },signal);
   return {content:[{type:'text',text:JSON.stringify({result})}]};
  } catch(error) { return {content:[{type:'text',text:JSON.stringify({error:error.message})}]}; }
 }})
})});`;

const md5 = (value) => createHash("md5").update(value).digest("hex");
function passwordUsed(request) {
	const header = request.headers.authorization;
	if (!header) return "none";
	const attributes = Object.fromEntries(
		[...header.matchAll(/(\w+)=(?:"([^"]*)"|([^, ]+))/g)].map(([, key, quoted, bare]) => [
			key,
			quoted ?? bare,
		]),
	);
	if (
		!header.startsWith("Digest ") ||
		attributes.username !== username ||
		attributes.uri !== request.url ||
		attributes.realm !== "fixture" ||
		attributes.nonce !== "fixture-nonce" ||
		attributes.qop !== "auth"
	)
		return "invalid";
	const ha2 = md5(`${request.method}:${request.url}`);
	return (
		Object.entries(secrets).find(([, secret]) => {
			const ha1 = md5(`${username}:fixture:${secret}`);
			return (
				attributes.response === md5(`${ha1}:fixture-nonce:${attributes.nc}:${attributes.cnonce}:auth:${ha2}`)
			);
		})?.[0] ?? "invalid"
	);
}

async function startServer(t) {
	t.received = [];
	t.collections = new Set(["/collection"]);
	t.note = "";
	t.server = createServer(async (request, response) => {
		const selected = passwordUsed(request);
		t.received.push({ method: request.method, path: request.url, selected, depth: request.headers.depth });
		response.setHeader("Set-Cookie", secrets.saved);
		response.setHeader("X-Private", secrets.env);
		response.setHeader("Content-Type", "text/plain");
		if (selected !== "saved" && selected !== "env") {
			request.resume();
			response.statusCode = 401;
			response.setHeader("WWW-Authenticate", 'Digest realm="fixture", nonce="fixture-nonce", qop="auth"');
			response.end(secrets.wrongEnv);
			return;
		}
		await serveAuthorized(t, request, response);
	});
	t.server.listen(0, "127.0.0.1");
	await once(t.server, "listening");
	t.origin = `http://127.0.0.1:${t.server.address().port}`;
	t.host = new URL(t.origin).host;
}

async function serveAuthorized(t, request, response) {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	if (request.url === "/error") {
		response.statusCode = 503;
		response.setHeader("WWW-Authenticate", secrets.saved);
		response.end(secrets.saved);
	} else if (request.method === "PROPFIND") {
		response.statusCode = t.collections.has(request.url) ? 207 : 404;
		response.setHeader("ETag", '"fixture-etag"');
		response.end(t.collections.has(request.url) ? "<collection/>" : secrets.saved);
	} else if (request.method === "MKCOL") {
		t.collections.add(request.url);
		response.writeHead(201);
		response.end();
	} else if (request.method === "PUT") {
		t.note = Buffer.concat(chunks).toString();
		response.writeHead(201);
		response.end();
	} else {
		response.end(t.note);
	}
}

async function installFixture(t) {
	const packageRoot = join(t.root, "installed", "node_modules", "@gyoungwe", "pi-knowledge");
	await mkdir(packageRoot, { recursive: true });
	await writeFile(
		join(packageRoot, "package.json"),
		JSON.stringify({
			name: "@gyoungwe/pi-knowledge",
			version: "1.0.0",
			type: "module",
			pi: { extensions: ["./native.mjs"] },
		}),
	);
	await writeFile(join(packageRoot, "runtime.mjs"), RUNTIME);
	await writeFile(
		join(packageRoot, "native.mjs"),
		"export default()=>{throw new Error('Use the managed owner');};",
	);
	await writeFile(
		join(packageRoot, "plugin.manifest.json"),
		JSON.stringify({
			schemaVersion: 1,
			id: "drone-fixture-webdav",
			version: "1.0.0",
			pi: { apiVersion: 1, minHostVersion: "1.1.0", testedHosts: ["1.1.0"] },
			capabilities: ["knowledge"],
			hosts: ["drone-desktop", "native-pi"],
			entrypoints: { desktopRuntime: "./runtime.mjs", extension: "./native.mjs" },
			drone: {
				pluginApi: 1,
				resultContract: "drone-result/v3",
				credentials: [
					{
						slot: "webdav",
						label: { zh: "WebDAV", en: "WebDAV" },
						hosts: [t.host],
						header: "Authorization",
						fields: [],
						authentication: "http-basic-digest",
						custody: "host-environment",
					},
				],
			},
			permissions: { filesystem: [], network: [t.host], subprocess: [] },
			tools: [],
		}),
	);
	// The user approved the package's policy at install, so the host's WebDAV password may stand in.
	t.catalog = (await discoverInstalledPackages(join(t.root, "installed", "node_modules"))).map((item) => {
		if ("error" in item || !item.runtime) throw new Error("Fixture discovery failed");
		const source = { ...item.runtime, policyConsent: consentForSource(item.runtime) };
		return { name: `package:${item.packageRoot}`, source, state: "enabled" };
	});
	[t.plugin] = t.catalog;
}

async function createModel(t) {
	const agentDir = join(t.root, "agent");
	await mkdir(agentDir);
	t.cwd = join(t.root, "project");
	await mkdir(t.cwd);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "en");
	t.modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	t.faux = fauxProvider({ provider: "webdav-slot-offline", tokensPerSecond: 0 });
	t.modelRuntime.registerNativeProvider(t.faux.provider);
	vi.spyOn(t.modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
}

function createHost(t) {
	const owner = { id: 23, isDestroyed: () => false };
	t.dialogs = [];
	t.approve = true;
	t.backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		tools: ["read", "fixture_webdav"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: [t.plugin.source.nativeEntrypoint],
			pluginRuntimeDirectory: runtimeDirectory,
			noSkills: true,
			noPromptTemplates: true,
			nativeRuntime: {
				begin: () =>
					t.bridge.beginNative(
						owner,
						(path) => t.catalog.find((item) => item.source.nativeEntrypoint === path)?.name,
					),
				manages: (path) => t.catalog.some((item) => item.source.nativeEntrypoint === path),
			},
		},
	});
	t.backend.sessions.modelRuntime = t.modelRuntime;
	t.bridge = new PluginRuntimeBridge({
		source: (name) => t.catalog.find((item) => item.name === name)?.source,
		sources: () => t.catalog,
		enabled: () => true,
		approve: async (_owner, _source, operation, detail) => {
			t.dialogs.push({ operation, detail });
			return t.approve;
		},
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		getSessionContext: (id) => t.backend.sessions.getPluginCallerContext(id),
		capabilities: (source) => () => ({
			resources: [],
			handlers: {
				...t.backend.sessions.getPluginSessionCapabilities(),
				...t.backend.sessions.getPluginSourceCapabilities(source),
			},
		}),
	});
}

async function setup() {
	const t = { root: await realpath(await mkdtemp(join(tmpdir(), "drone-webdav-slot-"))) };
	onTestFinished(async () => {
		await t.bridge?.close();
		await t.backend?.dispose();
		if (t.server?.listening) await new Promise((done) => t.server.close(done));
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(t.root, { recursive: true, force: true });
	});
	await startServer(t);
	await installFixture(t);
	await createModel(t);
	createHost(t);
	const meta = await t.backend.sessions.createSession({
		cwd: t.cwd,
		provider: t.faux.provider.id,
		modelId: t.faux.getModel().id,
	});
	t.entry = t.backend.sessions.registry.get(meta.sessionId);
	t.save = () =>
		new PluginCredentialStore().save(
			t.plugin.source.pluginId,
			t.plugin.source.credentials[0],
			secrets.saved,
			{},
		);
	t.run = (method, path = "/collection", extra = {}) =>
		runTool(t, { origin: t.origin, method, path, ...extra });
	return t;
}

async function runTool(t, input) {
	t.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("fixture_webdav", input)], { stopReason: "toolUse" }),
		fauxAssistantMessage("done"),
	]);
	await t.entry.session.prompt("Run synthetic WebDAV fixture", { expandPromptTemplates: false });
	await t.entry.session.waitForIdle?.();
	const message = t.entry.session.messages.findLast(
		(item) => item.role === "toolResult" && item.toolName === "fixture_webdav",
	);
	const result = JSON.parse(message.content[0].text);
	for (const secret of Object.values(secrets)) expect(JSON.stringify(result)).not.toContain(secret);
	return result;
}

it("uses saved Digest for Depth 0 PROPFIND and approves MKCOL/PUT with successful readback", async () => {
	const t = await setup();
	await t.save();
	const { result } = await t.run("PROPFIND");
	expect(result).toMatchObject({
		status: 207,
		base64: Buffer.from("<collection/>").toString("base64"),
		bytes: 13,
	});
	expect(Object.keys(result.headers).sort()).toEqual(["content-length", "content-type", "etag"]);
	expect(t.received.map(({ selected, depth }) => ({ selected, depth }))).toEqual([
		{ selected: "none", depth: "0" },
		{ selected: "saved", depth: "0" },
	]);
	expect((await t.run("MKCOL", "/created")).result.status).toBe(201);
	expect((await t.run("PROPFIND", "/created")).result.status).toBe(207);
	expect((await t.run("PUT", "/note")).result.status).toBe(201);
	expect((await t.run("GET", "/note")).result.base64).toBe(Buffer.from("fixture upload").toString("base64"));
	const writes = t.dialogs.filter(({ operation }) => operation === "capability:network.write");
	expect(writes).toHaveLength(2);
	expect(writes.map(({ detail }) => detail.split("\n")[0])).toEqual([
		`Network write: MKCOL ${t.host}/created`,
		`Network write: PUT ${t.host}/note`,
	]);
	for (const { detail } of writes) {
		expect(detail).toContain("Uses saved credential: webdav");
		expect(detail).not.toContain(username);
		for (const secret of Object.values(secrets)) expect(detail).not.toContain(secret);
	}
});

it("takes the env override afresh and a wrong override never falls back to the saved password", async () => {
	const t = await setup();
	await t.save();
	expect((await t.run("PROPFIND")).result.status).toBe(207);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", secrets.env);
	expect((await t.run("PROPFIND")).result.status).toBe(207);
	vi.stubEnv("DRONE_WEBDAV_PASSWORD", secrets.wrongEnv);
	const { result } = await t.run("PROPFIND");
	expect(result).toMatchObject({ status: 401, base64: "", bytes: 0 });
	expect(Object.keys(result.headers).sort()).toEqual(["content-length", "content-type"]);
	expect(t.received.map(({ selected }) => selected)).toEqual([
		"none",
		"saved",
		"none",
		"env",
		"none",
		"wrongEnv",
	]);
});

it("discards server failures and denies writes and invalid usernames before network IO", async () => {
	const t = await setup();
	expect(await t.run("PROPFIND")).toEqual({
		error: "Credential webdav is not configured; add it in Drone settings",
	});
	expect(t.received).toEqual([]);
	await t.save();
	const { result } = await t.run("GET", "/error");
	expect(result).toMatchObject({ status: 503, base64: "", bytes: 0 });
	expect(Object.keys(result.headers).sort()).toEqual(["content-length", "content-type"]);
	const sent = t.received.length;
	t.approve = false;
	for (const method of ["MKCOL", "PUT"])
		expect((await t.run(method, "/denied")).error).toBe("Plugin capability denied: network.write");
	expect(await t.run("PROPFIND", "/collection", { username: `${secrets.saved}:invalid` })).toEqual({
		error: "Invalid HTTP authentication username",
	});
	expect(t.received).toHaveLength(sent);
});
