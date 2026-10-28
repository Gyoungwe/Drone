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
	expect(await invoke("session.inspect", null)).toEqual({ agentActive: false });
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
		invoke("model.generate", request(selection), { override: { callerIdentity: {} } }),
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
				expect(await invoke("session.inspect", null)).toEqual({ agentActive: true });
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
