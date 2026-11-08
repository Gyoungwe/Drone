// Host facts a managed native plugin receives in place of the in-process bridges (docs/handoff-2026-10-29-p4.md
// §5.2 item 4): drone:context-evicted forwarded from the session's own extension bus, the host capability
// checkpoint as session.capabilities, and agent decisions through session.decision.record. Real SDK sessions,
// the restricted plugin process and the offline faux model.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
/** Per-test resources: temp root, backend and plugin bridge. */
const live = {};
afterEach(async () => {
	await live.backend?.dispose();
	await live.bridge?.close();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (live.root) await rm(live.root, { recursive: true, force: true });
	for (const key of Object.keys(live)) delete live[key];
});

const OWNER = `export default async({capabilities}) => ({
 operations:{},
 async dispose(){},
 createNativeSession(){return {
  eventEffects:{"drone:context-evicted":"read"},
  commandEffects:{caps:"read",decide:"read"},
  async dispose(){},
  extension(pi){
   pi.on("drone:context-evicted",async(event,ctx)=>{
    await capabilities.call("record",{evicted:event,session:ctx.sessionManager.getSessionId()});
   });
   pi.registerCommand("caps",{handler:async()=>{
    await capabilities.call("record",{capabilities:await capabilities.call("session.capabilities",null)});
   }});
   pi.registerCommand("decide",{handler:async(args)=>{
    await capabilities.call("session.decision.record",{id:"rebind:"+args,kind:"rebind",summary:"Rebind approved",basis:["task:"+args]});
   }});
  }};}
});`;

/** The offline faux model, with auth reported as configured. */
async function offlineModel(agentDir) {
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "managed-host-events-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	return { runtime, faux };
}

/** The real session capabilities plus a read-only `record` the plugin reports what it received to. */
const recordingBridge = (definition, records, approve) =>
	new PluginRuntimeBridge({
		source: () => definition,
		enabled: () => true,
		approve,
		factory: () => createProcessPluginRuntime({ ...definition, runtimeDirectory }),
		getSessionContext: (id) => live.backend.sessions.getPluginCallerContext(id),
		capabilities: () => ({
			resources: [],
			handlers: {
				...live.backend.sessions.getPluginSessionCapabilities(),
				record: {
					inputSchema: {},
					resultSchema: { type: "null" },
					effect: "read",
					execute: async (input, ctx) => {
						records.push({ ...input, caller: ctx.scope.sessionId });
						return null;
					},
				},
			},
		}),
	});

async function setup() {
	live.root = await realpath(await mkdtemp(join(tmpdir(), "drone-managed-host-events-")));
	const pkg = join(live.root, "package"),
		agentDir = join(live.root, "agent");
	await mkdir(pkg);
	await mkdir(agentDir);
	const entrypoint = join(pkg, "owner.mjs"),
		nativeEntrypoint = join(pkg, "native.mjs");
	await writeFile(entrypoint, OWNER);
	await writeFile(
		nativeEntrypoint,
		'throw new Error("The managed package must never import into the host");',
	);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(live.root, "knowledge"));
	const { runtime, faux } = await offlineModel(agentDir);
	const records = [];
	const approve = vi.fn(async () => true);
	live.bridge = recordingBridge(
		{ pluginId: "managed-events", packageRoot: pkg, entrypoint, nativeEntrypoint },
		records,
		approve,
	);
	const window = { id: 102, isDestroyed: () => false };
	live.backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		webFetch: false,
		subagentPreferBuiltin: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: [nativeEntrypoint],
			pluginRuntimeDirectory: runtimeDirectory,
			nativeRuntime: {
				manages: (path) => path === nativeEntrypoint,
				begin: () =>
					live.bridge.beginNative(window, (path) => (path === nativeEntrypoint ? "events-ui" : undefined)),
			},
		},
	});
	live.backend.sessions.modelRuntime = runtime;
	const create = async (name) => {
		const cwd = join(live.root, name);
		await mkdir(cwd);
		const meta = await live.backend.sessions.createSession({
			cwd,
			provider: faux.provider.id,
			modelId: faux.getModel().id,
		});
		return live.backend.sessions.registry.get(meta.sessionId).session;
	};
	return { records, approve, create, backend: live.backend };
}

/** Emits the way the context-evaporation extension does: on the session's own extension bus. */
const evict = (session, payload) => session.resourceLoader.eventBus.emit("drone:context-evicted", payload);
const settle = () => new Promise((done) => setTimeout(done, 300));

it("delivers each session's own context evictions to the managed hook, rebuilt from the known fields", async () => {
	const { records, approve, create } = await setup();
	const first = await create("one"),
		second = await create("two");
	evict(first, { sessionId: first.sessionId, toolCallIds: ["call-1", 7, "call-2"], extra: "dropped" });
	// Another session's id on this bus is not this session's eviction.
	evict(first, { sessionId: second.sessionId, toolCallIds: ["foreign"] });
	evict(second, { sessionId: second.sessionId, toolCallIds: ["call-3"] });
	await settle();
	expect(records).toEqual([
		{
			evicted: { sessionId: first.sessionId, toolCallIds: ["call-1", "call-2"] },
			session: first.sessionId,
			caller: first.sessionId,
		},
		{
			evicted: { sessionId: second.sessionId, toolCallIds: ["call-3"] },
			session: second.sessionId,
			caller: second.sessionId,
		},
	]);
	// A read hook: ordinary evictions raise no plugin dialog.
	expect(approve.mock.calls.filter(([, , operation]) => operation)).toEqual([]);
});

it("reads the host capability checkpoint and records decisions without a dialog", async () => {
	const { records, approve, create, backend } = await setup();
	const session = await create("one");
	await backend.sessions.command(session.sessionId, "caps", "");
	session.sessionManager.appendCustomEntry("drone-capability-checkpoint-v1", {
		capabilities: ["literature"],
	});
	session.sessionManager.appendCustomEntry("drone-capability-checkpoint-v1", {
		capabilities: ["analysis", "compute"],
	});
	await backend.sessions.command(session.sessionId, "caps", "");
	expect(records).toEqual([
		{ capabilities: [], caller: session.sessionId },
		{ capabilities: ["analysis", "compute"], caller: session.sessionId },
	]);
	const decisions = [];
	backend.sessions.onDecision((event) => decisions.push(event));
	await backend.sessions.command(session.sessionId, "decide", "t1");
	expect(decisions).toEqual([
		{
			id: "managed-events:rebind:t1",
			kind: "rebind",
			summary: "Rebind approved",
			basis: ["task:t1"],
			at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			projectId: session.sessionManager.getCwd(),
		},
	]);
	expect(approve.mock.calls.filter(([, , operation]) => operation)).toEqual([]);
});
