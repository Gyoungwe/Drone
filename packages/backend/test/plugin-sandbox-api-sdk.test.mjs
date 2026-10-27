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

async function runSession(workspace, responses) {
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
