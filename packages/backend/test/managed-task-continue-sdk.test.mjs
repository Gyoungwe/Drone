// How a managed task asks the user to go on, through a real SDK session, a real restricted worker
// and the installed @gyoungwe/pi-core runtime (docs/handoff-2026-10-29-p4.md §5.2 item 5).
// The model is the offline faux provider; everything between it and the plugin is production code.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { discoverInstalledPackages } from "../../desktop/src/main/ui-plugins/installed-package-sources";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

let root, backend, bridge;
afterEach(async () => {
	await bridge?.close();
	await backend?.dispose();
	bridge = backend = undefined;
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

const RUNTIME = `import {createManagedTaskApplication} from './dist/managed-runtime.mjs';
export default async context=>{
 const app=createManagedTaskApplication(context);
 let probing=false;
 const seen=[];
 const attempt=async(hook,name,input)=>{
  try{const value=await context.capabilities.call(name,input);seen.push({hook,name,ok:true,value:name==='session.select'?value:undefined});}
  catch(error){seen.push({hook,name,ok:false,error:error.message});}
 };
 const check=hook=>async()=>{
  if(!probing)return;
  await attempt(hook,'session.select',{title:'Probe '+hook,options:['one','two']});
  await attempt(hook,'session.notify',{content:'Probe '+hook});
 };
 return {...app,
  createNativeSession:async(...args)=>{
   const session=await app.createNativeSession(...args);
   return {...session,extension:pi=>{session.extension(pi);pi.on('agent_end',check('agent_end'));pi.on('agent_settled',check('agent_settled'));}};
  },
  operations:{...app.operations,
   fixtureView:{effect:'read',inputSchema:{type:'null'},resultSchema:{type:'object'},execute:(_input,ctx)=>app.withCurrentSession(ctx.signal,session=>session.controller.journal.view())},
   fixtureProbe:{effect:'read',inputSchema:{type:'boolean'},resultSchema:{type:'array'},execute:async input=>{probing=input;return seen;}},
  }};
};`;
const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);

async function installFixture() {
	const dir = join(root, "source");
	await mkdir(dir);
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({
			name: "@fixture/tasks",
			version: "1.0.0",
			type: "module",
			files: ["runtime.mjs", "native.mjs", "plugin.manifest.json", "dist"],
			pi: { extensions: ["./native.mjs"] },
		}),
	);
	await writeFile(join(dir, "runtime.mjs"), RUNTIME);
	await writeFile(
		join(dir, "native.mjs"),
		"export default()=>{throw new Error('Desktop must select the managed runtime owner.');};",
	);
	await cp(dirname(createRequire(import.meta.url).resolve("@gyoungwe/pi-core")), join(dir, "dist"), {
		recursive: true,
	});
	await writeFile(
		join(dir, "plugin.manifest.json"),
		JSON.stringify({
			schemaVersion: 1,
			id: "drone-fixture-tasks",
			version: "1.0.0",
			pi: { apiVersion: 1, minHostVersion: "1.1.0", testedHosts: ["1.1.0"] },
			capabilities: ["core"],
			hosts: ["drone-desktop", "native-pi"],
			entrypoints: { desktopRuntime: "./runtime.mjs", extension: "./native.mjs" },
			drone: {
				pluginApi: 1,
				resultContract: "drone-result/v3",
				taskGrants: "request",
				workspaceRead: "session",
				provides: { "fixture.tasks": { version: 1, operations: ["status", "fixtureView", "fixtureProbe"] } },
			},
			permissions: { filesystem: ["workspace-read"], network: [], subprocess: [] },
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
	return (await discoverInstalledPackages(join(prefix, "node_modules"))).map((item) => {
		if ("error" in item || !item.runtime) throw new Error(JSON.stringify(item));
		return { name: `package:${item.packageRoot}`, source: item.runtime, state: "enabled" };
	});
}

/** What the plugin asked the host, recorded on the host side of the capability boundary. */
const observed = (handlers, calls, hostDelay) =>
	Object.fromEntries(
		Object.entries(handlers).map(([name, handler]) => [
			name,
			{
				...handler,
				execute: async (input, context) => {
					if (name === "session.notify" && hostDelay.ms)
						await new Promise((done) => setTimeout(done, hostDelay.ms));
					const result = await handler.execute(input, context);
					if (name === "session.inspect") calls.push(`inspect:${result.agentActive ? "active" : "idle"}`);
					else if (name === "session.select") calls.push("select");
					return result;
				},
			},
		]),
	);

async function setup() {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-managed-continue-")));
	const catalog = await installFixture();
	const [plugin] = catalog;
	const home = join(root, "home"),
		cwd = join(home, "project"),
		agentDir = join(root, "agent");
	await mkdir(join(cwd, "outputs"), { recursive: true });
	await mkdir(agentDir);
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	vi.stubEnv("DRONE_REPLY_LANGUAGE", "zh");
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "managed-continue-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	const owner = { id: 11, isDestroyed: () => false };
	const dialogs = [],
		questions = [],
		calls = [],
		hostDelay = { ms: 0 };
	let service,
		answerQuestion = () => undefined;
	backend = createBackend({
		projectTrust: false,
		lazyCapabilities: false,
		permissionGates: true,
		tools: [
			"read",
			"write",
			"task_plan",
			"task_wait",
			"task_status",
			"task_reconcile",
			"task_evidence_restore",
		],
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
		approve: async (_owner, _source, operation) => {
			dialogs.push(operation);
			return true;
		},
		factory: (source) => createProcessPluginRuntime({ ...source, runtimeDirectory }),
		getSessionContext: (id) => service?.getPluginCallerContext(id),
		taskGrants: service.getTaskGrants(),
		questionTransport: () => ({
			ownerId: owner.id,
			send: (request) => {
				const question = request.questions[0];
				questions.push((question.options ?? []).map((o) => o.value));
				const value = answerQuestion(question);
				queueMicrotask(() =>
					service.respondAsk(
						request.id,
						value === undefined
							? { kind: "cancel" }
							: {
									kind: "answer",
									mode: "submit",
									answers: { [question.id ?? "value"]: { values: [value] } },
								},
						owner.id,
					),
				);
				return true;
			},
			resolved: () => {},
		}),
		capabilities: (source) => () => ({
			resources: [],
			handlers: observed(
				{
					...service.getPluginSessionCapabilities(),
					...service.getPluginTaskGrantCapabilities(source),
					...service.getPluginWorkspaceCapabilities(),
				},
				calls,
				hostDelay,
			),
		}),
	});
	const meta = await service.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	const entry = service.registry.get(meta.sessionId);
	const errors = [];
	entry.session.extensionRunner.onError((error) => errors.push(`${error.event}: ${error.error}`));
	const binding = await bridge.bind(plugin.name, owner),
		selection = bridge.selectSession(owner, meta.sessionId);
	const prompt = async (text) => {
		// Commands only resolve when templates expand; the task panel sends them this way.
		await entry.session.prompt(text, { expandPromptTemplates: text.startsWith("/") });
		await entry.session.agent.waitForIdle?.();
		await entry.session.waitForIdle?.();
	};
	const settled = async () => {
		await vi.waitFor(() => expect(entry.session.isStreaming).toBe(false));
		await entry.session.waitForIdle?.();
	};
	const branch = () => entry.session.sessionManager.getBranch();
	return {
		cwd,
		faux,
		errors,
		dialogs,
		questions,
		calls,
		hostDelay,
		prompt,
		settled,
		answer: (fn) => {
			answerQuestion = fn;
		},
		view: () => bridge.invoke(owner, binding, "fixtureView", null, selection),
		status: () => bridge.invoke(owner, binding, "status", null, selection),
		probe: (on) => bridge.invoke(owner, binding, "fixtureProbe", on, selection),
		notices: () =>
			branch()
				.filter((row) => String(row.customType).startsWith("plugin-notice:"))
				.map((row) => row.content),
		continuations: () =>
			entry.session.messages.filter((message) => String(message.customType).startsWith("plugin-continue:")),
	};
}

const plan = (count) =>
	fauxToolCall("task_plan", {
		goal: "Write the staged results",
		summary: "Write one result file per stage",
		writeDirectories: ["outputs"],
		milestones: Array.from({ length: count }, (_, i) => ({
			id: `m${i + 1}`,
			title: `Result ${i + 1}`,
			dependsOn: [],
			acceptance: { kind: "file", path: `outputs/m${i + 1}.txt`, rootKind: "workspace" },
		})),
	});
const writeResult = (n) => fauxToolCall("write", { path: `outputs/m${n}.txt`, content: `result ${n}` });
const stage = (...calls) => fauxAssistantMessage(calls, { stopReason: "toolUse" });

const taskAction = (input) => `/task-action ${Buffer.from(JSON.stringify(input)).toString("base64url")}`;
const CONTINUE = "接着做完剩下的";
const RECHECK = "仅核对已有产物";

/** The offline model: replies from the session it sees, because host-internal model calls share the queue. */
function script(t, { stages, stopAt = stages }) {
	let n = 0,
		planned = false;
	const respond = (context) => {
		if (!getCurrentTools(context.messages || []).some((tool) => tool.name === "task_plan"))
			return fauxAssistantMessage("internal");
		// Only what the model itself did: the host appends context notes after it.
		const last = context.messages.findLast((m) => m.role === "assistant" || m.role === "toolResult");
		if (last?.role === "toolResult") {
			if (last.toolName === "task_plan") return stage(writeResult(++n));
			return fauxAssistantMessage(`stage ${n} done`);
		}
		if (!planned) {
			planned = true;
			return stage(plan(stages));
		}
		if (n < stopAt) return stage(writeResult(++n));
		return fauxAssistantMessage(`stopping after ${n}`);
	};
	t.faux.setResponses(Array.from({ length: 160 }, () => respond));
}
/** Automatic continuations start after the prompt settles, so wait for the session to stay idle. */
const quiet = async (t) => {
	await t.settled();
	await new Promise((done) => setTimeout(done, 300));
	await t.settled();
};
const stoppedTask = async (t) => {
	script(t, { stages: 3, stopAt: 1 });
	await t.prompt("Please write all the staged results");
	await quiet(t);
	const view = await t.view();
	return { taskId: view.tasks[0].id, revision: view.revision };
};

// The managed adapter spends the host's task.continue budget on routine handoffs; the grant asks for 19
// (16 handoffs, as native Pi's LIMITS.autoHandoffs, plus 3 recoveries).
it("one task authorization carries a task through more stages than the recovery budget", async () => {
	const t = await setup();
	script(t, { stages: 6 });
	await t.prompt("Please write all the staged results");
	await quiet(t);
	expect((await t.view()).tasks[0]).toMatchObject({ state: "completed" });
}, 60000);

// Handoff §5.2 item 5: once handoffs run out, the user is asked. The run is still active inside
// agent_end, so the adapter defers the question to agent_settled.
const handoffsExhausted = async () => {
	const t = await setup();
	t.answer(() => CONTINUE);
	script(t, { stages: 20 });
	await t.prompt("Please write all the staged results");
	for (let turn = 0; turn < 14 && !t.questions.length; turn++) {
		await quiet(t);
		await t.prompt("继续");
	}
	await quiet(t);
	return t;
};
it("when automatic handoffs run out, the run's end asks the user whether to go on", async () => {
	const t = await handoffsExhausted();
	expect(t.questions).not.toEqual([]);
}, 120000);
it("the question waits for agent_settled and reaches session.select without errors", async () => {
	const t = await handoffsExhausted();
	expect((await t.view()).tasks[0].budget.autoHandoffs).toBe(16);
	expect(t.calls).toContain("select");
	expect(t.errors).toEqual([]);
}, 120000);

it("the task panel's progress action asks while idle and continues on the user's answer", async () => {
	const t = await setup();
	t.answer(() => CONTINUE);
	const task = await stoppedTask(t);
	const continued = t.continuations().length;
	await t.prompt(taskAction({ action: "progress", ...task }));
	await quiet(t);
	expect(t.questions).toEqual([[expect.any(String), RECHECK, CONTINUE]]);
	expect(t.continuations().length).toBe(continued + 1);
	expect(t.errors).toEqual([]);
}, 60000);

// Regression: progress-action.mjs used to post this status without awaiting it, so the invocation could
// end while the post was in flight. The host refuses it ("caller completed") and the plugin treats that as a
// storage failure. Awaiting the posts took concurrent runs from 6/18 fenced to 0/18; the delay makes it certain.
it("choosing to only re-check posts the status and leaves the task usable", async () => {
	const t = await setup();
	t.answer(() => RECHECK);
	const task = await stoppedTask(t);
	t.hostDelay.ms = 200;
	await t.prompt(taskAction({ action: "progress", ...task }));
	await quiet(t);
	t.hostDelay.ms = 0;
	await t.prompt("任务状态");
	await quiet(t);
	expect((await t.status()).storage).toMatchObject({ state: "durable" });
}, 60000);

it("the task panel's resume action reaches the user: the send-continue card arrives while idle", async () => {
	const t = await setup();
	const task = await stoppedTask(t);
	await t.prompt(taskAction({ action: "resume", ...task }));
	await quiet(t);
	expect(t.notices().at(-1)).toBe("请在对话里发送「继续」，接着做剩下的部分。");
	expect(t.errors).toEqual([]);
}, 60000);

it("host rules at the end of a run: questions work at both boundaries, messages only once settled", async () => {
	const t = await setup();
	t.answer((question) => question.options?.[0]?.value);
	script(t, { stages: 1, stopAt: 0 });
	await t.probe(true);
	await t.prompt("Hello");
	await quiet(t);
	const outcome = (await t.probe(false)).map(({ hook, name, ok }) => `${hook} ${name} ${ok}`);
	expect(outcome).toEqual([
		"agent_end session.select true",
		"agent_end session.notify false",
		"agent_settled session.select true",
		"agent_settled session.notify true",
	]);
}, 60000);
