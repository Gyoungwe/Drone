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
it.each(["double", "cancel-retry"])(
	"registered command %s completes exactly once",
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
			let asks = 0,
				pendingAsk;
			backend.onAskRequest((req) => {
				asks++;
				if (asks === 1)
					queueMicrotask(() =>
						backend.respondAsk(req.id, {
							kind: "answer",
							mode: "submit",
							answers: { value: { values: ["同意本次请求"] } },
						}),
					);
				else pendingAsk = req;
			});
			const meta = await backend.createSession({
				cwd,
				provider: faux.provider.id,
				modelId: faux.getModel().id,
			});
			const session = backend.registry.get(meta.sessionId).session;
			const checked = (response) => (context) => {
				assertWire(context.messages);
				return response;
			};

			faux.setResponses([
				checked(
					reply(
						[
							call("task_plan", {
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
			const submit = () => backend.prompt(meta.sessionId, `/task-action ${command}`).catch((error) => error);
			let first = submit();
			await vi.waitFor(() => expect(pendingAsk).toBeTruthy());
			let second;
			if (mode === "double") {
				second = submit();
				await new Promise((resolve) => setImmediate(resolve));
			} else {
				backend.respondAsk(pendingAsk.id, { kind: "cancel" });
				await first;
				expect(faux.state.callCount).toBe(2);
				pendingAsk = null;
				first = submit();
				await vi.waitFor(() => expect(pendingAsk).toBeTruthy());
			}
			backend.respondAsk(pendingAsk.id, {
				kind: "answer",
				mode: "submit",
				answers: { value: { values: ["按原范围继续完成剩余事项"] } },
			});
			expect(await first).not.toBeInstanceOf(Error);
			if (second) expect(await second).not.toBeInstanceOf(Error);
			await vi.waitFor(() => expect(JSON.stringify(session.messages)).toContain("QUICK_DELIVERY_COMPLETE"), {
				timeout: 5000,
			});
			expect(asks).toBe(mode === "double" ? 2 : 3);
			expect(session.messages.filter((m) => m.role === "toolResult" && m.toolName === "write")).toHaveLength(
				1,
			);
			expect(await readFile(join(cwd, "result.md"), "utf8")).toContain("Delivered");
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
