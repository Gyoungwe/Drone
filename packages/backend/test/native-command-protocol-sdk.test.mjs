import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const fixtures = [];
afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		await fixture.backend.dispose();
		await fixture.bridge.close();
		await rm(fixture.root, { recursive: true, force: true });
	}
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
const source = `export default async({capabilities}) => {
 const records=[];
 const record=async(input,ctx)=>{
  const scope=await capabilities.call("scope",null);
  const inspection=await capabilities.call("session.inspect",null);
  records.push({input,cwd:ctx.cwd,id:ctx.sessionManager.getSessionId(),scope,inspection,pid:process.pid,hasUI:ctx.hasUI});
 };
 return {operations:{snapshot:{inputSchema:{type:"null"},resultSchema:{type:"array"},effect:"read",execute:async()=>records}},
 async dispose(){},createNativeSession(){return {commandEffects:{record:"read",read_write:"read",hold:"read",unsupported:"read",failure:"read"},async dispose(){},extension(pi){
  pi.registerCommand("record",{description:"Read the exact current command scope",handler:record});
  pi.registerCommand("write",{description:"Unknown command effect requires approval",handler:async(args)=>{await capabilities.call("write",args);}});
  pi.registerCommand("read_write",{handler:async(args)=>{await capabilities.call("write",args);}});
  pi.registerCommand("failure",{handler:async()=>{throw new Error("Managed command failed");}});
  pi.registerCommand("unsupported",{handler:async(args,ctx)=>{ctx[args]();}});
  pi.registerCommand("hold",{handler:async(args,ctx)=>{
   await capabilities.call("entered",args);ctx.signal.throwIfAborted();
   await new Promise(resolve=>ctx.signal.addEventListener("abort",resolve,{once:true}));
   let lateDenied=false;try{await capabilities.call("write","late:"+args);}catch{lateDenied=true;}
   records.push({cancelled:args,lateDenied,aborted:ctx.signal.aborted});
  }});
 }};}};
};`;
async function setup(commandSource = source, nativeName = "command-ui") {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-managed-command-")));
	const pkg = join(root, "package"),
		agentDir = join(root, "agent");
	await mkdir(pkg);
	await mkdir(agentDir);
	const entrypoint = join(pkg, "owner.mjs"),
		nativeEntrypoint = join(pkg, "native.mjs");
	await writeFile(entrypoint, commandSource);
	await writeFile(
		nativeEntrypoint,
		'throw new Error("The managed package must never import into the host");',
	);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "managed-command-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	let backend,
		enabled = true,
		allowWrite = true;
	const entered = [],
		writes = [],
		approve = vi.fn(async (_owner, _source, operation) => !operation || allowWrite);
	const definition = { pluginId: "managed-commands", packageRoot: pkg, entrypoint, nativeEntrypoint };
	const bridge = new PluginRuntimeBridge({
		source: () => definition,
		enabled: () => enabled,
		approve,
		factory: () => createProcessPluginRuntime({ ...definition, runtimeDirectory }),
		getSessionContext: (id) => backend.sessions.getPluginCallerContext(id),
		capabilities: () => ({
			resources: [],
			handlers: {
				...backend.sessions.getPluginSessionCapabilities(),
				scope: {
					inputSchema: { type: "null" },
					resultSchema: { type: "object" },
					effect: "read",
					execute: async (_input, ctx) => ctx.scope,
				},
				write: {
					inputSchema: { type: "string" },
					resultSchema: { type: "null" },
					effect: "write",
					execute: async (input, ctx) => {
						writes.push({ input, scope: ctx.scope });
						return null;
					},
				},
				entered: {
					inputSchema: { type: "string" },
					resultSchema: { type: "null" },
					effect: "read",
					execute: async (input) => {
						entered.push(input);
						return null;
					},
				},
			},
		}),
	});
	const window = { id: 101, isDestroyed: () => false };
	backend = createBackend({
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
					bridge.beginNative(window, (path) => (path === nativeEntrypoint ? nativeName : undefined)),
			},
		},
	});
	backend.sessions.modelRuntime = runtime;
	const state = {
		root,
		backend,
		bridge,
		faux,
		entered,
		writes,
		approve,
		setAllow: (value) => {
			allowWrite = value;
		},
		setEnabled: (value) => {
			enabled = value;
		},
		window,
	};
	fixtures.push(state);
	const create = async (name) => {
		const cwd = join(root, name);
		await mkdir(cwd);
		await writeFile(join(cwd, "source.txt"), "basic read survives");
		const meta = await backend.sessions.createSession({
			cwd,
			provider: faux.provider.id,
			modelId: faux.getModel().id,
		});
		return backend.sessions.registry.get(meta.sessionId).session;
	};
	state.create = create;
	state.first = await create("one");
	state.selection = bridge.selectSession(window, state.first.sessionId);
	state.token = await bridge.bind("command-ui", window);
	state.snapshot = () => bridge.invoke(window, state.token, "snapshot", null, state.selection);
	return state;
}
it("registers standard command metadata and binds the shared owner to two real SDK sessions", async () => {
	const state = await setup();
	const { backend, first, faux } = state;
	const second = await state.create("two");
	expect(first.extensionRunner.getCommand("record")).toMatchObject({
		description: "Read the exact current command scope",
	});
	await expect(backend.sessions.command(first.sessionId, "record", "first")).resolves.toEqual({
		kind: "command",
	});
	await backend.sessions.command(second.sessionId, "record", "second");
	const records = await state.snapshot();
	expect(records).toHaveLength(2);
	expect(records[0].pid).not.toBe(process.pid);
	expect(records[1].pid).toBe(records[0].pid);
	for (const [index, session] of [first, second].entries())
		expect(records[index]).toMatchObject({
			id: session.sessionId,
			cwd: session.sessionManager.getCwd(),
			scope: {
				kind: "session",
				sessionId: session.sessionId,
				workspaceDirectory: session.sessionManager.getCwd(),
			},
			inspection: { agentActive: false },
			hasUI: false,
		});
	// A typed native command keeps the SDK's official dispatch behavior.
	await first.prompt("/record typed");
	expect((await state.snapshot()).at(-1).input).toBe("typed");
	expect(faux.state.callCount).toBe(0);
}, 20000);
it("requires write approval for an undeclared effect and never upgrades a read command's capability authority", async () => {
	const state = await setup();
	const { backend, first } = state;
	state.setAllow(false);
	await expect(backend.sessions.command(first.sessionId, "write", "denied")).rejects.toThrow("denied");
	expect(state.writes).toEqual([]);
	state.setAllow(true);
	await backend.sessions.command(first.sessionId, "write", "accepted");
	expect(state.writes).toMatchObject([{ input: "accepted", scope: { sessionId: first.sessionId } }]);
	await expect(backend.sessions.command(first.sessionId, "read_write", "escalation")).rejects.toThrow(
		"Read-only plugin invocation",
	);
	expect(state.writes).toHaveLength(1);
	const operations = state.approve.mock.calls.map((call) => call[2]);
	expect(operations).toContain("native:command:write");
	expect(operations).toContain("capability:write");
}, 20000);
it("rejects unsupported contexts and handler failures once while actual SDK read remains usable", async () => {
	const state = await setup();
	const { backend, first, faux } = state;
	const errors = [];
	const stop = first.extensionRunner.onError((error) => errors.push(error));
	await expect(backend.sessions.command(first.sessionId, "failure")).rejects.toThrow(
		"Managed command failed",
	);
	expect(errors.filter((error) => error.error === "Managed command failed")).toHaveLength(1);
	await first.prompt("/failure");
	expect(errors.filter((error) => error.error === "Managed command failed")).toHaveLength(2);
	expect(faux.state.callCount).toBe(0);
	for (const method of ["isIdle", "waitForIdle", "newSession"])
		await expect(backend.sessions.command(first.sessionId, "unsupported", method)).rejects.toThrow(
			"Unsupported native Pi context: " + method,
		);
	stop();
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("read", { path: "source.txt" }), { stopReason: "toolUse" }),
		fauxAssistantMessage("Read complete"),
	]);
	await first.prompt("Read source.txt");
	await first.waitForIdle();
	expect(
		first.messages.findLast((message) => message.role === "toolResult" && message.toolName === "read"),
	).toMatchObject({ isError: false, content: [{ type: "text", text: "basic read survives" }] });
}, 20000);
it("cancels only the actual command and drains it before session close or plugin stop", async () => {
	const state = await setup();
	const { backend, first } = state;
	const second = await state.create("two");
	const a = backend.sessions.command(first.sessionId, "hold", "a").catch((error) => error);
	const b = backend.sessions.command(second.sessionId, "hold", "b").catch((error) => error);
	await vi.waitFor(() => expect(state.entered).toEqual(["a", "b"]));
	await backend.sessions.abort(first.sessionId);
	expect(await a).toBeInstanceOf(Error);
	expect(await state.snapshot()).toContainEqual({ cancelled: "a", lateDenied: true, aborted: true });
	await backend.sessions.closeSession(second.sessionId);
	expect(await b).toBeInstanceOf(Error);
	await backend.sessions.command(first.sessionId, "record", "still active");
	expect(state.writes).toEqual([]);
	const oldPid = (await state.snapshot()).find((record) => record.pid).pid;
	const c = backend.sessions.command(first.sessionId, "hold", "stop").catch((error) => error);
	await vi.waitFor(() => expect(state.entered).toContain("stop"));
	state.setEnabled(false);
	await state.bridge.revoke("command-ui");
	expect(await c).toBeInstanceOf(Error);
	await expect(backend.sessions.command(first.sessionId, "record", "stale")).rejects.toThrow();
	expect(state.writes).toEqual([]);
	expect(() => process.kill(oldPid, 0)).toThrow();
	state.setEnabled(true);
	await first.reload();
	await backend.sessions.command(first.sessionId, "record", "restored");
	state.selection = state.bridge.selectSession(state.window, first.sessionId);
	state.token = await state.bridge.bind("command-ui", state.window);
	const restored = await state.snapshot();
	expect(restored).toHaveLength(1);
	expect(restored[0]).toMatchObject({ input: "restored", id: first.sessionId });
	expect(restored[0].pid).not.toBe(oldPid);
}, 20000);
it.each([
	[
		"duplicate",
		'pi.registerCommand("same",{handler:async()=>{}});pi.registerCommand("same",{handler:async()=>{}});',
		"Duplicate native command",
	],
	[
		"completion",
		'pi.registerCommand("completion",{handler:async()=>{},getArgumentCompletions:()=>[]});',
		"getArgumentCompletions",
	],
])(
	"rejects unsupported registration (%s) without losing basic read",
	async (_name, registration, error) => {
		const state = await setup(
			`export default async()=>({operations:{},async dispose(){},createNativeSession(){return {async dispose(){},extension(pi){${registration}}};}});`,
		);
		expect(state.first.extensionRunner.getCommand("same")).toBeUndefined();
		expect(JSON.stringify(state.first.resourceLoader.getExtensions().errors)).toContain(error);
		state.faux.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { path: "source.txt" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Read complete"),
		]);
		await state.first.prompt("Read source.txt");
		await state.first.waitForIdle();
		expect(
			state.first.messages.findLast((message) => message.role === "toolResult" && message.toolName === "read")
				.isError,
		).toBe(false);
	},
	20000,
);

it("cancels a pending command approval before a late grant and never executes its write", async () => {
	const state = await setup();
	let grant;
	const approval = new Promise((resolve) => {
		grant = resolve;
	});
	state.approve.mockImplementation(async (_owner, _source, operation) =>
		operation === "native:command:write" ? approval : true,
	);
	const rejected = state.backend.sessions
		.command(state.first.sessionId, "write", "late-approval")
		.catch((error) => error);
	await vi.waitFor(() =>
		expect(state.approve.mock.calls.some((call) => call[2] === "native:command:write")).toBe(true),
	);
	await state.backend.sessions.abort(state.first.sessionId);
	expect(await rejected).toBeInstanceOf(Error);
	grant(true);
	await state.backend.sessions.command(state.first.sessionId, "record", "after cancel");
	expect(state.writes).toEqual([]);
	expect((await state.snapshot()).at(-1).input).toBe("after cancel");
}, 20000);

it("revoking a managed native source aborts its actual SDK model run before revoke finishes", async () => {
	const state = await setup();
	let entered, observedAbort;
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	const aborted = new Promise((resolve) => {
		observedAbort = resolve;
	});
	state.faux.setResponses([
		async (_context, options) => {
			entered();
			await new Promise((resolve) => options.signal.addEventListener("abort", resolve, { once: true }));
			observedAbort();
			return fauxAssistantMessage("", { stopReason: "aborted" });
		},
	]);
	const prompt = state.first.prompt("Synthetic model waiting during package disable.");
	await started;
	state.setEnabled(false);
	const revoke = state.bridge.revoke("command-ui");
	await Promise.race([
		aborted,
		revoke.then(() => {
			throw new Error("Source revoke finished without aborting its actual SDK run");
		}),
	]);
	await Promise.all([prompt, revoke]);
	expect(state.first.isStreaming).toBe(false);
	state.setEnabled(true);
	await state.first.reload();
	state.faux.setResponses([fauxAssistantMessage("new source run")]);
	await state.first.prompt("Synthetic new run after completed source drain.");
	expect(state.first.isStreaming).toBe(false);
}, 20000);

it("a UI-only transition drains window callers while the actual native SDK run and owner continue", async () => {
	const state = await setup();
	await state.backend.sessions.command(state.first.sessionId, "record", "before UI transition");
	const pid = (await state.snapshot())[0].pid;
	let entered, release;
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	const held = new Promise((resolve) => {
		release = resolve;
	});
	let modelAborted = false;
	state.faux.setResponses([
		async (_context, options) => {
			options.signal.addEventListener(
				"abort",
				() => {
					modelAborted = true;
					release();
				},
				{ once: true },
			);
			entered();
			await held;
			return fauxAssistantMessage("ordinary model result after UI transition");
		},
	]);
	const prompt = state.first.prompt("Synthetic active model during UI settings change.");
	await started;
	try {
		await state.bridge.withUiTransition(async () => {
			expect(state.first.isStreaming).toBe(true);
			await state.backend.sessions.command(state.first.sessionId, "record", "during UI transition");
		});
		expect(modelAborted).toBe(false);
		expect(state.first.isStreaming).toBe(true);
		await expect(state.snapshot()).rejects.toThrow("binding is invalid");
		state.selection = state.bridge.selectSession(state.window, state.first.sessionId);
		state.token = await state.bridge.bind("command-ui", state.window);
		const records = await state.snapshot();
		expect(records.map((record) => record.input)).toEqual(["before UI transition", "during UI transition"]);
		expect(records.every((record) => record.pid === pid)).toBe(true);
	} finally {
		release();
		await prompt;
	}
}, 20000);

it("keeps a source teardown barrier after actual SDK abort receipt failure even when domain cleanup succeeds", async () => {
	const state = await setup(source, "package-native-alias");
	await state.backend.sessions.command(state.first.sessionId, "record", "before failed teardown");
	const pid = (await state.snapshot())[0].pid;
	const actualAbort = state.first.abort.bind(state.first);
	let aborted = false;
	state.first.abort = async () => {
		await actualAbort();
		aborted = true;
		throw new Error("Injected SDK abort receipt failure after real cleanup");
	};
	try {
		state.setEnabled(false);
		await expect(state.bridge.revoke()).rejects.toThrow("disposal failed");
		expect(aborted).toBe(true);
		expect(() => process.kill(pid, 0)).toThrow(); // Real domain worker cleanup completed successfully.
		state.setEnabled(true);
		const transition = await state.bridge.withTransition(async () => "opened").catch(() => "blocked");
		const rebind = await state.bridge.bind("command-ui", state.window).then(
			() => "opened",
			() => "blocked",
		);
		expect({ transition, rebind }).toEqual({ transition: "blocked", rebind: "blocked" });
	} finally {
		state.first.abort = actualAbort;
		fixtures.splice(fixtures.indexOf(state), 1);
		// The deliberately failed receipt stays failed; shutdown still drains all actual resources.
		await Promise.allSettled([state.backend.dispose(), state.bridge.close()]);
		await rm(state.root, { recursive: true, force: true });
	}
}, 20000);
