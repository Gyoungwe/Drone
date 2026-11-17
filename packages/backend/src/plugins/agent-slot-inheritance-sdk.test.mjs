import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, onTestFinished, vi } from "vitest";
import { SessionRegistry } from "../session/registry";
import { SessionTraces } from "../session/traces";
import { runSubagent } from "../tools/subagent/runner";
import { nativeSubagentSlotCounts } from "../tools/subagent/slots";
import { agentSlotCapabilityHandlers } from "./agent-slot-capabilities";
import { PluginRuntimeBridge } from "./coordinator";
import { createProcessPluginRuntime } from "./process-runtime";
import { getPluginSessionCaller } from "./session-caller";

const OWNER = `export default async({capabilities}) => ({
 operations:{},
 async dispose(){},
 createNativeSession(){return {
  toolEffects:{slot_probe:"read"},
  async dispose(){},
  extension(pi){pi.registerTool({
   name:"slot_probe",label:"Slot probe",description:"Acquire a native agent slot",
   parameters:{type:"object",properties:{forget:{type:"boolean"}},required:["forget"]},
   async execute(_id,{forget},signal){
    const lease=await capabilities.call("agent.slot.acquire",{},signal);
    await capabilities.call("record",{pid:process.pid});
    if(!forget)await capabilities.call("agent.slot.release",lease);
    return {content:[{type:"text",text:"acquired"}]};
   }
  });}
 };}
});`;

async function offlineModel(agentDir) {
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "nested-agent-slot-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	return { runtime, faux };
}

function bridgeFor(source, sessions, records) {
	const runtimeDirectory = resolve(
		import.meta.dirname,
		`../../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
	);
	return new PluginRuntimeBridge({
		source: () => source,
		enabled: () => true,
		approve: async () => true,
		factory: () => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		getSessionContext: (id) => getPluginSessionCaller(sessions, id),
		capabilities: () => ({
			resources: [],
			handlers: {
				...agentSlotCapabilityHandlers(),
				record: {
					effect: "read",
					inputSchema: { type: "object" },
					resultSchema: { type: "null" },
					execute: async (input, context) => {
						records.push({
							pid: input.pid,
							scope: context.scope,
							counts: nativeSubagentSlotCounts(context.scope.workspaceDirectory),
						});
						return null;
					},
				},
			},
		}),
	});
}

async function setup() {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "drone-nested-agent-sdk-")));
	const agentDir = join(cwd, "agent");
	await mkdir(agentDir);
	await mkdir(join(cwd, ".pi"));
	await writeFile(join(cwd, ".pi/research-workspace.json"), '{"maxConcurrentSubagents":1}');
	const source = {
		pluginId: "slot-probe",
		packageRoot: cwd,
		entrypoint: join(cwd, "owner.mjs"),
		nativeEntrypoint: join(cwd, "native.mjs"),
	};
	await writeFile(source.entrypoint, OWNER);
	await writeFile(source.nativeEntrypoint, 'throw new Error("Only the managed entry may load");');
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	const { runtime, faux } = await offlineModel(agentDir);
	const sessions = new SessionRegistry(),
		records = [],
		runs = [];
	const controller = new AbortController();
	const bridge = bridgeFor(source, sessions, records);
	const owner = { id: 1, isDestroyed: () => false };
	const integration = {
		manages: (path) => path === source.nativeEntrypoint,
		childExtensionPaths: () => [source.nativeEntrypoint],
		begin: (facts) =>
			bridge.beginNative(
				owner,
				(path) => (path === source.nativeEntrypoint ? "slot-probe" : undefined),
				facts,
			),
	};
	onTestFinished(async () => {
		controller.abort();
		await Promise.allSettled(runs);
		await bridge.close();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});
	const deps = {
		getModelRuntime: async () => runtime,
		getSubagentModel: async () => undefined,
		gate: { confirm: async () => false },
		traces: new SessionTraces(),
		nativeChildren: () => ({
			integration,
			register: (entry) => {
				sessions.add(entry);
				return () => sessions.delete(entry.session.sessionId);
			},
		}),
	};
	return { cwd, faux, deps, records, runs, signal: controller.signal };
}

it.each([false, true])(
	"inherits in a real SDK child through the restricted worker; forgotten release: %s",
	async (forget) => {
		const state = await setup();
		state.faux.setResponses([
			fauxAssistantMessage(fauxToolCall("slot_probe", { forget })),
			fauxAssistantMessage("Probe complete."),
		]);
		const running = runSubagent(state.deps, {
			cwd: state.cwd,
			projectTrusted: true,
			model: state.faux.getModel(),
			signal: state.signal,
			agent: {
				name: "slot-reader",
				description: "Probe slot inheritance",
				tools: ["slot_probe"],
				systemPrompt: "Run the slot probe.",
				source: "user",
			},
			task: "Run the slot probe.",
		});
		state.runs.push(running);
		const result = await running;
		expect(result.exitCode, result.error).toBe(0);
		expect(state.records).toHaveLength(1);
		expect(state.records[0].pid).not.toBe(process.pid);
		expect(state.records[0].scope).toMatchObject({ kind: "session", sessionId: result.sessionId });
		expect(state.records[0].counts).toEqual({ active: 1, project: 1 });
		expect(nativeSubagentSlotCounts(state.cwd)).toEqual({ active: 0, project: 0 });
	},
);
