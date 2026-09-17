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
it.each([
	{ approved: true, mode: "sequential" },
	{ approved: false, mode: "sequential" },
	{ approved: true, mode: "parallel" },
	{ approved: false, mode: "parallel" },
])(
	"real SDK one ask_user decision → valid wire → delivery, approved=$approved mode=$mode",
	async ({ approved, mode }) => {
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
					backend.respondAsk(
						req.id,
						approved
							? { kind: "answer", mode: "submit", answers: { value: { values: ["同意本次请求"] } } }
							: { kind: "cancel" },
					),
				);
			});
			const meta = await backend.createSession({
				cwd,
				provider: faux.provider.id,
				modelId: faux.getModel().id,
			});
			const session = backend.registry.get(meta.sessionId).session;
			session.agent.toolExecution = mode;
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
							call("task_status", {}),
						],
						{ stopReason: "toolUse" },
					),
				),
				...(approved
					? [
							checked(
								reply(
									[
										call("write", {
											path: "result.md",
											content: "# Result\nCompleted within approved scope.\n",
										}),
									],
									{ stopReason: "toolUse" },
								),
							),
							checked(reply([call("task_status", {})], { stopReason: "toolUse" })),
						]
					: []),
				checked(reply(approved ? "DELIVERED result.md" : "DECLINED; no file written")),
			]);
			await session.prompt("Create a code report file in this project after asking for task authorization.", {
				expandPromptTemplates: false,
			});
			assertWire(session.messages);
			expect(asks).toBe(1);
			expect(faux.state.callCount).toBe(approved ? 4 : 2);
			expect(JSON.stringify(session.messages)).toContain(
				approved ? "DELIVERED result.md" : "DECLINED; no file written",
			);
			expect(network).not.toHaveBeenCalled();
			if (approved) expect(await readFile(join(cwd, "result.md"), "utf8")).toContain("Completed");
			else await expect(readFile(join(cwd, "result.md"))).rejects.toMatchObject({ code: "ENOENT" });
			if (approved) {
				faux.setResponses([checked(reply("Continuation needs no repeated write."))]);
				await session.prompt("继续", { expandPromptTemplates: false });
				assertWire(session.messages);
				expect(asks).toBe(1);
				expect(
					session.messages.filter((m) => m.role === "toolResult" && m.toolName === "write"),
				).toHaveLength(1);
				// A completed task is not silently reopened by "continue".
				expect(faux.state.callCount).toBe(4);
				// Seed the exact legacy interleaving and verify the next provider context is repaired.
				const history = session.agent.state.messages;
				const statusIndex = history.findIndex(
					(m) => m.role === "custom" && m.customType === "drone-task-status",
				);
				const [legacyStatus] = history.splice(statusIndex, 1);
				const resultIndex = history.findIndex((m) => m.role === "toolResult");
				history.splice(resultIndex, 0, legacyStatus);
				let recovered = false;
				faux.setResponses([
					(context) => {
						assertWire(context.messages);
						recovered = true;
						return reply("Existing report explained without changes.");
					},
				]);
				await session.prompt("Explain the existing result.md without changing files.", {
					expandPromptTemplates: false,
				});
				expect(recovered).toBe(true);
				expect(asks).toBe(1);
				expect(
					session.messages.filter((m) => m.role === "toolResult" && m.toolName === "write"),
				).toHaveLength(1);
			}
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
