import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxToolCall as call, fauxProvider, fauxAssistantMessage as reply } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { closeKnowledgeServices } from "../../../.pi/lib/knowledge/service.mjs";
import { FAILURE_EXPLANATION_POLICY, TASK_HANDOFF_POLICY } from "../../../.pi/lib/tasks/failure-feedback.mjs";
import { PiBackend } from "../src/pi-backend";

// Actual SDK/provider/tool-result transport, but an in-memory fake model: no paid model or user credentials.
it("real SDK failure → task_status → natural handoff keeps pairing and does not replace the final answer", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "drone-failure-sdk-")));
	let backend;
	try {
		const cwd = join(root, "project"),
			agentDir = join(root, "agent");
		await mkdir(cwd);
		await mkdir(agentDir);
		vi.stubEnv("DRONE_KNOWLEDGE_DIR", join(root, "app"));
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		vi.stubEnv("PI_RESEARCH_DESKTOP_CONFIG", undefined);
		const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
			throw new Error("Network must not run in this fixture");
		});
		const runtime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(agentDir, "models-cache.json"),
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		const faux = fauxProvider({ provider: "failure-feedback-fixture" });
		runtime.registerNativeProvider(faux.provider);
		vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
		backend = new PiBackend({
			projectTrust: true,
			subagentPreferBuiltin: false,
			webFetch: false,
			desktopIntegration: {
				appendSystemPrompt: [],
				additionalExtensionPaths: [resolve("../../.pi/extensions/obsidian-workbench.mjs")],
				additionalSkillPaths: [],
			},
		});
		backend.modelRuntime = runtime;
		const meta = await backend.createSession({
			cwd,
			provider: faux.provider.id,
			modelId: faux.getModel().id,
		});
		const session = backend.registry.get(meta.sessionId).session;
		let captured;
		const answer =
			"读取 missing.csv 时发现文件不存在，因此还不能分析这份输入；我会先核对文件路径，不重跑其他已完成步骤。";
		faux.setResponses([
			() => reply([call("read", { path: "missing.csv" })], { stopReason: "toolUse" }),
			() => reply([call("task_status", {})], { stopReason: "toolUse" }),
			(context) => {
				captured = context;
				return reply(answer);
			},
		]);
		await session.prompt("读取 missing.csv，并说明任何失败对结果的影响和下一步。", {
			expandPromptTemplates: false,
		});
		expect(faux.state.callCount).toBe(3);
		expect(network).not.toHaveBeenCalled();
		expect(captured.messages.some((m) => m.role === "toolResult" && m.toolName === "task_status")).toBe(true);
		expect(captured.systemPrompt).toContain("not a copied task ledger");
		expect(captured.systemPrompt).toContain("which concrete step/file/service failed");
		expect(captured.systemPrompt).toContain("impact not yet known");
		const index = captured.messages.findIndex((m) => m.role === "toolResult" && m.toolName === "read");
		expect(index).toBeGreaterThan(0);
		const result = captured.messages[index];
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain("task_failure_context");
		expect(JSON.stringify(result.content)).toContain("missing.csv");
		expect(JSON.stringify(result.content)).toContain("ENOENT");
		// No custom status can split the assistant(tool_calls) / tool-result pair.
		const previous = captured.messages[index - 1];
		expect(previous.role).toBe("assistant");
		expect(previous.content.some((b) => b.type === "toolCall" && b.id === result.toolCallId)).toBe(true);
		expect(
			session.messages.some((m) => m.role === "assistant" && JSON.stringify(m.content).includes(answer)),
		).toBe(true);
	} finally {
		backend?.dispose();
		await closeKnowledgeServices();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}, 30000);
