import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
import { afterEach, expect, it, vi } from "vitest";
import { createProcessPluginRuntime } from "../src/plugins/process-runtime";
import { SessionEngine } from "../src/session-engine/engine";

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const roots = [],
	runtimes = [],
	sessions = [];
afterEach(async () => {
	for (const session of sessions.splice(0)) await new SessionEngine().dispose(session);
	for (const runtime of runtimes.splice(0)) await runtime.dispose();
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(source) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-managed-tools-")));
	roots.push(root);
	const entrypoint = join(root, "runtime.mjs");
	await writeFile(entrypoint, source);
	const runtime = await createProcessPluginRuntime({
		pluginId: "managed-tools",
		packageRoot: root,
		entrypoint,
		runtimeDirectory,
	})({
		applicationId: "managed-tools-test",
		signal: new AbortController().signal,
		resources: [],
		capabilities: {
			call: async () => {
				throw new Error("No capabilities requested");
			},
		},
		events: { changed() {} },
	});
	runtimes.push(runtime);
	return { root, runtime };
}
async function sdk(state, responses) {
	const settingsManager = SettingsManager.inMemory({});
	const resourceLoader = new DefaultResourceLoader({
		cwd: state.root,
		agentDir: state.root,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		extensionFactories: [
			async (pi) => {
				const native = await state.runtime.createNativeSession();
				await native.extension(pi);
				pi.on("session_shutdown", () => native.dispose());
			},
		],
	});
	await resourceLoader.reload({ resolveProjectTrust: async () => true });
	const modelRuntime = await ModelRuntime.create({
		authPath: join(state.root, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const provider = fauxProvider({ provider: "managed-tools-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(provider.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	provider.setResponses(responses);
	const { session } = await createAgentSession({
		cwd: state.root,
		agentDir: state.root,
		settingsManager,
		resourceLoader,
		modelRuntime,
		model: provider.getModel(),
		sessionManager: SessionManager.inMemory(state.root),
	});
	sessions.push(session);
	await session.bindExtensions({});
	return { session, resourceLoader };
}

it("preserves managed SDK declarations and scopes parallel progress to the actual tool calls", async () => {
	const declaration = {
		name: "managed_progress",
		label: "Managed progress",
		description: "Read a synthetic result",
		parameters: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] },
		outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		renderShell: "default",
		promptSnippet: "Read a synthetic managed result",
		promptGuidelines: ["Keep tags isolated"],
		namespace: { name: "managed", description: "Managed fixture", instructions: "Synthetic inputs only" },
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		defaultActive: true,
		exposure: "direct",
		executionMode: "parallel",
	};
	const state = await fixture(
		`export default async()=>({operations:{},async dispose(){},createNativeSession(){return {async dispose(){},extension(pi){pi.registerTool({...${JSON.stringify(declaration)},async execute(id,{tag},signal,update){signal.throwIfAborted();update?.({content:[{type:"text",text:tag+":progress"}],details:{id,tag,pid:process.pid}});await new Promise(resolve=>setTimeout(resolve,20));return {content:[{type:"text",text:tag+":done"}],structuredContent:{value:tag}};}});}};}});`,
	);
	const { session, resourceLoader } = await sdk(state, [
		fauxAssistantMessage([
			fauxToolCall("managed_progress", { tag: "first" }),
			fauxToolCall("managed_progress", { tag: "second" }),
		]),
		fauxAssistantMessage("complete"),
	]);
	expect(resourceLoader.getExtensions().errors).toEqual([]);
	expect(resourceLoader.getExtensions().extensions[0].tools.get(declaration.name).definition).toMatchObject(
		declaration,
	);
	const events = [];
	const unsubscribe = session.subscribe((event) => events.push(event));
	await session.prompt("Run both managed progress tools.");
	await session.waitForIdle();
	unsubscribe();
	const progress = events.filter(
		(event) => event.type === "tool_execution_update" && event.toolName === "managed_progress",
	);
	expect(progress).toHaveLength(2);
	for (const tag of ["first", "second"]) {
		const update = progress.find((event) => event.partialResult.details.tag === tag);
		expect(update.partialResult.content).toEqual([{ type: "text", text: `${tag}:progress` }]);
		expect(update.partialResult.details.id).toBe(update.toolCallId);
		expect(update.partialResult.details.pid).not.toBe(process.pid);
		const result = session.messages.find(
			(message) => message.role === "toolResult" && message.toolCallId === update.toolCallId,
		);
		expect(result).toMatchObject({ isError: false, content: [{ type: "text", text: `${tag}:done` }] });
	}
	// Progress is a live SDK event, never a replacement final result.
	expect(JSON.stringify(session.messages.filter((message) => message.role === "toolResult"))).not.toContain(
		":progress",
	);
}, 20000);

it("gives no update callback without an SDK observer and rejects a callback after its invocation ended", async () => {
	const state = await fixture(
		`export default async()=>{let late;return {operations:{late:{inputSchema:{type:"null"},resultSchema:{type:"string"},effect:"read",execute(){try{late({content:[{type:"text",text:"late"}]});return "unexpected success";}catch(error){return error.message;}}}},async dispose(){},createNativeSession(){return {async dispose(){},extension(pi){pi.registerTool({name:"progress",label:"Progress",description:"Progress",parameters:{type:"object",properties:{}},async execute(id,args,signal,update){late=update;return {content:[{type:"text",text:update?"observer":"no observer"}]};}});}};}};};`,
	);
	const native = await state.runtime.createNativeSession();
	let tool;
	await native.extension({
		registerTool(definition) {
			tool = definition;
		},
		on() {},
	});
	const context = { cwd: state.root, sessionManager: { getSessionId: () => "actual-call" } };
	expect(await tool.execute("one", {}, undefined, undefined, context)).toMatchObject({
		content: [{ type: "text", text: "no observer" }],
	});
	const update = vi.fn();
	expect(await tool.execute("two", {}, undefined, update, context)).toMatchObject({
		content: [{ type: "text", text: "observer" }],
	});
	expect(
		await state.runtime.operations.late.execute(null, {
			scope: { kind: "application" },
			signal: new AbortController().signal,
			capabilities: { call: async () => null },
		}),
	).toContain("no longer active");
	expect(update).not.toHaveBeenCalled();
	await native.dispose();
}, 20000);

it("stops progress when a native call is canceled while another attachment remains usable", async () => {
	const state = await fixture(
		`export default async()=>({operations:{},async dispose(){},createNativeSession(){return {async dispose(){},extension(pi){pi.registerTool({name:"progress",label:"Progress",description:"Cancelable progress",parameters:{type:"object",properties:{}},async execute(id,args,signal,update){update({content:[{type:"text",text:id+":started"}]});if(args.hold){await new Promise(resolve=>signal.addEventListener("abort",resolve,{once:true}));update({content:[{type:"text",text:id+":after-abort"}]});}return {content:[{type:"text",text:id+":done"}]};}});}};}});`,
	);
	const natives = [await state.runtime.createNativeSession(), await state.runtime.createNativeSession()];
	const tools = [];
	for (const native of natives)
		await native.extension({
			registerTool(tool) {
				tools.push(tool);
			},
			on() {},
		});
	const firstUpdates = vi.fn(),
		secondUpdates = vi.fn();
	const controller = new AbortController();
	const ctx = (id) => ({ cwd: state.root, sessionManager: { getSessionId: () => id } });
	const canceled = tools[0]
		.execute("canceled", { hold: true }, controller.signal, firstUpdates, ctx("first"))
		.then(
			() => "unexpected success",
			(error) => error.message,
		);
	await vi.waitFor(() => expect(firstUpdates).toHaveBeenCalledTimes(1));
	controller.abort();
	expect(await canceled).toMatch(/aborted/i);
	expect(firstUpdates).toHaveBeenCalledTimes(1);
	expect(await tools[1].execute("sibling", {}, undefined, secondUpdates, ctx("second"))).toMatchObject({
		content: [{ type: "text", text: "sibling:done" }],
	});
	expect(secondUpdates).toHaveBeenCalledWith({ content: [{ type: "text", text: "sibling:started" }] });
	for (const native of natives) await native.dispose();
}, 20000);

it("reports unsupported managed callbacks during loading and leaves real SDK builtin read usable", async () => {
	for (const field of ["prepareArguments", "prepareLoadout", "renderCall", "renderResult"]) {
		const state = await fixture(
			`export default async()=>({operations:{},async dispose(){},createNativeSession(){return {async dispose(){},extension(pi){pi.registerTool({name:"unsupported",label:"Unsupported",description:"Unsupported callback",parameters:{type:"object",properties:{}},${field}(){return {};},async execute(){throw new Error("must not execute");}});}};}});`,
		);
		const proof = join(state.root, "proof.txt");
		await writeFile(proof, `read survives rejected ${field}`);
		const { session, resourceLoader } = await sdk(state, [
			fauxAssistantMessage(fauxToolCall("read", { path: proof })),
			fauxAssistantMessage("continued"),
		]);
		expect(resourceLoader.getExtensions().errors).toHaveLength(1);
		expect(resourceLoader.getExtensions().errors[0].error).toContain(
			`Unsupported native Pi API: tool unsupported.${field}`,
		);
		await session.prompt("Read proof.txt after the package rejection.");
		await session.waitForIdle();
		expect(
			session.messages.find((message) => message.role === "toolResult" && message.toolName === "read"),
		).toMatchObject({ isError: false, content: [{ type: "text", text: `read survives rejected ${field}` }] });
	}
}, 20000);
