import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, onTestFinished, vi } from "vitest";
import { PluginCapabilityBroker } from "../src/plugins/runtime-capabilities";
import { SessionService } from "../src/session-service";

const schema = {
	type: "object",
	properties: { decision: { enum: ["approve", "reject"] } },
	required: ["decision"],
	additionalProperties: false,
};

async function setup() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-model-errors-")));
	const harness = { root, approvals: [], streams: [], marker: `SYNTHETIC-SECRET-MARKER-${randomUUID()}` };
	registerCleanup(harness);
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
	harness.faux = fauxProvider({ provider: "plugin-model-errors-offline", tokensPerSecond: 0 });
	observeStreams(harness);
	runtime.registerNativeProvider(harness.faux.provider);
	vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
	harness.backend = new SessionService({
		projectTrust: false,
		lazyCapabilities: false,
		tools: ["read"],
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
		},
	});
	harness.backend.modelRuntime = runtime;
	const meta = await harness.backend.createSession({
		cwd,
		provider: harness.faux.provider.id,
		modelId: harness.faux.getModel().id,
	});
	harness.session = harness.backend.registry.get(meta.sessionId).session;
	harness.session.agent.state.messages = [{ role: "user", content: "Synthetic parent note", timestamp: 1 }];
	harness.parentTranscript = JSON.stringify(harness.session.messages);
	harness.caller = harness.backend.getPluginCallerContext(meta.sessionId);
	harness.broker = new PluginCapabilityBroker({
		handlers: harness.backend.getPluginSessionCapabilities(),
		resources: [],
	});
	harness.selection = await invoke(harness, "model.selection", {});
	return harness;
}

function registerCleanup(harness) {
	onTestFinished(async () => {
		try {
			if (harness.backend) {
				for (const entry of harness.backend.registry.list())
					await harness.backend.closeSession(entry.session.sessionId);
				harness.backend.dispose();
			}
		} finally {
			vi.restoreAllMocks();
			vi.unstubAllEnvs();
			await rm(harness.root, { recursive: true, force: true });
		}
	});
}

function observeStreams(harness) {
	const streamSimple = harness.faux.provider.streamSimple.bind(harness.faux.provider);
	// Observe the actual provider stream without replacing SDK completions or broker results.
	vi.spyOn(harness.faux.provider, "streamSimple").mockImplementation((...args) => {
		const stream = streamSimple(...args);
		harness.streams.push(stream);
		return stream;
	});
}

function invoke(harness, operation, input, signal = harness.caller.signal) {
	const { backend, broker, caller, approvals } = harness;
	return broker.run(
		{
			pluginId: "synthetic-model-errors-client",
			applicationId: "test-app",
			scope: caller.scope,
			callerIdentity: caller.identity,
			sessionIdentity: caller.identity,
			signal,
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
}

function request(selection, operation) {
	const common = { selection, systemPrompt: "Review only synthetic evidence.", maxTokens: 2800 };
	if (operation === "model.generate")
		return { ...common, prompt: "Synthetic evidence.", resultSchema: schema };
	return {
		...common,
		messages: [{ role: "user", content: [{ type: "text", text: "Synthetic evidence." }], timestamp: 1 }],
		tools: [{ name: "structured_result", description: "Return a synthetic decision", parameters: schema }],
	};
}

function secretText(harness) {
	return `Authorization: Bearer ${harness.marker}\napi_key=${harness.marker}`;
}

async function observeFailure(harness, operation, response, signal = harness.caller.signal) {
	const callsBefore = harness.faux.state.callCount;
	harness.faux.setResponses([response]);
	const observation = await invoke(harness, operation, request(harness.selection, operation), signal).then(
		(result) => ({ result, error: null }),
		(error) => ({ result: null, error }),
	);
	expect(harness.faux.state.callCount).toBe(callsBefore + 1);
	const reply = await harness.streams.at(-1).result();
	expect(
		JSON.stringify(reply).includes(harness.marker),
		"actual SDK reply carries the synthetic marker",
	).toBe(true);
	observation.sdkReply = reply;
	observation.transcript = JSON.stringify(harness.session.messages);
	expect(harness.approvals.some((approval) => approval.name === operation)).toBe(true);
	expect(observation.transcript).toBe(harness.parentTranscript);
	// Recovery runs before secrecy assertions so a reproduced leak cannot bypass it.
	harness.faux.setResponses([
		fauxAssistantMessage(fauxToolCall("structured_result", { decision: "approve" })),
	]);
	const recovered = await invoke(harness, "model.generate", request(harness.selection, "model.generate"));
	expect(recovered).toMatchObject({ selection: harness.selection, value: { decision: "approve" } });
	expect(harness.faux.state.callCount).toBe(callsBefore + 2);
	expect(JSON.stringify(harness.session.messages)).toBe(harness.parentTranscript);
	observation.approvals = harness.approvals.filter((approval) => approval.detail !== undefined);
	return observation;
}

function expectRejected(observation, message) {
	expect(observation.result).toBeNull();
	expect(observation.error).toBeInstanceOf(Error);
	expect(observation.error.message).toMatch(message);
}

function expectProviderFailure(observation, operation) {
	expect(observation.sdkReply.stopReason).toBe("error");
	if (operation === "model.generate") {
		expectRejected(observation, /^Structured model request did not complete \(error\)$/);
	} else {
		// The private-step contract returns an assistant error reply instead of rejecting.
		expect(observation.error).toBeNull();
		expect(observation.result).not.toHaveProperty("value");
		expect(observation.result.reply.stopReason).toBe("error");
	}
}

function expectSecretSafe(harness, observations) {
	for (const observation of observations) {
		for (let error = observation.error; error; error = error.cause) {
			expect.soft(String(error), "String(error) excludes the synthetic marker").not.toContain(harness.marker);
			expect.soft(error.message, "error.message excludes the synthetic marker").not.toContain(harness.marker);
		}
		expect
			.soft(JSON.stringify(observation.result), "serialized result excludes the synthetic marker")
			.not.toContain(harness.marker);
		for (const approval of observation.approvals)
			expect
				.soft(approval.detail, "approval detail excludes the synthetic marker")
				.not.toContain(harness.marker);
		expect
			.soft(observation.transcript, "parent transcript excludes the synthetic marker")
			.not.toContain(harness.marker);
	}
}

function streamingResponse(harness, controller, streamed) {
	return () => {
		const stream = harness.streams.at(-1),
			push = stream.push.bind(stream);
		vi.spyOn(stream, "push").mockImplementation((event) => {
			push(event);
			if (event.type === "text_delta") {
				streamed.text += event.delta;
				if (streamed.text.includes(secretText(harness))) controller.abort();
			}
		});
		return fauxAssistantMessage(`${secretText(harness)}\n${"Synthetic trailing text. ".repeat(30)}`);
	};
}

it("contains provider throws through real SDK generate and toolStep failures", async () => {
	const harness = await setup(),
		observations = [];
	for (const operation of ["model.generate", "model.toolStep"]) {
		const observation = await observeFailure(harness, operation, () => {
			throw new Error(secretText(harness));
		});
		expectProviderFailure(observation, operation);
		observations.push(observation);
	}
	expectSecretSafe(harness, observations);
});

it("contains provider error replies through real SDK generate and toolStep failures", async () => {
	const harness = await setup(),
		observations = [];
	for (const operation of ["model.generate", "model.toolStep"]) {
		const observation = await observeFailure(
			harness,
			operation,
			fauxAssistantMessage("Synthetic provider failure", {
				stopReason: "error",
				errorMessage: secretText(harness),
			}),
		);
		expectProviderFailure(observation, operation);
		observations.push(observation);
	}
	expectSecretSafe(harness, observations);
});

it("contains malformed structured_result arguments through the real SDK schema failure", async () => {
	const harness = await setup();
	const observation = await observeFailure(
		harness,
		"model.generate",
		fauxAssistantMessage(fauxToolCall("structured_result", { decision: secretText(harness) }), {
			stopReason: "toolUse",
		}),
	);
	expectRejected(observation, /^Validation failed for tool "structured_result":/);
	expectSecretSafe(harness, [observation]);
});

it("contains cancellation during real SDK marker streaming and keeps both callers usable", async () => {
	const harness = await setup(),
		observations = [];
	for (const operation of ["model.generate", "model.toolStep"]) {
		const controller = new AbortController(),
			streamed = { text: "" };
		const observation = await observeFailure(
			harness,
			operation,
			streamingResponse(harness, controller, streamed),
			controller.signal,
		);
		expect(
			streamed.text.includes(secretText(harness)),
			"actual text deltas carry both synthetic secret shapes",
		).toBe(true);
		expect(controller.signal.aborted).toBe(true);
		expect(observation.sdkReply.stopReason).toBe("aborted");
		expectRejected(observation, /^This operation was aborted$/);
		observations.push(observation);
	}
	expectSecretSafe(harness, observations);
});
