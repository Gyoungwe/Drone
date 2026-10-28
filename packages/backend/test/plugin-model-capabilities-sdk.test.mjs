import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";
import { PluginCapabilityBroker } from "../src/plugins/runtime-capabilities";

let root, backend, session, faux, broker, caller;
const approvals = [];
afterEach(async () => {
	if (backend) {
		for (const entry of backend.registry.list()) await backend.closeSession(entry.session.sessionId);
		backend.dispose();
	}
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	if (root) await rm(root, { recursive: true, force: true });
});
async function setup(customTools = []) {
	root = await realpath(await mkdtemp(join(tmpdir(), "drone-model-capability-")));
	const agentDir = join(root, "agent"),
		cwd = join(root, "project");
	await mkdir(agentDir);
	await mkdir(cwd);
	await writeFile(join(cwd, "source.txt"), "read remains available");
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	faux = fauxProvider({ provider: "plugin-model-offline", tokensPerSecond: 0 });
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	backend = new PiBackend({
		projectTrust: false,
		lazyCapabilities: false,
		tools: ["read", ...customTools.map((tool) => tool.name)],
		customTools,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
		},
	});
	backend.modelRuntime = runtime;
	const meta = await backend.createSession({ cwd, provider: faux.provider.id, modelId: faux.getModel().id });
	session = backend.registry.get(meta.sessionId).session;
	caller = backend.getPluginCallerContext(meta.sessionId);
	broker = new PluginCapabilityBroker({ handlers: backend.getPluginSessionCapabilities(), resources: [] });
	approvals.length = 0;
}
async function invoke(operation, input, { deny = false, override = {} } = {}) {
	const context = {
		pluginId: "synthetic-model-client",
		applicationId: "test-app",
		scope: caller.scope,
		callerIdentity: caller.identity,
		sessionIdentity: caller.identity,
		signal: caller.signal,
		bootstrap: false,
		...override,
	};
	return broker.run(
		context,
		"write",
		() => {
			if (backend.getPluginCallerContext(caller.scope.sessionId)?.identity !== caller.identity)
				throw new Error("caller revoked");
		},
		async (name, _input, _effect, detail) => {
			approvals.push({ name, detail });
			return !deny;
		},
		() => broker.port.call(operation, input),
	);
}
const schema = {
	type: "object",
	properties: { decision: { enum: ["approve", "reject"] } },
	required: ["decision"],
	additionalProperties: false,
};
const request = (selection) => ({
	selection,
	systemPrompt: "Review only the supplied synthetic data.",
	prompt: "Synthetic evidence under condition A.",
	resultSchema: schema,
	maxTokens: 2800,
});
it("uses the real current SDK model once, asks about model data and cost, and returns no parent transcript or thinking", async () => {
	await setup();
	session.agent.state.messages = [{ role: "user", content: "PARENT_PRIVATE_HISTORY", timestamp: 1 }];
	const before = JSON.stringify(session.messages);
	const selection = await invoke("model.selection", {});
	expect(await invoke("session.inspect", null)).toEqual({
		agentActive: false,
		projectTrusted: true,
		readOnly: false,
	});
	let captured;
	faux.setResponses([
		(context) => {
			captured = context;
			return fauxAssistantMessage(
				[
					{ type: "thinking", thinking: "PRIVATE_MODEL_THINKING" },
					fauxToolCall("structured_result", { decision: "approve" }),
				],
				{ stopReason: "toolUse" },
			);
		},
	]);
	const result = await invoke("model.generate", request(selection));
	expect(result).toMatchObject({ selection, value: { decision: "approve" }, usage: { cost: null } });
	expect(captured.messages.map((message) => message.role)).toEqual(["system", "user"]);
	expect(JSON.stringify(captured)).not.toContain("PARENT_PRIVATE_HISTORY");
	expect(getCurrentTools(captured.messages).map((tool) => tool.name)).toEqual(["structured_result"]);
	expect(JSON.stringify(result)).not.toContain("PRIVATE_MODEL_THINKING");
	expect(JSON.stringify(session.messages)).toBe(before);
	expect(approvals.at(-1).detail).toContain(`${selection.provider}/${selection.model}`);
	expect(approvals.at(-1).detail).toContain("2800");
	expect(approvals.at(-1).detail).toMatch(/费用|charges/);
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("read", { path: "source.txt" })),
		fauxAssistantMessage("read complete"),
	]);
	await session.prompt("Read source.txt");
	expect(
		session.messages.some(
			(message) => message.role === "toolResult" && message.toolName === "read" && !message.isError,
		),
	).toBe(true);
});
it("denies unapproved or mismatched requests and stale, cross-session, application or untrusted callers before SDK calls", async () => {
	await setup();
	const selection = await invoke("model.selection", {});
	const complete = vi.spyOn(backend.modelRuntime, "completeSimple");
	await expect(invoke("model.generate", request(selection), { deny: true })).rejects.toThrow("denied");
	await expect(invoke("model.generate", request({ ...selection, model: "other-model" }))).rejects.toThrow(
		"selection",
	);
	await expect(
		invoke("model.generate", request(selection), { override: { sessionIdentity: {} } }),
	).rejects.toThrow("caller");
	await expect(
		invoke("model.generate", request(selection), { override: { scope: { kind: "application" } } }),
	).rejects.toThrow("selected live session");
	await expect(invoke("model.selection", { profile: "unconfigured-preference" })).rejects.toThrow(
		"not configured",
	);
	const trust = vi.spyOn(session.settingsManager, "isProjectTrusted").mockReturnValue(false);
	await expect(invoke("model.generate", request(selection))).rejects.toThrow("trusted");
	trust.mockRestore();
	expect(complete).not.toHaveBeenCalled();
	backend.registry.revoke(session.sessionId);
	await expect(invoke("model.generate", request(selection))).rejects.toThrow();
	expect(complete).not.toHaveBeenCalled();
});
it("rejects malformed or forbidden model tool outputs and preserves ordinary tools", async () => {
	await setup();
	const selection = await invoke("model.selection", {});
	for (const output of [
		fauxToolCall("structured_result", { decision: "invented" }),
		fauxToolCall("write", { path: "source.txt", content: "bad" }),
	]) {
		faux.setResponses([fauxAssistantMessage(output)]);
		await expect(invoke("model.generate", request(selection))).rejects.toThrow();
	}
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("read", { path: "source.txt" })),
		fauxAssistantMessage("read complete"),
	]);
	await session.prompt("Read source.txt");
	expect(
		session.messages.some(
			(message) => message.role === "toolResult" && message.toolName === "read" && !message.isError,
		),
	).toBe(true);
});
it("rejects a selection changed during a real model response", async () => {
	await setup();
	const selection = await invoke("model.selection", {});
	faux.setResponses([
		() => {
			session.agent.state.model = { ...session.model, id: "changed-during-model" };
			return fauxAssistantMessage(fauxToolCall("structured_result", { decision: "approve" }));
		},
	]);
	await expect(invoke("model.generate", request(selection))).rejects.toThrow("selection");
});

it("serves a real native SDK tool while its parent session is streaming", async () => {
	await setup([
		{
			name: "model_probe",
			label: "Model probe",
			description: "Generate a private structured result",
			parameters: { type: "object", properties: {} },
			async execute() {
				expect(session.isStreaming).toBe(true);
				expect(await invoke("session.inspect", null)).toEqual({
					agentActive: true,
					projectTrusted: true,
					readOnly: false,
				});
				const selection = await invoke("model.selection", {});
				const result = await invoke("model.generate", request(selection));
				return { content: [{ type: "text", text: JSON.stringify(result.value) }] };
			},
		},
	]);
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("model_probe", {})),
		fauxAssistantMessage(fauxToolCall("structured_result", { decision: "reject" })),
		fauxAssistantMessage("Parent completed"),
	]);
	await session.prompt("Run model_probe");
	await session.waitForIdle();
	const result = session.messages.find(
		(message) => message.role === "toolResult" && message.toolName === "model_probe",
	);
	expect(result?.isError, JSON.stringify(result)).toBe(false);
	expect(result.content[0].text).toBe('{"decision":"reject"}');
});

it("cancels a real SDK completion without returning a result and keeps the caller usable", async () => {
	await setup();
	const selection = await invoke("model.selection", {});
	const controller = new AbortController();
	let entered;
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	faux.setResponses([
		(_context, options) =>
			new Promise((_resolve, reject) => {
				entered();
				options.signal.addEventListener("abort", () => reject(new Error("synthetic model cancellation")), {
					once: true,
				});
			}),
	]);
	const result = invoke("model.generate", request(selection), { override: { signal: controller.signal } });
	const rejected = expect(result).rejects.toThrow();
	await started;
	controller.abort(new Error("synthetic cancel"));
	await rejected;
	faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", { decision: "reject" }))]);
	expect(await invoke("model.generate", request(selection))).toMatchObject({ value: { decision: "reject" } });
});

it("routes two same-session window approvals independently while capabilities receive the real session identity", async () => {
	await setup();
	const { PluginRuntimeBridge } = await import("../src/plugins/coordinator");
	const source = { pluginId: "model-probe", packageRoot: root, entrypoint: join(root, "probe.mjs") };
	const approvedOwners = [];
	const bridge = new PluginRuntimeBridge({
		source: () => source,
		enabled: () => true,
		getSessionContext: (id) => backend.getPluginCallerContext(id),
		capabilities: () => ({ resources: [], handlers: backend.getPluginSessionCapabilities() }),
		approve: async (owner, _source, operation) => {
			if (!operation) return true;
			approvedOwners.push(owner.id);
			return owner.id === 101;
		},
		factory: () => async () => ({
			operations: {
				generate: {
					inputSchema: { type: "null" },
					resultSchema: { type: "object" },
					effect: "write",
					async execute(_input, context) {
						const selection = await context.capabilities.call("model.selection", {});
						return context.capabilities.call("model.generate", request(selection));
					},
				},
			},
			dispose: async () => {},
		}),
	});
	const first = { id: 101, isDestroyed: () => false },
		second = { id: 202, isDestroyed: () => false };
	const a = await bridge.bind("ui", first),
		b = await bridge.bind("ui", second);
	const aSelection = bridge.selectSession(first, session.sessionId),
		bSelection = bridge.selectSession(second, session.sessionId);
	const complete = vi.spyOn(backend.modelRuntime, "completeSimple");
	await expect(bridge.invoke(second, b, "generate", null, bSelection)).rejects.toThrow("denied");
	expect(complete).not.toHaveBeenCalled();
	faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", { decision: "approve" }))]);
	expect(await bridge.invoke(first, a, "generate", null, aSelection)).toMatchObject({
		value: { decision: "approve" },
	});
	expect(approvedOwners).toEqual([202, 101, 101]);
	expect(complete).toHaveBeenCalledOnce();
	let entered;
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	let modelAborted = false;
	faux.setResponses([
		(_context, options) =>
			new Promise((_resolve, reject) => {
				entered();
				options.signal.addEventListener(
					"abort",
					() => {
						modelAborted = true;
						reject(new Error("actual provider canceled"));
					},
					{ once: true },
				);
			}),
	]);
	const pending = bridge.invoke(first, a, "generate", null, aSelection, "running-model");
	const rejected = expect(pending).rejects.toThrow();
	await started;
	expect(await bridge.cancel(first, a, aSelection, "running-model")).toBe(true);
	await rejected;
	expect(modelAborted).toBe(true);
	expect(await bridge.cancel(first, a, aSelection, "running-model")).toBe(false);
	bridge.selectSession(first, null);
	const restored = bridge.selectSession(first, session.sessionId);
	expect(restored).not.toBe(aSelection);
	await expect(bridge.cancel(first, a, aSelection, "running-model")).rejects.toThrow("lease");
	faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", { decision: "reject" }))]);
	expect(await bridge.invoke(first, a, "generate", null, restored, "restored-model")).toMatchObject({
		value: { decision: "reject" },
	});
	expect(complete).toHaveBeenCalledTimes(3);
	await bridge.close();
});

it("binds the real coordinator-native SDK caller before generating inside its active tool", async () => {
	await setup();
	const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await import(
		"@earendil-works/pi-coding-agent"
	);
	const { PluginRuntimeBridge } = await import("../src/plugins/coordinator");
	const nativeEntrypoint = join(root, "model-native.mjs");
	await writeFile(nativeEntrypoint, 'throw new Error("Managed entry must be replaced by its owner");');
	const source = {
		pluginId: "native-model-probe",
		packageRoot: root,
		entrypoint: join(root, "owner.mjs"),
		nativeEntrypoint,
	};
	const approve = vi.fn(async () => true);
	const bridge = new PluginRuntimeBridge({
		source: () => source,
		enabled: () => true,
		approve,
		getSessionContext: (id) => backend.getPluginCallerContext(id),
		capabilities: () => ({ resources: [], handlers: backend.getPluginSessionCapabilities() }),
		factory:
			() =>
			async ({ capabilities }) => ({
				operations: {},
				createNativeSession: async () => ({
					toolEffects: { model_bridge_probe: "write" },
					extension(pi) {
						pi.registerTool({
							name: "model_bridge_probe",
							label: "Model bridge probe",
							description: "Use scoped structured model",
							parameters: { type: "object", properties: {} },
							async execute() {
								const selection = await capabilities.call("model.selection", {});
								const result = await capabilities.call("model.generate", request(selection));
								return { content: [{ type: "text", text: JSON.stringify(result.value) }] };
							},
						});
					},
					dispose: async () => {},
				}),
				dispose: async () => {},
			}),
	});
	const window = { id: 303, isDestroyed: () => false };
	const bootstrap = bridge.beginNative(window, (path) =>
		path === nativeEntrypoint ? "native-ui" : undefined,
	);
	const cwd = join(root, "project"),
		agentDir = join(root, "agent");
	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		additionalExtensionPaths: [nativeEntrypoint],
		extensionFactoryForPath: bootstrap.factoryForPath,
	});
	await resourceLoader.reload({ resolveProjectTrust: async () => true });
	expect(resourceLoader.getExtensions().errors).toEqual([]);
	const { session: nativeSession } = await createAgentSession({
		cwd,
		agentDir,
		settingsManager,
		resourceLoader,
		modelRuntime: backend.modelRuntime,
		sessionManager: SessionManager.inMemory(cwd),
		model: faux.getModel(),
	});
	backend.registry.add({ session: nativeSession, cwd, unsubscribe: () => {} });
	bootstrap.bindSession(nativeSession.sessionId);
	await nativeSession.bindExtensions({});
	try {
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("model_bridge_probe", {})),
			fauxAssistantMessage(fauxToolCall("structured_result", { decision: "approve" })),
			fauxAssistantMessage("Native completed"),
		]);
		await nativeSession.prompt("Run the model bridge probe");
		await nativeSession.waitForIdle();
		const result = nativeSession.messages.find(
			(message) => message.role === "toolResult" && message.toolName === "model_bridge_probe",
		);
		expect(result?.isError, JSON.stringify(result)).toBe(false);
		expect(result.content[0].text).toBe('{"decision":"approve"}');
		expect(approve.mock.calls.filter((call) => call[2] === "capability:model.generate")[0][0]).toBe(window);
	} finally {
		await bootstrap.dispose();
		await backend.closeSession(nativeSession.sessionId);
		await bridge.close();
	}
});

it("reports current SDK trust and registry read-only facts without treating them as grants", async () => {
	await setup();
	session.settingsManager.setProjectTrusted(false);
	backend.registry.get(session.sessionId).readOnly = true;
	expect(await invoke("session.inspect", null)).toEqual({
		agentActive: false,
		projectTrusted: false,
		readOnly: true,
	});
	await expect(invoke("model.selection", {})).rejects.toThrow("writable trusted");
	backend.registry.revoke(session.sessionId);
	await expect(invoke("session.inspect", null)).rejects.toThrow();
});

const stepRequest = (selection) => ({
	selection,
	systemPrompt: "Private isolated worker instruction",
	messages: [{ role: "user", content: [{ type: "text", text: "Only this supplied note" }], timestamp: 1 }],
	tools: [
		{
			name: "knowledge_read",
			description: "Ask the calling package for an assigned note",
			parameters: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
				additionalProperties: false,
			},
		},
	],
	maxTokens: 3000,
});
it("returns one actual private SDK tool step with exact signatures/metadata and known-zero cache counts, without running its tools or inheriting parent history", async () => {
	await setup();
	session.agent.state.messages = [
		{ role: "user", content: "PARENT_SECRET_MUST_NOT_BE_INHERITED", timestamp: 1 },
	];
	const before = JSON.stringify(session.messages);
	const selection = await invoke("model.selection", {});
	let captured, capturedOptions;
	const reply = Object.assign(
		fauxAssistantMessage(
			[
				{ type: "thinking", thinking: "PRIVATE_STEP_THOUGHT", thinkingSignature: "actual-signed-thinking" },
				fauxToolCall("knowledge_read", { path: "Library/Papers/source.md" }),
			],
			{ stopReason: "toolUse", responseId: "actual-step-id" },
		),
		{
			providerThinkingLevel: "provider-native-effort",
			rawStopReason: "tool_use",
			durationMs: 12,
			usage: {
				input: 0,
				output: 30,
				cacheRead: 0,
				cacheWrite: 0,
				reasoning: 0,
				totalTokens: 30,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		},
	);
	faux.setResponses([
		(context, options) => {
			captured = context;
			capturedOptions = options;
			return reply;
		},
	]);
	const result = await invoke("model.toolStep", {
		...stepRequest(selection),
		systemPrompt: "s".repeat(18000),
		maxTokens: 12000,
	});
	expect(result.reply.content).toEqual(reply.content);
	expect(result.reply).toMatchObject({
		responseId: "actual-step-id",
		providerThinkingLevel: "provider-native-effort",
		rawStopReason: "tool_use",
		durationMs: 12,
	});
	expect(result.usage).toMatchObject({
		inputTokens: result.reply.usage.input,
		outputTokens: result.reply.usage.output,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: null,
		cost: null,
	});
	expect(result.usage.reportedFields).toContain("inputTokens");
	expect(result.usage.reportedFields).not.toContain("cost");
	expect(JSON.stringify(captured)).not.toContain("PARENT_SECRET_MUST_NOT_BE_INHERITED");
	expect(getCurrentTools(captured.messages).map((tool) => tool.name)).toEqual(["knowledge_read"]);
	expect(JSON.stringify(session.messages)).toBe(before);
	expect(faux.state.callCount).toBe(1);
	expect(approvals.at(-1)).toMatchObject({ name: "model.toolStep" });
	expect(approvals.at(-1).detail).toContain("12000");
	expect(capturedOptions.maxTokens).toBe(12000);
});
it("blocks unapproved, mismatched and duplicate-schema private steps before any SDK request", async () => {
	await setup();
	const selection = await invoke("model.selection", {});
	const complete = vi.spyOn(backend.modelRuntime, "completeSimple");
	await expect(invoke("model.toolStep", stepRequest(selection), { deny: true })).rejects.toThrow("denied");
	await expect(invoke("model.toolStep", stepRequest({ ...selection, model: "forged" }))).rejects.toThrow(
		"selection",
	);
	await expect(
		invoke("model.toolStep", {
			...stepRequest(selection),
			tools: [...stepRequest(selection).tools, ...stepRequest(selection).tools],
		}),
	).rejects.toThrow("unique");
	await expect(
		invoke("model.toolStep", { ...stepRequest(selection), systemPrompt: "界".repeat(12000) }),
	).rejects.toThrow("bounded");
	await expect(
		invoke("model.toolStep", stepRequest(selection), { override: { sessionIdentity: {} } }),
	).rejects.toThrow("caller");
	await expect(
		invoke("model.toolStep", {
			...stepRequest(selection),
			tools: [
				{ ...stepRequest(selection).tools[0], parameters: { type: "object", functionCallback: () => true } },
			],
		}),
	).rejects.toThrow("JSON data");
	expect(complete).not.toHaveBeenCalled();
});
it("awaits actual tool-step cancellation cleanup and leaves a fresh call usable", async () => {
	await setup();
	const selection = await invoke("model.selection", {}),
		controller = new AbortController();
	let entered,
		cleaned = false;
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	faux.setResponses([
		(_context, options) =>
			new Promise((_resolve, reject) => {
				entered();
				options.signal.addEventListener(
					"abort",
					() =>
						setImmediate(() => {
							cleaned = true;
							reject(new Error("actual synthetic cleanup"));
						}),
					{ once: true },
				);
			}),
	]);
	const pending = invoke("model.toolStep", stepRequest(selection), {
		override: { signal: controller.signal },
	});
	const rejected = expect(pending).rejects.toThrow();
	await started;
	controller.abort();
	await rejected;
	expect(cleaned).toBe(true);
	faux.setResponses([fauxAssistantMessage(fauxToolCall("knowledge_read", { path: "other.md" }))]);
	expect((await invoke("model.toolStep", stepRequest(selection))).reply.content[0].name).toBe(
		"knowledge_read",
	);
});

it("resolves optional profiles only when truly unset and never falls back from a configured unavailable model", async () => {
	await setup();
	const parent = await invoke("model.selection", {});
	const missing = await invoke("model.selection", { optionalProfile: "optional-specialist" });
	expect(missing).toEqual({ ...parent, optionalProfile: "optional-specialist" });
	await backend.setSubagentModel("optional-specialist", `${parent.provider}/${parent.model}`);
	const configured = await invoke("model.selection", { optionalProfile: "optional-specialist" });
	expect(configured).toEqual({ ...parent, profile: "optional-specialist" });
	const complete = vi.spyOn(backend.modelRuntime, "completeSimple");
	await expect(invoke("model.toolStep", stepRequest(missing))).rejects.toThrow("selection");
	await backend.setSubagentModel("optional-specialist", "missing-provider/missing-model");
	await expect(invoke("model.selection", { optionalProfile: "optional-specialist" })).rejects.toThrow(
		"unavailable",
	);
	await expect(invoke("model.toolStep", stepRequest(configured))).rejects.toThrow("unavailable");
	expect(complete).not.toHaveBeenCalled();
	await expect(
		invoke("model.selection", { profile: "strict", optionalProfile: "optional" }),
	).rejects.toThrow();
});
