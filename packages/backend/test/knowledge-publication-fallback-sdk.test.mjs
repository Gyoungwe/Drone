import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { taskHostLoader } from "@gyoungwe/pi-core/host";
import { expect, it, vi } from "vitest";
import { createBackend } from "../src/create-backend";

it("native core plus knowledge executes actual SDK read through fallback without exposing final draft or losing provider usage", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-native-fallback-sdk-")));
	const cwd = join(root, "project"),
		agentDir = join(root, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	await writeFile(join(cwd, "input.txt"), "Actual read input retained.\n");
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "knowledge"));
	vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const provider = fauxProvider({ provider: "native-fallback-sdk", tokensPerSecond: 0 });
	modelRuntime.registerNativeProvider(provider.provider);
	vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
	const require = createRequire(import.meta.url);
	const backend = createBackend({
		taskHostLoader,
		projectTrust: false,
		lazyCapabilities: false,
		webFetch: false,
		subagentPreferBuiltin: false,
		desktopIntegration: {
			appendSystemPrompt: [],
			additionalSkillPaths: [],
			additionalExtensionPaths: [
				require.resolve("@gyoungwe/pi-core"),
				require.resolve("@gyoungwe/pi-knowledge"),
			],
		},
	});
	const observed = [];
	backend.sessions.modelRuntime = modelRuntime;
	const stop = backend.sessions.onEvent((_id, event) => {
		if (event.type === "message_end") observed.push(structuredClone(event.message));
	});
	const draft = "UNPUBLISHED_FINAL_DRAFT_WITHOUT_HOST_PROOF";
	try {
		const meta = await backend.sessions.createSession({
			cwd,
			provider: provider.provider.id,
			modelId: provider.getModel().id,
		});
		const session = backend.sessions.registry.get(meta.sessionId).session;
		provider.setResponses([
			fauxAssistantMessage(
				[{ type: "text", text: "PRIVATE_PROGRESS_BEFORE_READ" }, fauxToolCall("read", { path: "input.txt" })],
				{ stopReason: "toolUse", responseId: "actual-provider-call" },
			),
			fauxAssistantMessage(draft, { responseId: "actual-provider-final" }),
		]);
		await session.prompt("Read input.txt and explain its bounded result.");
		await session.waitForIdle();
		expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
			toolName: "read",
			isError: false,
			content: [expect.objectContaining({ text: "Actual read input retained.\n" })],
		});
		const toolMessage = session.messages.find(
			(message) => message.role === "assistant" && message.stopReason === "toolUse",
		);
		expect(toolMessage).toMatchObject({
			responseId: "actual-provider-call",
			api: provider.getModel().api,
			provider: provider.provider.id,
			model: provider.getModel().id,
			content: [
				expect.objectContaining({ type: "toolCall", name: "read", arguments: { path: "input.txt" } }),
			],
		});
		expect(toolMessage.usage.input).toBeGreaterThan(0);
		const final = session.messages.filter((message) => message.role === "assistant").at(-1);
		expect(final).toMatchObject({
			responseId: "actual-provider-final",
			api: provider.getModel().api,
			provider: provider.provider.id,
			model: provider.getModel().id,
		});
		expect(final.usage.input).toBeGreaterThan(0);
		expect(JSON.stringify(final.content)).toContain("知识库检查未通过");
		const persisted = await readFile(session.sessionFile, "utf8");
		for (const visible of [JSON.stringify(session.messages), JSON.stringify(observed), persisted]) {
			expect(visible).not.toContain(draft);
			expect(visible).not.toContain("PRIVATE_PROGRESS_BEFORE_READ");
		}
		expect(observed.find((message) => message.stopReason === "toolUse").usage).toEqual(toolMessage.usage);
	} finally {
		stop();
		await backend.dispose();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	}
}, 20000);
