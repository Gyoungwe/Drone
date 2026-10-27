import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
import { PluginSandboxSession } from "../src/plugin-sandbox";
import { SessionEngine } from "../src/session-engine/engine";
import { sandboxExtensionFactory } from "../src/session-engine/sandbox-loader";

const runtimeDirectory = resolve(
	import.meta.dirname,
	`../../desktop/plugin-runtime/${process.platform}-${process.arch}`,
);
const roots = [];
const sessions = [];
const getters = [
	"getActiveTools",
	"getAllTools",
	"getCommands",
	"getMcpServers",
	"getFlag",
	"getSessionName",
];
const callbacks = ["prepareArguments", "prepareLoadout", "renderCall", "renderResult"];

afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => new SessionEngine().dispose(session)));
	vi.restoreAllMocks();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(packages) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-sandbox-api-sdk-")));
	roots.push(root);
	const paths = [];
	for (const [name, source] of Object.entries(packages)) {
		const path = join(root, "packages", name);
		await mkdir(path, { recursive: true });
		await writeFile(
			join(path, "package.json"),
			JSON.stringify({ name, version: "1.0.0", type: "module", pi: { extensions: ["./index.mjs"] } }),
		);
		await writeFile(join(path, "index.mjs"), source);
		paths.push(path);
	}
	const settingsManager = SettingsManager.inMemory({});
	const agentDir = join(root, "agent");
	await mkdir(agentDir);
	const resourceLoader = new DefaultResourceLoader({
		cwd: root,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		additionalExtensionPaths: paths,
		extensionFactoryForPath: sandboxExtensionFactory(runtimeDirectory, [], root),
	});
	await resourceLoader.reload({ resolveProjectTrust: async () => true });
	return { root, agentDir, settingsManager, resourceLoader };
}

async function runSession(workspace, responses, onEvent) {
	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace.agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({ provider: "sandbox-api-offline", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(faux.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	faux.setResponses(responses);
	const { session } = await createAgentSession({
		cwd: workspace.root,
		agentDir: workspace.agentDir,
		settingsManager: workspace.settingsManager,
		resourceLoader: workspace.resourceLoader,
		modelRuntime,
		model: faux.getModel(),
		sessionManager: SessionManager.inMemory(workspace.root),
	});
	sessions.push(session);
	if (onEvent) session.subscribe(onEvent);
	await session.bindExtensions({ uiContext: { confirm: async () => true } });
	await session.prompt("Run the synthetic sandbox checks and then read the local proof.");
	await session.waitForIdle();
	return session;
}

it("returns explicit getter errors through a real SDK tool loop and keeps builtin read usable", async () => {
	const state = await workspace({
		"third-party-getters": `export default pi => pi.registerTool({name:"getter_probe",label:"Getter probe",description:"Exercise unavailable synchronous APIs",parameters:{type:"object",properties:{method:{type:"string"}},required:["method"]},async execute(_id,args){const value=pi[args.method]("example");return {content:[{type:"text",text:JSON.stringify(value) ?? "undefined"}]};}});`,
	});
	expect(state.resourceLoader.getExtensions().errors).toEqual([]);
	const proof = join(state.root, "proof.txt");
	await writeFile(proof, "builtin read survives sandbox getter errors");
	const session = await runSession(state, [
		...getters.map((method) => fauxAssistantMessage(fauxToolCall("getter_probe", { method }))),
		fauxAssistantMessage(fauxToolCall("read", { path: proof })),
		fauxAssistantMessage("continued"),
	]);
	const errors = session.messages.filter(
		(message) => message.role === "toolResult" && message.toolName === "getter_probe",
	);
	expect(errors).toHaveLength(getters.length);
	for (const [index, method] of getters.entries()) {
		expect(errors[index].isError).toBe(true);
		expect(errors[index].content).toEqual([
			{
				type: "text",
				text: expect.stringContaining(`Process-sandbox extension API is not supported: ${method}`),
			},
		]);
	}
	const read = session.messages.find(
		(message) => message.role === "toolResult" && message.toolName === "read",
	);
	expect(read?.isError).toBe(false);
	expect(read?.content).toEqual([{ type: "text", text: expect.stringContaining("builtin read survives") }]);
}, 20000);

it("reports unsupported tool callbacks as package load errors without disabling the host session", async () => {
	const state = await workspace(
		Object.fromEntries(
			callbacks.map((field) => [
				`third-party-${field.toLowerCase()}`,
				`export default pi => pi.registerTool({name:"callback_probe",label:"Callback probe",description:"Must not silently lose ${field}",parameters:{type:"object",properties:{}},${field}(){return {};},async execute(){return {content:[{type:"text",text:"must-not-execute"}]};}});`,
			]),
		),
	);
	const loaded = state.resourceLoader.getExtensions();
	expect(loaded.errors).toHaveLength(callbacks.length);
	for (const field of callbacks)
		expect(
			loaded.errors.some(({ error }) =>
				error.includes(`Process-sandbox tool feature is not supported: callback_probe.${field}`),
			),
		).toBe(true);
	expect(loaded.extensions.flatMap((extension) => [...extension.tools.keys()])).not.toContain(
		"callback_probe",
	);
	const proof = join(state.root, "proof.txt");
	await writeFile(proof, "builtin read survives rejected sandbox packages");
	const session = await runSession(state, [
		fauxAssistantMessage(fauxToolCall("read", { path: proof })),
		fauxAssistantMessage("continued"),
	]);
	const read = session.messages.find(
		(message) => message.role === "toolResult" && message.toolName === "read",
	);
	expect(read?.isError).toBe(false);
	expect(read?.content).toEqual([
		{ type: "text", text: expect.stringContaining("survives rejected sandbox packages") },
	]);
}, 20000);

it("preserves serializable SDK tool declarations across the real worker and resource loader", async () => {
	const declarations = [
		false,
		{ type: "json_schema", strict: "require" },
		{ type: "grammar", variants: { openai_regex: "[a-z]+" } },
	].map((constrainedSampling, index) => ({
		name: `declaration_probe_${index}`,
		label: "Declaration probe",
		description: "Serializable SDK fields",
		parameters: { type: "object", properties: {} },
		outputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
		constrainedSampling,
		renderShell: index === 2 ? "self" : "default",
		namespace: { name: "sandbox_probe", description: "Synthetic tools", instructions: "Read-only fixture" },
		annotations: { readOnlyHint: true },
		executionMode: "sequential",
		promptSnippet: "Synthetic declaration",
		promptGuidelines: ["Read-only"],
	}));
	const state = await workspace({
		"third-party-declarations": `export default pi => {for(const definition of ${JSON.stringify(declarations)}) pi.registerTool({...definition,async execute(){return {content:[{type:"text",text:"value"}],structuredContent:{value:"value"}};}});};`,
	});
	const loaded = state.resourceLoader.getExtensions();
	expect(loaded.errors).toEqual([]);
	for (const declaration of declarations)
		expect(loaded.extensions[0].tools.get(declaration.name)?.definition).toMatchObject(declaration);
}, 20000);

it("routes third-party progress through the approved worker into real SDK tool update events", async () => {
	const state = await workspace({
		"third-party-progress": `export default pi => pi.registerTool({name:"third_party_progress",label:"Progress",description:"Synthetic progress",parameters:{type:"object",properties:{tag:{type:"string"}},required:["tag"]},executionMode:"parallel",async execute(id,{tag},signal,update){signal.throwIfAborted();update({content:[{type:"text",text:tag+":progress"}],details:{id,tag,pid:process.pid}});return {content:[{type:"text",text:tag+":done"}]};}});`,
	});
	const observed = [];
	const session = await runSession(
		state,
		[
			fauxAssistantMessage([
				fauxToolCall("third_party_progress", { tag: "first" }),
				fauxToolCall("third_party_progress", { tag: "second" }),
			]),
			fauxAssistantMessage("continued"),
		],
		(event) => observed.push(event),
	);
	expect(
		session.messages.filter((message) => message.role === "toolResult").every((message) => !message.isError),
	).toBe(true);
	const updates = observed.filter(
		(event) => event.type === "tool_execution_update" && event.toolName === "third_party_progress",
	);
	expect(updates).toHaveLength(2);
	for (const tag of ["first", "second"]) {
		const event = updates.find((event) => event.partialResult.details.tag === tag);
		expect(event.partialResult.details.id).toBe(event.toolCallId);
		expect(event.partialResult.details.pid).not.toBe(process.pid);
		expect(event.partialResult.content).toEqual([{ type: "text", text: `${tag}:progress` }]);
	}
	const progressResults = session.messages.filter(
		(message) => message.role === "toolResult" && message.toolName === "third_party_progress",
	);
	expect(progressResults.map((message) => message.content[0].text).sort()).toEqual([
		"first:done",
		"second:done",
	]);
});

it("revokes ordinary sandbox progress after cancellation without affecting another invocation", async () => {
	const state = await workspace({
		"third-party-cancel-progress": `export default pi => pi.registerTool({name:"progress",label:"Progress",description:"Cancelable progress",parameters:{type:"object",properties:{}},async execute(id,args,signal,update){update?.({content:[{type:"text",text:id+":started"}]});if(args.hold){await new Promise(resolve=>signal.addEventListener("abort",resolve,{once:true}));update({content:[{type:"text",text:id+":after-abort"}]});}return {content:[{type:"text",text:update?"observer":"no observer"}]};}});`,
	});
	const pkg = join(state.root, "packages/third-party-cancel-progress");
	const sandbox = new PluginSandboxSession({
		pluginId: "cancel-progress",
		packageRoot: pkg,
		entrypoint: join(pkg, "index.mjs"),
		cwd: state.root,
		runtimeDirectory,
	});
	try {
		const firstUpdates = vi.fn(),
			secondUpdates = vi.fn();
		const controller = new AbortController();
		const canceled = sandbox
			.invoke("progress", "cancel", { hold: true }, controller.signal, undefined, firstUpdates)
			.then(
				() => "unexpected success",
				(error) => error.message,
			);
		await vi.waitFor(() => expect(firstUpdates).toHaveBeenCalledTimes(1));
		controller.abort();
		expect(await canceled).toContain("aborted");
		expect(
			await sandbox.invoke("progress", "sibling", {}, undefined, undefined, secondUpdates),
		).toMatchObject({ content: [{ type: "text", text: "observer" }] });
		expect(firstUpdates).toHaveBeenCalledTimes(1);
		expect(secondUpdates).toHaveBeenCalledExactlyOnceWith({
			content: [{ type: "text", text: "sibling:started" }],
		});
		expect(await sandbox.invoke("progress", "no-observer", {})).toMatchObject({
			content: [{ type: "text", text: "no observer" }],
		});
	} finally {
		await sandbox.close();
	}
}, 20000);
