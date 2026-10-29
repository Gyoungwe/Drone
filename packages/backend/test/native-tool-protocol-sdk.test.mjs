import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
async function fixture(
	source,
	call = async () => {
		throw new Error("No capabilities requested");
	},
) {
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
		capabilities: { call },
		events: { changed() {} },
	});
	runtimes.push(runtime);
	return { root, runtime };
}
async function sdk(state, responses) {
	let native;
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
				native = await state.runtime.createNativeSession();
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
	return { session, resourceLoader, provider, native };
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

it("chains managed input, tool argument mutation, and turn hooks through the actual SDK", async () => {
	const output = "managed-rewritten.txt";
	const state =
		await fixture(`export default async()=>{const timeline=[];return {operations:{timeline:{inputSchema:{type:"null"},resultSchema:{type:"array"},effect:"read",async execute(){return timeline;}}},async dispose(){},createNativeSession(){return {eventEffects:{input:"read",tool_call:"read",turn_start:"read",turn_end:"read"},async dispose(){},extension(pi){
 pi.on("input",event=>{timeline.push(["input-first",event.text]);return event.text==="handled"?{action:"handled"}:{action:"transform",text:"managed "+event.text};});
 pi.on("input",event=>{timeline.push(["input-second",event.text]);return {action:"continue"};});
 pi.on("tool_call",event=>{if(event.toolName==="write"){event.input.path=${JSON.stringify(output)};event.input.content="first";timeline.push(["call-first",event.input.content]);}});
 pi.on("tool_call",event=>{if(event.toolName==="write"){if(event.input.content!=="first")throw new Error("tool argument chain lost");event.input.content="last";timeline.push(["call-second",event.input.content]);}});
 pi.on("turn_start",event=>{timeline.push(["turn-start",event.turnIndex]);});
 pi.on("turn_end",event=>{timeline.push(["turn-end",event.turnIndex]);return {};});
 }};}};};`);
	const { session, provider, resourceLoader } = await sdk(state, [
		fauxAssistantMessage(fauxToolCall("write", { path: "must-not-write.txt", content: "original" })),
		fauxAssistantMessage("done"),
	]);
	expect(resourceLoader.getExtensions().errors).toEqual([]);
	const diagnostic = [];
	session.subscribe((event) => {
		if (event.type === "extension_error") diagnostic.push(event);
	});
	await session.prompt("original");
	await session.waitForIdle();
	expect(await readFile(join(state.root, output), "utf8")).toBe("last");
	await expect(access(join(state.root, "must-not-write.txt"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(session.messages.find((message) => message.role === "user").content).toEqual([
		{ type: "text", text: "managed original" },
	]);
	const readTimeline = () =>
		state.runtime.operations.timeline.execute(null, {
			scope: { kind: "application" },
			signal: new AbortController().signal,
			capabilities: { call: async () => null },
		});
	expect(await readTimeline()).toEqual([
		["input-first", "original"],
		["input-second", "managed original"],
		["turn-start", 0],
		["call-first", "first"],
		["call-second", "last"],
		["turn-end", 0],
		["turn-start", 1],
		["turn-end", 1],
	]);
	const before = session.messages.length;
	const stream = vi.spyOn(provider.provider, "stream");
	await session.prompt("handled");
	await session.waitForIdle();
	expect(stream).not.toHaveBeenCalled();
	expect(session.messages).toHaveLength(before);
	expect((await readTimeline()).at(-1)).toEqual(["input-first", "handled"]);
	expect(diagnostic).toEqual([]);
}, 20000);

it("honors a managed tool block and chains a real turn_end continuation flag without drafts", async () => {
	const state = await fixture(
		`export default async()=>({operations:{},async dispose(){},createNativeSession(){return {eventEffects:{tool_call:"read",turn_end:"read"},async dispose(){},extension(pi){pi.on("tool_call",event=>event.toolName==="write"?{block:true,reason:"actual managed policy",terminate:false}:undefined);pi.on("turn_end",event=>event.turnIndex===0?{continue:true}:{});pi.on("turn_end",event=>{if(event.turnIndex===0&&event.continue!==true)throw new Error("boundary continuation chain lost");});}};}});`,
	);
	const { session, resourceLoader } = await sdk(state, [
		fauxAssistantMessage(fauxToolCall("write", { path: "blocked.txt", content: "must never appear" })),
		fauxAssistantMessage("first final"),
	]);
	expect(resourceLoader.getExtensions().errors).toEqual([]);
	await session.prompt("blocked write then finish");
	await session.waitForIdle();
	await expect(access(join(state.root, "blocked.txt"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
		isError: true,
		content: [{ type: "text", text: "actual managed policy" }],
	});
	expect(session.messages.filter((message) => message.role === "assistant").at(-1).content).toEqual([
		{ type: "text", text: "first final" },
	]);
}, 20000);

it("discards a late input transform when its actual native attachment is revoked", async () => {
	let entered;
	const ready = new Promise((resolve) => {
		entered = resolve;
	});
	const state = await fixture(
		`export default async({capabilities})=>({operations:{},async dispose(){},createNativeSession(){return {eventEffects:{input:"read"},async dispose(){},extension(pi){pi.on("input",async(event,ctx)=>{await capabilities.call("entered",null);await new Promise(resolve=>ctx.signal.addEventListener("abort",resolve,{once:true}));return {action:"transform",text:"late forbidden transform"};});}};}});`,
		async (name) => {
			expect(name).toBe("entered");
			entered();
			return null;
		},
	);
	const { session, native, resourceLoader } = await sdk(state, [fauxAssistantMessage("after revoked hook")]);
	expect(resourceLoader.getExtensions().errors).toEqual([]);
	const errors = [];
	const stop = session.extensionRunner.onError((error) => errors.push(error));
	const prompt = session.prompt("original survives");
	await ready;
	await native.dispose();
	await prompt;
	await session.waitForIdle();
	expect(session.messages.find((message) => message.role === "user").content).toEqual([
		{ type: "text", text: "original survives" },
	]);
	expect(errors).toHaveLength(1);
	expect(errors[0]).toMatchObject({ event: "input" });
	stop();
}, 20000);

it("drops canceled tool mutations while a second real session in the same worker remains usable", async () => {
	let entered;
	const ready = new Promise((resolve) => {
		entered = resolve;
	});
	const state = await fixture(
		`export default async({capabilities})=>({operations:{},async dispose(){},createNativeSession(){return {eventEffects:{tool_call:"read"},async dispose(){},extension(pi){pi.on("tool_call",async(event,ctx)=>{if(event.toolName!=="write"||event.input.path!=="cancelled.txt")return;await capabilities.call("entered",null);await new Promise(resolve=>ctx.signal.addEventListener("abort",resolve,{once:true}));event.input.path="late.txt";event.input.content="late forbidden write";});}};}});`,
		async (name) => {
			expect(name).toBe("entered");
			entered();
			return null;
		},
	);
	const first = await sdk(state, [
		fauxAssistantMessage(fauxToolCall("write", { path: "cancelled.txt", content: "original" })),
	]);
	const second = await sdk(state, [
		fauxAssistantMessage(fauxToolCall("write", { path: "sibling.txt", content: "sibling survives" })),
		fauxAssistantMessage("done"),
	]);
	const pending = first.session.prompt("cancel this write");
	await ready;
	await first.session.abort();
	await pending;
	await first.session.waitForIdle();
	const call = first.session.messages
		.flatMap((message) => (message.role === "assistant" ? message.content : []))
		.find((block) => block.type === "toolCall");
	expect(call.arguments).toEqual({ path: "cancelled.txt", content: "original" });
	await expect(access(join(state.root, "cancelled.txt"))).rejects.toMatchObject({ code: "ENOENT" });
	await expect(access(join(state.root, "late.txt"))).rejects.toMatchObject({ code: "ENOENT" });
	await second.session.prompt("write sibling file");
	await second.session.waitForIdle();
	expect(await readFile(join(state.root, "sibling.txt"), "utf8")).toBe("sibling survives");
}, 20000);

it("reports a managed input handler failure once and leaves the real SDK read tool usable", async () => {
	const state = await fixture(
		`export default async()=>({operations:{},async dispose(){},createNativeSession(){return {eventEffects:{input:"read"},async dispose(){},extension(pi){pi.on("input",()=>{throw new Error("managed input failure");});}};}});`,
	);
	await writeFile(join(state.root, "source.txt"), "real read survives input error");
	const { session } = await sdk(state, [
		fauxAssistantMessage(fauxToolCall("read", { path: "source.txt" })),
		fauxAssistantMessage("done"),
	]);
	const errors = [];
	const stop = session.extensionRunner.onError((error) => errors.push(error));
	await session.prompt("read source after error");
	await session.waitForIdle();
	expect(errors).toHaveLength(1);
	expect(errors[0]).toMatchObject({ event: "input", error: "managed input failure" });
	expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
		isError: false,
		content: [{ type: "text", text: "real read survives input error" }],
	});
	stop();
}, 20000);

it.each(["return", "in-place"])(
	"rejects %s turn_end drafts before they can bypass source-owned record persistence",
	async (kind) => {
		const draft = {
			type: "custom",
			customType: "plugin-record:another-source:forged",
			data: { approved: true },
		};
		const mutation =
			kind === "return"
				? `return {entries:[${JSON.stringify(draft)}]};`
				: `event.entries.push(${JSON.stringify(draft)});`;
		const state = await fixture(
			`export default async()=>({operations:{},async dispose(){},createNativeSession(){return {eventEffects:{turn_end:"read"},async dispose(){},extension(pi){pi.on("turn_end",event=>{${mutation}});}};}});`,
		);
		const { session } = await sdk(state, [fauxAssistantMessage("ordinary answer")]);
		const errors = [];
		const stop = session.extensionRunner.onError((error) => errors.push(error));
		await session.prompt("ordinary request");
		await session.waitForIdle();
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({
			event: "turn_end",
			error: "Unsupported native turn_end boundary drafts",
		});
		expect(
			session.sessionManager.getBranch().filter((entry) => entry.customType === draft.customType),
		).toEqual([]);
		expect(session.messages.filter((message) => message.role === "assistant").at(-1).content).toEqual([
			{ type: "text", text: "ordinary answer" },
		]);
		stop();
	},
	20000,
);
