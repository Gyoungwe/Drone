import { mkdirSync, renameSync } from "node:fs";
import {
	access,
	appendFile,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { createBackend } from "../src/create-backend";
import { PluginRuntimeBridge } from "../src/plugins/coordinator";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";

let root, bridge;
const backends = [];
afterEach(async () => {
	if (bridge) await bridge.close();
	bridge = undefined;
	for (const backend of backends.splice(0)) await backend.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (root) await rm(root, { recursive: true, force: true });
});
async function setup({ isolated = false } = {}) {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-session-record-")));
	const cwd = join(root, "project"),
		agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "session-record-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	const makeBackend = () => {
		const backend = createBackend({
			projectTrust: false,
			lazyCapabilities: false,
			desktopIntegration: {
				appendSystemPrompt: [],
				additionalSkillPaths: [],
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
			},
		});
		backend.sessions.modelRuntime = runtime;
		backends.push(backend);
		return backend;
	};
	const backend = makeBackend(),
		service = backend.sessions;
	const meta = await service.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	const entry = service.registry.get(meta.sessionId);
	const sources = new Map();
	const capabilityNames = {
		read: "session.records.read",
		append: "session.records.append",
		notify: "session.notify",
	};
	for (const id of ["record-a", "record-b"]) {
		const packageRoot = join(root, id);
		await mkdir(packageRoot);
		const source = { pluginId: id, packageRoot, entrypoint: join(packageRoot, "client.mjs") };
		sources.set(id, source);
		await writeFile(
			source.entrypoint,
			`export default async()=>({operations:Object.fromEntries(Object.entries(${JSON.stringify(capabilityNames)}).map(([key,name])=>[key,{effect:key==='read'?'read':'write',inputSchema:{},resultSchema:{type:'object'},execute:async(input,ctx)=>ctx.capabilities.call(name,input)}])),dispose:async()=>{}});`,
		);
	}
	let approve = async () => true;
	const approvals = [];
	bridge = new PluginRuntimeBridge({
		source: (name) => sources.get(name),
		enabled: () => true,
		approve: async (...args) => {
			approvals.push(args);
			return approve(...args);
		},
		getSessionContext: (id) => service.getPluginCallerContext(id),
		capabilities: () => ({ handlers: service.getPluginSessionCapabilities(), resources: [] }),
		factory: (source) =>
			isolated
				? createProcessPluginRuntime({
						...source,
						runtimeDirectory: resolve(
							import.meta.dirname,
							`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
						),
					})
				: async () => ({
						operations: Object.fromEntries(
							Object.entries(capabilityNames).map(([key, name]) => [
								key,
								{
									effect: key === "read" ? "read" : "write",
									inputSchema: {},
									resultSchema: { type: "object" },
									execute: async (input, ctx) => ctx.capabilities.call(name, input),
								},
							]),
						),
						dispose: async () => {},
					}),
	});
	const owner = { id: 17, isDestroyed: () => false };
	const bindings = new Map(
		await Promise.all([...sources.keys()].map(async (name) => [name, await bridge.bind(name, owner)])),
	);
	let selection = bridge.selectSession(owner, meta.sessionId);
	const invoke = (name, operation, input, requestId) =>
		bridge.invoke(owner, bindings.get(name), operation, input, selection, requestId);
	const converse = async () => {
		faux.setResponses([fauxAssistantMessage("A real offline conversation.")]);
		await entry.session.prompt("Prepare a real persisted session.");
		await entry.session.waitForIdle();
	};
	return {
		get selection() {
			return selection;
		},
		backend,
		service,
		entry,
		meta,
		sources,
		owner,
		bindings,
		invoke,
		converse,
		faux,
		makeBackend,
		approvals,
		approve: (fn) => {
			approve = fn;
		},
		select: (id) => {
			selection = bridge.selectSession(owner, id);
		},
	};
}
it("latest checkpoints are source-owned, current-branch only and never expose messages or another source's global-tag poison", async () => {
	const { entry, invoke, converse, faux, approvals } = await setup();
	await converse();
	const modelCalls = faux.state.callCount;
	const first = await invoke("record-a", "append", { type: "checkpoint", data: { revision: 1 } });
	expect(first.durability).toBe("durable");
	await invoke("record-a", "append", { type: "checkpoint", data: { revision: 2 } });
	await invoke("record-b", "append", { type: "drone-task-session-v1", data: { poison: true } });
	await invoke("record-b", "append", { type: "checkpoint", data: { revision: 99 } });
	const own = await invoke("record-a", "read", null);
	expect(own).toMatchObject({
		mode: "persistent",
		state: "durable",
		error: null,
		records: [{ type: "checkpoint", data: { revision: 2 } }],
	});
	expect(own.records).toHaveLength(1);
	expect(JSON.stringify(own)).not.toContain("real offline conversation");
	expect(
		entry.session.sessionManager.getBranch().some((row) => row.customType === "drone-task-session-v1"),
	).toBe(false);
	expect(
		entry.session.sessionManager
			.getBranch()
			.filter((row) => row.type === "custom")
			.map((row) => row.customType),
	).toContain("plugin-record:record-b:drone-task-session-v1");
	entry.session.sessionManager.branch(first.id);
	expect((await invoke("record-a", "read", null)).records).toEqual([
		{ id: first.id, type: "checkpoint", data: { revision: 1 } },
	]);
	expect((await invoke("record-b", "read", null)).records).toEqual([]);
	// Own-source checkpoints are bookkeeping (host task grant design): they never prompt.
	expect(approvals.filter((args) => args[2] === "capability:session.records.append")).toHaveLength(0);
	expect(faux.state.callCount).toBe(modelCalls);
});
it("lazy SDK storage explicitly defers without creating a file; idle notifications have no trusted details or model turn", async () => {
	const { entry, invoke, faux } = await setup();
	const file = entry.session.sessionManager.getSessionFile();
	expect(await invoke("record-a", "read", null)).toMatchObject({ mode: "persistent", state: "deferred" });
	await expect(access(file)).rejects.toThrow(/ENOENT/);
	await expect(
		invoke("record-a", "append", { type: "checkpoint", data: { revision: 1 } }),
	).resolves.toMatchObject({ durability: "deferred" });
	await expect(invoke("record-a", "notify", { content: "Ordinary plugin result" })).resolves.toEqual({
		durability: "deferred",
	});
	await expect(access(file)).rejects.toThrow(/ENOENT/);
	const message = entry.session.messages.at(-1);
	expect(message).toMatchObject({
		role: "custom",
		customType: "plugin-notice:record-a",
		content: "Ordinary plugin result",
		display: true,
	});
	expect(message.details).toBeUndefined();
	expect(faux.state.callCount).toBe(0);
});
it("a real SDK inMemory session remains explicitly deferred", async () => {
	const { service, entry, faux } = await setup();
	const { session } = await createAgentSession({
		cwd: entry.cwd,
		model: faux.getModel(),
		modelRuntime: entry.session.modelRuntime,
		settingsManager: entry.session.settingsManager,
		resourceLoader: entry.session.resourceLoader,
		sessionManager: SessionManager.inMemory(entry.cwd),
	});
	const actualEntry = { session, cwd: entry.cwd, unsubscribe: () => {} };
	service.registry.add(actualEntry);
	try {
		const caller = service.getPluginCallerContext(session.sessionId);
		const context = {
			pluginId: "record-a",
			scope: caller.scope,
			sessionIdentity: actualEntry,
			signal: caller.signal,
		};
		await expect(
			service
				.getPluginSessionCapabilities()
				["session.records.append"].execute({ type: "memory", data: 1 }, context),
		).resolves.toMatchObject({ durability: "deferred" });
		expect(session.sessionManager.getSessionFile()).toBeUndefined();
		await expect(
			service.getPluginSessionCapabilities()["session.records.read"].execute(null, context),
		).resolves.toMatchObject({ mode: "memory", state: "deferred", records: [{ type: "memory", data: 1 }] });
	} finally {
		await service.closeSession(session.sessionId);
	}
});
it("real append EISDIR fences all sources and notifications through repeat handler construction and SDK reload; only a fresh disk-backed entry recovers", async () => {
	const { entry, service, invoke, converse, makeBackend } = await setup();
	await converse();
	const beforeCheckpoint = entry.session.sessionManager.getLeafId();
	const saved = await invoke("record-a", "append", { type: "checkpoint", data: { revision: 1 } });
	const file = entry.session.sessionManager.getSessionFile(),
		backup = `${file}.saved`;
	const disk = await readFile(file, "utf8");
	const append = entry.session.sessionManager.appendCustomEntry.bind(entry.session.sessionManager);
	vi.spyOn(entry.session.sessionManager, "appendCustomEntry").mockImplementationOnce((...args) => {
		renameSync(file, backup);
		mkdirSync(file);
		return append(...args);
	});
	await expect(invoke("record-a", "append", { type: "checkpoint", data: { revision: 2 } })).rejects.toThrow(
		/EISDIR/,
	);
	expect(entry.session.sessionManager.getBranch().at(-1).data).toEqual({ revision: 2 });
	await rm(file, { recursive: true });
	await rename(backup, file);
	service.getPluginSessionCapabilities();
	await entry.session.reload();
	await expect(invoke("record-b", "append", { type: "other", data: 3 })).rejects.toThrow(/reopen/);
	await expect(invoke("record-b", "notify", { content: "Must not extend phantom chain" })).rejects.toThrow(
		/reopen/,
	);
	expect(await invoke("record-a", "read", null)).toEqual({
		mode: "persistent",
		state: "needs-reopen",
		error: expect.stringContaining("EISDIR"),
		records: [{ id: saved.id, type: "checkpoint", data: { revision: 1 } }],
	});
	entry.session.sessionManager.branch(beforeCheckpoint);
	expect(await invoke("record-a", "read", null)).toMatchObject({ state: "needs-reopen", records: [] });
	entry.session.sessionManager.branch(saved.id);
	expect(await readFile(file, "utf8")).toBe(disk);
	const actualDisk = SessionManager.open(file);
	expect(actualDisk.getBranch().at(-1).id).toBe(saved.id);
	const reopened = makeBackend().sessions;
	const meta = await reopened.openSession(file);
	const actualEntry = reopened.registry.get(meta.sessionId);
	const handlers = reopened.getPluginSessionCapabilities();
	const result = await handlers["session.records.read"].execute(null, {
		pluginId: "record-a",
		scope: reopened.getPluginCallerContext(meta.sessionId).scope,
		sessionIdentity: actualEntry,
		signal: new AbortController().signal,
	});
	expect(result).toEqual({
		mode: "persistent",
		state: "durable",
		error: null,
		records: [{ id: saved.id, type: "checkpoint", data: { revision: 1 } }],
	});
});
it("approval cancellation, readonly/untrusted and application callers cannot append; active notify rejects without poisoning a healthy entry", async () => {
	const state = await setup();
	const { service, entry, invoke, converse, approve, owner, bindings, select, meta, faux } = state;
	await converse();
	let release;
	// Appends do not prompt; cancel while the surrounding write operation awaits its approval.
	approve(async (_owner, _source, operation) =>
		operation === "append"
			? new Promise((resolve) => {
					release = resolve;
				})
			: true,
	);
	const pending = invoke("record-a", "append", { type: "checkpoint", data: 1 }, "cancel-write").catch(
		(error) => error,
	);
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	// This is the real coordinator cancellation path, not a fabricated SDK signal.
	const cancelling = bridge.cancel(owner, bindings.get("record-a"), state.selection, "cancel-write");
	release(true);
	await expect(cancelling).resolves.toBe(true);
	select(null);
	expect(await pending).toBeInstanceOf(Error);
	select(meta.sessionId);
	approve(async () => true);
	entry.readOnly = true;
	await expect(invoke("record-a", "append", { type: "checkpoint", data: 2 })).rejects.toThrow();
	entry.readOnly = false;
	entry.session.settingsManager.setProjectTrusted(false);
	await expect(invoke("record-a", "append", { type: "checkpoint", data: 2 })).rejects.toThrow();
	entry.session.settingsManager.setProjectTrusted(true);
	select(null);
	await expect(invoke("record-a", "read", null)).rejects.toThrow(/selected live session/);
	select(meta.sessionId);
	let unblock;
	const held = new Promise((resolve) => {
		unblock = resolve;
	});
	faux.setResponses([
		async () => {
			await held;
			return fauxAssistantMessage("Released actual turn.");
		},
	]);
	await service.prompt(meta.sessionId, "Hold this actual model turn.");
	await vi.waitFor(() => expect(entry.session.isStreaming).toBe(true));
	try {
		await expect(invoke("record-a", "notify", { content: "Not queued" })).rejects.toThrow(/idle/);
	} finally {
		unblock();
	}
	await entry.session.waitForIdle();
	await expect(invoke("record-a", "append", { type: "checkpoint", data: 3 })).resolves.toMatchObject({
		durability: "durable",
	});
	expect((await invoke("record-a", "read", null)).records.map((value) => value.data)).toEqual([3]);
});
it("production restricted worker round-trips the same real SDK checkpoint and idle notice", async () => {
	const { entry, invoke, converse, faux } = await setup({ isolated: true });
	await converse();
	const modelCalls = faux.state.callCount;
	await expect(
		invoke("record-a", "append", { type: "worker", data: { saved: true } }),
	).resolves.toMatchObject({ durability: "durable" });
	expect((await invoke("record-a", "read", null)).records).toMatchObject([
		{ type: "worker", data: { saved: true } },
	]);
	await expect(invoke("record-a", "notify", { content: "Actual worker result" })).resolves.toEqual({
		durability: "durable",
	});
	expect(entry.session.messages.at(-1).content).toBe("Actual worker result");
	expect(faux.state.callCount).toBe(modelCalls);
});

it("malformed real SDK JSONL reports only a line number, never the assistant content quoted by JSON.parse", async () => {
	const { entry, invoke, converse } = await setup();
	await converse();
	const saved = await invoke("record-a", "append", { type: "checkpoint", data: { revision: 1 } });
	const file = entry.session.sessionManager.getSessionFile();
	await appendFile(
		file,
		'{"type":"message","message":{"role":"assistant","content":"PRIVATE_ASSISTANT_SYNTAX_FRAGMENT"}BROKEN\n',
	);
	const read = await invoke("record-a", "read", null);
	expect(read).toEqual({
		mode: "persistent",
		state: "needs-reopen",
		error: expect.stringMatching(/^Invalid SDK session JSONL at line \d+$/),
		records: [{ id: saved.id, type: "checkpoint", data: { revision: 1 } }],
	});
	expect(JSON.stringify(read)).not.toContain("PRIVATE_ASSISTANT_SYNTAX_FRAGMENT");
	await expect(invoke("record-a", "append", { type: "checkpoint", data: 2 })).rejects.toThrow(
		/^Session records need disk reopen: Invalid SDK session JSONL at line \d+$/,
	);
});
