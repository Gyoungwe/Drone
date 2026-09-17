import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxToolCall as call, fauxProvider, fauxAssistantMessage as reply } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { closeKnowledgeServices } from "../../../.pi/lib/knowledge/service.mjs";
import { PiBackend } from "../src/pi-backend";

function assertWire(messages) {
	let pending = new Set();
	for (const m of messages) {
		if (m.role === "toolResult") {
			expect(pending.has(m.toolCallId), `orphan tool result ${m.toolCallId}`).toBe(true);
			pending.delete(m.toolCallId);
			continue;
		}
		expect(pending.size, `interrupted tool batch before ${m.role}/${m.customType || ""}`).toBe(0);
		if (m.role === "assistant")
			pending = new Set(m.content.filter((b) => b.type === "toolCall").map((b) => b.id));
	}
	expect(pending.size, "incomplete tool batch sent to provider").toBe(0);
}
it.each(["reopen", "close-pending"])(
	"persisted session lifecycle %s does not lose consent or run stale contexts",
	async (mode) => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "drone-auth-wire-")));
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
				throw new Error("Network forbidden in fixture");
			});
			const runtime = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: null,
				modelsStorePath: join(agentDir, "cache.json"),
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const faux = fauxProvider({ provider: "auth-wire-fixture" });
			runtime.registerNativeProvider(faux.provider);
			vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
			backend = new PiBackend({
				projectTrust: true,
				webFetch: false,
				subagentPreferBuiltin: false,
				desktopIntegration: {
					appendSystemPrompt: [],
					additionalExtensionPaths: [resolve("../../.pi/extensions/obsidian-workbench.mjs")],
					additionalSkillPaths: [],
				},
			});
			backend.modelRuntime = runtime;
			let asks = 0;
			backend.onAskRequest((req) => {
				asks++;
				queueMicrotask(() =>
					backend.respondAsk(req.id, {
						kind: "answer",
						mode: "submit",
						answers: { value: { values: [asks === 1 ? "同意本次请求" : "接着做完剩下的"] } },
					}),
				);
			});
			const meta = await backend.createSession({
				cwd,
				provider: faux.provider.id,
				modelId: faux.getModel().id,
			});
			let session = backend.registry.get(meta.sessionId).session;
			const checked = (response) => (context) => {
				assertWire(context.messages);
				return response;
			};

			faux.setResponses([
				checked(
					reply(
						[
							call("task_plan", {
								goal: "Write one bounded result",
								summary: "Write one bounded result",
								writeDirectories: ["."],
								milestones: [
									{ id: "report", title: "Report", acceptance: { kind: "file", path: "result.md" } },
								],
							}),
						],
						{ stopReason: "toolUse" },
					),
				),
				checked(reply("Report is not written yet; remaining delivery is result.md.")),
			]);
			await session.prompt("Create a code report file in this project after task authorization.", {
				expandPromptTemplates: false,
			});
			expect(asks).toBe(1);
			if (mode === "reopen") {
				const file = session.sessionFile;
				await backend.closeSession(meta.sessionId);
				const restored = await backend.openSession(file);
				expect(restored.sessionId).toBe(meta.sessionId);
				session = backend.registry.get(restored.sessionId).session;
			}
			const view = [...session.messages].reverse().find((m) => m.details?.taskView)?.details.taskView;
			const task = view.tasks.find((t) => t.id === view.activeTaskId);
			expect(task.remainingSummary).toContain("剩余 1 项");
			faux.setResponses([
				checked(
					reply([call("write", { path: "result.md", content: "# Delivered\n" })], { stopReason: "toolUse" }),
				),
				checked(reply([call("task_status", {})], { stopReason: "toolUse" })),
				checked(reply("QUICK_DELIVERY_COMPLETE")),
			]);
			const command = Buffer.from(
				JSON.stringify({ taskId: task.id, revision: view.revision, action: "progress" }),
			).toString("base64url");
			await backend.prompt(meta.sessionId, `/task-action ${command}`);
			expect(asks).toBe(2);
			if (mode === "reopen") {
				await vi.waitFor(
					() => expect(JSON.stringify(session.messages)).toContain("QUICK_DELIVERY_COMPLETE"),
					{ timeout: 5000 },
				);
				expect(await readFile(join(cwd, "result.md"), "utf8")).toContain("Delivered");
				const finalView = [...session.messages].reverse().find((m) => m.details?.taskView)?.details.taskView;
				expect(finalView.tasks.find((t) => t.id === task.id).remainingSummary).toContain("已验收 1/1");
			} else {
				await backend.closeSession(meta.sessionId);
				await new Promise((resolve) => setTimeout(resolve, 40));
				await expect(readFile(join(cwd, "result.md"))).rejects.toMatchObject({ code: "ENOENT" });
				expect(faux.state.callCount).toBe(2);
			}
			expect(asks).toBe(2);
			assertWire(session.messages);
			expect(network).not.toHaveBeenCalled();
		} finally {
			backend?.dispose();
			await closeKnowledgeServices();
			vi.restoreAllMocks();
			vi.unstubAllEnvs();
			await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	},
	30000,
);
