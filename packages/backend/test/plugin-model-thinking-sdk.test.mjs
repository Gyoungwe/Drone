import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, onTestFinished, vi } from "vitest";
import { PiBackend } from "../src/pi-backend";
import { PluginCapabilityBroker } from "../src/plugins/runtime-capabilities";

async function setup() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-model-thinking-")));
	const agentDir = join(root, "agent"),
		cwd = join(root, "project");
	await mkdir(agentDir);
	await mkdir(cwd);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", undefined);
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const faux = fauxProvider({
		provider: "plugin-thinking-offline",
		tokensPerSecond: 0,
		models: [
			{ id: "parent", reasoning: true },
			{ id: "limited", reasoning: true },
			{ id: "plain", reasoning: false },
		],
	});
	faux.getModel("limited").thinkingLevelMap = { high: null };
	runtime.registerNativeProvider(faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	const backend = new PiBackend({
		projectTrust: false,
		lazyCapabilities: false,
		tools: [],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
		},
	});
	onTestFinished(async () => {
		for (const entry of backend.registry.list()) await backend.closeSession(entry.session.sessionId);
		backend.dispose();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	});
	backend.modelRuntime = runtime;
	const meta = await backend.createSession({ cwd, provider: faux.provider.id, modelId: "parent" });
	const session = backend.registry.get(meta.sessionId).session;
	await backend.setThinkingLevel(session.sessionId, "high");
	await backend.setSubagentModel("specialist", `${faux.provider.id}/limited`);
	return {
		backend,
		session,
		faux,
		complete: vi.spyOn(runtime, "completeSimple"),
		...client(backend, session),
	};
}

function client(backend, session) {
	const caller = backend.getPluginCallerContext(session.sessionId);
	const broker = new PluginCapabilityBroker({
		handlers: backend.getPluginSessionCapabilities(),
		resources: [],
	});
	const approvals = [];
	const invoke = (operation, input) =>
		broker.run(
			{
				pluginId: "synthetic-thinking-client",
				applicationId: "test-app",
				scope: caller.scope,
				callerIdentity: caller.identity,
				sessionIdentity: caller.identity,
				signal: caller.signal,
				bootstrap: false,
			},
			"write",
			() => {
				if (backend.getPluginCallerContext(caller.scope.sessionId)?.identity !== caller.identity)
					throw new Error("caller revoked");
			},
			async (name, _input, _effect, detail) => {
				approvals.push({ name, detail });
				return true;
			},
			() => broker.port.call(operation, input),
		);
	return { invoke, approvals };
}

const selectionInput = { profile: "specialist", inheritedThinking: "nearest-supported" };
const resultSchema = {
	type: "object",
	properties: { decision: { enum: ["approve"] } },
	required: ["decision"],
	additionalProperties: false,
};
const request = (selection) => ({
	selection,
	systemPrompt: "Review only the supplied synthetic data.",
	prompt: "Synthetic evidence.",
	resultSchema,
	maxTokens: 2800,
});
const stepRequest = (selection) => ({
	selection,
	systemPrompt: "Review only the supplied synthetic data.",
	messages: [{ role: "user", content: [{ type: "text", text: "Synthetic evidence." }], timestamp: 1 }],
	tools: [{ name: "structured_result", description: "Return a decision", parameters: resultSchema }],
	maxTokens: 2800,
});

it("resolves opted-in inherited thinking in selections, approvals and actual SDK generate/tool-step options", async () => {
	const { invoke, approvals, faux, complete } = await setup();
	for (const input of [
		{ inheritedThinking: "nearest-supported" },
		{ optionalProfile: "unset-specialist", inheritedThinking: "nearest-supported" },
	]) {
		expect(await invoke("model.selection", input)).toMatchObject({
			model: "parent",
			thinkingLevel: "high",
			...input,
		});
	}
	for (const level of ["medium", "minimal"]) {
		if (level === "minimal") faux.getModel("limited").thinkingLevelMap.medium = null;
		const selection = await invoke("model.selection", selectionInput);
		expect(selection).toEqual({
			provider: faux.provider.id,
			model: "limited",
			thinkingLevel: level,
			profile: "specialist",
			inheritedThinking: "nearest-supported",
		});
		for (const [operation, input] of [
			["model.generate", request(selection)],
			["model.toolStep", stepRequest(selection)],
		]) {
			faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", { decision: "approve" }))]);
			expect((await invoke(operation, input)).selection).toEqual(selection);
			expect(approvals.at(-1).detail).toContain(`thinking: ${level}`);
			expect(complete.mock.calls.at(-1)[2].reasoning).toBe(level);
		}
	}
	expect(complete).toHaveBeenCalledTimes(4);
	expect(faux.state.callCount).toBe(4);
});

it("resolves opted-in inherited high to off for a non-reasoning model", async () => {
	const { backend, invoke, approvals, faux, complete } = await setup();
	await backend.setSubagentModel("specialist", `${faux.provider.id}/plain`);
	const selection = await invoke("model.selection", selectionInput);
	expect(selection).toMatchObject({ thinkingLevel: "off", inheritedThinking: "nearest-supported" });
	faux.setResponses([fauxAssistantMessage(fauxToolCall("structured_result", { decision: "approve" }))]);
	expect((await invoke("model.generate", request(selection))).selection).toEqual(selection);
	expect(approvals.at(-1).detail).toContain("thinking: off");
	expect(complete.mock.calls[0][2].reasoning).toBeUndefined();
	expect(complete).toHaveBeenCalledOnce();
	expect(faux.state.callCount).toBe(1);
});

it("keeps explicitly configured unsupported profile thinking strict despite the opt-in", async () => {
	const { backend, invoke, faux, complete } = await setup();
	await backend.setSubagentThinking("specialist", "high");
	await expect(invoke("model.selection", selectionInput)).rejects.toThrow(
		"Selected model thinking level is unavailable",
	);
	expect(complete).not.toHaveBeenCalled();
	expect(faux.state.callCount).toBe(0);
});

it("keeps unsupported inherited thinking strict when the opt-in is omitted or explicitly strict", async () => {
	const { backend, session, invoke, faux, complete } = await setup();
	for (const input of [{ profile: "specialist" }, { profile: "specialist", inheritedThinking: "strict" }]) {
		await expect(invoke("model.selection", input)).rejects.toThrow(
			"Selected model thinking level is unavailable",
		);
	}
	await backend.setThinkingLevel(session.sessionId, "medium");
	const selection = await invoke("model.selection", { profile: "specialist", inheritedThinking: "strict" });
	expect(selection).toEqual({
		provider: faux.provider.id,
		model: "limited",
		thinkingLevel: "medium",
		profile: "specialist",
	});
	expect(complete).not.toHaveBeenCalled();
	expect(faux.state.callCount).toBe(0);
});

it("rejects an opted-in selection after the parent thinking changes before generate", async () => {
	const { backend, session, invoke, faux, complete } = await setup();
	const selection = await invoke("model.selection", selectionInput);
	await backend.setThinkingLevel(session.sessionId, "low");
	await expect(invoke("model.generate", request(selection))).rejects.toThrow("Model selection changed");
	expect(complete).not.toHaveBeenCalled();
	expect(faux.state.callCount).toBe(0);
});

it("rejects unavailable configured models despite the opt-in before any SDK request", async () => {
	const { backend, invoke, faux, complete } = await setup();
	await backend.setSubagentModel("specialist", "missing-provider/missing-model");
	await expect(invoke("model.selection", selectionInput)).rejects.toThrow(
		"Configured model preference is unavailable; no provider fallback was used",
	);
	expect(complete).not.toHaveBeenCalled();
	expect(faux.state.callCount).toBe(0);
});
